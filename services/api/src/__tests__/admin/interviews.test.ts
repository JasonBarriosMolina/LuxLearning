/**
 * Tests for admin/interviews.ts
 * Covers: list, create, update, delete, AI generate — auth guards + validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAdminCtx, makePrisma, makeEvent, bodyOf } from '../helpers/ctx';

// ── AWS SDK mocks ─────────────────────────────────────────────────────────────
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: vi.fn() }; },
  InvokeModelCommand:   function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return { send: vi.fn() }; },
  AdminGetUserCommand:           function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-ses',   () => ({ SESClient:   function () { return { send: vi.fn() }; } }));
vi.mock('@aws-sdk/client-s3',    () => ({ S3Client:    function () { return { send: vi.fn() }; }, PutObjectCommand: function (x: any) { return x; } }));
vi.mock('@aws-sdk/client-polly', () => ({ PollyClient: function () { return { send: vi.fn() }; } }));
vi.mock('@aws-sdk/client-lambda',() => ({ LambdaClient:function () { return { send: vi.fn() }; }, InvokeCommand: function (x: any) { return x; } }));

// ── Shared helpers mocks ──────────────────────────────────────────────────────
vi.mock('../../shared/db-submissions', () => ({
  listInterviewsForModule: vi.fn().mockResolvedValue([]),
}));

// ── Bedrock / invokeBedrockForJson mock ───────────────────────────────────────
vi.mock('../../admin/ctx', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    invokeBedrockForJson: vi.fn().mockResolvedValue({
      vapiPrompt: 'Eres un evaluador oral. Evalúa al estudiante con 3 preguntas.',
      vapiObjectives: ['Comprensión conceptual', 'Aplicación práctica', 'Análisis crítico'],
    }),
  };
});

import { handleInterviews } from '../../admin/interviews';
import { invokeBedrockForJson } from '../../admin/ctx';
import { listInterviewsForModule } from '../../shared/db-submissions';

// ── Helpers ───────────────────────────────────────────────────────────────────
const EVAL_EVENT = {
  id: 'ev-1', courseId: 'course-1', moduleId: 'mod-1',
  type: 'INTERVIEW', name: 'Entrevista Final',
  dueDate: null, weight: 15, order: 1,
  vapiPrompt: 'prompt', vapiObjectives: 'obj', targetStudentIds: [],
  createdAt: new Date().toISOString(),
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/interviews/generate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/interviews/generate', () => {
  it('returns vapiPrompt + vapiObjectives from Bedrock', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/interviews/generate',
      body: { title: 'Entrevista Final', topic: 'Python básico', courseTitle: 'Intro Python', language: 'ES' },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.vapiPrompt).toBeTruthy();
    expect(Array.isArray(body.data.vapiObjectives)).toBe(true);
    expect(invokeBedrockForJson).toHaveBeenCalledOnce();
  });

  it('returns 400 when neither title nor topic provided', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/interviews/generate',
      body: {},
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 403 for STUDENT role', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'POST', path: '/admin/interviews/generate',
      body: { title: 'Test' },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/interviews
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /admin/interviews', () => {
  it('returns interview definitions for a course', async () => {
    const prisma = makePrisma({
      evaluationEvent: { findMany: vi.fn().mockResolvedValue([EVAL_EVENT]) },
    });
    const ctx = makeAdminCtx({
      method: 'GET', path: '/admin/interviews', prisma,
      event: makeEvent('ADMIN', 'GET', '/admin/interviews', { qs: { courseId: 'course-1' } }),
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].id).toBe('ev-1');
  });

  it('returns 400 when courseId missing', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/interviews' });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('enriches with submissionCount when includeSubmissions=true', async () => {
    vi.mocked(listInterviewsForModule).mockResolvedValueOnce([
      { userId: 'u1', interviewId: 'iv-1', courseId: 'course-1', moduleId: 'mod-1', status: 'completed', createdAt: new Date().toISOString() },
    ] as any);
    const prisma = makePrisma({
      evaluationEvent: { findMany: vi.fn().mockResolvedValue([EVAL_EVENT]) },
      course: { findUnique: vi.fn().mockResolvedValue({ modules: [{ id: 'mod-1', title: 'Módulo 1' }] }) },
    });
    const ctx = makeAdminCtx({
      method: 'GET', path: '/admin/interviews', prisma,
      event: makeEvent('ADMIN', 'GET', '/admin/interviews', { qs: { courseId: 'course-1', includeSubmissions: 'true' } }),
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data[0].submissionCount).toBe(1);
    expect(body.data[0].pendingCount).toBe(1); // no grade
  });

  it('EVALUATOR can list', async () => {
    const prisma = makePrisma({
      evaluationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR', 'GET', '/admin/interviews', { qs: { courseId: 'course-1' } }),
      method: 'GET', path: '/admin/interviews', prisma,
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/interviews
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/interviews', () => {
  it('creates interview definition and returns 201', async () => {
    const created = { ...EVAL_EVENT };
    const prisma = makePrisma({
      course:          { findUnique: vi.fn().mockResolvedValue({ id: 'course-1' }) },
      module:          { findUnique: vi.fn().mockResolvedValue({ id: 'mod-1' }) },
      evaluationEvent: {
        findFirst: vi.fn().mockResolvedValue({ order: 2 }),
        create:    vi.fn().mockResolvedValue(created),
      },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/interviews', prisma,
      body: {
        courseId: 'course-1', moduleId: 'mod-1',
        name: 'Entrevista Final', weight: 15, dueDate: '2026-10-01',
        vapiPrompt: 'prompt', vapiObjectives: 'obj1\nobj2\nobj3',
      },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(201);
    const body = await bodyOf(res);
    expect(body.data.id).toBe('ev-1');
  });

  it('returns 400 when name is missing', async () => {
    const prisma = makePrisma({
      course: { findUnique: vi.fn().mockResolvedValue({ id: 'course-1' }) },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/interviews', prisma,
      body: { courseId: 'course-1' },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when courseId is missing', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/interviews',
      body: { name: 'Test' },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 404 when course not found', async () => {
    const prisma = makePrisma({
      course: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/interviews', prisma,
      body: { courseId: 'bad-id', name: 'Test' },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 404 when module not found', async () => {
    const prisma = makePrisma({
      course: { findUnique: vi.fn().mockResolvedValue({ id: 'course-1' }) },
      module: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/interviews', prisma,
      body: { courseId: 'course-1', moduleId: 'bad-mod', name: 'Test' },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('creates with targetStudentIds (specific students)', async () => {
    const prisma = makePrisma({
      course:          { findUnique: vi.fn().mockResolvedValue({ id: 'course-1' }) },
      evaluationEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create:    vi.fn().mockResolvedValue({ ...EVAL_EVENT, targetStudentIds: ['student1', 'student2'] }),
      },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/interviews', prisma,
      body: { courseId: 'course-1', name: 'Entrevista selectiva', targetStudentIds: ['student1', 'student2'] },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(201);
    const body = await bodyOf(res);
    expect(body.data.targetStudentIds).toEqual(['student1', 'student2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /admin/interviews/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /admin/interviews/:id', () => {
  it('updates and returns 200', async () => {
    const updated = { ...EVAL_EVENT, name: 'Nuevo nombre', weight: 20 };
    const prisma = makePrisma({
      evaluationEvent: {
        findUnique: vi.fn().mockResolvedValue(EVAL_EVENT),
        update:     vi.fn().mockResolvedValue(updated),
      },
    });
    const ctx = makeAdminCtx({
      method: 'PUT', path: '/admin/interviews/ev-1', prisma,
      body: { name: 'Nuevo nombre', weight: 20 },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.name).toBe('Nuevo nombre');
  });

  it('returns 404 when event not found', async () => {
    const ctx = makeAdminCtx({
      method: 'PUT', path: '/admin/interviews/bad-id',
      body: { name: 'X' },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 400 when trying to update a non-INTERVIEW event', async () => {
    const prisma = makePrisma({
      evaluationEvent: { findUnique: vi.fn().mockResolvedValue({ ...EVAL_EVENT, type: 'QUIZ' }) },
    });
    const ctx = makeAdminCtx({
      method: 'PUT', path: '/admin/interviews/ev-1', prisma,
      body: { name: 'X' },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('EVALUATOR can update', async () => {
    const updated = { ...EVAL_EVENT, name: 'Updated by eval' };
    const prisma = makePrisma({
      evaluationEvent: {
        findUnique: vi.fn().mockResolvedValue(EVAL_EVENT),
        update:     vi.fn().mockResolvedValue(updated),
      },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'PUT', path: '/admin/interviews/ev-1', prisma,
      body: { name: 'Updated by eval' },
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /admin/interviews/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /admin/interviews/:id', () => {
  it('ADMIN deletes and returns 200', async () => {
    const prisma = makePrisma({
      evaluationEvent: {
        findUnique: vi.fn().mockResolvedValue(EVAL_EVENT),
        delete:     vi.fn().mockResolvedValue(EVAL_EVENT),
      },
    });
    const ctx = makeAdminCtx({
      method: 'DELETE', path: '/admin/interviews/ev-1', prisma,
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.deleted).toBe(true);
  });

  it('EVALUATOR cannot delete — returns 403', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'DELETE', path: '/admin/interviews/ev-1',
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 404 when event not found', async () => {
    const ctx = makeAdminCtx({
      method: 'DELETE', path: '/admin/interviews/bad-id',
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 400 when trying to delete non-INTERVIEW event', async () => {
    const prisma = makePrisma({
      evaluationEvent: { findUnique: vi.fn().mockResolvedValue({ ...EVAL_EVENT, type: 'EVIDENCE' }) },
    });
    const ctx = makeAdminCtx({
      method: 'DELETE', path: '/admin/interviews/ev-1', prisma,
    });
    const res = await handleInterviews(ctx);
    expect(res?.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes that should not be handled by handleInterviews (return null)
// ─────────────────────────────────────────────────────────────────────────────

describe('unmatched routes', () => {
  it('returns null for unrelated paths', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/courses' });
    const res = await handleInterviews(ctx);
    expect(res).toBeNull();
  });
});
