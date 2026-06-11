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
  TABLES, ddb,
} from '../shared/db-dynamo';
import { sendTemplatedEmail } from '../shared/email';
import { getPrismaClient } from '../shared/db-neon';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { FavoriteItem } from '../shared/db-dynamo';
import { ok, badRequest, serverError, cors, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();
  setRequestOrigin(event.headers?.origin ?? event.headers?.Origin);
  setEnvironmentFromOrigin(event.headers?.origin ?? event.headers?.Origin);

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
      const { lessonId, lessonTitle, lessonContent, moduleTitle, history, message } = JSON.parse(event.body ?? '{}');
      if (!message) return badRequest('message is required');

      const systemPrompt = `Eres el Mentor de Lux Learning, un asistente pedagógico experto en ${moduleTitle ?? 'el tema de la lección'}. El estudiante está viendo la lección "${lessonTitle ?? ''}".${lessonContent ? `\n\nContenido de la lección:\n${String(lessonContent).slice(0, 3000)}` : ''}\n\nINSTRUCCIONES:\n- Responde SIEMPRE en español\n- Usa markdown limpio: ## para secciones, - para listas, **negrita** para conceptos clave\n- Máximo 2-3 párrafos cortos por respuesta\n- Sé conciso, pedagógico y motivador\n- NO uses asteriscos triples ni subrayados`;

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

    // ── POST /student/heartbeat ───────────────────────────────────────────────
    if (method === 'POST' && path === '/student/heartbeat') {
      if (userId) await updateLastSeen(userId);
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
