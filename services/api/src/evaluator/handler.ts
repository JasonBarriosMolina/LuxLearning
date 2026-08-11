// lux-evaluator Lambda entry point — thin router that delegates to domain modules.
import { getPrismaClient } from '../shared/db-neon';
import { cors, forbidden, notFound, serverError, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';
import { Event } from './ctx';
import { handleReflections } from './reflections';
import { handleCourses } from './courses';
import { handleTasks } from './tasks';
import { handleResources } from './resources';
import { handleCalendar } from './calendar';
import { handleGroups } from './groups';
import { handleSubmissions } from './submissions';
import { handleMisc } from './misc';
import { handleEvalStudyPlans } from './study-plans';

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const auth = event.requestContext.authorizer?.lambda;
  if (auth?.role !== 'EVALUATOR' && auth?.role !== 'ADMIN' && auth?.role !== 'SUPER_ADMIN') {
    return forbidden('Evaluator role required');
  }

  const userId = auth?.userId ?? '';
  const role = auth?.role ?? '';
  const isAdminRole = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // getPrismaClient inside try-catch so DB init errors return 500 instead of crashing (502)
    const prisma = await getPrismaClient();
    const body = event.body ? JSON.parse(event.body) : {};

    const ctx = { event, method, path, prisma, body, userId, role, isAdminRole };

    const result =
      await handleReflections(ctx) ??
      await handleCourses(ctx) ??
      await handleTasks(ctx) ??
      await handleResources(ctx) ??
      await handleCalendar(ctx) ??
      await handleGroups(ctx) ??
      await handleSubmissions(ctx) ??
      await handleEvalStudyPlans(ctx) ??
      await handleMisc(ctx) ??
      notFound('Ruta no encontrada');

    return result;
  } catch (err) {
    return serverError(err);
  }
};
