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
  getPushSubscriptionsByUserId: vi.fn().mockResolvedValue([]),
}));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue(undefined) },
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
    generateLessonAudio:    vi.fn().mockResolvedValue(null),
    generateCarouselNarration: vi.fn().mockResolvedValue(null),
    invokeBedrockForJson:   vi.fn().mockResolvedValue({ weeklyPlan: [{ weekNum: 1, topics: ['Topic'] }], modules: [] }),
    lambdaClient:           { send: vi.fn().mockResolvedValue({}) },
    s3Client:               { send: vi.fn().mockResolvedValue({}) },
    bedrock:                { send: vi.fn().mockResolvedValue({ body: Buffer.from(JSON.stringify({ content: [{ text: '[]' }] })) }) },
  };
});
vi.mock('../../admin/ai-image-helpers', () => ({
  generateLessonImage:       vi.fn().mockResolvedValue('https://s3.example.com/img.jpg'),
  generateLessonInfographic: vi.fn().mockResolvedValue(null),
}));
// Auto-carousel phase (item 3) — stub the script draft + asset pipeline so its
// unit tests exercise only the phase-wiring in ai-wizard-worker.ts, not the real
// Bedrock/Polly/Stability chain (already covered by carousel.test.ts / carousel-worker.test.ts).
vi.mock('../../admin/carousel', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, draftCarouselScript: vi.fn().mockResolvedValue(null) };
});
vi.mock('../../admin/carousel-worker', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, generateCarouselAssets: vi.fn().mockResolvedValue(null) };
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

    // 8 fake lessons with real (non-placeholder) content — the completeness sweep added
    // after Jason's 2026-08-30 report re-reads lessons from the DB via findMany() to
    // verify the module is actually complete; the mock has no real persistence, so without
    // this the sweep would see "0 lessons" every time and loop through all 3 repair sweeps.
    const fakeLessons = Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, title: `L${i + 1}`, content: '<p>Real content, no placeholder here.</p>', points: [], tip: '' }));
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod 1', description: 'Desc' }), update: vi.fn().mockResolvedValue({}) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 10 }), findMany: vi.fn().mockResolvedValue(fakeLessons) },
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
    // See comment in the previous test — the completeness sweep re-reads lessons from the
    // DB, so the mock needs to look "already complete" or every module gets reprocessed
    // through all 3 repair sweeps too.
    const fakeLessons = Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, title: `L${i + 1}`, content: '<p>Real content, no placeholder here.</p>', points: [], tip: '' }));
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }), update: vi.fn().mockResolvedValue({}) },
      lesson: { createMany: createManyMock, findMany: vi.fn().mockResolvedValue(fakeLessons) },
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

  it('wizard-lessons-bulk skips a module that already has lessons instead of colliding on the (moduleId, order) unique constraint (regression: Trello DmPpbrff, 2026-08-31 17:30 — root cause of "lecciones vacías": the whole job was dispatched twice for the same course, and the second run\'s createMany threw P2002 on every module)', async () => {
    const createManyMock = vi.fn().mockResolvedValue({ count: 8 });
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }) },
      // Module already has 8 lessons from a prior run — the guard must skip, not retry.
      lesson: { createMany: createManyMock, count: vi.fn().mockResolvedValue(8), findMany: vi.fn().mockResolvedValue(
        Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, content: '<p>Real content.</p>', points: [], tip: '' })),
      ) },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: { _action: 'wizard-lessons-bulk', _jobId: 'job-idempotent', courseId: 'c1', moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    expect(createManyMock).not.toHaveBeenCalled();
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

  it('completeness sweep repairs a module whose lessons were ALL placeholders after the main pass AND its in-generation retry (regression: Jason 2026-08-30 — "sí o sí" completeness guarantee)', async () => {
    const { invokeBedrockForJson } = await import('../../admin/ctx');
    // 1st call = lessonPrompt (main pass) -> total failure. 2nd = resourcesPrompt -> null.
    // 3rd = the in-generation retry (2026-09-01 fix: a TOTAL failure now retries just
    // like a partial one) -> also fails, so placeholders really do reach the DB.
    // 4th = the sweep's targeted repair prompt -> succeeds this time.
    vi.mocked(invokeBedrockForJson)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(Array.from({ length: 8 }, (_, i) => ({
        title: `Repaired ${i + 1}`, content: `<h3>Fixed</h3><p>Real content ${i + 1}.</p>`, points: [], tip: '', duration: '9 min',
      })));

    const placeholderLessons = Array.from({ length: 8 }, (_, i) => ({
      id: `l${i + 1}`, order: i + 1, title: `Lección ${i + 1}`,
      content: '<p><strong>⚠ Generación incompleta.</strong> ...</p>', points: [], tip: '',
    }));
    const repairedLessons = Array.from({ length: 8 }, (_, i) => ({
      id: `l${i + 1}`, order: i + 1, title: `Repaired ${i + 1}`,
      content: `<h3>Fixed</h3><p>Real content ${i + 1}.</p>`, points: [], tip: '',
    }));
    const lessonUpdateMock = vi.fn().mockResolvedValue({});
    const findManyMock = vi.fn()
      .mockResolvedValueOnce(placeholderLessons) // verifyAndRepairModule's initial read
      .mockResolvedValueOnce(repairedLessons);   // its post-repair re-check
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 8 }), findMany: findManyMock, update: lessonUpdateMock },
    });
    const { saveAiJob } = await import('../../shared/db-dynamo');
    vi.mocked(saveAiJob).mockClear();

    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: { _action: 'wizard-lessons-bulk', _jobId: 'job-repair', courseId: 'c1', moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    // All 8 placeholder lessons got a targeted update — not a blind re-createMany
    expect(lessonUpdateMock).toHaveBeenCalledTimes(8);
    const doneCall = vi.mocked(saveAiJob).mock.calls.find((c) => (c[1] as any)?.status === 'done');
    expect(doneCall).toBeDefined();
    expect((doneCall?.[1] as any)?.incompleteModuleIds).toEqual([]);
  });

  it('a TOTAL lesson-generation failure retries immediately during the main pass, never reaching the DB as placeholders — root cause fix (Jason, 2026-09-01: "sigues generando lecciones vacías... necesito que eso sea definitivamente arreglado hoy mismo")', async () => {
    const { invokeBedrockForJson } = await import('../../admin/ctx');
    // Root cause: invokeBedrockForJson silently resolves to a non-array (here: null,
    // but in production it was `{}` from ctx.ts's own silent-parse-failure fallback)
    // when Bedrock returns nothing usable — NOT a thrown error. The retry-for-missing
    // block used to only fire for a PARTIAL failure (`validLessons` truthy array);
    // a TOTAL failure (`validLessons` was `null`, which is falsy) skipped retry
    // entirely and went straight to placeholder content for every lesson.
    vi.mocked(invokeBedrockForJson)
      .mockResolvedValueOnce(null)  // lessonPrompt — total failure
      .mockResolvedValueOnce(null) // resourcesPrompt
      .mockResolvedValueOnce(Array.from({ length: 8 }, (_, i) => ({    // in-generation retry — succeeds
        title: `Lesson ${i + 1}`, content: `<h3>Real</h3><p>Genuine content ${i + 1}.</p>`, points: [], tip: '', type: i === 0 || i === 7 ? 'video' : 'text',
      })));

    const lessonCreateMany = vi.fn().mockResolvedValue({ count: 8 });
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }), update: vi.fn().mockResolvedValue({}) },
      lesson: {
        createMany: lessonCreateMany,
        findMany: vi.fn().mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, content: `<p>Genuine content ${i + 1}.</p>`, points: [], tip: '' }))),
      },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: { _action: 'wizard-lessons-bulk', _jobId: 'job-total-retry', courseId: 'c1', moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    // createMany was called ONCE, already with the retry's real content — not
    // placeholders that a later repair pass has to fix.
    expect(lessonCreateMany).toHaveBeenCalledTimes(1);
    const inserted = (lessonCreateMany.mock.calls[0]![0] as any).data;
    expect(inserted).toHaveLength(8);
    inserted.forEach((l: any, i: number) => {
      expect(l.content).toContain(`Genuine content ${i + 1}`);
      expect(l.content).not.toContain('Generación incompleta');
    });
  });

  it('completeness sweep reports done_incomplete + which modules after exhausting all repair attempts (regression: Jason 2026-08-30)', async () => {
    const { invokeBedrockForJson } = await import('../../admin/ctx');
    // Every attempt — main pass AND every sweep's repair prompt — keeps failing.
    vi.mocked(invokeBedrockForJson).mockResolvedValue(null);

    const placeholderLessons = Array.from({ length: 8 }, (_, i) => ({
      id: `l${i + 1}`, order: i + 1, title: `Lección ${i + 1}`,
      content: '<p><strong>⚠ Generación incompleta.</strong> ...</p>', points: [], tip: '',
    }));
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 8 }), findMany: vi.fn().mockResolvedValue(placeholderLessons), update: vi.fn().mockResolvedValue({}) },
    });
    const { saveAiJob } = await import('../../shared/db-dynamo');
    vi.mocked(saveAiJob).mockClear();

    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: { _action: 'wizard-lessons-bulk', _jobId: 'job-give-up', courseId: 'c1', moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    const finalCall = vi.mocked(saveAiJob).mock.calls.find((c) => (c[1] as any)?.status === 'done_incomplete');
    expect(finalCall).toBeDefined();
    expect((finalCall?.[1] as any)?.incompleteModuleIds).toEqual(['m1']);
  });

  it('notifies the course creator in-app once the job reaches its final status, only when creatorUserId was provided (regression: Jason 2026-08-30 — no completion signal existed at all)', async () => {
    const { saveAiJob, createNotification } = await import('../../shared/db-dynamo');
    vi.mocked(saveAiJob).mockClear();
    vi.mocked(createNotification).mockClear();

    const fakeLessons = Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, title: `L${i + 1}`, content: '<p>Real content, no placeholder here.</p>', points: [], tip: '' }));
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod 1', description: 'Desc' }) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 8 }), findMany: vi.fn().mockResolvedValue(fakeLessons) },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: {
        _action: 'wizard-lessons-bulk', _jobId: 'job-notify', courseId: 'c1', moduleIds: ['m1'],
        courseTitle: 'Curso Notif', language: 'ES', creatorUserId: 'evaluator-1',
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'evaluator-1',
      message: expect.stringContaining('Curso Notif'),
    }));
  });

  it('does NOT try to notify when creatorUserId is absent (legacy callers / no auth context on the async worker)', async () => {
    const { createNotification } = await import('../../shared/db-dynamo');
    vi.mocked(createNotification).mockClear();

    const fakeLessons = Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, title: `L${i + 1}`, content: '<p>Real content.</p>', points: [], tip: '' }));
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod 1', description: 'Desc' }) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 8 }), findMany: vi.fn().mockResolvedValue(fakeLessons) },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: { _action: 'wizard-lessons-bulk', _jobId: 'job-no-notify', courseId: 'c1', moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('clears activeGenerationJobId on the Course once the job reaches a final status (2026-08-31 status-visibility fix)', async () => {
    const fakeLessons = Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, title: `L${i + 1}`, content: '<p>Real content.</p>', points: [], tip: '' }));
    const courseUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod 1', description: 'Desc' }) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 8 }), findMany: vi.fn().mockResolvedValue(fakeLessons) },
      course: { updateMany: courseUpdateManyMock },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: { _action: 'wizard-lessons-bulk', _jobId: 'job-clear-flag', courseId: 'c1', moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES' },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);
    expect(courseUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'c1', activeGenerationJobId: 'job-clear-flag' },
      data: { activeGenerationJobId: null },
    });
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

  it('wizard-lessons-bulk records REFLECTION and INTERVIEW intent via EvaluationEvent when planned (regression: Trello DmPpbrff comment 6a9269e2 — reflection/interview appearing on modules never selected in Lux Planner)', async () => {
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
        _action: 'wizard-lessons-bulk', _jobId: 'job-reflex-interview', courseId: 'c1',
        moduleIds: ['m1', 'm2'], courseTitle: 'Curso', language: 'ES',
        reflexModuleIndices: [0], // only m1 gets reflection
        interviewModuleIndices: [1], // only m2 gets interview
        quizModuleIndices: [], classModuleIndices: [],
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    expect(evalEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ courseId: 'c1', moduleId: 'm1', type: 'REFLECTION' }),
    }));
    expect(evalEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ courseId: 'c1', moduleId: 'm2', type: 'INTERVIEW' }),
    }));
    // m1 must NOT get an INTERVIEW event, m2 must NOT get a REFLECTION event
    expect(evalEventCreate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ moduleId: 'm1', type: 'INTERVIEW' }),
    }));
    expect(evalEventCreate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ moduleId: 'm2', type: 'REFLECTION' }),
    }));
  });

  it('wizard-lessons-bulk runs phases across ALL modules in order: lessons → carousel → class → quiz → reflections → interviews (Trello DmPpbrff, 2026-08-31 17:30 — Mack\'s latest/authoritative word on ordering, superseding two earlier same-day versions)', async () => {
    const { invokeBedrockForJson } = await import('../../admin/ctx');
    const { draftCarouselScript } = await import('../../admin/carousel');
    const { generateCarouselAssets } = await import('../../admin/carousel-worker');
    const callOrder: string[] = [];

    vi.mocked(invokeBedrockForJson).mockImplementation(async (prompt: string) => {
      if (prompt.includes('multiple-choice questions') || prompt.includes('opción múltiple')) {
        return Array.from({ length: 10 }, (_, i) => ({ text: `Q${i + 1}?`, options: ['A', 'B', 'C', 'D'], correctIndex: 0, order: i + 1 }));
      }
      if (prompt.includes('Lux Mentor class for module') || prompt.includes('Clase Magistral Lux Mentor')) {
        return { vapiPrompt: 'Prompt', lessonScript: 'Script', closingScript: 'Closing' };
      }
      // lessonPrompt / resourcesPrompt / retryPrompt — shape doesn't matter for ordering
      return null;
    });
    vi.mocked(draftCarouselScript).mockImplementation(async () => {
      callOrder.push('carousel');
      return { slides: [{ order: 1, onScreenText: { title: 'T', bullets: [] }, narrationSegment: 'Seg.', imagePrompt: 'p' }], topic: 'Mod' };
    });
    vi.mocked(generateCarouselAssets).mockResolvedValue({ lessonId: 'carousel-1' });

    const evalEventCreate = vi.fn().mockImplementation(async ({ data }: any) => {
      callOrder.push(data.type.toLowerCase());
      return { id: `ee-${data.type}-${data.moduleId}` };
    });
    let lessonsCreated = false;
    const lessonCreateMany = vi.fn().mockImplementation(async () => { callOrder.push('lessons'); lessonsCreated = true; return { count: 8 }; });
    const questionCreateMany = vi.fn().mockImplementation(async () => { callOrder.push('quiz-questions'); return { count: 10 }; });
    const fakeLessons = Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, title: `L${i + 1}`, content: '<p>Real content, no placeholder here.</p>', points: [], tip: '' }));

    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }), update: vi.fn().mockResolvedValue({}) },
      lesson: {
        createMany: lessonCreateMany,
        findMany: vi.fn().mockResolvedValue(fakeLessons),
        // 0 for the carousel-existence check; the plain count is 0 until lessons are
        // actually created (the new idempotency guard in generateModuleLessons reads
        // this — must be 0 first so the lessons phase actually runs), then 8 after.
        count: vi.fn().mockImplementation(async ({ where }: any) => (where?.type === 'carousel' ? 0 : (lessonsCreated ? 8 : 0))),
      },
      question: { createMany: questionCreateMany },
      evaluationEvent: { findFirst: vi.fn().mockResolvedValue(null), create: evalEventCreate },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: {
        _action: 'wizard-lessons-bulk', _jobId: 'job-phases', courseId: 'c1',
        moduleIds: ['m1', 'm2'], courseTitle: 'Curso', language: 'ES',
        quizModuleIndices: [0, 1], classModuleIndices: [0, 1],
        reflexModuleIndices: [0, 1], interviewModuleIndices: [0, 1],
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    const firstIndexOf = (label: string) => callOrder.indexOf(label);
    expect(firstIndexOf('lessons')).toBeGreaterThanOrEqual(0);
    expect(firstIndexOf('lessons')).toBeLessThan(firstIndexOf('carousel'));
    expect(firstIndexOf('carousel')).toBeLessThan(firstIndexOf('class'));
    expect(firstIndexOf('class')).toBeLessThan(firstIndexOf('quiz'));
    expect(firstIndexOf('quiz')).toBeLessThan(firstIndexOf('reflection'));
    expect(firstIndexOf('reflection')).toBeLessThan(firstIndexOf('interview'));
    // Both modules' lessons finish before either module's quiz starts — not
    // module-by-module (the old per-module loop's behavior).
    const lastLessonsIdx = callOrder.lastIndexOf('lessons');
    const firstQuizIdx = firstIndexOf('quiz-questions');
    expect(lastLessonsIdx).toBeLessThan(firstQuizIdx);
  });

  it('wizard-lessons-bulk reports the current phase via saveAiJob so the UI can show which step is running', async () => {
    const { saveAiJob } = await import('../../shared/db-dynamo');
    vi.mocked(saveAiJob).mockClear();
    const fakeLessons = Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, title: `L${i + 1}`, content: '<p>Real content, no placeholder here.</p>', points: [], tip: '' }));
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }), update: vi.fn().mockResolvedValue({}) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 8 }), findMany: vi.fn().mockResolvedValue(fakeLessons) },
      question: { createMany: vi.fn().mockResolvedValue({ count: 10 }) },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: {
        _action: 'wizard-lessons-bulk', _jobId: 'job-phase-status', courseId: 'c1',
        moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES', quizModuleIndices: [0],
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    const phases = vi.mocked(saveAiJob).mock.calls.map((c) => (c[1] as any)?.phase).filter(Boolean);
    expect(phases).toContain('lessons');
    expect(phases).toContain('quiz');
  });

  it('wizard-lessons-bulk generates Polly narration (male voice, WITH speech marks for live captions) + a closing recap for the class, and drops the old "deliver monologue" Vapi prompt (Trello DmPpbrff, 2026-08-31 restructure / 2026-09-01 caption redesign)', async () => {
    const { invokeBedrockForJson, generateLessonAudio, generateCarouselNarration } = await import('../../admin/ctx');
    vi.mocked(invokeBedrockForJson).mockImplementation(async (prompt: string) => {
      if (prompt.includes('Clase Magistral Lux Mentor')) {
        return { vapiPrompt: 'Preguntas guía sobre el módulo.', lessonScript: 'Puntos clave del módulo.', closingScript: 'Hoy vimos varios temas. ¡Felicidades por completar la clase!' };
      }
      return null;
    });
    vi.mocked(generateLessonAudio).mockImplementation(async (_id: string, _text: string, voiceId?: string) =>
      voiceId === 'Pedro' ? 'https://s3.example.com/male-closing.mp3' : null
    );
    vi.mocked(generateCarouselNarration).mockImplementation(async (_id: string, _text: string, voiceId?: string) =>
      voiceId === 'Pedro'
        ? { audioUrl: 'https://s3.example.com/male-lesson.mp3', marks: [{ time: 0, value: 'Puntos clave del módulo.' }] }
        : null
    );

    const evalEventCreate = vi.fn().mockResolvedValue({ id: 'ee-class' });
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod 1', description: 'Desc' }), update: vi.fn().mockResolvedValue({}) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 8 }) },
      evaluationEvent: { findFirst: vi.fn().mockResolvedValue(null), create: evalEventCreate },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: {
        _action: 'wizard-lessons-bulk', _jobId: 'job-class-restructure', courseId: 'c1',
        moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES',
        classModuleIndices: [0], quizModuleIndices: [], reflexModuleIndices: [], interviewModuleIndices: [],
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    expect(evalEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'CLASS',
        vapiPrompt: 'Preguntas guía sobre el módulo.',
        lessonScript: 'Puntos clave del módulo.',
        lessonAudioUrl: 'https://s3.example.com/male-lesson.mp3',
        lessonSpeechMarks: [{ time: 0, value: 'Puntos clave del módulo.' }],
        closingScript: 'Hoy vimos varios temas. ¡Felicidades por completar la clase!',
        closingAudioUrl: 'https://s3.example.com/male-closing.mp3',
      }),
    }));
    // Both narration calls used the male voice, not the default female one
    expect(generateCarouselNarration).toHaveBeenCalledWith(expect.stringContaining('class-'), expect.any(String), 'Pedro');
    expect(generateLessonAudio).toHaveBeenCalledWith(expect.stringContaining('class-'), expect.any(String), 'Pedro');
  });

  it('wizard-lessons-bulk also notifies the course evaluator (distinct from the creator) that it is ready for review (Trello DmPpbrff item 8)', async () => {
    const { createNotification } = await import('../../shared/db-dynamo');
    vi.mocked(createNotification).mockClear();
    const fakeLessons = Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, title: `L${i + 1}`, content: '<p>Real content.</p>', points: [], tip: '' }));
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }), update: vi.fn().mockResolvedValue({}) },
      lesson: { createMany: vi.fn().mockResolvedValue({ count: 8 }), findMany: vi.fn().mockResolvedValue(fakeLessons) },
      course: { findUnique: vi.fn().mockResolvedValue({ evaluatorId: 'evaluator-99' }) },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: {
        _action: 'wizard-lessons-bulk', _jobId: 'job-eval-notify', courseId: 'c1', moduleIds: ['m1'],
        courseTitle: 'Curso Eval', language: 'ES', creatorUserId: 'admin-1',
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin-1' }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'evaluator-99', type: 'COURSE_READY_FOR_REVIEW',
    }));
  });

  it('wizard-lessons-bulk auto-generates a Lux Carrousel for EVERY module — no opt-in indices required — inserted as the penultimate lesson, running right after lessons and before quiz/reflection/class (Trello DmPpbrff, 2026-08-31 17:30)', async () => {
    const { draftCarouselScript } = await import('../../admin/carousel');
    const { generateCarouselAssets } = await import('../../admin/carousel-worker');
    const { invokeBedrockForJson } = await import('../../admin/ctx');
    vi.mocked(draftCarouselScript).mockClear();
    vi.mocked(generateCarouselAssets).mockClear();
    vi.mocked(draftCarouselScript).mockResolvedValue({ slides: [{ order: 1, onScreenText: { title: 'T', bullets: [] }, narrationSegment: 'Seg.', imagePrompt: 'p' }], topic: 'Mod' });
    let carouselCreated = false;
    vi.mocked(generateCarouselAssets).mockImplementation(async () => { carouselCreated = true; return { lessonId: 'carousel-lesson-1', durationMin: 2 }; });
    vi.mocked(invokeBedrockForJson).mockImplementation(async (prompt: string) => {
      if (prompt.includes('multiple-choice questions') || prompt.includes('opción múltiple')) {
        return Array.from({ length: 10 }, (_, i) => ({ text: `Q${i + 1}?`, options: ['A', 'B', 'C', 'D'], correctIndex: 0, order: i + 1 }));
      }
      return null;
    });

    const callOrder: string[] = [];
    let lessonsCreated = false;
    const evalEventCreate = vi.fn().mockImplementation(async ({ data }: any) => { callOrder.push(data.type.toLowerCase()); return { id: `ee-${data.type}` }; });
    const questionCreateMany = vi.fn().mockImplementation(async () => { callOrder.push('quiz-questions'); return { count: 10 }; });
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc', duration: '60 min' }), update: vi.fn().mockResolvedValue({}) },
      lesson: {
        createMany: vi.fn().mockImplementation(async () => { callOrder.push('lessons'); lessonsCreated = true; return { count: 8 }; }),
        // The carousel idempotency guard counts existing type:'carousel' lessons
        // separately from the plain per-module lesson count — 0 for the former (no
        // carousel yet). The plain count must be 0 until lessons actually get created
        // (the lessons-phase idempotency guard reads this too), then 8 after.
        count: vi.fn().mockImplementation(async ({ where }: any) =>
          where?.type === 'carousel' ? (carouselCreated ? 1 : 0) : (lessonsCreated ? 8 : 0)
        ),
        findMany: vi.fn().mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ id: `l${i + 1}`, order: i + 1, content: '<p>Real content.</p>', points: [], tip: '' }))),
      },
      question: { createMany: questionCreateMany },
      evaluationEvent: { findFirst: vi.fn().mockResolvedValue(null), create: evalEventCreate },
    });
    const ctx = makeAdminCtx({
      method: 'WORKER', path: '', prisma,
      action: 'wizard-lessons-bulk',
      body: {
        _action: 'wizard-lessons-bulk', _jobId: 'job-carousel-auto', courseId: 'c1',
        moduleIds: ['m1'], courseTitle: 'Curso', language: 'ES',
        // Deliberately empty — carousel must run regardless of any opt-in index set.
        quizModuleIndices: [0], classModuleIndices: [], reflexModuleIndices: [0], interviewModuleIndices: [],
      },
    });
    const res = await handleAI(ctx);
    expect(res?.statusCode).toBe(200);

    expect(draftCarouselScript).toHaveBeenCalledTimes(1);
    // Inserted at order = pre-carousel lesson count (8) — the module's PENULTIMATE slot.
    expect(generateCarouselAssets).toHaveBeenCalledWith(expect.anything(), 'm1', expect.any(Array), 'ES', 8);
    // Runs right after lessons, BEFORE quiz + reflection (order per Mack's 17:30
    // comment, superseding the earlier 14:02 version this test used to assert).
    const quizIdx = callOrder.indexOf('quiz-questions');
    const reflexIdx = callOrder.indexOf('reflection');
    expect(quizIdx).toBeGreaterThanOrEqual(0);
    expect(reflexIdx).toBeGreaterThanOrEqual(0);
    expect(draftCarouselScript.mock.invocationCallOrder[0]).toBeLessThan(questionCreateMany.mock.invocationCallOrder[0]);
    expect(draftCarouselScript.mock.invocationCallOrder[0]).toBeLessThan(evalEventCreate.mock.invocationCallOrder[0]);

    // Module duration bumped by the carousel's REAL computed duration (60 → 62,
    // not a flat "+6" guess — code review, 2026-09-01). draftCarouselScript being
    // called only once (asserted above) also proves the carousel catch-up pass
    // after the completeness sweep correctly skips a module that already has one.
    expect(prisma.module.update).toHaveBeenCalledWith(expect.objectContaining({ data: { duration: '62 min' } }));
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
