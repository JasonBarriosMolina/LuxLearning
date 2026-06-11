import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { getNotifications, markNotificationRead } from '../shared/db-dynamo';
import { ok, badRequest, forbidden, notFound, serverError, cors } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<
  APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }
>;

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();
  setEnvironmentFromOrigin(event.headers?.origin ?? event.headers?.Origin);

  const userId = event.requestContext.authorizer?.lambda?.userId;
  if (!userId) return forbidden('No autorizado');

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // GET /notifications
    if (path === '/notifications' && method === 'GET') {
      const notifs = await getNotifications(userId);
      return ok(notifs);
    }

    // POST /notifications/read
    if (path === '/notifications/read' && method === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      const { notifId } = body;
      if (!notifId) return badRequest('notifId es requerido');
      await markNotificationRead(userId, notifId);
      return ok({ marked: true });
    }

    return notFound('Ruta no encontrada');
  } catch (err) {
    return serverError(err);
  }
};
