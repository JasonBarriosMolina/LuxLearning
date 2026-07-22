import { randomUUID } from 'crypto';
import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getPrismaClient } from '../shared/db-neon';
import { isModuleUnlocked, getLessonProgress, hasPassedQuiz, getReflection, getEnrollments, getResourcesByCourse, createSubmission, listMySubmissions, listSubmissionsForModule } from '../shared/db-dynamo';
import { ok, notFound, serverError, cors, setRequestOrigin, badRequest, forbidden } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';
import { batchTranslate, type TranslatableFields } from '../shared/translate';

const s3 = new S3Client({ region: 'us-east-1' });
const SUBMISSIONS_BUCKET = 'lux-learning-submissions';

/** Applies cached/fresh translations over a list of {id, ...fields} entities, mutating nothing — returns new objects. */
function applyTranslations<T extends { id: string }>(
  items: T[],
  type: 'course' | 'module' | 'lesson' | 'question',
  translations: Map<string, TranslatableFields>
): T[] {
  return items.map((item) => {
    const t = translations.get(`${type}#${item.id}`);
    if (!t) return item;
    // For questions, validate options array length before applying — prevents correctIndex desync
    if (type === 'question' && Array.isArray(t.options) && Array.isArray((item as any).options)) {
      if ((t.options as unknown[]).length !== ((item as any).options as unknown[]).length) {
        console.error(`[translate] Question ${item.id}: options length mismatch, skipping translation`);
        return item;
      }
    }
    return { ...item, ...t };
  });
}

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const userId = event.requestContext.authorizer?.lambda?.userId;
  const path = event.rawPath;
  const rawLang = event.queryStringParameters?.lang ?? 'es';
  const lang = ['en', 'es'].includes(rawLang) ? rawLang : 'es';
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

      const translations = lang !== 'es' ? await batchTranslate([
        ...courses.map((c) => ({ type: 'course' as const, id: c.id, fields: { title: c.title, description: c.description } })),
        ...courses.flatMap((c) => c.modules.map((m) => ({ type: 'module' as const, id: m.id, fields: { title: m.title, description: m.description } }))),
      ], lang) : undefined;

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
                const t = translations?.get(`module#${mod.id}`);
                return {
                  ...mod,
                  ...(t ?? {}),
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

            const ct = translations?.get(`course#${course.id}`);
            return { ...course, ...(ct ?? {}), modules: enrichedModules };
          })
        );
        return ok(enriched);
      }

      const translatedCourses = translations
        ? courses.map((c) => ({
            ...c,
            ...(translations!.get(`course#${c.id}`) ?? {}),
            modules: applyTranslations(c.modules, 'module', translations!),
          }))
        : courses;
      return ok(translatedCourses);
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
          evaluationEvents: { orderBy: { order: 'asc' } },
        },
      });

      if (!course) return notFound('Course not found');

      const translations = lang !== 'es' ? await batchTranslate([
        { type: 'course', id: course.id, fields: { title: course.title, description: course.description } },
        ...course.modules.map((m) => ({ type: 'module' as const, id: m.id, fields: { title: m.title, description: m.description } })),
        ...course.modules.flatMap((m) => m.lessons.map((l) => ({ type: 'lesson' as const, id: l.id, fields: { title: l.title, content: l.content, points: l.points, tip: l.tip } }))),
        ...course.modules.flatMap((m) => m.questions.map((q) => ({ type: 'question' as const, id: q.id, fields: { text: q.text, options: q.options } }))),
      ], lang) : undefined;

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
            const mt = translations?.get(`module#${mod.id}`);

            const moduleSubs = await listSubmissionsForModule(mod.id);
            const mySubmissions = moduleSubs.filter((s) => s.userId === userId);

            return {
              ...mod,
              ...(mt ?? {}),
              unlocked,
              quizPassed,
              reflectionStatus: reflection?.status ?? null,
              qualityScore: (reflection as any)?.qualityScore ?? null,
              submissions: mySubmissions.map((s) => ({
                submissionId: s.submissionId,
                fileName: s.fileName,
                fileSize: s.fileSize,
                status: s.status,
                grade: s.grade ?? null,
                feedback: s.feedback ?? null,
                createdAt: s.createdAt,
              })),
              lessons: applyTranslations(mod.lessons, 'lesson', translations ?? new Map()).map((l) => ({
                ...l,
                completed: completedLessonIds.has(l.id),
              })),
              questions: applyTranslations(mod.questions, 'question', translations ?? new Map()),
            };
          })
        );
        const ct = translations?.get(`course#${course.id}`);
        return ok({ ...course, ...(ct ?? {}), modules: enriched });
      }

      if (translations) {
        const ct = translations.get(`course#${course.id}`);
        const modules = course.modules.map((mod) => ({
          ...mod,
          ...(translations!.get(`module#${mod.id}`) ?? {}),
          lessons: applyTranslations(mod.lessons, 'lesson', translations!),
          questions: applyTranslations(mod.questions, 'question', translations!),
        }));
        return ok({ ...course, ...(ct ?? {}), modules });
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

    // GET /my-submissions?moduleId=X — list this student's submissions for a module
    if (path === '/my-submissions' && method === 'GET') {
      if (!userId) return forbidden('Login required');
      const moduleId = event.queryStringParameters?.moduleId;
      if (!moduleId) return badRequest('moduleId required');
      const subs = await listMySubmissions(userId, moduleId);
      return ok(subs);
    }

    // POST /my-submissions/presign — get presigned S3 PUT URL
    if (path === '/my-submissions/presign' && method === 'POST') {
      if (!userId) return forbidden('Login required');
      const body = JSON.parse(event.body ?? '{}');
      const { courseId, moduleId, fileName, fileType } = body;
      if (!courseId || !moduleId || !fileName || !fileType) return badRequest('courseId, moduleId, fileName, fileType required');
      const submissionId = randomUUID();
      const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
      const s3Key = `submissions/${courseId}/${moduleId}/${userId}/${submissionId}.${ext}`;
      const cmd = new PutObjectCommand({
        Bucket: SUBMISSIONS_BUCKET,
        Key: s3Key,
        ContentType: fileType,
      });
      const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
      return ok({ submissionId, uploadUrl, s3Key });
    }

    // POST /my-submissions — register submission after S3 upload
    if (path === '/my-submissions' && method === 'POST') {
      if (!userId) return forbidden('Login required');
      const body = JSON.parse(event.body ?? '{}');
      const { submissionId, courseId, moduleId, fileName, fileSize, fileType, s3Key } = body;
      if (!submissionId || !courseId || !moduleId || !fileName || !s3Key) return badRequest('Missing required fields');
      await createSubmission({
        userId,
        submissionId,
        courseId,
        moduleId,
        fileName,
        fileSize: Number(fileSize ?? 0),
        fileType: fileType ?? 'application/octet-stream',
        s3Key,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      return ok({ submissionId });
    }

    return notFound();
  } catch (err) {
    return serverError(err);
  }
};
