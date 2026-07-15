import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { YoutubeTranscript } from 'youtube-transcript';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { createId } from '@paralleldrive/cuid2';
import {
  markLessonComplete, getLessonProgress,
  getHighlights, saveHighlights,
  getFavorites, toggleFavorite,
  getTranscript, saveTranscript,
  updateLastSeen,
  markOnboardingDone, isOnboardingDone,
  getTasksForUser, updateTask, autoCompleteTasks,
  startSession, updateSession, endSession, getActivity, getAllQuizAttemptsForUser,
  setInactivityReminder, getAllEnrollments, getEnrollments,
  TABLES, ddb,
} from '../shared/db-dynamo';
import { sendTemplatedEmail } from '../shared/email';
import { getPrismaClient } from '../shared/db-neon';
import { UpdateCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { FavoriteItem } from '../shared/db-dynamo';
import { ok, badRequest, serverError, cors, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const userId = event.requestContext.authorizer?.lambda?.userId!;
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // ── Lesson progress ───────────────────────────────────────────────────────

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
      if (!courseId || !moduleId || !lessonId) return badRequest('courseId, moduleId and lessonId are required');
      await markLessonComplete({ userId, courseId, moduleId, lessonId, completedAt: new Date().toISOString(), durationMs });

      // Check if ALL lessons in the module are now complete → trigger MODULE_COMPLETED
      try {
        const prisma = await getPrismaClient();
        const [module, progress] = await Promise.all([
          prisma.module.findUnique({ where: { id: moduleId }, include: { lessons: true, course: { select: { title: true } } } }),
          getLessonProgress(userId, courseId),
        ]);
        if (module) {
          const completedIds = new Set(progress.map((p) => p.lessonId));
          const allDone = module.lessons.every((l) => completedIds.has(l.id));
          if (allDone) {
            const email = event.requestContext.authorizer?.lambda?.email;
            const courseTitle = module.course?.title ?? courseId;
            const frontendUrl = process.env.FRONTEND_URL ?? '';
            // Auto-complete matching tasks (non-fatal)
            await autoCompleteTasks(userId, 'complete_module', moduleId);
            // Send email notification (non-fatal)
            if (email) {
              sendTemplatedEmail(email, 'MODULE_COMPLETED', {
                studentName: userId,
                moduleTitle: module.title,
                courseTitle,
                actionUrl: `${frontendUrl}/courses/${courseId}/modules/${moduleId}`,
              }).catch(() => {});
            }
          }
        }
      } catch { /* non-fatal */ }

      return ok({ marked: true });
    }

    // ── Highlights ────────────────────────────────────────────────────────────

    // GET /lessons/highlights?lessonId=xxx
    if (method === 'GET' && path.includes('/highlights')) {
      const lessonId = event.queryStringParameters?.lessonId;
      if (!lessonId) return badRequest('lessonId query param required');
      const items = await getHighlights(userId, lessonId);
      return ok(items);
    }

    // POST /lessons/highlights — save all highlights for a lesson (full replace)
    if (method === 'POST' && path.includes('/highlights')) {
      const body = JSON.parse(event.body ?? '{}');
      const { lessonId, items } = body as { lessonId?: string; items?: any[] };
      if (!lessonId) return badRequest('lessonId required');
      const sanitized = (items ?? []).map((h: any) => ({
        id: h.id ?? createId(),
        text: String(h.text ?? '').slice(0, 500),
        color: ['yellow', 'green', 'blue', 'pink'].includes(h.color) ? h.color : 'yellow',
        createdAt: h.createdAt ?? new Date().toISOString(),
      }));
      await saveHighlights(userId, lessonId, sanitized);
      return ok({ saved: true });
    }

    // ── Favorites ─────────────────────────────────────────────────────────────

    // GET /lessons/favorites
    if (method === 'GET' && path.includes('/favorites')) {
      const favorites = await getFavorites(userId);
      return ok(favorites);
    }

    // POST /lessons/favorites/toggle
    if (method === 'POST' && path.includes('/favorites')) {
      const body = JSON.parse(event.body ?? '{}');
      const { type, id, title, courseId, moduleId } = body as Partial<FavoriteItem>;
      if (!type || !id || !title) return badRequest('type, id, and title are required');
      if (type !== 'lesson' && type !== 'module') return badRequest('type must be lesson or module');
      const added = await toggleFavorite(userId, { type, id, title, courseId, moduleId, createdAt: '' });
      return ok({ added, id });
    }

    // ── Transcript ────────────────────────────────────────────────────────────

    // GET /lessons/transcript?lessonId=xxx&youtubeId=yyy
    if (method === 'GET' && path.includes('/transcript')) {
      const { lessonId, youtubeId } = event.queryStringParameters ?? {};
      if (!lessonId || !youtubeId) return badRequest('lessonId and youtubeId required');

      // Return cached version if available
      const cached = await getTranscript(lessonId);
      if (cached) return ok({ transcript: cached, cached: true });

      // Fetch from YouTube
      try {
        const segments = await YoutubeTranscript.fetchTranscript(youtubeId, { lang: 'es' })
          .catch(() => YoutubeTranscript.fetchTranscript(youtubeId)); // fallback to any language
        const text = segments
          .map((s: any) => s.text.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"'))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (!text) return ok({ transcript: null, cached: false });

        await saveTranscript(lessonId, text);
        return ok({ transcript: text, cached: false });
      } catch (ytErr: any) {
        console.error('[Transcript] YouTube fetch failed:', ytErr?.message ?? ytErr);
        return ok({ transcript: null, cached: false });
      }
    }

    // ── Chat ──────────────────────────────────────────────────────────────────

    // POST /lessons/chat
    if (method === 'POST' && path.includes('/chat')) {
      const { lessonId, lessonTitle, lessonContent, moduleTitle, history, message, lang } = JSON.parse(event.body ?? '{}');
      if (!message) return badRequest('message is required');

      const isEn = lang === 'en';
      const systemPrompt = isEn
        ? `You are the Lux Learning Mentor, a Socratic pedagogical guide for the lesson "${lessonTitle ?? ''}" in the module "${moduleTitle ?? 'the course'}".${lessonContent ? `\n\nLesson content (your knowledge base):\n${String(lessonContent).slice(0, 3000)}` : ''}\n\nSOCRATIC METHOD — RULES:\n- For conceptual or reasoning questions (how, why, what does this mean, how would you apply…): ask 1-2 guiding questions that lead the student to discover the answer themselves. Do NOT give the answer directly on the first turn.\n- For purely factual questions (a date, a name, a formula, a definition with a single correct answer): answer directly and clearly — Socratic questioning is not appropriate here.\n- If the student is stuck after 2+ attempts on a reasoning question, or explicitly says "just tell me" / "I give up", then explain directly and clearly.\n- Acknowledge what the student already understands correctly before asking the next question.\n- Keep responses short: 1 guiding question + 1 encouraging sentence for reasoning; direct answer + brief explanation for factual. Never lecture.\n- Use clean markdown: **bold** for key concepts, - for lists. No triple asterisks or underlines.\n- Always respond in English.`
        : `Eres el Mentor de Lux Learning, un guía socrático para la lección "${lessonTitle ?? ''}" del módulo "${moduleTitle ?? 'el curso'}".${lessonContent ? `\n\nContenido de la lección (tu base de conocimiento):\n${String(lessonContent).slice(0, 3000)}` : ''}\n\nMÉTODO SOCRÁTICO — REGLAS:\n- Para preguntas conceptuales o de razonamiento (cómo, por qué, qué significa, cómo aplicarías…): haz 1-2 preguntas guía que lleven al estudiante a descubrir la respuesta por sí mismo. NO des la respuesta directa en el primer turno.\n- Para preguntas puramente factuales (una fecha, un nombre, una fórmula, una definición con una única respuesta correcta): responde directamente y con claridad — el método socrático no aplica aquí.\n- Si el estudiante lleva 2+ intentos en una pregunta de razonamiento sin llegar a la respuesta, o dice explícitamente "dime la respuesta" / "me rindo", entonces explica de forma directa y clara.\n- Reconoce primero lo que el estudiante ya entiende correctamente antes de hacer la siguiente pregunta.\n- Respuestas cortas: 1 pregunta guía + 1 frase de aliento para razonamiento; respuesta directa + breve explicación para lo factual. No des clases magistrales.\n- Usa markdown limpio: **negrita** para conceptos clave, - para listas. NO uses asteriscos triples ni subrayados.\n- Responde SIEMPRE en español.`;

      const messages = [
        ...((Array.isArray(history) ? history : []) as { role: string; content: string }[]).map((h) => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: String(h.content),
        })),
        { role: 'user', content: String(message) },
      ];

      const bedrockRes = await bedrock.send(
        new InvokeModelCommand({
          modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 600,
            system: systemPrompt,
            messages,
          }),
        })
      );
      const parsed = JSON.parse(new TextDecoder().decode(bedrockRes.body));
      const reply = parsed.content?.[0]?.text ?? '';
      return ok({ reply });
    }

    // ── GET /my-study-plan ──────────────────────────────────────────────────
    if (method === 'GET' && path === '/my-study-plan') {
      const cacheItem = await ddb.send(new GetCommand({
        TableName: TABLES.PROGRESS,
        Key: { userId: 'STUDYPLAN', lessonId: userId },
      })).then((r) => r.Item).catch(() => null);

      if (cacheItem?.plan) {
        const age = Date.now() - new Date(cacheItem.generatedAt as string).getTime();
        if (age < 7 * 24 * 60 * 60 * 1000) {
          return ok({ plan: cacheItem.plan, generatedAt: cacheItem.generatedAt, cached: true });
        }
      }

      const prisma = await getPrismaClient();
      const [myEnrollments, quizAttempts] = await Promise.all([
        getEnrollments(userId),
        getAllQuizAttemptsForUser(userId),
      ]);
      const courseIds = myEnrollments.map((e) => e.courseId);
      if (courseIds.length === 0) return ok({ plan: null });

      const courses = await prisma.course.findMany({
        where: { id: { in: courseIds } },
        include: { modules: { orderBy: { order: 'asc' }, include: { lessons: { select: { id: true } } } } },
      });

      const progressResults = await Promise.all(courseIds.map((cid) => getLessonProgress(userId, cid)));
      const completedLessonIds = new Set(progressResults.flat().map((p: any) => p.lessonId));
      const passedModuleIds = new Set(quizAttempts.filter((a) => a.passed).map((a) => a.moduleId));

      const lines: string[] = [];
      for (const course of courses) {
        lines.push(`Curso: ${course.title}`);
        for (const mod of (course as any).modules) {
          const done = mod.lessons.filter((l: any) => completedLessonIds.has(l.id)).length;
          const total = mod.lessons.length;
          const quizPassed = passedModuleIds.has(mod.id);
          const status = done === 0 ? 'no iniciado'
            : done < total ? `${done}/${total} lecciones completadas`
            : !quizPassed ? 'lecciones completas — quiz pendiente'
            : 'módulo completado ✓';
          lines.push(`  - Módulo ${mod.order}: ${mod.title} — ${status}`);
        }
      }

      const prompt = `Eres un coach educativo de Lux Learning. Crea un plan de estudio semanal personalizado para este estudiante.

PROGRESO ACTUAL:
${lines.join('\n')}

Genera un plan concreto de 5 días (Lunes a Viernes). Para cada día indica:
- Qué módulo/lección trabajar (sé específico con los nombres)
- Objetivo del día en 1 frase
- Tiempo estimado (30-60 min)

Tono motivador y cercano. Máximo 350 palabras. Solo en español.`;

      const bedrockRes = await bedrock.send(new InvokeModelCommand({
        modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      }));
      const bedrockParsed = JSON.parse(new TextDecoder().decode(bedrockRes.body));
      const plan = bedrockParsed.content?.[0]?.text?.trim() ?? '';

      const generatedAt = new Date().toISOString();
      await ddb.send(new PutCommand({
        TableName: TABLES.PROGRESS,
        Item: { userId: 'STUDYPLAN', lessonId: userId, plan, generatedAt },
      })).catch(() => {});

      return ok({ plan, generatedAt, cached: false });
    }

    // ── POST /my-study-plan/refresh — force regenerate ──────────────────────
    if (method === 'POST' && path === '/my-study-plan/refresh') {
      await ddb.send(new PutCommand({
        TableName: TABLES.PROGRESS,
        Item: { userId: 'STUDYPLAN', lessonId: userId, plan: null, generatedAt: '1970-01-01T00:00:00.000Z' },
      })).catch(() => {});
      return ok({ cleared: true });
    }

    // ── POST /student/heartbeat ───────────────────────────────────────────────
    if (method === 'POST' && path === '/student/heartbeat') {
      if (userId) {
        await updateLastSeen(userId);
        // Reset inactivity reminder sequence when student returns
        setInactivityReminder(userId, 0, null).catch((err) => {
          console.warn('[Heartbeat] Failed to reset inactivity reminder for', userId, err);
        });
      }
      return ok({ ok: true });
    }

    // ── GET /student/onboarding ───────────────────────────────────────────────
    if (method === 'GET' && path === '/student/onboarding') {
      const done = userId ? await isOnboardingDone(userId) : false;
      return ok({ done });
    }

    // ── POST /student/onboarding ──────────────────────────────────────────────
    if (method === 'POST' && path === '/student/onboarding') {
      if (userId) await markOnboardingDone(userId);
      return ok({ ok: true });
    }

    // ── PUT /student/tasks/:taskId/submit — submit a URL for a task ───────────
    const taskSubmitMatch = path.match(/^\/student\/tasks\/([^/]+)\/submit$/);
    if (taskSubmitMatch && method === 'PUT') {
      const taskId = taskSubmitMatch[1]!;
      let body: any = {};
      try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* no body */ }
      const { submissionUrl } = body as { submissionUrl?: string };
      if (!submissionUrl) return badRequest('submissionUrl es requerido');
      const tasks = await getTasksForUser(userId);
      const task = tasks.find((t: any) => t.taskId === taskId);
      if (!task) return badRequest('Tarea no encontrada');
      await updateTask(userId, task.sk, { status: 'COMPLETED', completedAt: new Date().toISOString() });
      // Also store submissionUrl via UpdateCommand
      await ddb.send(new UpdateCommand({
        TableName: TABLES.TASKS,
        Key: { userId, sk: task.sk },
        UpdateExpression: 'SET submissionUrl = :url',
        ExpressionAttributeValues: { ':url': submissionUrl },
      })).catch(() => {});
      return ok({ ok: true });
    }

    // ── Activity / Session Tracking ───────────────────────────────────────────

    if (method === 'POST' && path === '/student/activity/start') {
      let body: any = {};
      try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* no body */ }
      const { sessionId } = body as { sessionId?: string };
      if (!sessionId) return badRequest('sessionId es requerido');
      await startSession(userId, sessionId);
      return ok({ ok: true });
    }

    if (method === 'PUT' && path === '/student/activity/update') {
      let body: any = {};
      try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* no body */ }
      const { sessionId, durationSeconds } = body as { sessionId?: string; durationSeconds?: number };
      if (!sessionId) return badRequest('sessionId es requerido');
      await updateSession(userId, sessionId, durationSeconds ?? 0);
      return ok({ ok: true });
    }

    if (method === 'POST' && path === '/student/activity/end') {
      let body: any = {};
      try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* no body */ }
      const { sessionId } = body as { sessionId?: string };
      if (!sessionId) return badRequest('sessionId es requerido');
      await endSession(userId, sessionId);
      return ok({ ok: true });
    }

    if (method === 'GET' && path === '/student/activity') {
      const days = parseInt(event.queryStringParameters?.days ?? '30', 10);
      const [sessions, quizAttempts, tasks] = await Promise.all([
        getActivity(userId, days),
        getAllQuizAttemptsForUser(userId),
        getTasksForUser(userId),
      ]);
      // Build summary
      const totalSeconds = sessions.reduce((s: number, sess: any) => s + (sess.durationSeconds ?? 0), 0);
      const totalHours = Math.round((totalSeconds / 3600) * 10) / 10;
      // Group by day for chart
      const byDay: Record<string, number> = {};
      sessions.forEach((sess: any) => {
        const day = (sess.startedAt ?? '').slice(0, 10);
        if (day) byDay[day] = (byDay[day] ?? 0) + (sess.durationSeconds ?? 0);
      });
      const completedTasks = tasks.filter((t: any) => t.status === 'COMPLETED');
      return ok({ sessions, totalHours, byDay, quizAttempts, completedTasks });
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
