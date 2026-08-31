// ─── courses/classes.ts ───────────────────────────────────────────────────────
// Student-facing routes for Lux Mentor Class sessions.
// GET  /my-classes?moduleId=X    — list this student's sessions
// POST /my-classes/start         — register new session + return Vapi config
// PATCH /my-classes/:sessionId   — update vapiCallId / status / hasCompletedQA
import { randomUUID } from 'crypto';
import { ok, badRequest, forbidden } from '../shared/response';
import {
  listMyClassSessions,
  createClassSession,
  getClassSession,
  updateClassSession,
} from '../shared/db-classes';

// Trello DmPpbrff item 7 (2026-08-30 20:28): "el estudiante no puede llevar 2 veces las
// clases con Luz Mentor... es imperativo que solo sea una vez." Was 2 — a student could
// legitimately retake a class with no technical issue at all. Voided (technical-failure)
// sessions are still excluded from this count, so a real connection problem still gets a
// free retry — only a second *successful-connection* attempt is now blocked.
const MAX_ATTEMPTS = 1;

export async function handleClasses(
  event: any,
  method: string,
  path: string,
  userId: string | undefined,
  prisma: any,
): Promise<any | null> {
  // ── GET /my-classes?moduleId=X ───────────────────────────────────────────────
  if (path === '/my-classes' && method === 'GET') {
    if (!userId) return forbidden('Login required');
    const moduleId = event.queryStringParameters?.moduleId;
    if (!moduleId) return badRequest('moduleId required');
    const sessions = await listMyClassSessions(userId, moduleId);
    return ok(sessions);
  }

  // ── POST /my-classes/start — register session + return Vapi config ───────────
  if (path === '/my-classes/start' && method === 'POST') {
    if (!userId) return forbidden('Login required');
    let body: any = {};
    try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }
    const { courseId, moduleId } = body as { courseId?: string; moduleId?: string };
    if (!courseId || !moduleId) return badRequest('courseId and moduleId required');

    const vapiPublicKey = process.env.VAPI_PUBLIC_KEY ?? '';
    if (!vapiPublicKey) {
      return ok({ sessionId: null, vapiPublicKey: '', hasCompletedQA: false, vapiPrompt: null, vapiObjectives: null, lessonVideoUrl: null, lessonScript: null });
    }

    // Get all existing sessions for this module
    const existing = await listMyClassSessions(userId, moduleId);

    // Check if already completed (permanent one-time flag)
    const completedSession = existing.find((s) => s.hasCompletedQA || s.status === 'completed');
    if (completedSession) {
      // Fetch lessonScript so frontend can show it in Tab 1
      let lessonScript: string | null = null;
      try {
        const ev = await prisma.evaluationEvent.findFirst({
          where: { courseId, moduleId, type: 'CLASS' },
          orderBy: { order: 'asc' },
        }) ?? await prisma.evaluationEvent.findFirst({
          where: { courseId, type: 'CLASS' },
          orderBy: { order: 'asc' },
        });
        lessonScript = ev?.lessonScript ?? null;
      } catch (err) {
        console.warn('[my-classes/start] evaluationEvent fetch failed (completed path):', err);
      }
      return ok({
        sessionId: completedSession.sessionId,
        vapiPublicKey: '',
        hasCompletedQA: true,
        transcript: completedSession.transcript ?? null,
        messages: completedSession.messages ?? [],
        lessonScript,
        vapiPrompt: null,
        vapiObjectives: null,
        lessonVideoUrl: null,
      });
    }

    // Count real attempts: non-voided sessions that actually reached Vapi (have a callId)
    const realAttempts = existing.filter((s) => !s.voided && s.vapiCallId).length;
    if (realAttempts >= MAX_ATTEMPTS) {
      return ok({
        sessionId: null,
        vapiPublicKey: '',
        hasCompletedQA: false,
        attemptsExhausted: true,
      });
    }

    // Fetch CLASS EvaluationEvent — wrap in try-catch, non-fatal
    let evalEvent: any = null;
    try {
      evalEvent = await prisma.evaluationEvent.findFirst({
        where: { courseId, moduleId, type: 'CLASS' },
        orderBy: { order: 'asc' },
      }) ?? await prisma.evaluationEvent.findFirst({
        where: { courseId, type: 'CLASS' },
        orderBy: { order: 'asc' },
      });
    } catch (err) {
      console.warn('[my-classes/start] evaluationEvent query failed (start path):', err);
    }

    // Reuse pending session (avoid ghost records on refresh)
    const reusable = existing.find((s) =>
      s.status === 'pending' || s.status === 'content_viewed' || s.status === 'qa_started',
    );
    const sessionId = reusable?.sessionId ?? randomUUID();
    if (!reusable) {
      await createClassSession({
        userId,
        sessionId,
        courseId,
        moduleId,
        evaluationEventId: evalEvent?.id ?? undefined,
        status: 'pending',
        attempts: realAttempts,
        createdAt: new Date().toISOString(),
      });
    }

    return ok({
      sessionId,
      vapiPublicKey,
      hasCompletedQA: false,
      attemptsExhausted: false,
      attemptsUsed: realAttempts,
      attemptsMax: MAX_ATTEMPTS,
      vapiPrompt: evalEvent?.vapiPrompt ?? null,
      vapiObjectives: evalEvent?.vapiObjectives ?? null,
      lessonVideoUrl: evalEvent?.lessonVideoUrl ?? null,
      lessonScript: evalEvent?.lessonScript ?? null,
    });
  }

  // ── PATCH /my-classes/:sessionId — update callId / status ───────────────────
  const patchMatch = path.match(/^\/my-classes\/([^/]+)$/);
  if (patchMatch && method === 'PATCH') {
    if (!userId) return forbidden('Login required');
    const sessionId = patchMatch[1]!;
    let body: any = {};
    try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }
    const { vapiCallId, status, hasCompletedQA } = body as {
      vapiCallId?: string;
      status?: string;
      hasCompletedQA?: boolean;
    };

    const session = await getClassSession(userId, sessionId);
    if (!session) return badRequest('Sesión no encontrada');

    const patch: Record<string, any> = {};
    if (vapiCallId) patch.vapiCallId = vapiCallId;
    if (status) patch.status = status;
    if (hasCompletedQA === true) patch.hasCompletedQA = true;
    if (Object.keys(patch).length) await updateClassSession(userId, sessionId, patch as any);
    return ok({ updated: true });
  }

  return null; // not handled here
}
