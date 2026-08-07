// ─── courses/classes.ts ───────────────────────────────────────────────────────
// Student-facing routes for Lux Mentor Class sessions.
// GET  /my-classes?moduleId=X    — list this student's sessions
// POST /my-classes/start         — register new session + return Vapi config
// PATCH /my-classes/:sessionId   — update vapiCallId / status
import { randomUUID } from 'crypto';
import { ok, badRequest, forbidden } from '../shared/response';
import {
  listMyClassSessions,
  createClassSession,
  getClassSession,
  updateClassSession,
} from '../shared/db-classes';

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
    // Include voided sessions so frontend can show the "network failure, retry" message
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
      return ok({ sessionId: null, vapiPublicKey: '', vapiPrompt: null, vapiObjectives: null, lessonVideoUrl: null, lessonScript: null });
    }

    // Find CLASS type EvaluationEvent for this course+module
    const evalEvent = await prisma.evaluationEvent.findFirst({
      where: { courseId, moduleId, type: 'CLASS' },
      orderBy: { order: 'asc' },
    }) ?? await prisma.evaluationEvent.findFirst({
      where: { courseId, type: 'CLASS' },
      orderBy: { order: 'asc' },
    });

    // Reuse existing non-completed session to avoid ghost records
    const existing = await listMyClassSessions(userId, moduleId);
    const reusable = existing.find((s) => s.status === 'pending' || s.status === 'content_viewed' || s.status === 'in_progress');

    const sessionId = reusable?.sessionId ?? randomUUID();
    if (!reusable) {
      await createClassSession({
        userId,
        sessionId,
        courseId,
        moduleId,
        evaluationEventId: evalEvent?.id ?? undefined,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }

    return ok({
      sessionId,
      vapiPublicKey,
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
    const { vapiCallId, status } = body as { vapiCallId?: string; status?: string };

    // Verify ownership
    const session = await getClassSession(userId, sessionId);
    if (!session) return badRequest('Sesión no encontrada');

    const patch: Record<string, any> = {};
    if (vapiCallId) patch.vapiCallId = vapiCallId;
    if (status) patch.status = status;
    if (Object.keys(patch).length) await updateClassSession(userId, sessionId, patch as any);
    return ok({ updated: true });
  }

  return null; // not handled here
}
