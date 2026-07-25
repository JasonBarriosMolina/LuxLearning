// TODO FASE 5: recursos por curso (LuxResources DDB + S3) — carpetas, colores, papelera 60 días
// lux-admin Lambda entry point — thin router that delegates to domain modules.
import { getPrismaClient } from '../shared/db-neon';
import { cors, forbidden, notFound, serverError, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';
import { Event, isAuthorized } from './ctx';
import { handleCourses } from './courses';
import { handleUsers } from './users';
import { handleReports } from './reports';
import { handleAI } from './ai';
import { handleProfile } from './profile';
import { handleFiles } from './files';
import { handleGroups } from './groups';

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();
  if (!isAuthorized(event)) return forbidden('Se requiere rol de evaluador o administrador');

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // getPrismaClient inside try-catch so DB init errors return 500 instead of crashing (502)
    const prisma = await getPrismaClient();
    const body = event.body ? JSON.parse(event.body) : {};
    const action = (body as any)._action as string | undefined;
    const userId = event.requestContext.authorizer?.lambda?.userId;

    const ctx = { event, method, path, prisma, body, action, userId };

    const result =
      await handleCourses(ctx) ??
      await handleUsers(ctx) ??
      await handleReports(ctx) ??
      await handleAI(ctx) ??
      await handleProfile(ctx) ??
      await handleFiles(ctx) ??
      await handleGroups(ctx) ??
      notFound('Ruta no encontrada');

    return result;
  } catch (err) {
    return serverError(err);
  }
};
