import { randomUUID } from 'crypto';
import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getPrismaClient } from '../shared/db-neon';
import { isModuleUnlocked, getLessonProgress, hasPassedQuiz, getReflection, getEnrollments, getResourcesByCourse, createSubmission, listMySubmissions, listSubmissionsForModule, createInterview, updateInterview, listMyInterviews } from '../shared/db-dynamo';
import { listMyClassSessions, listMyClassSessionsForCourse } from '../shared/db-classes';
import { handleClasses } from './classes';
import { handleVapiWebhook } from './vapi-webhook';
import { ok, notFound, serverError, cors, setRequestOrigin, badRequest, forbidden } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';
import { batchTranslate, type TranslatableFields } from '../shared/translate';

const s3 = new S3Client({ region: 'us-east-1' });
const SUBMISSIONS_BUCKET = process.env.SUBMISSIONS_BUCKET ?? 'lux-learning-submissions';
const S3_IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET ?? 'lux-learning-images';

// VAPID keys loaded lazily from Secrets Manager via shared/vapid.ts

// Vapi credentials loaded lazily from Secrets Manager via shared/vapi-keys.ts
// VAPI_PUBLIC_KEY stays in env — it's returned to the frontend (not sensitive)

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
  const role = event.requestContext.authorizer?.lambda?.role ?? '';
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const rawLang = event.queryStringParameters?.lang ?? 'es';
  const lang = ['en', 'es'].includes(rawLang) ? rawLang : 'es';

  try {
    // getPrismaClient inside try-catch so DB init errors return 500 instead of crashing (502)
    const prisma = await getPrismaClient();
    // GET /courses
    if (path === '/courses' || path === '/courses/') {
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
          // Light select — only used to know which modules actually have a
          // REFLECTION planned, for the isModuleUnlocked sequential gate below.
          evaluationEvents: { select: { type: true, moduleId: true } },
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
            const reflectionPlannedModuleIds = new Set(
              ((course as any).evaluationEvents ?? [])
                .filter((e: any) => e.type === 'REFLECTION' && e.moduleId)
                .map((e: any) => e.moduleId as string),
            );

            const enrichedModules = await Promise.all(
              course.modules.map(async (mod) => {
                const unlocked = await isModuleUnlocked(userId, mod.order, moduleRefs, {
                  weeklyPacingEnabled: (course as any).weeklyPacingEnabled,
                  courseStartDate: course.startDate,
                  reflectionPlannedModuleIds,
                });
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
        // Enrollment check — students can only view courses they're enrolled in
        if (role === 'STUDENT') {
          const enrolled = await getEnrollments(userId);
          if (!enrolled.includes(courseId)) return forbidden('No estás inscrito en este curso');
        }
        // Enrich with unlock status
        const moduleRefs = course.modules.map((m) => ({ id: m.id, order: m.order }));
        const reflectionPlannedModuleIds = new Set(
          (course.evaluationEvents ?? [])
            .filter((e) => e.type === 'REFLECTION' && e.moduleId)
            .map((e) => e.moduleId as string),
        );
        const lessonProgress = await getLessonProgress(userId, courseId);
        const completedLessonIds = new Set(lessonProgress.map((p) => p.lessonId));
        // One Query for every class session in the course (not one per module) — used to
        // gate the dashboard's "Presentar"/"Ir al quiz" buttons on the class actually being
        // done, same as the module page's blockingStep (Trello DmPpbrff item 3).
        const myClassSessions = await listMyClassSessionsForCourse(userId, courseId).catch(() => []);
        const enriched = await Promise.all(
          course.modules.map(async (mod) => {
            const unlocked = await isModuleUnlocked(userId, mod.order, moduleRefs, {
              weeklyPacingEnabled: (course as any).weeklyPacingEnabled,
              courseStartDate: course.startDate,
              reflectionPlannedModuleIds,
            });
            const quizPassed = await hasPassedQuiz(userId, mod.id);
            const reflection = await getReflection(userId, mod.id);
            const mt = translations?.get(`module#${mod.id}`);

            const mySubmissions = await listMySubmissions(userId, mod.id);
            const classCompleted = myClassSessions.some((s) => s.moduleId === mod.id && (s.hasCompletedQA || s.status === 'completed'));

            return {
              ...mod,
              ...(mt ?? {}),
              unlocked,
              quizPassed,
              classCompleted,
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
              // Strip correctIndex for students — answers must not be exposed before quiz submission
              questions: applyTranslations(mod.questions, 'question', translations ?? new Map())
                .map(role === 'STUDENT' ? ({ correctIndex: _ci, ...q }: any) => q : (q: any) => q),
            };
          })
        );
        const ct = translations?.get(`course#${course.id}`);
        // Compute isCourseLocked: course is active but startDate is still in the future
        const isCourseLocked = !!(course.startDate && new Date(course.startDate) > new Date());
        return ok({ ...course, ...(ct ?? {}), modules: enriched, isCourseLocked });
      }

      if (translations) {
        const ct = translations.get(`course#${course.id}`);
        const modules = course.modules.map((mod) => ({
          ...mod,
          ...(translations!.get(`module#${mod.id}`) ?? {}),
          lessons: applyTranslations(mod.lessons, 'lesson', translations!),
          questions: applyTranslations(mod.questions, 'question', translations!),
        }));
        const isCourseLocked = !!(course.startDate && new Date(course.startDate) > new Date());
        return ok({ ...course, ...(ct ?? {}), modules, isCourseLocked });
      }

      const isCourseLocked = !!(course.startDate && new Date(course.startDate) > new Date());
      return ok({ ...course, isCourseLocked });
    }

    // GET /courses/:courseId/resources — public resources for students enrolled in this course
    const courseResourcesMatch = path.match(/^\/courses\/([^/]+)\/resources$/);
    if (courseResourcesMatch) {
      const courseId = courseResourcesMatch[1]!;
      // Enrollment check — resources are restricted to enrolled students
      if (userId && role === 'STUDENT') {
        const enrolled = await getEnrollments(userId);
        if (!enrolled.includes(courseId)) return forbidden('No estás inscrito en este curso');
      }
      try {
        const resources = await getResourcesByCourse(courseId);
        // The wizard-generated study plan is stored with a placeholder fileUrl
        // (`plan://${courseId}`) since the real download needs a signed S3 URL that
        // expires — storing a signed URL directly in DynamoDB would go stale. Resolve
        // it to a fresh signed URL on every read instead (Trello DmPpbrff comment
        // 6a926c61: clicking the resource led to a dead "plan://..." link).
        const planResources = (resources as any[]).filter((r) => typeof r.fileUrl === 'string' && r.fileUrl.startsWith('plan://'));
        if (planResources.length > 0) {
          const course = await prisma.course.findUnique({ where: { id: courseId }, select: { planDocumentS3Key: true } });
          if (course?.planDocumentS3Key) {
            await Promise.all(planResources.map(async (r) => {
              r.fileUrl = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: course.planDocumentS3Key!, ResponseContentDisposition: `attachment; filename="${r.fileName || `plan-${courseId}.docx`}"` }),
                { expiresIn: 3600 },
              ).catch(() => r.fileUrl);
            }));
          }
        }
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
      const ALLOWED_SUBMIT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'application/zip']);
      if (!ALLOWED_SUBMIT_TYPES.has(fileType)) return badRequest('Tipo de archivo no permitido');
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
      const { submissionId, courseId, moduleId, fileName, fileSize, fileType } = body;
      if (!submissionId || !courseId || !moduleId || !fileName) return badRequest('Missing required fields');
      const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
      const s3Key = `submissions/${courseId}/${moduleId}/${userId}/${submissionId}.${ext}`;
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

    // ── POST /vapi/webhook — public endpoint (no auth required) ──────────────
    if (path === '/vapi/webhook' && method === 'POST') {
      return handleVapiWebhook(event, prisma);
    }

    // ── GET /my-interviews?moduleId=X ─────────────────────────────────────────
    if (path === '/my-interviews' && method === 'GET') {
      if (!userId) return forbidden('Login required');
      const moduleId = event.queryStringParameters?.moduleId;
      if (!moduleId) return badRequest('moduleId required');
      const interviews = await listMyInterviews(userId, moduleId);
      return ok(interviews);
    }

    // ── POST /my-interviews/start — register a new interview and return Vapi config ──
    if (path === '/my-interviews/start' && method === 'POST') {
      if (!userId) return forbidden('Login required');
      let body: any = {};
      try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }
      const { courseId, moduleId } = body as { courseId?: string; moduleId?: string };
      if (!courseId || !moduleId) return badRequest('courseId and moduleId required');

      // Validate VAPI key BEFORE creating any DB record — avoids ghost pending records
      const vapiPublicKey = process.env.VAPI_PUBLIC_KEY ?? '';
      if (!vapiPublicKey) {
        return ok({ interviewId: null, vapiPublicKey: '', vapiPrompt: null, vapiObjectives: null });
      }

      // ── Prerequisite checks ──────────────────────────────────────────────────
      // 1. All lessons in the module must be completed
      const moduleForInterview = await prisma.module.findUnique({
        where: { id: moduleId },
        select: { lessons: { select: { id: true } } },
      });
      if (moduleForInterview) {
        const lessonIds = moduleForInterview.lessons.map((l: any) => l.id);
        if (lessonIds.length > 0) {
          const lessonProgress = await getLessonProgress(userId, courseId);
          const completedIds = new Set(lessonProgress.map((p) => p.lessonId));
          const allDone = lessonIds.every((id: string) => completedIds.has(id));
          if (!allDone) return badRequest('Debes completar todas las lecciones del módulo antes de la entrevista');
        }
      }
      // 2. If THIS module has a CLASS evaluation event, the student must have completed the
      //    class session — was courseId-only before (Trello DmPpbrff comment 6a9232ef, same
      //    root cause class as the frontend class-card bug), which incorrectly blocked
      //    interviews in modules with no class planned just because SOME OTHER module in
      //    the course had one.
      const hasClassEvent = await prisma.evaluationEvent.count({ where: { courseId, moduleId, type: 'CLASS' } });
      if (hasClassEvent > 0) {
        const classSessions = await listMyClassSessions(userId, moduleId);
        const hasCompletedClass = classSessions.some((s) => s.hasCompletedQA);
        if (!hasCompletedClass) return badRequest('Debes completar la sesión de clase antes de la entrevista');
      }
      // ── End prerequisite checks ──────────────────────────────────────────────

      // Find INTERVIEW type EvaluationEvent for this course
      const evalEvent = await prisma.evaluationEvent.findFirst({
        where: { courseId, type: 'INTERVIEW' },
        orderBy: { order: 'asc' },
      });

      // Reuse existing pending interview to avoid duplicate DDB records per session
      const existing = await listMyInterviews(userId, moduleId);
      // Rate limit: max 5 interviews per module (including completed)
      if (existing.length >= 5) return badRequest('Límite de entrevistas alcanzado para este módulo');
      const reuseableInterview = existing.find((iv) => iv.status === 'pending' || iv.status === 'in_progress');

      const interviewId = reuseableInterview?.interviewId ?? randomUUID();
      if (!reuseableInterview) {
        await createInterview({
          userId,
          interviewId,
          courseId,
          moduleId,
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
      }

      return ok({
        interviewId,
        vapiPublicKey,
        vapiPrompt: evalEvent?.vapiPrompt ?? null,
        vapiObjectives: evalEvent?.vapiObjectives ?? null,
      });
    }

    // ── PATCH /my-interviews/:interviewId — update call status/callId ─────────
    const interviewUpdateMatch = path.match(/^\/my-interviews\/([^/]+)$/);
    if (interviewUpdateMatch && method === 'PATCH') {
      if (!userId) return forbidden('Login required');
      const interviewId = interviewUpdateMatch[1]!;
      let body: any = {};
      try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }
      const { vapiCallId, status } = body as { vapiCallId?: string; status?: string };
      const patch: Record<string, any> = {};
      if (vapiCallId) patch.vapiCallId = vapiCallId;
      if (status) patch.status = status;
      if (Object.keys(patch).length) await updateInterview(userId, interviewId, patch as any);
      return ok({ updated: true });
    }

    // ── Lux Mentor Class routes (/my-classes/*) ──────────────────────────────
    const classResult = await handleClasses(event, method, path, userId, prisma);
    if (classResult) return classResult;

    return notFound();
  } catch (err) {
    return serverError(err);
  }
};
