import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { markLessonComplete, getLessonProgress } from '../shared/db-dynamo.js';
import { ok, badRequest, serverError, cors } from '../shared/response.js';
import { init as cuid } from '@paralleldrive/cuid2';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const userId = event.requestContext.authorizer?.lambda?.userId!;
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // GET /lessons/progress?courseId=xxx
    if (method === 'GET' && path.includes('/progress')) {
      const courseId = event.queryStringParameters?.courseId;
      if (!courseId) return badRequest('courseId query param required');
      const progress = await getLessonProgress(userId, courseId);
      return ok(progress);
    }

    // POST /lessons/complete
    if (method === 'POST' && path.includes('/complete')) {
      const body = JSON.parse(event.body ?? '{}');
      const { courseId, moduleId, lessonId, durationMs } = body;

      if (!courseId || !moduleId || !lessonId) {
        return badRequest('courseId, moduleId and lessonId are required');
      }

      await markLessonComplete({
        userId,
        courseId,
        moduleId,
        lessonId,
        completedAt: new Date().toISOString(),
        durationMs,
      });

      return ok({ marked: true });
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
