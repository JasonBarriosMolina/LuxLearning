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
      { title: 'Lección 2', content: '<h3>Tema A</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '6 min' },
      { title: 'Lección 3', content: '<h3>Tema B</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '6 min' },
      { title: 'Lección 4', content: '<h3>Tema C</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '6 min' },
      { title: 'Lección 5', content: '<h3>Tema D</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '6 min' },
      { title: 'Lección 6', content: '<h3>Tema E</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '6 min' },
      { title: 'Lección 7', content: '<h3>Tema F</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '6 min' },
      { title: 'Lección 8', content: '<h3>Tema G</h3><p>Contenido</p>', points: ['p1'], tip: 'tip', type: 'text', duration: '6 min' },
      { title: 'Lección 9', content: '<h3>Cierre reflexivo</h3><p>Resumen</p><ul><li>Punto clave</li></ul>', points: ['p1'], tip: 'tip', type: 'text', duration: '6 min' },
      { title: 'Lección 10', content: '<p>Resumen</p>', points: ['p1'], tip: 'tip', type: 'video', duration: '5 min' },
    ]);
  });

  it('genera 10 lecciones sin clase (2 video + 8 texto = ~60 min)', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = buildPrismaWithLessonCapture();
    const ctx = makeWizardBulkCtx({ classModuleIndices: [] });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    expect(capturedLessons).toHaveLength(10);

    const videos = capturedLessons.filter((l: any) => l.type === 'video');
    const texts  = capturedLessons.filter((l: any) => l.type === 'text');
    expect(videos).toHaveLength(2);
    expect(texts).toHaveLength(8);
  });

  it('lecciones de texto usan duración corta de 5-7 min (andamiaje), no 10 min densos', async () => {
    const { handleAIWizard } = await import('../../admin/ai-wizard');
    const prisma = buildPrismaWithLessonCapture();
    const ctx = makeWizardBulkCtx({ classModuleIndices: [] });
    ctx.prisma = prisma as any;

    await handleAIWizard(ctx as any);

    const texts = capturedLessons.filter((l: any) => l.type === 'text');
    const wrongDuration = texts.filter((l: any) => l.duration === '7 min' || l.duration === '10 min');
    expect(wrongDuration).toHaveLength(0);

    // Cada lección texto debe durar entre 5 y 7 min (andamiaje progresivo)
    texts.forEach((l: any) => {
      const mins = parseInt(l.duration, 10);
      expect(mins).toBeGreaterThanOrEqual(5);
      expect(mins).toBeLessThanOrEqual(7);
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

    // 2 video × 5 min + 8 text × 6 min = 58 min
    const updateCall = updateSpy.mock.calls.find((c: any[]) =>
      c[0]?.data?.duration != null
    );
    expect(updateCall).toBeDefined();
    const durationStr: string = updateCall![0].data.duration;
    const totalMin = parseInt(durationStr, 10);
    expect(totalMin).toBeGreaterThanOrEqual(50);
    expect(totalMin).toBeLessThanOrEqual(65);
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
