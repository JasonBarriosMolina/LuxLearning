// lux-study-plans Lambda — thin router (API Gateway) + EventBridge cron handler.
import { cors, forbidden, notFound, serverError, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin, initEnvFromFunctionName } from '../shared/env-context';
import { handleStudyPlans, runSuggestionsWorker } from './plans';
import { runCronGeneration } from './cron';

type AnyEvent = any;

export const handler = async (event: AnyEvent) => {
  // ── EventBridge scheduled event (Monday cron) ────────────────────────────
  if (event.source === 'aws.events' || event['detail-type'] === 'Scheduled Event') {
    initEnvFromFunctionName();
    await runCronGeneration();
    return { statusCode: 200, body: 'ok' };
  }

  // ── Bedrock suggestions background worker (self-invoke via Lambda) ────────
  if (event._studyPlanSuggestionsWorker) {
    const { userId, weekOf, promptLines } = event;
    await runSuggestionsWorker(userId, weekOf, promptLines ?? []);
    return { statusCode: 200, body: 'ok' };
  }

  // ── API Gateway event ─────────────────────────────────────────────────────
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext?.http?.method === 'OPTIONS') return cors();

  const auth = event.requestContext?.authorizer?.lambda;
  if (!auth?.userId) return forbidden('Auth required');

  const userId = auth.userId as string;
  const method = event.requestContext.http.method as string;
  const path = event.rawPath as string;

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const ctx = { event, method, path, body, userId };

    const result = await handleStudyPlans(ctx) ?? notFound('Ruta no encontrada');
    return result;
  } catch (err) {
    return serverError(err);
  }
};
