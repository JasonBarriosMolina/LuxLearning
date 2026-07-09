import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { createHash } from 'crypto';
import { getNotifications, markNotificationRead } from '../shared/db-dynamo';
import { batchTranslate } from '../shared/translate';
import { ok, badRequest, forbidden, notFound, serverError, cors, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<
  APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }
>;

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const userId = event.requestContext.authorizer?.lambda?.userId;
  if (!userId) return forbidden('No autorizado');

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // GET /notifications
    if (path === '/notifications' && method === 'GET') {
      const rawLang = event.queryStringParameters?.lang ?? 'es';
      const lang = ['en', 'es'].includes(rawLang) ? rawLang : 'es';
      let notifs = await getNotifications(userId);
      if (lang !== 'es' && notifs.length > 0) {
        try {
          const msgHash = (msg: string) => createHash('sha256').update(msg).digest('hex').slice(0, 16);
          const translations = await batchTranslate(
            notifs.map((n) => ({ type: 'notification' as const, id: msgHash(n.message), fields: { message: n.message } })),
            lang
          );
          notifs = notifs.map((n) => {
            const tr = translations.get(`notification#${msgHash(n.message)}`);
            return tr?.message ? { ...n, message: tr.message as string } : n;
          });
        } catch { /* fallback to original */ }
      }
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
