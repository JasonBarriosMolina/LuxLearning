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

// ── helpers ───────────────────────────────────────────────────────────────────

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
    vi.spyOn(ctx, 'invokeBedrockForJson').mockResolvedValue([
      { title: 'Lección 1', content: '<p>Intro</p>', points: ['p1'], tip: 'tip', type: 'video', duration: '5 min' },
      { title: 'Lección 2', content: '<h3>Tema A</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 3', content: '<h3>Tema B</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 4', content: '<h3>Tema C</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 5', content: '<h3>Tema D</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 6', content: '<h3>Tema E</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 7', content: '<h3>Cierre reflexivo</h3><p>Resumen</p><ul><li>Punto clave</li></ul>', points: ['p1'], tip: 'tip', type: 'text', duration: '9 min' },
      { title: 'Lección 8', content: '<p>Resumen</p>', points: ['p1'], tip: 'tip', type: 'video', duration: '5 min' },
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

  it('lecciones de texto usan duración de 8-10 min (700-900 palabras, más profundas), no 5-7 min', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = buildPrismaWithLessonCapture();
    const ctx = makeWizardBulkCtx({ classModuleIndices: [] });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    const texts = capturedLessons.filter((l: any) => l.type === 'text');
    // Cada lección texto debe durar entre 8 y 10 min (contenido de mayor profundidad —
    // Trello DmPpbrff comment 6a9232ef, ya no el andamiaje corto de 5-7 min anterior)
    texts.forEach((l: any) => {
      const mins = parseInt(l.duration, 10);
      expect(mins).toBeGreaterThanOrEqual(8);
      expect(mins).toBeLessThanOrEqual(10);
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

    // 2 video × 5 min + 6 text × 9 min = 64 min
    const updateCall = updateSpy.mock.calls.find((c: any[]) =>
      c[0]?.data?.duration != null
    );
    expect(updateCall).toBeDefined();
    const durationStr: string = updateCall![0].data.duration;
    const totalMin = parseInt(durationStr, 10);
    expect(totalMin).toBeGreaterThanOrEqual(55);
    expect(totalMin).toBeLessThanOrEqual(70);
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
