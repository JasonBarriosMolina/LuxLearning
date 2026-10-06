import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AdminCtx, bedrock, lambdaClient } from './ctx';
import { getCosts } from './costs';
import { PROJECT_CONTEXT } from './costs-context';
import { ddb, TABLES, saveAiJob } from '../shared/db-dynamo';
import { getCurrentEnv } from '../shared/env-context';
import { ok, badRequest, forbidden } from '../shared/response';

// POST /admin/costs/chat { question, history?, days? } → { jobId }   (ADMIN / SUPER_ADMIN)
// Poll the answer with GET /admin/courses/ai-job?jobId=…  ({ status, result: { answer } }).
// API Gateway times out at 29 s, so the Sonnet call runs in a self-invoked worker.

const MODEL_ID = process.env.COST_CHAT_MODEL ?? 'global.anthropic.claude-sonnet-4-6';
const HOURLY_LIMIT = Number(process.env.COST_CHAT_HOURLY_LIMIT ?? 40);
const MAX_HISTORY = 10;
const MAX_TURN_CHARS = 4000;

type Turn = { role: 'user' | 'assistant'; content: string };

/** Per-user hourly message counter. Fails open: a missing table must not block the chat. */
async function underHourlyLimit(userId: string): Promise<boolean> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLES.MEDIA_USAGE,
      Key: { pk: `chat#${new Date().toISOString().slice(0, 13)}`, sk: userId },
      UpdateExpression: 'ADD n :one SET #ttl = :ttl',
      ConditionExpression: 'attribute_not_exists(n) OR n < :max',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':max': HOURLY_LIMIT, ':ttl': Math.floor(Date.now() / 1000) + 7200 },
    }));
    return true;
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') return false;
    return true;
  }
}

function cleanHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const turns = raw
    .filter((t: any) => (t?.role === 'user' || t?.role === 'assistant') && typeof t?.content === 'string' && t.content.trim())
    .map((t: any) => ({ role: t.role as Turn['role'], content: String(t.content).slice(0, MAX_TURN_CHARS) }))
    .slice(-MAX_HISTORY);
  while (turns.length && turns[0]!.role !== 'user') turns.shift(); // Bedrock needs a user-first transcript
  return turns;
}

// Keep the dashboard payload compact: the model needs numbers, not every chart point's formatting.
function dataForModel(d: any) {
  return {
    ambiente_consultado: d.env, periodo: { dias: d.days, desde: d.from, hasta: d.to }, resumen: d.summary,
    servicios: d.services, tipos_de_uso_top: d.usageTypes,
    costo_diario_total: d.daily.map((r: any) => ({ fecha: r.date, total: r.total })),
    ambientes: {
      test: d.environments.test, staging: d.environments.staging, prod: d.environments.prod,
      compartido: d.environments.shared, factura_ia_media_total: d.environments.aiBillTotal,
      diario_por_ambiente: d.environments.daily, nota: d.environments.note,
    },
  };
}

function systemPrompt(d: any): string {
  return `Eres el analista de costos del dashboard de Lux Learning. Respondes en español, de forma directa y con números concretos (USD).
Reglas:
- Basa TODA cifra en los datos JSON de abajo. Si el dato no está, dilo; no inventes cifras ni supongas facturas que no ves.
- Los costos por ambiente son ESTIMADOS (ver nota en los datos); recuérdalo cuando compares ambientes.
- Para comparaciones calcula diferencias absolutas y porcentuales. Señala anomalías (picos diarios, servicios que crecen) y propón acciones concretas de ahorro cuando sea útil.
- Sobre código/arquitectura solo conoces el contexto de plataforma de abajo, no los archivos del repositorio. Si te piden detalle de código, indica qué archivo o módulo probablemente interviene según el contexto y que debe revisarse en el repo.
- Formato: Markdown breve (listas y tablas pequeñas están bien). No repitas la pregunta.

<contexto_plataforma>
${PROJECT_CONTEXT}
</contexto_plataforma>

<datos_costos generado="${d.generatedAt}">
${JSON.stringify(dataForModel(d))}
</datos_costos>`;
}

async function answer(question: string, history: Turn[], days: number): Promise<string> {
  const data = await getCosts(days);
  const messages: Turn[] = [...history, { role: 'user', content: question }];
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 2500,
      system: systemPrompt(data),
      messages,
    }),
  }));
  const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
  const text = (parsed.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  if (!text) throw new Error('Respuesta vacía del modelo');
  return text;
}

export async function handleCostsChat(ctx: AdminCtx): Promise<any | null> {
  const { method, path, event, body, userId } = ctx;

  // ── Worker branch (self-invoked, no HTTP context) ──
  if (ctx.action === 'costs-chat') {
    const { _jobId, question, history, days } = body as { _jobId: string; question: string; history: Turn[]; days: number };
    try {
      const text = await answer(question, history, days);
      await saveAiJob(_jobId, { status: 'done', result: { answer: text, model: MODEL_ID } });
    } catch (err: any) {
      console.error('[costs-chat] failed:', err?.name, err?.message);
      await saveAiJob(_jobId, { status: 'error', error: 'No se pudo generar la respuesta. Intenta de nuevo.' });
    }
    return ok({});
  }

  // ── Dispatch branch ──
  if (!(method === 'POST' && path === '/admin/costs/chat')) return null;

  const role = event.requestContext.authorizer?.lambda?.role;
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return forbidden('Solo ADMIN o SUPER_ADMIN pueden usar el chat de costos');

  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, MAX_TURN_CHARS) : '';
  if (!question) return badRequest('question es requerido');
  const days = Math.min(90, Math.max(7, Number(body?.days) || 30));

  if (!(await underHourlyLimit(userId ?? 'anon'))) {
    return badRequest(`Límite de ${HOURLY_LIMIT} mensajes por hora alcanzado. Intenta más tarde.`);
  }

  const jobId = `costchat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await saveAiJob(jobId, { status: 'processing' });
  try {
    await lambdaClient.send(new LambdaInvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({
        _action: 'costs-chat', _jobId: jobId, _env: getCurrentEnv(),
        question, history: cleanHistory(body?.history), days,
      })),
    }));
  } catch (err: any) {
    await saveAiJob(jobId, { status: 'error', error: 'No se pudo iniciar la consulta. Intenta de nuevo.' });
    console.error('[costs-chat] invoke failed:', err?.message);
    return badRequest('No se pudo iniciar la consulta');
  }
  return ok({ jobId });
}
