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
} from '../shared/db-dynamo';
import type { FavoriteItem } from '../shared/db-dynamo';
import { ok, badRequest, serverError, cors } from '../shared/response';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

export const handler = async (event: Event) => {
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
      } catch (ytErr) {
        console.error('[Transcript] YouTube fetch failed:', ytErr);
        return ok({ transcript: null, cached: false });
      }
    }

    // ── Chat ──────────────────────────────────────────────────────────────────

    // POST /lessons/chat
    if (method === 'POST' && path.includes('/chat')) {
      const { lessonId, lessonTitle, lessonContent, moduleTitle, history, message } = JSON.parse(event.body ?? '{}');
      if (!message) return badRequest('message is required');

      const systemPrompt = `Eres un tutor experto en ${moduleTitle ?? 'el tema de la lección'}. El estudiante está viendo la lección "${lessonTitle ?? ''}".${lessonContent ? `\n\nContenido de la lección:\n${String(lessonContent).slice(0, 3000)}` : ''}\n\nResponde en español, de forma concisa y pedagógica. Sé amable y motivador.`;

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

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
