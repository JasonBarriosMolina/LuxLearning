/**
 * Tests for admin/classes.ts
 * Covers: generate, presign-video, list, create, update, delete — auth guards + validation.
 * Mirrors the pattern from admin/interviews.test.ts.
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
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: function () { return { send: vi.fn() }; },
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: function () { return { send: vi.fn() }; },
  PutObjectCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://lux-learning-images.s3.amazonaws.com/presigned'),
}));
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: function () { return { send: vi.fn() }; },
  InvokeCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: function () { return { send: vi.fn() }; },
  SynthesizeSpeechCommand: function (x: any) { return x; },
}));

// ── db-classes mock ───────────────────────────────────────────────────────────
vi.mock('../../shared/db-classes', () => ({
  listClassSessionsForModule: vi.fn().mockResolvedValue([]),
}));

// ── db-dynamo mock ────────────────────────────────────────────────────────────
vi.mock('../../shared/db-dynamo', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, getAllEnrollments: vi.fn().mockResolvedValue([]) };
});

// ── Bedrock / invokeBedrockForJson mock ───────────────────────────────────────
vi.mock('../../admin/ctx', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    invokeBedrockForJson: vi.fn().mockResolvedValue({
      vapiPrompt: 'Eres Lux Mentor. Verifica la comprensión del estudiante con 3 preguntas.',
      vapiObjectives: ['Comprensión conceptual', 'Aplicación práctica', 'Análisis crítico'],
      lessonScript: 'En esta lección aprenderás sobre el tema principal...',
    }),
  };
});

import { handleClasses } from '../../admin/classes';
import { invokeBedrockForJson } from '../../admin/ctx';
import { listClassSessionsForModule } from '../../shared/db-classes';

// ── Test fixture ──────────────────────────────────────────────────────────────
const CLASS_EVENT = {
  id: 'cls-1', courseId: 'course-1', moduleId: 'mod-1',
  type: 'CLASS', name: 'Clase 1 — Introducción',
  dueDate: null, weight: 10, order: 1,
  vapiPrompt: 'prompt', vapiObjectives: '["obj1","obj2","obj3"]',
  lessonVideoUrl: null, lessonScript: 'guión',
  targetStudentIds: [], isDraft: false, isArchived: false,
  createdAt: new Date().toISOString(),
};

// Helper: event with query string params (GET by default)
const makeQsEvent = (role: string, qs: Record<string, string>) =>
  makeEvent(role, 'GET', '/admin/classes', { qs });

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/classes/generate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/classes/generate', () => {
  beforeEach(() => {
    vi.mocked(invokeBedrockForJson).mockResolvedValue({
      vapiPrompt: 'Eres Lux Mentor.',
      vapiObjectives: ['Obj1', 'Obj2', 'Obj3'],
      lessonScript: 'Guión de la lección...',
    });
  });

  it('returns vapiPrompt + vapiObjectives + lessonScript from Bedrock', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes/generate',
      body: { title: 'Clase 1', topic: 'Python básico', courseTitle: 'Intro Python', language: 'ES' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.vapiPrompt).toBeTruthy();
    expect(Array.isArray(body.data.vapiObjectives)).toBe(true);
    expect(typeof body.data.lessonScript).toBe('string');
    expect(invokeBedrockForJson).toHaveBeenCalledOnce();
  });

  it('returns 400 when neither title nor topic provided', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes/generate',
      body: {},
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when Bedrock result lacks vapiPrompt', async () => {
    vi.mocked(invokeBedrockForJson).mockResolvedValueOnce({ vapiObjectives: [] });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes/generate',
      body: { title: 'Test' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 403 for STUDENT role', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'POST', path: '/admin/classes/generate',
      body: { title: 'Test' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(403);
  });

  it('EVALUATOR can generate', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'POST', path: '/admin/classes/generate',
      body: { title: 'Test', topic: 'Tema' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/classes/presign-video
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/classes/presign-video', () => {
  it('returns presigned uploadUrl and publicUrl for video', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes/presign-video',
      body: { fileName: 'leccion.mp4', fileType: 'video/mp4' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.uploadUrl).toBeTruthy();
    expect(body.data.publicUrl).toMatch(/^https:\/\//);
    expect(body.data.key).toMatch(/^classes\/videos\//);
  });

  it('returns presigned URL for audio files', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes/presign-video',
      body: { fileName: 'audio.mp3', fileType: 'audio/mpeg' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
  });

  it('returns 400 when fileName missing', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes/presign-video',
      body: { fileType: 'video/mp4' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 for non-video/audio fileType', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes/presign-video',
      body: { fileName: 'doc.pdf', fileType: 'application/pdf' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/classes?courseId=X
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /admin/classes', () => {
  it('returns class definitions for a course', async () => {
    const prisma = makePrisma({
      evaluationEvent: { findMany: vi.fn().mockResolvedValue([CLASS_EVENT]) },
    });
    const ctx = makeAdminCtx({
      method: 'GET', path: '/admin/classes', prisma,
      event: makeQsEvent('ADMIN', { courseId: 'course-1' }),
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].id).toBe('cls-1');
  });

  it('returns 400 when courseId missing', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/classes' });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('enriches with submissionCount when includeSubmissions=true', async () => {
    vi.mocked(listClassSessionsForModule).mockResolvedValueOnce([
      {
        userId: 'u1', sessionId: 'ses-1', courseId: 'course-1', moduleId: 'mod-1',
        status: 'completed', voided: false, grade: undefined, createdAt: new Date().toISOString(),
      } as any,
    ]);
    const prisma = makePrisma({
      evaluationEvent: { findMany: vi.fn().mockResolvedValue([CLASS_EVENT]) },
      course: { findUnique: vi.fn().mockResolvedValue({ modules: [{ id: 'mod-1', title: 'Módulo 1' }] }) },
    });
    const ctx = makeAdminCtx({
      method: 'GET', path: '/admin/classes', prisma,
      event: makeQsEvent('ADMIN', { courseId: 'course-1', includeSubmissions: 'true' }),
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data[0].submissionCount).toBe(1);
    expect(body.data[0].pendingCount).toBe(1);
  });

  it('returns empty list when no CLASS events exist', async () => {
    const prisma = makePrisma({
      evaluationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const ctx = makeAdminCtx({
      method: 'GET', path: '/admin/classes', prisma,
      event: makeQsEvent('ADMIN', { courseId: 'course-1' }),
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveLength(0);
  });

  it('EVALUATOR can list classes', async () => {
    const prisma = makePrisma({
      evaluationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const ctx = makeAdminCtx({
      event: makeQsEvent('EVALUATOR', { courseId: 'course-1' }),
      method: 'GET', path: '/admin/classes', prisma,
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/classes — create
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/classes', () => {
  it('creates class definition and returns 201', async () => {
    const prisma = makePrisma({
      course:          { findUnique: vi.fn().mockResolvedValue({ id: 'course-1' }) },
      module:          { findUnique: vi.fn().mockResolvedValue({ id: 'mod-1' }) },
      evaluationEvent: {
        findFirst: vi.fn().mockResolvedValue({ order: 1 }),
        create:    vi.fn().mockResolvedValue(CLASS_EVENT),
      },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes', prisma,
      body: {
        courseId: 'course-1', moduleId: 'mod-1',
        name: 'Clase 1 — Introducción', weight: 10,
        vapiPrompt: 'prompt', lessonScript: 'guión',
      },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(201);
    const body = await bodyOf(res);
    expect(body.data.id).toBe('cls-1');
  });

  it('creates without moduleId (course-wide class)', async () => {
    const created = { ...CLASS_EVENT, moduleId: null };
    const prisma = makePrisma({
      course:          { findUnique: vi.fn().mockResolvedValue({ id: 'course-1' }) },
      evaluationEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create:    vi.fn().mockResolvedValue(created),
      },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes', prisma,
      body: { courseId: 'course-1', name: 'Clase General' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(201);
  });

  it('creates with lessonVideoUrl', async () => {
    const created = { ...CLASS_EVENT, lessonVideoUrl: 'https://s3.example.com/video.mp4' };
    const prisma = makePrisma({
      course:          { findUnique: vi.fn().mockResolvedValue({ id: 'course-1' }) },
      evaluationEvent: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(created) },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes', prisma,
      body: { courseId: 'course-1', name: 'Clase con video', lessonVideoUrl: 'https://s3.example.com/video.mp4' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(201);
    const body = await bodyOf(res);
    expect(body.data.lessonVideoUrl).toBe('https://s3.example.com/video.mp4');
  });

  it('returns 400 when name is missing', async () => {
    const prisma = makePrisma({
      course: { findUnique: vi.fn().mockResolvedValue({ id: 'course-1' }) },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes', prisma,
      body: { courseId: 'course-1' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when courseId is missing', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes',
      body: { name: 'Test' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 404 when course not found', async () => {
    const prisma = makePrisma({
      course: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes', prisma,
      body: { courseId: 'bad-id', name: 'Test' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 404 when moduleId provided but module not found', async () => {
    const prisma = makePrisma({
      course: { findUnique: vi.fn().mockResolvedValue({ id: 'course-1' }) },
      module: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/classes', prisma,
      body: { courseId: 'course-1', moduleId: 'bad-mod', name: 'Test' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('EVALUATOR can create class', async () => {
    const prisma = makePrisma({
      course:          { findUnique: vi.fn().mockResolvedValue({ id: 'course-1' }) },
      evaluationEvent: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(CLASS_EVENT) },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'POST', path: '/admin/classes', prisma,
      body: { courseId: 'course-1', name: 'Nueva clase' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /admin/classes/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /admin/classes/:id', () => {
  it('updates and returns 200', async () => {
    const updated = { ...CLASS_EVENT, name: 'Nuevo nombre', weight: 20 };
    const prisma = makePrisma({
      evaluationEvent: {
        findUnique: vi.fn().mockResolvedValue(CLASS_EVENT),
        update:     vi.fn().mockResolvedValue(updated),
      },
    });
    const ctx = makeAdminCtx({
      method: 'PUT', path: '/admin/classes/cls-1', prisma,
      body: { name: 'Nuevo nombre', weight: 20 },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.name).toBe('Nuevo nombre');
    expect(body.data.weight).toBe(20);
  });

  it('returns 404 when class not found', async () => {
    const ctx = makeAdminCtx({
      method: 'PUT', path: '/admin/classes/bad-id',
      body: { name: 'X' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 400 when trying to update a non-CLASS event', async () => {
    const prisma = makePrisma({
      evaluationEvent: { findUnique: vi.fn().mockResolvedValue({ ...CLASS_EVENT, type: 'INTERVIEW' }) },
    });
    const ctx = makeAdminCtx({
      method: 'PUT', path: '/admin/classes/cls-1', prisma,
      body: { name: 'X' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('can toggle isDraft and isArchived', async () => {
    const updated = { ...CLASS_EVENT, isDraft: true };
    const prisma = makePrisma({
      evaluationEvent: {
        findUnique: vi.fn().mockResolvedValue(CLASS_EVENT),
        update:     vi.fn().mockResolvedValue(updated),
      },
    });
    const ctx = makeAdminCtx({
      method: 'PUT', path: '/admin/classes/cls-1', prisma,
      body: { isDraft: true },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
  });

  it('EVALUATOR can update class', async () => {
    const updated = { ...CLASS_EVENT, name: 'Updated by evaluator' };
    const prisma = makePrisma({
      evaluationEvent: {
        findUnique: vi.fn().mockResolvedValue(CLASS_EVENT),
        update:     vi.fn().mockResolvedValue(updated),
      },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'PUT', path: '/admin/classes/cls-1', prisma,
      body: { name: 'Updated by evaluator' },
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /admin/classes/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /admin/classes/:id', () => {
  it('ADMIN deletes and returns 200', async () => {
    const prisma = makePrisma({
      evaluationEvent: {
        findUnique: vi.fn().mockResolvedValue(CLASS_EVENT),
        delete:     vi.fn().mockResolvedValue(CLASS_EVENT),
      },
    });
    const ctx = makeAdminCtx({
      method: 'DELETE', path: '/admin/classes/cls-1', prisma,
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.deleted).toBe(true);
  });

  it('SUPER_ADMIN deletes and returns 200', async () => {
    const prisma = makePrisma({
      evaluationEvent: {
        findUnique: vi.fn().mockResolvedValue(CLASS_EVENT),
        delete:     vi.fn().mockResolvedValue(CLASS_EVENT),
      },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('SUPER_ADMIN'),
      method: 'DELETE', path: '/admin/classes/cls-1', prisma,
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(200);
  });

  it('EVALUATOR cannot delete — returns 403', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'DELETE', path: '/admin/classes/cls-1',
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 404 when class not found', async () => {
    const ctx = makeAdminCtx({
      method: 'DELETE', path: '/admin/classes/bad-id',
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 400 when trying to delete a non-CLASS event', async () => {
    const prisma = makePrisma({
      evaluationEvent: { findUnique: vi.fn().mockResolvedValue({ ...CLASS_EVENT, type: 'QUIZ' }) },
    });
    const ctx = makeAdminCtx({
      method: 'DELETE', path: '/admin/classes/cls-1', prisma,
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard — all routes
// ─────────────────────────────────────────────────────────────────────────────

describe('auth guard', () => {
  it('returns 403 for STUDENT on any route', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'GET', path: '/admin/classes',
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 403 for missing authorizer', async () => {
    const ctx = makeAdminCtx({
      event: {
        requestContext: { http: { method: 'GET' }, authorizer: { lambda: { role: '' } } },
        queryStringParameters: {}, body: null,
        headers: {},
      } as any,
      method: 'GET', path: '/admin/classes',
    });
    const res = await handleClasses(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unmatched routes
// ─────────────────────────────────────────────────────────────────────────────

describe('unmatched routes', () => {
  it('returns null for /admin/courses', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/courses' });
    const res = await handleClasses(ctx);
    expect(res).toBeNull();
  });

  it('returns null for /admin/interviews', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/interviews' });
    const res = await handleClasses(ctx);
    expect(res).toBeNull();
  });

  it('returns null for unknown POST path', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/other' });
    const res = await handleClasses(ctx);
    expect(res).toBeNull();
  });
});
