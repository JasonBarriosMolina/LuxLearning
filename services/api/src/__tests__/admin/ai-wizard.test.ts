/**
 * Tests for admin/ai-wizard.ts
 * Focus: dynamic lesson count + comprehension-based durations (bug fix)
 *
 * Bug (original): lessonCount was hardcoded (hasClass ? 3 : 8) with superficial WPM durations (7 min).
 * Fix (7311391): dynamic count targeting ~60 min async per module, text lessons at 10 min comprehension time.
 *
 * Bug (2026-08-24, Trello DmPpbrff): 10 min/lesson produced fewer, denser lessons than requested.
 * Fix: text lessons target 5-7 min each (6 min), scaffolded, with subtitle/bullet chunking and a
 * reflective close — still totaling ~60 min per module, now via more/shorter lessons (10 total).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAdminCtx, makePrisma, bodyOf } from '../helpers/ctx';

// ── Mock all external I/O ─────────────────────────────────────────────────────

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
  GetObjectCommand:   function(x: any) { return x; },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned'),
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function() { return { send: vi.fn() }; },
  AdminGetUserCommand:           function(x: any) { return x; },
}));
vi.mock('../../shared/db-dynamo', () => ({
  saveAiJob:                  vi.fn().mockResolvedValue(undefined),
  batchCreateCalendarEvents:  vi.fn().mockResolvedValue(undefined),
  deleteWizardCalendarEvents: vi.fn().mockResolvedValue(undefined),
  saveResource:               vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/db-messages', () => ({
  upsertChat: vi.fn().mockResolvedValue(undefined),
  upsertMembership: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/env-context', () => ({
  getCurrentEnv: vi.fn().mockReturnValue('test'),
}));
vi.mock('../../admin/ai-image-helpers', () => ({
  generateLessonImage:       vi.fn().mockResolvedValue('https://s3.example.com/img.jpg'),
  generateLessonInfographic: vi.fn().mockResolvedValue(null),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

/** N-word filler content — duration is now derived from real word count (Trello
 *  DmPpbrff, 2026-08-31 15:19), so tests must mock realistically-sized content
 *  instead of asserting on a static duration string the model returned. */
function wordsOf(n: number): string {
  return `<h3>Tema</h3><p>${Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ')}</p>`;
}

let capturedLessons: any[] = [];

function buildPrismaWithLessonCapture(moduleTitle = 'Módulo de prueba') {
  const prisma = makePrisma({
    module: {
      findUnique: vi.fn().mockResolvedValue({ title: moduleTitle, description: 'Descripción de prueba' }),
      update:     vi.fn().mockResolvedValue({ id: 'mod-1' }),
    },
    lesson: {
      createMany: vi.fn().mockImplementation(async (args: any) => {
        capturedLessons = args.data;
        return { count: args.data.length };
      }),
      count: vi.fn().mockResolvedValue(0),
    },
    question: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  });
  return prisma;
}

function makeWizardBulkCtx(overrides: {
  moduleIds?: string[];
  quizModuleIndices?: number[];
  classModuleIndices?: number[];
  language?: string;
} = {}) {
  return makeAdminCtx({
    action: 'wizard-lessons-bulk',
    body: {
      _jobId: 'job-test-1',
      courseId: 'course-1',
      courseTitle: 'Curso de Prueba',
      moduleIds: overrides.moduleIds ?? ['mod-1'],
      language: overrides.language ?? 'ES',
      evaluationItems: [{ type: 'QUIZ', name: 'Quiz', weight: 10, count: 1 }],
      quizModuleIndices: overrides.quizModuleIndices ?? [],
      classModuleIndices: overrides.classModuleIndices ?? [],
    },
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ai-wizard — dynamic lesson count (bug fix)', () => {
  beforeEach(async () => {
    capturedLessons = [];
    vi.clearAllMocks();

    // Stub invokeBedrockForJson via ctx module
    const ctx = await import('../../admin/ctx');
    // Content sized realistically (~150 words video, ~1000 words text) — duration is
    // now DERIVED from actual word count (Trello DmPpbrff, 2026-08-31 15:19), so the
    // "duration" field the model returns here is deliberately ignored/wrong to prove
    // the real content length is what determines the final stored duration.
    vi.spyOn(ctx, 'invokeBedrockForJson').mockResolvedValue([
      { title: 'Lección 1', content: wordsOf(150), points: ['p1'], tip: 'tip', type: 'video', duration: '5 min' },
      { title: 'Lección 2', content: wordsOf(1000), points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 3', content: wordsOf(1000), points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 4', content: wordsOf(1000), points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 5', content: wordsOf(1000), points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 6', content: wordsOf(1000), points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 7', content: wordsOf(1000) + '<ul><li>Punto clave</li></ul>', points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 8', content: wordsOf(150), points: ['p1'], tip: 'tip', type: 'video', duration: '5 min' },
    ]);
  });

  it('genera 8 lecciones sin clase (2 video + 6 texto = ~60 min, andamiaje de 9 min/lección)', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = buildPrismaWithLessonCapture();
    const ctx = makeWizardBulkCtx({ classModuleIndices: [] });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    expect(capturedLessons).toHaveLength(8);

    const videos = capturedLessons.filter((l: any) => l.type === 'video');
    const texts  = capturedLessons.filter((l: any) => l.type === 'text');
    expect(videos).toHaveLength(2);
    expect(texts).toHaveLength(6);
  });

  it('la duración de cada lección se deriva del conteo real de palabras (~200 wpm), no del valor que devolvió el modelo (Trello DmPpbrff, 2026-08-31 15:19)', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = buildPrismaWithLessonCapture();
    const ctx = makeWizardBulkCtx({ classModuleIndices: [] });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    const texts = capturedLessons.filter((l: any) => l.type === 'text');
    // Contenido mockeado con ~1000 palabras reales — a 200 wpm eso son ~5 min, NO
    // los "9 min" que el modelo devolvió (deliberadamente ignorado): el bug era
    // exactamente que se confiaba en ese valor sin importar cuánto texto hubiera.
    texts.forEach((l: any) => {
      const mins = parseInt(l.duration, 10);
      expect(mins).toBeGreaterThanOrEqual(4);
      expect(mins).toBeLessThanOrEqual(6);
      expect(l.duration).not.toBe('9 min');
    });

    const videos = capturedLessons.filter((l: any) => l.type === 'video');
    // Contenido mockeado con ~150 palabras — a 200 wpm eso es <1 min, redondeado a 1 min
    // mínimo — NO los "5 min" que el modelo devolvió (el bug concreto que reportó Mack:
    // una lección de ~79 palabras etiquetada "5 minutos").
    videos.forEach((l: any) => {
      expect(l.duration).toBe('1 min');
    });
  });

  it('módulo con clase genera misma cantidad de lecciones asíncronas que sin clase', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prismaNoClass   = buildPrismaWithLessonCapture();
    const prismaWithClass = buildPrismaWithLessonCapture();

    // Sin clase
    const ctxNoClass = makeWizardBulkCtx({ classModuleIndices: [] });
    ctxNoClass.prisma = prismaNoClass as any;
    await handleAIWizard(ctxNoClass as any);
    const lessonsNoClass = capturedLessons.length;

    // Con clase (índice 0)
    capturedLessons = [];
    const ctxWithClass = makeWizardBulkCtx({ classModuleIndices: [0] });
    ctxWithClass.prisma = prismaWithClass as any;
    await handleAIWizard(ctxWithClass as any);
    const lessonsWithClass = capturedLessons.length;

    // La clase es ADICIONAL — no reduce el contenido asíncrono
    expect(lessonsWithClass).toBe(lessonsNoClass);
    expect(lessonsWithClass).toBeGreaterThanOrEqual(6);
  });

  it('module.duration se actualiza al total real de minutos de lecciones', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = buildPrismaWithLessonCapture();
    const updateSpy = prisma.module.update as ReturnType<typeof vi.fn>;
    const ctx = makeWizardBulkCtx({ classModuleIndices: [] });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    // Durations are now derived from real word count (Trello DmPpbrff, 2026-08-31
    // 15:19): 2 video × ~1 min + 6 text × ~5 min = ~32 min, not the old static 64 min.
    const updateCall = updateSpy.mock.calls.find((c: any[]) =>
      c[0]?.data?.duration != null
    );
    expect(updateCall).toBeDefined();
    const durationStr: string = updateCall![0].data.duration;
    const totalMin = parseInt(durationStr, 10);
    expect(totalMin).toBeGreaterThanOrEqual(28);
    expect(totalMin).toBeLessThanOrEqual(38);
  });

  it('no genera menos de 6 lecciones por módulo', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = buildPrismaWithLessonCapture();
    const ctx = makeWizardBulkCtx({});
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    expect(capturedLessons.length).toBeGreaterThanOrEqual(6);
  });

  it('sanitiza viñetas markdown ("- item") a <ul><li> para chunking visual', async () => {
    const ctxModule = await import('../../admin/ctx');
    (ctxModule.invokeBedrockForJson as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: 'Lección 1', content: '<p>Intro</p>', points: ['p1'], tip: 'tip', type: 'video', duration: '5 min' },
      { title: 'Lección 2', content: '## Concepto clave\n- Punto uno\n- Punto dos\n<p>Cuerpo</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '6 min' },
    ]);
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = buildPrismaWithLessonCapture();
    const ctx = makeWizardBulkCtx({ classModuleIndices: [] });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    const textLesson = capturedLessons.find((l: any) => l.type === 'text');
    expect(textLesson.content).toContain('<h3>Concepto clave</h3>');
    expect(textLesson.content).toContain('<ul><li>Punto uno</li><li>Punto dos</li></ul>');
  });
});

// ── Fix 1: quizModuleIndices / classModuleIndices fallback (bug 2026-08-25) ──────
// When the dispatch omits quizModuleIndices (not even an empty array), the worker
// must fall back to hasQuizInPlan to decide which modules get quiz questions.
// Passing [] explicitly must block quiz creation (caller said "none").
describe('ai-wizard — quiz/class index fallback (Fix 1)', () => {
  function makePrismaWithQuizCapture() {
    const prisma = makePrisma({
      module: {
        findUnique: vi.fn().mockResolvedValue({ title: 'Módulo Test', description: 'Desc' }),
        update:     vi.fn().mockResolvedValue({ id: 'mod-1' }),
      },
      lesson: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        count:      vi.fn().mockResolvedValue(0),
      },
      question: {
        createMany: vi.fn().mockResolvedValue({ count: 10 }),
      },
      evaluationEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create:    vi.fn().mockResolvedValue({ id: 'ev-1' }),
      },
    });
    return prisma;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cuando quizModuleIndices está ausente, NO genera preguntas — ya no hay fallback a "todos los módulos" (Trello DmPpbrff 6a9269e2)', async () => {
    const ctxModule = await import('../../admin/ctx');
    vi.spyOn(ctxModule, 'invokeBedrockForJson').mockResolvedValue([
      { text: '¿Pregunta 1?', options: ['A', 'B', 'C', 'D'], correctIndex: 0, order: 1 },
    ]);
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = makePrismaWithQuizCapture();

    // Body sin quizModuleIndices (undefined) — ya NO cae al viejo fallback hasQuizInPlan;
    // el dispatch (ai-wizard.ts) siempre manda índices explícitos ahora, así que "ausente"
    // debe comportarse igual que "[]" — ningún módulo.
    const ctx = makeAdminCtx({
      action: 'wizard-lessons-bulk',
      body: {
        _jobId: 'job-fallback-1',
        courseId: 'course-1',
        courseTitle: 'Curso Test',
        moduleIds: ['mod-1'],
        language: 'ES',
        evaluationItems: [{ type: 'QUIZ', name: 'Quiz', weight: 10, count: 1 }],
        // quizModuleIndices ausente — NO pasar el campo
      },
    });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    // question.createMany NO debe haberse llamado — sin índice explícito, sin quiz
    expect(prisma.question.createMany).not.toHaveBeenCalled();
  });

  it('cuando quizModuleIndices = [] explícito, NO genera preguntas aunque evaluationItems tenga QUIZ', async () => {
    const ctxModule = await import('../../admin/ctx');
    vi.spyOn(ctxModule, 'invokeBedrockForJson').mockResolvedValue([]);
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = makePrismaWithQuizCapture();

    // Dispatch pasa [] explícito — worker debe respetar "ningún módulo"
    const ctx = makeAdminCtx({
      action: 'wizard-lessons-bulk',
      body: {
        _jobId: 'job-explicit-empty-1',
        courseId: 'course-1',
        courseTitle: 'Curso Test',
        moduleIds: ['mod-1'],
        language: 'ES',
        evaluationItems: [{ type: 'QUIZ', name: 'Quiz', weight: 10, count: 1 }],
        quizModuleIndices: [], // explícito: el dispatch dijo "ninguno"
      },
    });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    // question.createMany NO debe haberse llamado
    expect(prisma.question.createMany).not.toHaveBeenCalled();
  });

  it('cuando classModuleIndices está ausente, NO crea EvaluationEvent CLASS — ya no hay fallback a "todos los módulos" (Trello DmPpbrff 6a9269e2)', async () => {
    const ctxModule = await import('../../admin/ctx');
    vi.spyOn(ctxModule, 'invokeBedrockForJson').mockResolvedValue({
      vapiPrompt: 'Pregunta guía sobre el módulo',
      lessonScript: 'Actividades de clase',
    });
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = makePrismaWithQuizCapture();

    const ctx = makeAdminCtx({
      action: 'wizard-lessons-bulk',
      body: {
        _jobId: 'job-class-fallback-1',
        courseId: 'course-1',
        courseTitle: 'Curso Test',
        moduleIds: ['mod-1'],
        language: 'ES',
        evaluationItems: [{ type: 'CLASS', name: 'Clase Lux Mentor', weight: 0, count: 1 }],
        // classModuleIndices ausente — NO pasar el campo
      },
    });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    // Sin índice explícito, ninguna EvaluationEvent CLASS se crea para este módulo
    expect(prisma.evaluationEvent.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'CLASS', moduleId: 'mod-1' }),
      }),
    );
  });
});

// ── Fix 2: quizModuleIndices/classModuleIndices desync in wizard/save (2026-08-27) ──
// Bug: indices were computed as positions in suggestedModules, but createdModuleIds
// (new-course path) skips modules whose create failed, and newModuleIds (edit add-only
// path) skips modules that already exist — so the index space no longer matched the
// array actually sent to the lesson-bulk worker, misassigning quiz/class to the wrong module.
describe('ai-wizard/save — quiz/class index desync (Fix 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('nuevo curso: si un module.create falla a mitad de la lista, quizModuleIndices apunta a la posición correcta en createdModuleIds (no en suggestedModules)', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const { lambdaClient } = await import('../../admin/ctx');

    let moduleCreateCalls = 0;
    const prisma = makePrisma({
      course: { create: vi.fn().mockResolvedValue({ id: 'course-1', slug: 'curso-1', planDocumentS3Key: null }) },
      module: {
        create: vi.fn().mockImplementation(async () => {
          moduleCreateCalls++;
          if (moduleCreateCalls === 1) throw new Error('DB transient error'); // module 0 (Módulo A) fails
          return { id: `mod-${moduleCreateCalls}` };
        }),
      },
    });

    const ctx = makeAdminCtx({
      method: 'POST',
      path: '/admin/courses/wizard/save',
      body: {
        title: 'Curso de Prueba',
        planLanguage: 'ES',
        suggestedModules: [
          { name: 'Módulo A' }, // index 0 — create fails, never occupies a createdModuleIds slot
          { name: 'Módulo B', quizWeek: 1 }, // index 1 — quiz planned; should land at createdModuleIds[0]
          { name: 'Módulo C' }, // index 2 — should land at createdModuleIds[1]
        ],
        weeklyPlan: [{ weekNum: 1, module: 'Módulo B' }],
        evaluationItems: [],
      },
    });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    const bulkCall = (lambdaClient.send as any).mock.calls
      .map((c: any[]) => c[0])
      .find((cmd: any) => JSON.parse(cmd.Payload.toString())._action === 'wizard-lessons-bulk');
    expect(bulkCall).toBeDefined();
    const payload = JSON.parse(bulkCall.Payload.toString());

    expect(payload.moduleIds).toEqual(['mod-2', 'mod-3']); // only the 2 successfully created modules
    // Módulo B (originally suggestedModules[1]) is now at position 0 of moduleIds —
    // quizModuleIndices must point to 0, NOT 1 (which would now wrongly hit Módulo C).
    expect(payload.quizModuleIndices).toEqual([0]);
  });

  it('editar curso (add-only): si un módulo ya existe y se salta, quizModuleIndices apunta a la posición correcta en newModuleIds (no en suggestedModules)', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const { lambdaClient } = await import('../../admin/ctx');

    const prisma = makePrisma({
      course: { update: vi.fn().mockResolvedValue({ id: 'course-1', slug: 'curso-1', planDocumentS3Key: null }) },
      module: {
        findMany: vi.fn().mockResolvedValue([{ id: 'mod-existing', title: 'Módulo A', order: 1 }]),
        create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `mod-new-${data.title}` })),
      },
    });

    const ctx = makeAdminCtx({
      method: 'POST',
      path: '/admin/courses/wizard/save',
      body: {
        title: 'Curso de Prueba',
        planLanguage: 'ES',
        editingCourseId: 'course-1',
        suggestedModules: [
          { name: 'Módulo A' }, // index 0 — already exists, skipped entirely (not in newModuleIds)
          { name: 'Módulo B', quizWeek: 1 }, // index 1 — quiz planned; should land at newModuleIds[0]
          { name: 'Módulo C' }, // index 2 — should land at newModuleIds[1]
        ],
        weeklyPlan: [{ weekNum: 1, module: 'Módulo B' }],
        evaluationItems: [],
      },
    });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    const bulkCall = (lambdaClient.send as any).mock.calls
      .map((c: any[]) => c[0])
      .find((cmd: any) => JSON.parse(cmd.Payload.toString())._action === 'wizard-lessons-bulk');
    expect(bulkCall).toBeDefined();
    const payload = JSON.parse(bulkCall.Payload.toString());

    expect(payload.moduleIds).toEqual(['mod-new-Módulo B', 'mod-new-Módulo C']);
    // Módulo B (originally suggestedModules[1]) is now at position 0 of newModuleIds —
    // quizModuleIndices must point to 0, NOT 1 (which would now wrongly hit Módulo C).
    expect(payload.quizModuleIndices).toEqual([0]);
  });
});

describe('ai-wizard/save — persists activeGenerationJobId on the Course (2026-08-31 status-visibility fix)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stamps the dispatched jobId onto the course row so the admin editor can poll it later', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const { lambdaClient } = await import('../../admin/ctx');

    const courseUpdateMock = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({
      course: { create: vi.fn().mockResolvedValue({ id: 'course-1', slug: 'curso-1', planDocumentS3Key: null }), update: courseUpdateMock },
      module: { create: vi.fn().mockImplementation(async () => ({ id: 'mod-1' })) },
    });

    const ctx = makeAdminCtx({
      method: 'POST',
      path: '/admin/courses/wizard/save',
      body: {
        title: 'Curso de Prueba', planLanguage: 'ES',
        suggestedModules: [{ name: 'Módulo A' }],
        weeklyPlan: [], evaluationItems: [],
      },
    });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    const bulkCall = (lambdaClient.send as any).mock.calls
      .map((c: any[]) => c[0])
      .find((cmd: any) => JSON.parse(cmd.Payload.toString())._action === 'wizard-lessons-bulk');
    const dispatchedJobId = JSON.parse(bulkCall.Payload.toString())._jobId;

    expect(courseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      data: { activeGenerationJobId: dispatchedJobId },
    });
  });
});
