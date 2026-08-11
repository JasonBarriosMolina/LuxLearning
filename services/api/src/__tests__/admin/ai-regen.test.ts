/**
 * Tests for admin/ai-regen.ts
 * Covers: lesson audio, lesson/module/course regeneration, async regen worker.
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
  saveAiJob:          vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/translate', () => ({
  invalidateTranslation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../admin/ctx', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    invokeBedrockForJson: vi.fn().mockResolvedValue({
      modules: [{ order: 1, title: 'Módulo regenerado', description: 'Desc' }],
    }),
    generateLessonAudio:      vi.fn().mockResolvedValue('https://s3.example.com/audio.mp3'),
    generateLessonImage:      vi.fn().mockResolvedValue('https://s3.example.com/img.jpg'),
    generateLessonInfographic: vi.fn().mockResolvedValue('https://s3.example.com/infographic.jpg'),
    shuffleQuestionOptions:   vi.fn((arr: any[]) => arr),
    s3KeyFromUrl:             vi.fn().mockReturnValue('lessons/audio.mp3'),
    s3Client:                 { send: vi.fn().mockResolvedValue({}) },
    lambdaClient:             { send: vi.fn().mockResolvedValue({}) },
    S3_IMAGES_BUCKET:         'lux-learning-images',
  };
});

import { handleAIRegen } from '../../admin/ai-regen';
import { invokeBedrockForJson } from '../../admin/ctx';

// ─────────────────────────────────────────────────────────────────────────────
// Lesson audio
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/lessons/:lessonId/audio', () => {
  it('returns 200 and audioUrl when lesson exists', async () => {
    const lesson = { id: 'l1', title: 'Intro', content: 'Content', points: ['p1'], tip: 'tip', audioUrl: null, order: 1 };
    const prisma = makePrisma({
      lesson: { findUnique: vi.fn().mockResolvedValue(lesson), update: vi.fn().mockResolvedValue({ ...lesson, audioUrl: 'https://s3.example.com/audio.mp3' }) },
    });
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/lessons/l1/audio', prisma, body: { voiceId: 'Mia' } });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.audioUrl).toBe('https://s3.example.com/audio.mp3');
  });

  it('returns 404 when lesson not found', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/lessons/ghost/audio', body: { voiceId: 'Mia' } });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 400 for invalid voice', async () => {
    const lesson = { id: 'l1', title: 'Intro', content: '', points: [], tip: '', audioUrl: null, order: 1 };
    const prisma = makePrisma({ lesson: { findUnique: vi.fn().mockResolvedValue(lesson) } });
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/lessons/l1/audio', prisma, body: { voiceId: 'InvalidVoice' } });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({ event: makeEvent('STUDENT'), method: 'POST', path: '/admin/lessons/l1/audio', body: {} });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lesson regeneration
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/lessons/:lessonId/regenerate', () => {
  const lesson = { id: 'l1', title: 'Intro', content: '<p>x</p>', points: ['p1'], tip: 'tip', order: 1, module: { title: 'Módulo 1', course: { title: 'Curso A' } } };

  it('returns 404 when lesson not found', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/lessons/ghost/regenerate', body: { type: 'text' } });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 200 with preview data in preview mode', async () => {
    const prisma = makePrisma({ lesson: { findUnique: vi.fn().mockResolvedValue(lesson) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/lessons/l1/regenerate', prisma,
      body: { type: 'text', level: 'intermediate', preview: true },
    });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.preview).toBe(true);
  });

  it('applies previewData and updates DB when not in preview mode', async () => {
    const updateFn = vi.fn().mockResolvedValue({ id: 'l1', title: 'Nuevo título' });
    const prisma = makePrisma({ lesson: { findUnique: vi.fn().mockResolvedValue(lesson), update: updateFn } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/lessons/l1/regenerate', prisma,
      body: { type: 'text', preview: false, previewData: { title: 'Nuevo título', content: '<p>new</p>', points: ['np'], tip: 'nt' } },
    });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
    expect(updateFn).toHaveBeenCalled();
  });

  it('returns 200 with imageUrl preview for type=image', async () => {
    const prisma = makePrisma({ lesson: { findUnique: vi.fn().mockResolvedValue(lesson) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/lessons/l1/regenerate', prisma,
      body: { type: 'image', preview: true },
    });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('imageUrl');
  });

  it('returns 200 with imageUrl preview for type=infographic', async () => {
    const prisma = makePrisma({ lesson: { findUnique: vi.fn().mockResolvedValue(lesson) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/lessons/l1/regenerate', prisma,
      body: { type: 'infographic', preview: true },
    });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('imageUrl');
    expect(body.data.preview).toBe(true);
  });

  it('applies infographic previewData imageUrl to DB when not in preview mode', async () => {
    const updateFn = vi.fn().mockResolvedValue({ id: 'l1', imageUrl: 'https://s3.example.com/infographic.jpg' });
    const prisma = makePrisma({ lesson: { findUnique: vi.fn().mockResolvedValue(lesson), update: updateFn } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/lessons/l1/regenerate', prisma,
      body: { type: 'infographic', preview: false, previewData: { imageUrl: 'https://s3.example.com/infographic.jpg' } },
    });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageUrl: 'https://s3.example.com/infographic.jpg' }),
    }));
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({ event: makeEvent('STUDENT'), method: 'POST', path: '/admin/lessons/l1/regenerate', body: {} });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Module regeneration dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/modules/:moduleId/regenerate', () => {
  it('dispatches async job and returns jobId', async () => {
    const { saveAiJob } = await import('../../shared/db-dynamo');
    vi.mocked(saveAiJob).mockClear();
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Módulo 1', description: 'Desc', course: { title: 'Curso A' } }) },
      lesson: { count: vi.fn().mockResolvedValue(8) },
    });
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/modules/mod-1/regenerate', prisma, body: {} });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('jobId');
    expect(saveAiJob).toHaveBeenCalledWith(expect.any(String), { status: 'processing' });
  });

  it('returns 404 when module not found', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/modules/ghost/regenerate', body: {} });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({ event: makeEvent('STUDENT'), method: 'POST', path: '/admin/modules/mod-1/regenerate', body: {} });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Module regen worker
// ─────────────────────────────────────────────────────────────────────────────

describe('/admin/modules/_regen_worker async worker', () => {
  beforeEach(() => {
    vi.mocked(invokeBedrockForJson)
      .mockResolvedValueOnce([
        { title: 'Lec 1', order: 1, type: 'video', content: null, duration: '5 min', points: ['p1'], tip: 'tip' },
        { title: 'Lec 2', order: 2, type: 'text', content: '<p>x</p>', duration: '8 min', points: ['p2'], tip: 'tip2' },
      ])
      .mockResolvedValueOnce([
        { text: '¿Qué es X?', options: ['A', 'B', 'C', 'D'], correctIndex: 0, order: 1 },
      ]);
  });

  it('generates quiz questions when course has QUIZ eval event', async () => {
    const { saveAiJob } = await import('../../shared/db-dynamo');
    vi.mocked(saveAiJob).mockClear();
    const questionCreate = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ courseId: 'course-1' }) },
      evaluationEvent: { count: vi.fn().mockResolvedValue(1) }, // course HAS a QUIZ event
      lesson: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      question: { deleteMany: vi.fn().mockResolvedValue({}), createMany: questionCreate },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/modules/_regen_worker', prisma,
      body: { _jobId: 'job-1', _moduleId: 'mod-1', _moduleTitle: 'Módulo 1', _moduleDesc: '', _courseTitle: 'Curso A', _lessonCount: 2 },
    });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
    // Quiz was generated because course has QUIZ eval event
    expect(questionCreate).toHaveBeenCalled();
    const doneCalls = vi.mocked(saveAiJob).mock.calls.filter((c) => (c[1] as any)?.status === 'done');
    expect(doneCalls.length).toBeGreaterThan(0);
  });

  it('skips quiz generation when course has NO QUIZ eval event', async () => {
    vi.mocked(invokeBedrockForJson).mockReset();
    vi.mocked(invokeBedrockForJson).mockResolvedValueOnce([
      { title: 'Lec 1', order: 1, type: 'video', content: null, duration: '5 min', points: ['p1'], tip: 'tip' },
      { title: 'Lec 2', order: 2, type: 'text', content: '<p>x</p>', duration: '8 min', points: ['p2'], tip: 'tip2' },
    ]);
    const questionCreate = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ courseId: 'course-no-quiz' }) },
      evaluationEvent: { count: vi.fn().mockResolvedValue(0) }, // course has NO QUIZ event
      lesson: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      question: { deleteMany: vi.fn().mockResolvedValue({}), createMany: questionCreate },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/modules/_regen_worker', prisma,
      body: { _jobId: 'job-2', _moduleId: 'mod-2', _moduleTitle: 'Módulo 2', _moduleDesc: '', _courseTitle: 'Curso B', _lessonCount: 2 },
    });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
    // Quiz was NOT generated because no QUIZ eval event
    expect(questionCreate).not.toHaveBeenCalled();
  });

  it('saves error job when _jobId or _moduleId is missing', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/modules/_regen_worker',
      body: { _jobId: '', _moduleId: '' },
    });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Course regeneration
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/courses/:courseId/regenerate', () => {
  it('returns 200 with proposed module structure', async () => {
    const prisma = makePrisma({
      course: { findUnique: vi.fn().mockResolvedValue({ title: 'Liderazgo', description: 'Desarrolla habilidades de liderazgo' }) },
    });
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/courses/course-1/regenerate', prisma, body: {} });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('modules');
  });

  it('returns 404 when course not found', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/courses/ghost/regenerate', body: {} });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({ event: makeEvent('STUDENT'), method: 'POST', path: '/admin/courses/c1/regenerate', body: {} });
    const res = await handleAIRegen(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

describe('Non-regen routes return null', () => {
  it('GET /admin/courses returns null from handleAIRegen', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/courses' });
    const res = await handleAIRegen(ctx);
    expect(res).toBeNull();
  });

  it('POST /admin/courses/wizard/copilot returns null from handleAIRegen', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/courses/wizard/copilot', body: {} });
    const res = await handleAIRegen(ctx);
    expect(res).toBeNull();
  });
});
