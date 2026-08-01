// TODO FASE 5: recursos por curso (LuxResources DDB + S3) — carpetas, colores, papelera 60 días
// lux-admin Lambda entry point — thin router that delegates to domain modules.
import { getPrismaClient } from '../shared/db-neon';
import { cors, forbidden, notFound, serverError, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin, setCurrentEnv, AppEnv } from '../shared/env-context';
import { Event, isAuthorized } from './ctx';
import { handleCourses } from './courses';
import { handleUsers } from './users';
import { handleReports } from './reports';
import { handleAI } from './ai';
import { handleProfile } from './profile';
import { handleFiles } from './files';
import { handleGroups } from './groups';
import { handleInterviews } from './interviews';

export const handler = async (event: Event) => {
  // Self-invoked async workers land _action directly on the event (no requestContext/body)
  const _selfAction = (event as any)._action as string | undefined;

  const _env = (event as any)._env as string | undefined;
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  if (_env === 'test' || _env === 'staging' || _env === 'prod') {
    setCurrentEnv(_env as AppEnv);
  } else {
    setEnvironmentFromOrigin(origin);
  }

  if (!_selfAction) {
    if (event.requestContext.http.method === 'OPTIONS') return cors();
    if (!isAuthorized(event)) return forbidden('Se requiere rol de evaluador o administrador');
  }

  const method = _selfAction ? 'WORKER' : event.requestContext.http.method;
  const path = _selfAction ? '' : event.rawPath;

  try {
    // getPrismaClient inside try-catch so DB init errors return 500 instead of crashing (502)
    const prisma = await getPrismaClient();
    const body = _selfAction ? (event as any) : (event.body ? JSON.parse(event.body) : {});
    const action = _selfAction ?? ((body as any)._action as string | undefined);
    const userId = event.requestContext?.authorizer?.lambda?.userId;

    const ctx = { event, method, path, prisma, body, action, userId };

    const result =
      await handleCourses(ctx) ??
      await handleUsers(ctx) ??
      await handleReports(ctx) ??
      await handleAI(ctx) ??
      await handleProfile(ctx) ??
      await handleFiles(ctx) ??
      await handleGroups(ctx) ??
      await handleInterviews(ctx) ??
      notFound('Ruta no encontrada');

    return result;
  } catch (err) {
    return serverError(err);
  }
};
