/**
 * Tests for admin/ai.ts domain handler.
 * Focus: routes added/restored during the monolith refactor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAdminCtx, makePrisma, makeEvent, bodyOf } from '../helpers/ctx';

// ── Mock all external I/O so tests run offline ────────────────────────────────

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function() { return { send: vi.fn() }; },
  InvokeModelCommand:   function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient:  function() { return { send: vi.fn().mockResolvedValue({}) }; },
  InvokeCommand: function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client:           function() { return { send: vi.fn().mockResolvedValue({}) }; },
  PutObjectCommand:   function(x: any) { return x; },
  DeleteObjectCommand: function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient:             function() { return { send: vi.fn() }; },
  SynthesizeSpeechCommand: function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function() { return { send: vi.fn() }; },
  AdminGetUserCommand:           function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: function() { return { send: vi.fn() }; },
}));

vi.mock('../../shared/db-dynamo', () => ({
  saveAiJob:                  vi.fn().mockResolvedValue(undefined),
  batchCreateCalendarEvents:  vi.fn().mockResolvedValue(undefined),
  deleteWizardCalendarEvents: vi.fn().mockResolvedValue(undefined),
  createNotification:         vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/db-calendar', () => ({
  batchCreateCalendarEvents:  vi.fn().mockResolvedValue(undefined),
  deleteWizardCalendarEvents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/db-messages', () => ({
  upsertChat:       vi.fn().mockResolvedValue(undefined),
  upsertMembership: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/translate', () => ({
  batchTranslate:        vi.fn().mockResolvedValue(new Map()),
  invalidateTranslation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('jsonrepair', () => ({ jsonrepair: vi.fn((x: string) => x) }));

// Stub heavy helpers from ctx so we don't call real Bedrock/S3
vi.mock('../../admin/ctx', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getCallerName:          vi.fn().mockResolvedValue('Test Admin'),
    generateLessonImage:    vi.fn().mockResolvedValue('https://s3.example.com/img.jpg'),
    generateLessonAudio:    vi.fn().mockResolvedValue(null),
    generateLessonInfographic: vi.fn().mockResolvedValue(null),
    invokeBedrockForJson:   vi.fn().mockResolvedValue({ weeklyPlan: [{ weekNum: 1, topics: ['Topic'] }], modules: [] }),
    lambdaClient:           { send: vi.fn().mockResolvedValue({}) },
    s3Client:               { send: vi.fn().mockResolvedValue({}) },
    bedrock:                { send: vi.fn().mockResolvedValue({ body: Buffer.from(JSON.stringify({ content: [{ text: '[]' }] })) }) },
  };
});

import { handleAI } from '../../admin/ai';

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/courses/wizard/copilot — dispatch async job', () => {
  it('returns 400 when title is missing', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/courses/wizard/copilot', body: { syllabusInput: 'algo' } });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when syllabusInput is missing', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/courses/wizard/copilot', body: { title: 'Curso X' } });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 403 for STUDENT role', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'POST', path: '/admin/courses/wizard/copilot',
      body: { title: 'Curso X', syllabusInput: 'temario...' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(403);
  });

  it('dispatches job and returns jobId for ADMIN', async () => {
    const { saveAiJob } = await import('../../shared/db-dynamo');
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/courses/wizard/copilot',
      body: { title: 'Curso X', syllabusInput: 'Temario extenso...' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('jobId');
    expect(saveAiJob).toHaveBeenCalledWith(expect.any(String), { status: 'processing' });
  });

  it('dispatches job for EVALUATOR role', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'POST', path: '/admin/courses/wizard/copilot',
      body: { title: 'Curso X', syllabusInput: 'Temario extenso...' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);
  });
});

describe('POST /admin/courses/wizard/save', () => {
  it('returns 403 for EVALUATOR (admin only)', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'POST', path: '/admin/courses/wizard/save',
      body: { title: 'Nuevo curso' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'POST', path: '/admin/courses/wizard/save',
      body: { title: 'Nuevo curso' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 400 when title is missing', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/courses/wizard/save', body: {} });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('creates course and returns courseId for ADMIN', async () => {
    const prisma = makePrisma({
      course: {
        create: vi.fn().mockResolvedValue({ id: 'course-123', slug: 'test-abc' }),
        update: vi.fn().mockResolvedValue({ id: 'course-123', slug: 'test-abc' }),
      },
      evaluationEvent: { create: vi.fn().mockResolvedValue({}) },
      courseSession: { createMany: vi.fn().mockResolvedValue({}) },
    });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/courses/wizard/save',
      prisma,
      body: { title: 'Mi Curso', planLanguage: 'ES', evaluationItems: [], suggestedModules: [], weeklyPlan: [] },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(201);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('courseId');
  });

  it('SUPER_ADMIN can also create a course', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('SUPER_ADMIN'),
      method: 'POST', path: '/admin/courses/wizard/save',
      body: { title: 'Mi Curso', evaluationItems: [], suggestedModules: [], weeklyPlan: [] },
    });
    const res = await handleAI(ctx);
    // 400 is fine here (prisma mock returns null for findUnique) — what matters is NOT 403
    expect(res?.statusCode).not.toBe(403);
  });
});

describe('POST /admin/courses/:id/generate-cover', () => {
  it('returns 400 when promptText is missing', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/courses/course-abc/generate-cover', body: {} });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 200 with imageUrl when course exists', async () => {
    const prisma = makePrisma({ course: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', title: 'Curso Test' }) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/courses/c1/generate-cover',
      prisma,
      body: { promptText: 'A professional course cover for leadership' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('imageUrl');
    expect(body.data.preview).toBe(true);
  });

  it('wizard-temp shortcut skips DB lookup', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/courses/wizard-temp/generate-cover',
      body: { promptText: 'Leadership course banner' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'POST', path: '/admin/courses/c1/generate-cover',
      body: { promptText: 'test' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

describe('POST /admin/courses/:id/approve-cover', () => {
  it('returns 400 when imageUrl is missing', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/courses/c1/approve-cover', body: {} });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('updates course imageUrl', async () => {
    const prisma = makePrisma({ course: { update: vi.fn().mockResolvedValue({ id: 'c1', imageUrl: 'https://s3.example.com/img.jpg' }) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/courses/c1/approve-cover',
      prisma,
      body: { imageUrl: 'https://s3.example.com/img.jpg' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.imageUrl).toBe('https://s3.example.com/img.jpg');
  });
});

describe('POST /admin/generate-image', () => {
  it('returns 400 when promptText is missing', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/generate-image', body: {} });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 200 with imageUrl', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/generate-image',
      body: { promptText: 'An educational illustration about communication' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('imageUrl');
  });

  it('returns 403 for STUDENT', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('STUDENT'),
      method: 'POST', path: '/admin/generate-image',
      body: { promptText: 'test' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(403);
  });
});

describe('GET /admin/stock-photos', () => {
  it('returns 400 when q is missing', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/stock-photos', event: makeEvent('ADMIN', 'GET', '/admin/stock-photos', { qs: {} }) });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 500 when UNSPLASH_ACCESS_KEY is not set', async () => {
    const ctx = makeAdminCtx({
      method: 'GET', path: '/admin/stock-photos',
      event: makeEvent('ADMIN', 'GET', '/admin/stock-photos', { qs: { q: 'leadership' } }),
    });
    const res = await handleAI(ctx);
    // No UNSPLASH key in test env → 500 with helpful message
    expect(res?.statusCode).toBe(500);
  });
});

describe('Async workers via ctx.action (wizard-lessons-bulk, wizard-copilot)', () => {
  it('wizard-lessons-bulk returns 200 and saves done job', async () => {
    const { saveAiJob } = await import('../../shared/db-dynamo');
    vi.mocked(saveAiJob).mockClear();

    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod 1', description: 'Desc' }), update: vi.fn().mockResolvedValue({}) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 10 }) },
      question: { createMany: vi.fn().mockResolvedValue({ count: 10 }) },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: { _action: 'wizard-lessons-bulk', _jobId: 'job-123', courseId: 'c1', moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);
    // saveAiJob called with done status
    const doneCalls = vi.mocked(saveAiJob).mock.calls.filter((c) => (c[1] as any)?.status === 'done');
    expect(doneCalls.length).toBeGreaterThan(0);
  });

  it('wizard-copilot returns 200 and saves done job with weeklyPlan', async () => {
    const { saveAiJob } = await import('../../shared/db-dynamo');
    vi.mocked(saveAiJob).mockClear();

    const ctx = makeAdminCtx({
      method: 'WORKER', path: '',
      action: 'wizard-copilot',
      body: {
        _action: 'wizard-copilot', _jobId: 'job-456', title: 'Curso X', courseType: 'TEORICO',
        planLanguage: 'ES', totalWeeks: 8, evaluationItems: [], syllabusInput: 'Temario...',
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);
    const doneCalls = vi.mocked(saveAiJob).mock.calls.filter((c) => (c[1] as any)?.status === 'done');
    expect(doneCalls.length).toBeGreaterThan(0);
  });

  it('wizard-lessons-bulk processes ALL modules even beyond the concurrency batch size (regression: Trello DmPpbrff comment 6a91f73f — sequential loop used to blow past the Lambda timeout and skip trailing modules entirely)', async () => {
    const { saveAiJob } = await import('../../shared/db-dynamo');
    vi.mocked(saveAiJob).mockClear();

    const moduleIds = ['m1', 'm2', 'm3', 'm4', 'm5']; // 5 modules > MODULE_CONCURRENCY (3)
    const createManyMock = vi.fn().mockResolvedValue({ count: 10 });
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }), update: vi.fn().mockResolvedValue({}) },
      lesson: { createMany: createManyMock },
      question: { createMany: vi.fn().mockResolvedValue({ count: 10 }) },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: { _action: 'wizard-lessons-bulk', _jobId: 'job-concurrency', courseId: 'c1', moduleIds, courseTitle: 'Curso', language: 'ES' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    // Every module must have been reached — not just the first batch of 3
    expect(createManyMock).toHaveBeenCalledTimes(moduleIds.length);
    const doneCall = vi.mocked(saveAiJob).mock.calls.find((c) => (c[1] as any)?.status === 'done');
    expect((doneCall?.[1] as any)?.modulesProcessed).toBe(moduleIds.length);
    expect((doneCall?.[1] as any)?.failed).toBe(0);
  });

  it('wizard-lessons-bulk records quiz INTENT via EvaluationEvent even when the module ends up with 0 questions (regression: Trello DmPpbrff comment 6a91f73f — "Preguntas del quiz (0)" section can\'t be hidden without a durable planned-vs-not signal)', async () => {
    const { invokeBedrockForJson } = await import('../../admin/ctx');
    // Simulate quiz question generation returning nothing usable — module ends up with
    // 0 questions, but the quiz WAS planned (moduleIdx 0 is in quizModuleIndices below).
    vi.mocked(invokeBedrockForJson).mockResolvedValue(null);

    const evalEventCreate = vi.fn().mockResolvedValue({ id: 'ee-1' });
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod 1', description: 'Desc' }), update: vi.fn().mockResolvedValue({}) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 10 }) },
      question: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      evaluationEvent: { findFirst: vi.fn().mockResolvedValue(null), create: evalEventCreate },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: {
        _action: 'wizard-lessons-bulk', _jobId: 'job-quiz-intent', courseId: 'c1',
        moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES',
        quizModuleIndices: [0], // module 0 IS planned to have a quiz
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    // The EvaluationEvent(type=QUIZ) row must exist regardless of question-generation outcome
    expect(evalEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ courseId: 'c1', moduleId: 'm1', type: 'QUIZ' }),
    }));
  });

  it('generateAndSaveQuizQuestions retries once when the first Bedrock response is empty/invalid (regression: Trello DmPpbrff comment 6a9232ef — planned quizzes silently ending up with 0 questions)', async () => {
    const { invokeBedrockForJson } = await import('../../admin/ctx');
    const goodQuestions = Array.from({ length: 10 }, (_, i) => ({
      text: `Q${i + 1}?`, options: ['A', 'B', 'C', 'D'], correctIndex: 0, order: i + 1,
    }));
    // First call returns garbage/empty, second (retry) succeeds
    vi.mocked(invokeBedrockForJson)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(goodQuestions);

    const questionCreateMany = vi.fn().mockResolvedValue({ count: 10 });
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }) },
      lesson: { count: vi.fn().mockResolvedValue(5) }, // module already has lessons
      question: { createMany: questionCreateMany },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: {
        _action: 'wizard-lessons-bulk', _jobId: 'job-quiz-retry', courseId: 'c1',
        moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES',
        _quizOnlyForExistingModules: true, quizModuleIndices: [0],
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    // Retry recovered — questions got saved despite the first call failing
    expect(questionCreateMany).toHaveBeenCalledTimes(1);
    expect((questionCreateMany.mock.calls[0]![0] as any).data).toHaveLength(10);
  });

  it('wizard-copilot dedups a module reused across 2 weeks for ASYNC courses (regression: Trello DmPpbrff comment 6a91f241)', async () => {
    const { saveAiJob } = await import('../../shared/db-dynamo');
    const { invokeBedrockForJson } = await import('../../admin/ctx');
    vi.mocked(saveAiJob).mockClear();
    // Simulate Bedrock ignoring the async "1 module per week" rule — same module name in weeks 1 and 2
    vi.mocked(invokeBedrockForJson).mockResolvedValueOnce({
      weeklyPlan: [
        { weekNum: 1, topics: ['Topic A'], module: 'Módulo Repetido' },
        { weekNum: 2, topics: ['Topic B'], module: 'Módulo Repetido' },
      ],
      modules: [{ name: 'Módulo Repetido', nameEN: 'Repeated Module', description: '', descriptionEN: '', weeks: [1, 2] }],
    });

    const ctx = makeAdminCtx({
      method: 'WORKER', path: '',
      action: 'wizard-copilot',
      body: {
        _action: 'wizard-copilot', _jobId: 'job-789', title: 'Curso Async', courseType: 'TEORICO',
        modality: 'ASINCRONICO', planLanguage: 'ES', totalWeeks: 2, evaluationItems: [], syllabusInput: 'Temario...',
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    const doneCall = vi.mocked(saveAiJob).mock.calls.find((c) => (c[1] as any)?.status === 'done');
    const weeklyPlan = (doneCall?.[1] as any)?.weeklyPlan;
    // Week 2 must have been renamed to a unique module — never sharing the same name as week 1
    expect(weeklyPlan[0].module).toBe('Módulo Repetido');
    expect(weeklyPlan[1].module).not.toBe('Módulo Repetido');
    expect(weeklyPlan[1].module).toContain('Parte 2');
  });
});

describe('Non-AI routes return null (pass to next domain)', () => {
  it('GET /admin/users returns null from handleAI', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/users' });
    const res = await handleAI(ctx);
    expect(res).toBeNull();
  });

  it('GET /admin/groups returns null from handleAI', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/groups' });
    const res = await handleAI(ctx);
    expect(res).toBeNull();
  });
});
