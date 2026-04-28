import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { getPrismaClient } from '../shared/db-neon.js';
import { isModuleUnlocked, getLessonProgress, hasPassedQuiz, getReflection } from '../shared/db-dynamo.js';
import { ok, notFound, serverError, cors } from '../shared/response.js';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const userId = event.requestContext.authorizer?.lambda?.userId;
  const path = event.rawPath;
  const prisma = getPrismaClient();

  try {
    // GET /courses
    if (path === '/courses' || path === '/courses/') {
      const courses = await prisma.course.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        include: { modules: { orderBy: { order: 'asc' }, select: { id: true, order: true, title: true, duration: true } } },
      });
      return ok(courses);
    }

    // GET /courses/:courseId
    const courseMatch = path.match(/^\/courses\/([^/]+)$/);
    if (courseMatch) {
      const courseId = courseMatch[1]!;
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: {
          modules: {
            orderBy: { order: 'asc' },
            include: {
              lessons: { orderBy: { order: 'asc' } },
              questions: { orderBy: { order: 'asc' } },
            },
          },
        },
      });

      if (!course) return notFound('Course not found');

      if (userId) {
        // Enrich with unlock status
        const moduleIds = course.modules.map((m) => m.id);
        const enriched = await Promise.all(
          course.modules.map(async (mod) => {
            const unlocked = await isModuleUnlocked(userId, mod.order, moduleIds);
            const progress = await getLessonProgress(userId, courseId);
            const completedLessonIds = new Set(progress.map((p) => p.lessonId));
            const quizPassed = await hasPassedQuiz(userId, mod.id);
            const reflection = await getReflection(userId, mod.id);

            return {
              ...mod,
              unlocked,
              quizPassed,
              reflectionStatus: reflection?.status ?? null,
              lessons: mod.lessons.map((l) => ({
                ...l,
                completed: completedLessonIds.has(l.id),
              })),
            };
          })
        );
        return ok({ ...course, modules: enriched });
      }

      return ok(course);
    }

    return notFound();
  } catch (err) {
    return serverError(err);
  }
};
