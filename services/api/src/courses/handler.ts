import { randomUUID } from 'crypto';
import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import webpush from 'web-push';
import { getPrismaClient } from '../shared/db-neon';
import { isModuleUnlocked, getLessonProgress, hasPassedQuiz, getReflection, getEnrollments, getResourcesByCourse, createSubmission, listMySubmissions, listSubmissionsForModule, createInterview, getInterview, getInterviewByCallId, updateInterview, listMyInterviews, getPushSubscriptionsByUserId } from '../shared/db-dynamo';
import { ok, notFound, serverError, cors, setRequestOrigin, badRequest, forbidden } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';
import { batchTranslate, type TranslatableFields } from '../shared/translate';

const s3 = new S3Client({ region: 'us-east-1' });
const SUBMISSIONS_BUCKET = 'lux-learning-submissions';
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });

const VAPID_PUBLIC_CO = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE_CO = process.env.VAPID_PRIVATE_KEY ?? '';
if (VAPID_PUBLIC_CO && VAPID_PRIVATE_CO) {
  webpush.setVapidDetails(process.env.VAPID_EMAIL ?? 'mailto:admin@luxlearning.com', VAPID_PUBLIC_CO, VAPID_PRIVATE_CO);
}

const VAPI_API_KEY = process.env.VAPI_API_KEY ?? '';
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID ?? '';
const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET ?? '';

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
  const method = event.requestContext.http.method;
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
        const lessonProgress = await getLessonProgress(userId, courseId);
        const completedLessonIds = new Set(lessonProgress.map((p) => p.lessonId));
        const enriched = await Promise.all(
          course.modules.map(async (mod) => {
            const unlocked = await isModuleUnlocked(userId, mod.order, moduleRefs);
            const quizPassed = await hasPassedQuiz(userId, mod.id);
            const reflection = await getReflection(userId, mod.id);
            const mt = translations?.get(`module#${mod.id}`);

            const mySubmissions = await listMySubmissions(userId, mod.id);

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
      // Verify Vapi webhook signature if secret is configured
      if (VAPI_WEBHOOK_SECRET) {
        const { createHmac } = await import('crypto');
        const rawBody = event.body ?? '';
        const incomingSignature = event.headers?.['x-vapi-signature'] ?? event.headers?.['X-Vapi-Signature'] ?? '';
        const expectedSignature = createHmac('sha256', VAPI_WEBHOOK_SECRET).update(rawBody).digest('hex');
        if (incomingSignature !== expectedSignature) {
          return { statusCode: 401, body: JSON.stringify({ error: 'Invalid webhook signature' }) };
        }
      }

      let body: any = {};
      try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }

      const { message } = body as { message?: any };
      if (!message) return ok({ received: true });

      const msgType: string = message.type ?? '';
      const callId: string = message.call?.id ?? message.callId ?? '';

      if (msgType === 'end-of-call-report' && callId) {
        const transcript: string = message.artifact?.transcript ?? message.transcript ?? '';
        const messages: any[] = message.artifact?.messages ?? message.messages ?? [];
        const durationSec: number = message.durationSeconds ?? message.call?.endedAt
          ? Math.round((new Date(message.call.endedAt).getTime() - new Date(message.call.startedAt ?? message.call.createdAt).getTime()) / 1000)
          : 0;

        void (async () => {
          try {
            const interview = await getInterviewByCallId(callId);
            if (!interview) { console.warn('[vapi] no interview record for callId=%s', callId); return; }

            // Run Bedrock analysis
            let aiAnalysis = '';
            let aiScore = 0;
            if (transcript) {
              const analysisPrompt = `Analiza la siguiente transcripción de una entrevista oral de evaluación.
Proporciona:
1. Un puntaje formativo del 0 al 100 basado en: claridad de ideas, dominio del tema, fluidez y profundidad de respuestas.
2. Un análisis formativo breve (máx. 3 párrafos) con fortalezas y áreas de mejora.
3. Responde en el mismo idioma de la transcripción.

Transcripción:
${transcript.slice(0, 4000)}

Responde ÚNICAMENTE con este JSON (sin markdown):
{"score": <número>, "analysis": "<texto análisis>"}`;

              const resp = await bedrock.send(new InvokeModelCommand({
                modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({
                  anthropic_version: 'bedrock-2023-05-31',
                  max_tokens: 1024,
                  messages: [{ role: 'user', content: analysisPrompt }],
                }),
              }));
              const raw = JSON.parse(Buffer.from(resp.body).toString());
              const text: string = raw.content?.[0]?.text ?? '';
              try {
                const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
                aiScore = Math.min(100, Math.max(0, Number(parsed.score ?? 0)));
                aiAnalysis = String(parsed.analysis ?? '');
              } catch {
                aiAnalysis = text;
              }
            }

            await updateInterview(interview.userId, interview.interviewId, {
              status: 'completed',
              transcript,
              messages,
              aiAnalysis,
              aiScore,
              durationSeconds: durationSec,
              questionsAsked: messages.filter((m: any) => m.role === 'assistant').length,
              completedAt: new Date().toISOString(),
            });

            // Push notification to student
            if (VAPID_PUBLIC_CO && VAPID_PRIVATE_CO) {
              const subs = await getPushSubscriptionsByUserId(interview.userId);
              const payload = JSON.stringify({ title: 'Entrevista completada', body: 'Tu entrevista oral ha sido procesada. El evaluador revisará tu resultado pronto.' });
              await Promise.allSettled(subs.map((sub: any) =>
                webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
              ));
            }
          } catch (e) {
            console.error('[vapi] webhook processing error', e);
          }
        })();
      }

      return ok({ received: true });
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

      // Find INTERVIEW type EvaluationEvent for this course
      const evalEvent = await prisma.evaluationEvent.findFirst({
        where: { courseId, type: 'INTERVIEW' },
        orderBy: { order: 'asc' },
      });

      const interviewId = randomUUID();
      await createInterview({
        userId,
        interviewId,
        courseId,
        moduleId,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });

      return ok({
        interviewId,
        vapiPublicKey: process.env.VAPI_PUBLIC_KEY ?? '',
        vapiAssistantId: process.env.VAPI_ASSISTANT_ID ?? '',
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

    return notFound();
  } catch (err) {
    return serverError(err);
  }
};
