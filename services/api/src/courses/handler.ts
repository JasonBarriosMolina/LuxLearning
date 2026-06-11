import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { getPrismaClient } from '../shared/db-neon';
import { isModuleUnlocked, getLessonProgress, hasPassedQuiz, getReflection, getEnrollments, getResourcesByCourse } from '../shared/db-dynamo';
import { ok, notFound, serverError, cors } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();
  setEnvironmentFromOrigin(event.headers?.origin ?? event.headers?.Origin);

  const userId = event.requestContext.authorizer?.lambda?.userId;
  const path = event.rawPath;
  const prisma = await getPrismaClient();

  try {
    // GET /courses
    if (path === '/courses' || path === '/courses/') {
      const role = event.requestContext.authorizer?.lambda?.role;
      let courseIdFilter: string[] | undefined;

      // Students see only their enrolled courses — empty list if no enrollments
      if (userId && role === 'STUDENT') {
        const enrolled = await getEnrollments(userId);
        courseIdFilter = enrolled; // always set, even if empty
      }

      const courses = await prisma.course.findMany({
        where: {
          isActive: true,
          isDraft: false,
          isArchived: false,
          ...(courseIdFilter !== undefined ? { id: { in: courseIdFilter } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        include: {
          modules: {
            orderBy: { order: 'asc' },
            include: { lessons: { orderBy: { order: 'asc' }, select: { id: true } } },
          },
        },
      });

      // Enrich with student progress if user is authenticated
      if (userId) {
        const enriched = await Promise.all(
          courses.map(async (course) => {
            const progress = await getLessonProgress(userId, course.id);
            const completedLessonIds = new Set(progress.map((p) => p.lessonId));
            const moduleRefs = course.modules.map((m) => ({ id: m.id, order: m.order }));

            const enrichedModules = await Promise.all(
              course.modules.map(async (mod) => {
                const unlocked = await isModuleUnlocked(userId, mod.order, moduleRefs);
                const reflection = await getReflection(userId, mod.id);
                const quizPassed = await hasPassedQuiz(userId, mod.id);
                return {
                  ...mod,
                  unlocked,
                  quizPassed,
                  reflectionStatus: reflection?.status ?? null,
                  qualityScore: (reflection as any)?.qualityScore ?? null,
                  evaluatorFeedback: (reflection as any)?.evaluatorFeedback ?? null,
                  reviewedAt: (reflection as any)?.reviewedAt ?? null,
                  lessons: mod.lessons.map((l) => ({ ...l, completed: completedLessonIds.has(l.id) })),
                };
              })
            );

            return { ...course, modules: enrichedModules };
          })
        );
        return ok(enriched);
      }

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
        const moduleRefs = course.modules.map((m) => ({ id: m.id, order: m.order }));
        const enriched = await Promise.all(
          course.modules.map(async (mod) => {
            const unlocked = await isModuleUnlocked(userId, mod.order, moduleRefs);
            const progress = await getLessonProgress(userId, courseId);
            const completedLessonIds = new Set(progress.map((p) => p.lessonId));
            const quizPassed = await hasPassedQuiz(userId, mod.id);
            const reflection = await getReflection(userId, mod.id);

            return {
              ...mod,
              unlocked,
              quizPassed,
              reflectionStatus: reflection?.status ?? null,
              qualityScore: (reflection as any)?.qualityScore ?? null,
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

    // GET /courses/:courseId/resources — public resources for students enrolled in this course
    const courseResourcesMatch = path.match(/^\/courses\/([^/]+)\/resources$/);
    if (courseResourcesMatch) {
      const courseId = courseResourcesMatch[1]!;
      try {
        const resources = await getResourcesByCourse(courseId);
        return ok(resources);
      } catch (err) {
        console.error('[Resources] Failed to fetch resources for course', courseId, err);
        return ok([]); // degrade gracefully — never block module view
      }
    }

    return notFound();
  } catch (err) {
    return serverError(err);
  }
};
