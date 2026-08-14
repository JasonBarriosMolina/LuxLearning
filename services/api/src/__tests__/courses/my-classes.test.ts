/**
 * Tests for courses/classes.ts (student-facing /my-classes routes)
 * Covers: GET, POST /start (fresh/completed/exhausted/no-key), PATCH, unmatched
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── db-classes mock ───────────────────────────────────────────────────────────
const mockListMySessions = vi.fn().mockResolvedValue([]);
const mockCreateSession  = vi.fn().mockResolvedValue(undefined);
const mockGetSession     = vi.fn().mockResolvedValue(null);
const mockUpdateSession  = vi.fn().mockResolvedValue(undefined);

vi.mock('../../shared/db-classes', () => ({
  listMyClassSessions:  (...a: any[]) => mockListMySessions(...a),
  createClassSession:   (...a: any[]) => mockCreateSession(...a),
  getClassSession:      (...a: any[]) => mockGetSession(...a),
  updateClassSession:   (...a: any[]) => mockUpdateSession(...a),
}));

import { handleClasses } from '../../courses/classes';

// ── Helpers ───────────────────────────────────────────────────────────────────
const makePrisma = (evalEvent: any = null) => ({
  evaluationEvent: {
    findFirst: vi.fn().mockResolvedValue(evalEvent),
  },
});

const makeEvent = (qs: Record<string, string> = {}, body: any = null) => ({
  queryStringParameters: qs,
  body: body ? JSON.stringify(body) : null,
});

const bodyOf = async (res: any) => JSON.parse(res?.body ?? '{}');

const START_BODY = { courseId: 'course-1', moduleId: 'mod-1' };

const EVAL_EVENT = {
  id: 'ev-1', type: 'CLASS',
  vapiPrompt: 'Eres Lux Mentor.',
  vapiObjectives: '["Obj1","Obj2"]',
  lessonVideoUrl: null,
  lessonScript: 'Contenido de la lección.',
};

beforeEach(() => {
  vi.resetAllMocks();
  mockListMySessions.mockResolvedValue([]);
  mockCreateSession.mockResolvedValue(undefined);
  mockGetSession.mockResolvedValue(null);
  mockUpdateSession.mockResolvedValue(undefined);
  process.env.VAPI_PUBLIC_KEY = 'test-vapi-key';
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /my-classes
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /my-classes', () => {
  it('returns sessions for module', async () => {
    const session = { sessionId: 'ses-1', userId: 'u1', moduleId: 'mod-1', status: 'completed', createdAt: new Date().toISOString() };
    mockListMySessions.mockResolvedValueOnce([session]);
    const res = await handleClasses(
      makeEvent({ moduleId: 'mod-1' }), 'GET', '/my-classes', 'u1', makePrisma(),
    );
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].sessionId).toBe('ses-1');
  });

  it('returns 403 when no userId', async () => {
    const res = await handleClasses(makeEvent({ moduleId: 'mod-1' }), 'GET', '/my-classes', undefined, makePrisma());
    expect(res?.statusCode).toBe(403);
  });

  it('returns 400 when moduleId missing', async () => {
    const res = await handleClasses(makeEvent(), 'GET', '/my-classes', 'u1', makePrisma());
    expect(res?.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /my-classes/start — fresh session
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /my-classes/start — fresh', () => {
  it('creates session and returns vapiPublicKey', async () => {
    const prisma = makePrisma(EVAL_EVENT);
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', prisma,
    );
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.vapiPublicKey).toBe('test-vapi-key');
    expect(body.data.hasCompletedQA).toBe(false);
    expect(body.data.sessionId).toBeTruthy();
    expect(mockCreateSession).toHaveBeenCalledOnce();
  });

  it('reuses pending session instead of creating new', async () => {
    mockListMySessions.mockResolvedValueOnce([
      { sessionId: 'existing-ses', userId: 'u1', moduleId: 'mod-1', status: 'pending', createdAt: new Date().toISOString() },
    ]);
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', makePrisma(EVAL_EVENT),
    );
    const body = await bodyOf(res);
    expect(body.data.sessionId).toBe('existing-ses');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns vapiPrompt and lessonScript from EvaluationEvent', async () => {
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', makePrisma(EVAL_EVENT),
    );
    const body = await bodyOf(res);
    expect(body.data.vapiPrompt).toBe('Eres Lux Mentor.');
    expect(body.data.lessonScript).toBe('Contenido de la lección.');
  });

  it('handles missing EvaluationEvent gracefully (still creates session)', async () => {
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', makePrisma(null),
    );
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.vapiPublicKey).toBe('test-vapi-key');
    expect(body.data.vapiPrompt).toBeNull();
    expect(mockCreateSession).toHaveBeenCalledOnce();
  });

  it('returns 400 when courseId missing', async () => {
    const res = await handleClasses(
      makeEvent({}, { moduleId: 'mod-1' }), 'POST', '/my-classes/start', 'u1', makePrisma(),
    );
    expect(res?.statusCode).toBe(400);
  });

  it('returns 403 when no userId', async () => {
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', undefined, makePrisma(),
    );
    expect(res?.statusCode).toBe(403);
  });

  it('returns empty config when VAPI_PUBLIC_KEY not set', async () => {
    delete process.env.VAPI_PUBLIC_KEY;
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', makePrisma(),
    );
    const body = await bodyOf(res);
    expect(body.data.vapiPublicKey).toBe('');
    expect(body.data.sessionId).toBeNull();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /my-classes/start — hasCompletedQA
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /my-classes/start — completed session', () => {
  it('returns hasCompletedQA=true when session exists with hasCompletedQA flag', async () => {
    mockListMySessions.mockResolvedValueOnce([{
      sessionId: 'ses-done', userId: 'u1', moduleId: 'mod-1',
      status: 'completed', hasCompletedQA: true,
      transcript: 'El estudiante respondió bien.',
      messages: [{ role: 'assistant', message: 'Hola' }],
      createdAt: new Date().toISOString(),
    }]);
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', makePrisma(EVAL_EVENT),
    );
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.hasCompletedQA).toBe(true);
    expect(body.data.vapiPublicKey).toBe('');
    expect(body.data.transcript).toBe('El estudiante respondió bien.');
    expect(body.data.lessonScript).toBe('Contenido de la lección.');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns hasCompletedQA=true for old-style completed session (no hasCompletedQA flag)', async () => {
    mockListMySessions.mockResolvedValueOnce([{
      sessionId: 'ses-old', userId: 'u1', moduleId: 'mod-1',
      status: 'completed', createdAt: new Date().toISOString(),
    }]);
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', makePrisma(EVAL_EVENT),
    );
    const body = await bodyOf(res);
    expect(body.data.hasCompletedQA).toBe(true);
  });

  it('does not count completed session as real attempt', async () => {
    // 1 completed + 1 voided → total real attempts = 0 non-voided w/ callId
    mockListMySessions.mockResolvedValueOnce([
      { sessionId: 's1', status: 'completed', hasCompletedQA: true, createdAt: new Date().toISOString() },
    ]);
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', makePrisma(EVAL_EVENT),
    );
    const body = await bodyOf(res);
    expect(body.data.hasCompletedQA).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /my-classes/start — attempts exhausted
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /my-classes/start — attempts exhausted', () => {
  it('returns attemptsExhausted=true when 2 real attempts exist', async () => {
    mockListMySessions.mockResolvedValueOnce([
      { sessionId: 's1', status: 'error', voided: false, vapiCallId: 'call-1', createdAt: new Date().toISOString() },
      { sessionId: 's2', status: 'error', voided: false, vapiCallId: 'call-2', createdAt: new Date().toISOString() },
    ]);
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', makePrisma(EVAL_EVENT),
    );
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.attemptsExhausted).toBe(true);
    expect(body.data.vapiPublicKey).toBe('');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('does NOT count voided sessions as real attempts', async () => {
    mockListMySessions.mockResolvedValueOnce([
      { sessionId: 's1', status: 'error', voided: true, vapiCallId: 'call-1', createdAt: new Date().toISOString() },
      { sessionId: 's2', status: 'error', voided: true, vapiCallId: 'call-2', createdAt: new Date().toISOString() },
    ]);
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', makePrisma(EVAL_EVENT),
    );
    const body = await bodyOf(res);
    // Voided don't count → NOT exhausted, can start new session
    expect(body.data.attemptsExhausted).toBeFalsy();
    expect(body.data.vapiPublicKey).toBe('test-vapi-key');
  });

  it('does NOT count sessions without vapiCallId as real attempts', async () => {
    mockListMySessions.mockResolvedValueOnce([
      { sessionId: 's1', status: 'pending', voided: false, createdAt: new Date().toISOString() },
      { sessionId: 's2', status: 'content_viewed', voided: false, createdAt: new Date().toISOString() },
    ]);
    const res = await handleClasses(
      makeEvent({}, START_BODY), 'POST', '/my-classes/start', 'u1', makePrisma(EVAL_EVENT),
    );
    const body = await bodyOf(res);
    expect(body.data.attemptsExhausted).toBeFalsy();
    expect(body.data.vapiPublicKey).toBe('test-vapi-key');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /my-classes/:sessionId
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /my-classes/:sessionId', () => {
  it('updates vapiCallId and status', async () => {
    mockGetSession.mockResolvedValueOnce({ sessionId: 'ses-1', userId: 'u1', status: 'pending', createdAt: '' });
    const res = await handleClasses(
      makeEvent({}, { vapiCallId: 'call-abc', status: 'qa_started' }),
      'PATCH', '/my-classes/ses-1', 'u1', makePrisma(),
    );
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.updated).toBe(true);
    expect(mockUpdateSession).toHaveBeenCalledWith('u1', 'ses-1', expect.objectContaining({ vapiCallId: 'call-abc', status: 'qa_started' }));
  });

  it('sets hasCompletedQA=true', async () => {
    mockGetSession.mockResolvedValueOnce({ sessionId: 'ses-1', userId: 'u1', status: 'qa_started', createdAt: '' });
    const res = await handleClasses(
      makeEvent({}, { hasCompletedQA: true }),
      'PATCH', '/my-classes/ses-1', 'u1', makePrisma(),
    );
    expect(res?.statusCode).toBe(200);
    expect(mockUpdateSession).toHaveBeenCalledWith('u1', 'ses-1', expect.objectContaining({ hasCompletedQA: true }));
  });

  it('returns 400 when session not found', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await handleClasses(
      makeEvent({}, { status: 'completed' }),
      'PATCH', '/my-classes/bad-id', 'u1', makePrisma(),
    );
    expect(res?.statusCode).toBe(400);
  });

  it('returns 403 when no userId', async () => {
    const res = await handleClasses(
      makeEvent({}, { status: 'completed' }),
      'PATCH', '/my-classes/ses-1', undefined, makePrisma(),
    );
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unmatched routes → null
// ─────────────────────────────────────────────────────────────────────────────

describe('unmatched routes', () => {
  it('returns null for unknown path', async () => {
    const res = await handleClasses(makeEvent(), 'GET', '/something-else', 'u1', makePrisma());
    expect(res).toBeNull();
  });

  it('returns null for POST /my-classes (no /start suffix)', async () => {
    const res = await handleClasses(makeEvent({}, START_BODY), 'POST', '/my-classes', 'u1', makePrisma());
    expect(res).toBeNull();
  });
});
