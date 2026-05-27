import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import type { SQSEvent } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import webpush from 'web-push';
import { getPrismaClient } from '../shared/db-neon';
import { saveReflection, getReflection, updateReflectionStatus, hasPassedQuiz, isModuleUnlocked, getPushSubscriptionsByRole } from '../shared/db-dynamo';
import { ok, badRequest, forbidden, serverError, cors, setRequestOrigin } from '../shared/response';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });

// Configure web-push VAPID
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@luxlearning.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

const MIN_WORDS = 80;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

// ─── HTTP Handler ─────────────────────────────────────────────────────────────

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();
  setRequestOrigin(event.headers?.origin ?? event.headers?.Origin);

  const userId = event.requestContext.authorizer?.lambda?.userId ?? '';
  const studentEmail = event.requestContext.authorizer?.lambda?.email ?? '';
  if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const prisma = getPrismaClient();

  try {
    // GET /reflection/:moduleId
    const getMatch = path.match(/^\/reflection\/([^/]+)$/);
    if (method === 'GET' && getMatch) {
      const moduleId = getMatch[1]!;
      const reflection = await getReflection(userId, moduleId);
      return ok(reflection);
    }

    // POST /reflection/ai-preview — must be checked BEFORE the generic POST /reflection block
    if (method === 'POST' && path === '/reflection/ai-preview') {
      const body = JSON.parse(event.body ?? '{}');
      const { text, moduleTitle } = body as { text: string; moduleTitle?: string };
      if (!text || countWords(text) < 20) return badRequest('Se necesitan al menos 20 palabras para analizar');

      const prompt = `Eres un evaluador pedagógico especializado en el tema de "${moduleTitle ?? 'este módulo'}". Un estudiante acaba de estudiar este módulo y está escribiendo su reflexión de aprendizaje. Quiere saber si puede mejorarla antes de enviarla.

Una buena reflexión de aprendizaje debe:
- Demostrar comprensión real de los conceptos del módulo (no copiarlos)
- Conectar lo aprendido con experiencias o situaciones propias concretas
- Mostrar pensamiento crítico: qué sorprendió, qué cambió, qué aplicará
- Usar lenguaje propio (no parafrasear definiciones genéricas)

REFLEXIÓN DEL ESTUDIANTE:
"""
${text.slice(0, 3000)}
"""

Evalúa si esta reflexión demuestra aprendizaje genuino sobre "${moduleTitle ?? 'el módulo'}" y proporciona:
1. Una evaluación honesta pero motivadora (1-2 oraciones)
2. Exactamente 3 sugerencias específicas y accionables para mejorarla

Responde ÚNICAMENTE con JSON válido:
{
  "assessment": "Evaluación breve aquí",
  "suggestions": ["Sugerencia 1", "Sugerencia 2", "Sugerencia 3"],
  "readyToSubmit": true o false
}`;

      try {
        const response = await bedrock.send(new InvokeModelCommand({
          modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 768,
            messages: [{ role: 'user', content: prompt }],
          }),
        }));
        const raw = JSON.parse(new TextDecoder().decode(response.body));
        const content = raw.content?.[0]?.text ?? '';
        const clean = content.replace(/```json|```/g, '').trim();
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return serverError('AI response format error');
        const parsed = JSON.parse(jsonMatch[0]);
        return ok(parsed);
      } catch (aiErr) {
        console.error('[Reflection] AI preview error:', aiErr);
        return serverError('AI preview failed');
      }
    }

    // POST /reflection
    if (method === 'POST') {
      const body = JSON.parse(event.body ?? '{}');
      const { moduleId, text } = body as { moduleId: string; text: string };

      if (!moduleId || !text) return badRequest('moduleId and text are required');

      // Word count validation (backend security)
      const wordCount = countWords(text);
      if (wordCount < MIN_WORDS) {
        return badRequest(`Reflection must be at least ${MIN_WORDS} words. Current: ${wordCount}`);
      }

      // Verify quiz was passed
      const quizPassed = await hasPassedQuiz(userId, moduleId);
      if (!quizPassed) return forbidden('You must pass the quiz before submitting a reflection');

      // Check module unlock
      const module = await prisma.module.findUnique({
        where: { id: moduleId },
        include: { course: { include: { modules: { orderBy: { order: 'asc' }, select: { id: true, order: true } } } } },
      });

      if (!module) return badRequest('Module not found');

      const moduleRefs = module.course.modules.map((m) => ({ id: m.id, order: m.order }));
      const unlocked = await isModuleUnlocked(userId, module.order, moduleRefs);
      if (!unlocked) return forbidden('Module is locked');

      // Save reflection with PENDING_AI status
      const submittedAt = new Date().toISOString();
      const deadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const reflection = {
        userId,
        studentEmail,
        moduleId,
        text,
        wordCount,
        status: 'PENDING_AI' as const,
        submittedAt,
        deadline,
      };

      // Guard: do not allow overwriting an approved or in-review reflection
      const existing = await getReflection(userId, moduleId);
      if (existing) {
        if (existing.status === 'APPROVED') {
          return badRequest('Esta reflexión ya fue aprobada y no puede reescribirse');
        }
        if (existing.status === 'PENDING_AI' || existing.status === 'PENDING_EVAL') {
          return badRequest('Tu reflexión está siendo revisada. Espera el resultado antes de reenviar');
        }
      }

      await saveReflection(reflection);

      // Send to SQS for AI processing
      await sqs.send(new SendMessageCommand({
        QueueUrl: process.env.SQS_REFLECTION_QUEUE_URL!,
        MessageBody: JSON.stringify({ userId, moduleId }),
        // Standard queue — MessageGroupId is not used (only valid for FIFO queues)
      }));

      // Fire-and-forget push notification to all evaluators
      // Use IIFE so any synchronous throw (e.g. missing VAPID config) is also caught
      void (async () => {
        try {
          if (!VAPID_PUBLIC || !VAPID_PRIVATE) return; // VAPID not configured — skip silently
          const subs = await getPushSubscriptionsByRole('EVALUATOR');
          if (!subs.length) return;
          const payload = JSON.stringify({
            title: 'Nueva reflexión pendiente',
            body: `${module.title} · ${wordCount} palabras`,
            url: '/evaluator/reflections',
          });
          await Promise.allSettled(
            subs.map((sub) =>
              webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
            )
          );
        } catch {
          // Non-fatal — push failure must never block the student's response
        }
      })();

      return ok(reflection, 'Reflection submitted. Processing with AI...');
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
