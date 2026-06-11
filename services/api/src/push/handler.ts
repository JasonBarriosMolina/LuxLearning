import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { savePushSubscription, deletePushSubscription } from '../shared/db-dynamo';
import { ok, badRequest, serverError, cors } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? '';

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();
  setEnvironmentFromOrigin(event.headers?.origin ?? event.headers?.Origin);

  const auth = event.requestContext.authorizer?.lambda;
  const userId = auth?.userId ?? '';
  const role = auth?.role ?? 'STUDENT';
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // GET /push/vapid-key — public key for browser subscription
    if (method === 'GET' && path === '/push/vapid-key') {
      return ok({ publicKey: VAPID_PUBLIC_KEY });
    }

    // POST /push/subscribe — save subscription
    if (method === 'POST' && path === '/push/subscribe') {
      if (!userId) return badRequest('Unauthorized');
      const body = JSON.parse(event.body ?? '{}');
      const { endpoint, keys } = body as { endpoint: string; keys: { p256dh: string; auth: string } };
      if (!endpoint || !keys?.p256dh || !keys?.auth) return badRequest('endpoint and keys required');

      await savePushSubscription({
        userId,
        endpoint,
        keys,
        role,
        createdAt: new Date().toISOString(),
      });
      return ok({ subscribed: true });
    }

    // DELETE /push/subscribe — remove subscription
    if (method === 'DELETE' && path === '/push/subscribe') {
      if (!userId) return badRequest('Unauthorized');
      const body = JSON.parse(event.body ?? '{}');
      const { endpoint } = body as { endpoint: string };
      if (!endpoint) return badRequest('endpoint required');
      await deletePushSubscription(userId, endpoint);
      return ok({ unsubscribed: true });
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
