/**
 * Tests for admin/courses-content.ts
 * Covers: lesson CRUD, question CRUD, AI generation dispatch+worker for modules/lessons/questions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAdminCtx, makePrisma, makeEvent, bodyOf } from '../helpers/ctx';

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient:  function() { return { send: vi.fn().mockResolvedValue({}) }; },
  InvokeCommand: function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client:            function() { return { send: vi.fn().mockResolvedValue({}) }; },
  DeleteObjectCommand: function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function() { return { send: vi.fn() }; },
  InvokeModelCommand:   function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function() { return { send: vi.fn() }; },
}));
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: function() { return { send: vi.fn() }; },
}));
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: function() { return { send: vi.fn() }; },
}));

vi.mock('../../shared/db-dynamo', () => ({
  saveAiJob:             vi.fn().mockResolvedValue(undefined),
  getAiJob:              vi.fn().mockResolvedValue(null),
  createNotification:    vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/translate', () => ({
  invalidateTranslation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../admin/ctx', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    invokeBedrockForJson: vi.fn().mockResolvedValue([
      { title: 'Lección 1', order: 1, type: 'text', content: '<p>content</p>', duration: '5 min', points: ['p1'], tip: 'tip' },
    ]),
    generateLessonAudio: vi.fn().mockResolvedValue(null),
    shuffleQuestionOptions: vi.fn((arr: any[]) => arr),
    s3KeyFromUrl: vi.fn().mockReturnValue('lessons/key.mp3'),
    s3Client: { send: vi.fn().mockResolvedValue({}) },
    lambdaClient: { send: vi.fn().mockResolvedValue({}) },
    S3_IMAGES_BUCKET: 'lux-learning-images',
  };
});

import { handleCoursesContent } from '../../admin/courses-content';
import { invokeBedrockForJson } from '../../admin/ctx';

// ─────────────────────────────────────────────────────────────────────────────
// Lesson CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/modules/:moduleId/lessons', () => {
  it('creates a lesson and returns 201', async () => {
    const lesson = { id: 'lesson-1', title: 'Intro', order: 1 };
    const prisma = makePrisma({ lesson: { create: vi.fn().mockResolvedValue(lesson) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/modules/mod-1/lessons', prisma,
      body: { title: 'Intro', order: 1, duration: '5 min', type: 'text', youtubeId: '', content: '<p>hi</p>', points: [], tip: '' },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(201);
    const body = await bodyOf(res);
    expect(body.data.id).toBe('lesson-1');
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'POST', path: '/admin/modules/mod-1/lessons',
      body: { title: 'X', duration: '5 min', type: 'text' },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

describe('PUT /admin/lessons/:lessonId', () => {
  it('updates lesson and returns 200', async () => {
    const updated = { id: 'lesson-1', title: 'Updated', order: 1 };
    const prisma = makePrisma({ lesson: { update: vi.fn().mockResolvedValue(updated) } });
    const ctx = makeAdminCtx({
      method: 'PUT', path: '/admin/lessons/lesson-1', prisma,
      body: { title: 'Updated', order: 1, duration: '5 min', type: 'text', youtubeId: '', content: '', points: [], tip: '' },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.title).toBe('Updated');
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'PUT', path: '/admin/lessons/lesson-1',
      body: { title: 'X', duration: '5 min', type: 'text' },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

describe('DELETE /admin/lessons/:lessonId', () => {
  it('deletes lesson and returns 200', async () => {
    const prisma = makePrisma({
      lesson: { findUnique: vi.fn().mockResolvedValue({ id: 'lesson-1', imageUrl: null, audioUrl: null }), delete: vi.fn().mockResolvedValue({}) },
    });
    const ctx = makeAdminCtx({ method: 'DELETE', path: '/admin/lessons/lesson-1', prisma });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.deleted).toBe(true);
  });

  it('proceeds even when lesson has no S3 assets (no imageUrl/audioUrl)', async () => {
    const prisma = makePrisma({
      lesson: { findUnique: vi.fn().mockResolvedValue(null), delete: vi.fn().mockResolvedValue({}) },
    });
    const ctx = makeAdminCtx({ method: 'DELETE', path: '/admin/lessons/no-assets', prisma });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(200);
  });

  it('returns 403 for EVALUATOR (admin only)', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'DELETE', path: '/admin/lessons/lesson-1',
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Question CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/modules/:moduleId/questions', () => {
  it('creates a question and returns 201', async () => {
    const question = { id: 'q-1', text: '¿Qué es X?', options: ['A', 'B'], correctIndex: 0 };
    const prisma = makePrisma({ question: { create: vi.fn().mockResolvedValue(question) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/modules/mod-1/questions', prisma,
      body: { text: '¿Qué es X?', options: ['A', 'B', 'C', 'D'], correctIndex: 0, order: 1 },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(201);
    const body = await bodyOf(res);
    expect(body.data.id).toBe('q-1');
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'POST', path: '/admin/modules/mod-1/questions',
      body: { text: 'Q', options: ['A', 'B'], correctIndex: 0, order: 1 },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

describe('PUT /admin/questions/:questionId', () => {
  it('updates question and returns 200', async () => {
    const updated = { id: 'q-1', text: 'Actualizada?' };
    const prisma = makePrisma({ question: { update: vi.fn().mockResolvedValue(updated) } });
    const ctx = makeAdminCtx({
      method: 'PUT', path: '/admin/questions/q-1', prisma,
      body: { text: 'Actualizada?', options: ['A', 'B', 'C', 'D'], correctIndex: 1, order: 1 },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(200);
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'PUT', path: '/admin/questions/q-1',
      body: { text: 'Q', options: ['A', 'B'], correctIndex: 0, order: 1 },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

describe('DELETE /admin/questions/:questionId', () => {
  it('deletes question and returns 200', async () => {
    const prisma = makePrisma({ question: { delete: vi.fn().mockResolvedValue({}) } });
    const ctx = makeAdminCtx({ method: 'DELETE', path: '/admin/questions/q-1', prisma });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.deleted).toBe(true);
  });

  it('returns 403 for EVALUATOR (admin only)', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'DELETE', path: '/admin/questions/q-1',
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI generation dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/modules/:moduleId/lessons/ai-generate', () => {
  it('dispatches job and returns jobId', async () => {
    const { saveAiJob } = await import('../../shared/db-dynamo');
    vi.mocked(saveAiJob).mockClear();
    const prisma = makePrisma({
      module: { count: vi.fn().mockResolvedValue(1) },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/modules/mod-1/lessons/ai-generate', prisma,
      body: { topic: 'Introducción a Python' },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('jobId');
    expect(saveAiJob).toHaveBeenCalledWith(expect.any(String), { status: 'processing' });
  });

  it('returns 404 when module not found', async () => {
    const prisma = makePrisma({ module: { count: vi.fn().mockResolvedValue(0) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/modules/ghost/lessons/ai-generate', prisma,
      body: { topic: 'Introducción a Python' },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'POST', path: '/admin/modules/mod-1/lessons/ai-generate', body: {},
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

describe('POST /admin/modules/:moduleId/questions/ai-generate', () => {
  it('generates and persists questions, returns created count', async () => {
    vi.mocked(invokeBedrockForJson).mockResolvedValueOnce([
      { text: '¿Qué es X?', options: ['A', 'B', 'C', 'D'], correctIndex: 0 },
      { text: '¿Qué es Y?', options: ['A', 'B', 'C', 'D'], correctIndex: 1 },
    ]);
    const prisma = makePrisma({
      module: {
        findUnique: vi.fn().mockResolvedValue({ title: 'Módulo 1', questions: [] }),
      },
      question: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
        findMany: vi.fn().mockResolvedValue([{ id: 'q-1' }, { id: 'q-2' }]),
      },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/modules/mod-1/questions/ai-generate', prisma,
      body: { content: 'Contenido educativo extenso con más de 20 caracteres para el módulo', count: 2 },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('created');
  });

  it('returns 400 when content is missing', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/modules/mod-1/questions/ai-generate', body: {} });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 404 when module not found', async () => {
    const prisma = makePrisma({ module: { findUnique: vi.fn().mockResolvedValue(null) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/modules/ghost/questions/ai-generate', prisma,
      body: { content: 'Contenido educativo extenso con más de 20 caracteres para el módulo' },
    });
    const res = await handleCoursesContent(ctx);
    expect(res?.statusCode).toBe(404);
  });
});

describe('Non-courses-content routes return null', () => {
  it('GET /admin/users returns null from handleCoursesContent', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/users' });
    const res = await handleCoursesContent(ctx);
    expect(res).toBeNull();
  });

  it('GET /admin/courses returns null from handleCoursesContent', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/courses' });
    const res = await handleCoursesContent(ctx);
    expect(res).toBeNull();
  });
});
