import { badRequest, notFound, serverError, cors, setRequestOrigin } from '../shared/response';
import { getSql, staffFromEvent, type PlatformCtx, type PlatformEvent } from './ctx';
import { handleDemoRequests } from './demo-requests';
import { handleLeads } from './leads';
import { handleTeacherApplications } from './teacher-applications';
import { handleTeachers } from './teachers';

export const handler = async (event: PlatformEvent) => {
  setRequestOrigin(event.headers?.origin ?? event.headers?.Origin);
  const method = event.requestContext.http.method;
  if (method === 'OPTIONS') return cors();

  let body: Record<string, unknown> = {};
  if (event.body) {
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      body = JSON.parse(raw);
    } catch {
      return badRequest('Cuerpo de la solicitud no válido');
    }
  }

  const ctx: PlatformCtx = {
    event,
    method,
    path: event.rawPath,
    body,
    getSql,
    staff: staffFromEvent(event),
  };

  try {
    return (
      (await handleDemoRequests(ctx)) ??
      (await handleTeacherApplications(ctx)) ??
      (await handleLeads(ctx)) ??
      (await handleTeachers(ctx)) ??
      notFound('Ruta no encontrada')
    );
  } catch (err) {
    return serverError(err);
  }
};
