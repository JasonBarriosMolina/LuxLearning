import { CloudWatchLogsClient, FilterLogEventsCommand, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient, ListTablesCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { getCosts } from './costs';

// Read-only tools for the platform assistant (costs-chat.ts). Everything returned to the model is
// untrusted data (logs can contain user input): the system prompt tells the model never to follow
// instructions found in tool results. Secrets are redacted before leaving this file.

const region = process.env.AWS_REGION ?? 'us-east-1';
const logs = new CloudWatchLogsClient({ region });
const cw = new CloudWatchClient({ region });
const lambda = new LambdaClient({ region });
const ddbMeta = new DynamoDBClient({ region });

export type Env = 'test' | 'staging' | 'prod';
const ENVS: Env[] = ['test', 'staging', 'prod'];
const suffix = (env: Env) => (env === 'prod' ? '' : `-${env}`);
const envOfFn = (name: string): Env => (name.endsWith('-test') ? 'test' : name.endsWith('-staging') ? 'staging' : 'prod');

const redact = (s: string) => s
  .replace(/postgres(ql)?:\/\/[^@\s]+@/gi, 'postgresql://***@')
  .replace(/(password|passwd|secret|token|api[_-]?key|authorization)(["'\s:=]+)(Bearer\s+)?[^\s"',}&]{6,}/gi, '$1$2***')
  .replace(/AIza[0-9A-Za-z_-]{30,}/g, 'AIza***')
  .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '$1***')
  .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, 'jwt***');

const clamp = (n: unknown, def: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(n)) || def));
const asEnv = (v: unknown): Env => (ENVS.includes(v as Env) ? (v as Env) : 'test');

async function luxFunctions(env: Env): Promise<any[]> {
  const out: any[] = [];
  let marker: string | undefined;
  do {
    const r = await lambda.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
    out.push(...(r.Functions ?? []).filter((f) => f.FunctionName?.startsWith('lux-') && envOfFn(f.FunctionName) === env));
    marker = r.NextMarker;
  } while (marker);
  return out;
}

// ── Tools ────────────────────────────────────────────────────────────────────
const envProp = { type: 'string', enum: ENVS, description: 'Ambiente de Lux Learning: test, staging o prod' };

export const TOOLS = [
  {
    name: 'get_costs',
    description: 'Costos AWS de la cuenta (Cost Explorer): total, por servicio, por día, tipos de uso, estimado por ambiente (test/staging/prod/compartido) y tokens por Lambda. Estimaciones por ambiente explicadas en la nota del resultado.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', description: 'Periodo en días (7-90, default 30)' } } },
  },
  {
    name: 'search_logs',
    description: 'Busca en los logs de CloudWatch de las Lambdas de Lux. Por defecto solo errores (ERROR/Exception/timeouts), más recientes primero. Úsala para "último error", fallos recientes o rastrear un mensaje. Sin "lambda" revisa todas las Lambdas del ambiente.',
    input_schema: {
      type: 'object',
      properties: {
        environment: envProp,
        lambda: { type: 'string', description: 'Nombre corto sin prefijo ni sufijo, ej. "admin", "evaluator", "courses". Opcional.' },
        minutes: { type: 'integer', description: 'Ventana hacia atrás en minutos (default 1440 = 24h, máx 10080)' },
        errors_only: { type: 'boolean', description: 'true (default) = solo errores. false = cualquier línea (usa con "contains")' },
        contains: { type: 'string', description: 'Texto a buscar en el mensaje (opcional)' },
        limit: { type: 'integer', description: 'Máx eventos a devolver (default 10, máx 30)' },
      },
      required: ['environment'],
    },
  },
  {
    name: 'lambda_health',
    description: 'Salud de las Lambdas de un ambiente en las últimas horas: invocaciones, errores, throttles y duración máxima por función (métricas CloudWatch).',
    input_schema: { type: 'object', properties: { environment: envProp, hours: { type: 'integer', description: 'default 24, máx 168' } }, required: ['environment'] },
  },
  {
    name: 'list_lambdas',
    description: 'Inventario de Lambdas de un ambiente: runtime, memoria, timeout, tamaño, última modificación y NOMBRES de variables de entorno (nunca sus valores).',
    input_schema: { type: 'object', properties: { environment: envProp }, required: ['environment'] },
  },
  {
    name: 'dynamo_tables',
    description: 'Tablas DynamoDB de Lux de un ambiente con conteo aproximado de ítems y tamaño en MB.',
    input_schema: { type: 'object', properties: { environment: envProp }, required: ['environment'] },
  },
];

async function searchLogs(input: any) {
  const env = asEnv(input.environment);
  const minutes = clamp(input.minutes, 1440, 5, 10080);
  const limit = clamp(input.limit, 10, 1, 30);
  const errorsOnly = input.errors_only !== false;
  const contains = typeof input.contains === 'string' ? input.contains.replace(/["\\]/g, '').slice(0, 80) : '';

  let groups: string[];
  if (typeof input.lambda === 'string' && input.lambda.trim()) {
    const short = input.lambda.trim().replace(/^lux-/, '').replace(/-(test|staging)$/, '').replace(/[^a-z0-9-]/gi, '');
    groups = [`/aws/lambda/lux-${short}${suffix(env)}`];
  } else {
    const names: string[] = [];
    let token: string | undefined;
    do {
      const r = await logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: '/aws/lambda/lux-', nextToken: token }));
      names.push(...(r.logGroups ?? []).map((g) => g.logGroupName!).filter((n) => envOfFn(n) === env));
      token = r.nextToken;
    } while (token);
    groups = names;
  }

  const terms = errorsOnly ? '?ERROR ?Exception ?"Task timed out" ?"Runtime.ExitError" ?"Unhandled"' : '';
  const filterPattern = [terms, contains ? `"${contains}"` : ''].filter(Boolean).join(' ') || undefined;
  const startTime = Date.now() - minutes * 60_000;

  const perGroup = await Promise.all(groups.slice(0, 40).map(async (g) => {
    try {
      const r = await logs.send(new FilterLogEventsCommand({ logGroupName: g, startTime, filterPattern, limit: 25 }));
      return (r.events ?? []).map((e) => ({ group: g.replace('/aws/lambda/', ''), ts: e.timestamp ?? 0, message: e.message ?? '' }));
    } catch (err: any) {
      return err?.name === 'ResourceNotFoundException' ? [] : [{ group: g, ts: 0, message: `(no se pudo leer: ${err?.name})` }];
    }
  }));

  const events = perGroup.flat()
    .filter((e) => !e.message.includes('NodeVersionSupportWarning'))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map((e) => ({
      lambda: e.group, time: e.ts ? new Date(e.ts).toISOString() : null,
      message: redact(e.message.trim()).slice(0, 900),
    }));
  return { environment: env, window_minutes: minutes, groups_searched: groups.length, matches: events.length, events };
}

async function lambdaHealth(input: any) {
  const env = asEnv(input.environment);
  const hours = clamp(input.hours, 24, 1, 168);
  const fns = (await luxFunctions(env)).map((f) => f.FunctionName as string);
  if (!fns.length) return { environment: env, functions: [] };
  const stats = ['Invocations', 'Errors', 'Throttles'] as const;
  const queries = fns.flatMap((fn, i) => [
    ...stats.map((m) => ({ Id: `${m[0]!.toLowerCase()}${i}`, MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: m, Dimensions: [{ Name: 'FunctionName', Value: fn }] }, Period: hours * 3600, Stat: 'Sum' } })),
    { Id: `d${i}`, MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'Duration', Dimensions: [{ Name: 'FunctionName', Value: fn }] }, Period: hours * 3600, Stat: 'Maximum' } },
  ]);
  const vals: Record<string, number> = {};
  for (let i = 0; i < queries.length; i += 400) {
    const r = await cw.send(new GetMetricDataCommand({
      MetricDataQueries: queries.slice(i, i + 400) as any, StartTime: new Date(Date.now() - hours * 3600_000), EndTime: new Date(),
    }));
    for (const m of r.MetricDataResults ?? []) vals[m.Id!] = Math.round((m.Values ?? []).reduce((s, v) => s + v, 0) * 100) / 100;
  }
  const functions = fns.map((fn, i) => ({
    lambda: fn, invocations: vals[`i${i}`] ?? 0, errors: vals[`e${i}`] ?? 0, throttles: vals[`t${i}`] ?? 0, max_duration_ms: vals[`d${i}`] ?? 0,
  })).sort((a, b) => b.errors - a.errors || b.invocations - a.invocations);
  return { environment: env, window_hours: hours, functions };
}

async function listLambdas(input: any) {
  const env = asEnv(input.environment);
  return {
    environment: env,
    functions: (await luxFunctions(env)).map((f) => ({
      name: f.FunctionName, runtime: f.Runtime, memory_mb: f.MemorySize, timeout_s: f.Timeout,
      size_mb: Math.round((f.CodeSize ?? 0) / 1048576 * 10) / 10, last_modified: f.LastModified,
      env_var_names: Object.keys(f.Environment?.Variables ?? {}).sort(),
    })),
  };
}

// Same names as db-core BASE_TABLES / helpers; prod has no suffix.
const LUX_TABLE_BASES = [
  'LessonProgress', 'QuizAttempts', 'Reflections', 'Notifications', 'Enrollments', 'Certificates', 'PushSubscriptions',
  'ScheduledTasks', 'ReportAnalysis', 'CurriculumRecommendations', 'LuxActivity', 'LuxCertTemplates', 'LuxResources',
  'LuxTranslations', 'LuxCalendarEvents', 'LuxUserProfiles', 'LuxSubmissions', 'LuxInterviews', 'LuxClasses', 'LuxAttendance',
  'LuxStudyPlans', 'LuxGamification', 'LuxSlides', 'LuxMentorInteractions', 'LuxMediaUsage', 'LuxChats', 'LuxMessages', 'LuxEmailTemplates',
];

async function dynamoTables(input: any) {
  const env = asEnv(input.environment);
  const all: string[] = [];
  let start: string | undefined;
  do {
    const r = await ddbMeta.send(new ListTablesCommand({ ExclusiveStartTableName: start }));
    all.push(...(r.TableNames ?? []));
    start = r.LastEvaluatedTableName;
  } while (start);
  const wanted = LUX_TABLE_BASES.map((b) => `${b}${env === 'prod' ? '' : env === 'test' ? '-Test' : '-Staging'}`).filter((n) => all.includes(n));
  const tables = await Promise.all(wanted.map(async (name) => {
    try {
      const t = (await ddbMeta.send(new DescribeTableCommand({ TableName: name }))).Table;
      return { name, items: t?.ItemCount ?? 0, size_mb: Math.round((t?.TableSizeBytes ?? 0) / 1048576 * 100) / 100, status: t?.TableStatus };
    } catch { return { name, items: null, size_mb: null, status: 'error' }; }
  }));
  return { environment: env, note: 'ItemCount se actualiza cada ~6 h en DynamoDB (aproximado).', tables: tables.sort((a, b) => (b.items ?? 0) - (a.items ?? 0)) };
}

const trimCosts = (d: any) => ({
  periodo: { dias: d.days, desde: d.from, hasta: d.to }, resumen: d.summary, servicios: d.services, tipos_de_uso_top: d.usageTypes.slice(0, 25),
  costo_diario_total: d.daily.map((r: any) => ({ fecha: r.date, total: r.total })),
  ambientes: { total_atribuido_por_ambiente: d.environments.totals, cobertura: d.environments.coverage,
    lambda_y_apigw_repartidos_por_uso: d.environments.infra, costo_real_por_tag_lux_env: d.environments.tag,
    test: d.environments.test, staging: d.environments.staging, prod: d.environments.prod, compartido: d.environments.shared,
    factura_ia_media_total: d.environments.aiBillTotal, diario_por_ambiente: d.environments.daily, nota: d.environments.note },
});

export async function runTool(name: string, input: any): Promise<string> {
  try {
    const r = name === 'get_costs' ? trimCosts(await getCosts(clamp(input?.days, 30, 7, 90)))
      : name === 'search_logs' ? await searchLogs(input ?? {})
      : name === 'lambda_health' ? await lambdaHealth(input ?? {})
      : name === 'list_lambdas' ? await listLambdas(input ?? {})
      : name === 'dynamo_tables' ? await dynamoTables(input ?? {})
      : { error: `Herramienta desconocida: ${name}` };
    return JSON.stringify(r).slice(0, 60_000);
  } catch (err: any) {
    console.error('[platform-chat] tool failed:', name, err?.name, err?.message);
    return JSON.stringify({ error: `La herramienta falló: ${err?.name ?? 'Error'}` });
  }
}

export const TOOL_LABELS: Record<string, string> = {
  get_costs: 'Consultando costos', search_logs: 'Buscando en CloudWatch Logs', lambda_health: 'Revisando salud de las Lambdas',
  list_lambdas: 'Listando Lambdas', dynamo_tables: 'Revisando tablas DynamoDB',
};
