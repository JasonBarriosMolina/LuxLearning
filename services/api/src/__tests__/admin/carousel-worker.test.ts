/**
 * Tests for admin/carousel-worker.ts — Trello N1bbWdz0 (2026-08-30).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAdminCtx, makePrisma } from '../helpers/ctx';

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: function () { return { send: vi.fn().mockResolvedValue({}) }; },
  PutObjectCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: vi.fn() }; },
  InvokeModelCommand:   function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-ses',   () => ({ SESClient: function () { return {}; } }));
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: function () { return { send: vi.fn() }; },
  SynthesizeSpeechCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return {}; },
  AdminGetUserCommand: function (x: any) { return x; },
}));
// pdfkit is a real native-ish dependency — stub it so tests don't need a real PDF renderer
vi.mock('pdfkit', () => ({
  default: function () {
    const listeners: Record<string, Function[]> = {};
    return {
      on: (evt: string, cb: Function) => { (listeners[evt] ??= []).push(cb); },
      image: () => {},
      fontSize: () => ({ font: () => ({ text: () => {} }), text: () => {} }),
      font: () => ({ text: () => {}, fontSize: () => ({ text: () => {} }) }),
      moveDown: () => {},
      text: () => {},
      end: () => { listeners['data']?.forEach((cb) => cb(Buffer.from('pdf'))); listeners['end']?.forEach((cb) => cb()); },
      page: { width: 595, height: 842 },
      get y() { return 100; },
    };
  },
}), { virtual: true });

const generateCarouselNarrationMock = vi.fn();
vi.mock('../../admin/ctx', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    generateCarouselNarration: (...args: any[]) => generateCarouselNarrationMock(...args),
    defaultVoiceForLanguage: (lang: string) => (lang === 'EN' ? 'Danielle' : 'Mia'),
  };
});
const generateLessonImageMock = vi.fn();
vi.mock('../../admin/ai-image-helpers', () => ({
  generateLessonImage: (...args: any[]) => generateLessonImageMock(...args),
}));
vi.mock('../../shared/db-dynamo', () => ({
  saveAiJob: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }) as any;

import { handleCarouselWorker, computeSlideTiming, fitSlidesToNarrationBudget } from '../../admin/carousel-worker';
import { saveAiJob } from '../../shared/db-dynamo';

function makeSlides(n = 3) {
  return Array.from({ length: n }, (_, i) => ({
    order: i + 1,
    onScreenText: { title: `Título ${i + 1}`, bullets: [] },
    narrationSegment: `Frase ${i + 1}.`,
    imagePrompt: `Escena ${i + 1}`,
  }));
}

describe('computeSlideTiming', () => {
  it('uses Polly sentence marks directly when the count matches the slide count', () => {
    const slides = makeSlides(3);
    const marks = [{ time: 0, value: 'Frase 1.' }, { time: 1000, value: 'Frase 2.' }, { time: 2500, value: 'Frase 3.' }];
    const timed = computeSlideTiming(slides as any, marks);
    expect(timed[0].startMs).toBe(0);
    expect(timed[0].endMs).toBe(1000);
    expect(timed[2].startMs).toBe(2500);
  });

  it('falls back to proportional char-count timing when marks do not line up with slides', () => {
    const slides = makeSlides(2);
    const timed = computeSlideTiming(slides as any, []); // 0 marks — mismatch
    expect(timed[0].startMs).toBe(0);
    expect(timed[1].startMs).toBeGreaterThan(0);
    expect(timed[1].endMs).toBeGreaterThan(timed[1].startMs);
  });
});

describe('fitSlidesToNarrationBudget — review fix (2026-08-30): audio/slide desync', () => {
  // Bug found in review: ctx.ts's generateCarouselNarration silently .slice(0,2900)s the
  // narration TEXT before synthesis — if applied after building the full text, the last
  // slides would show images with no matching narration audio at all (a real desync, not
  // just a timing approximation). Fitting the SLIDE LIST first keeps every kept slide
  // backed by real audio.
  it('keeps every slide when the combined narration fits within the budget', () => {
    const slides = Array.from({ length: 9 }, (_, i) => ({
      order: i + 1, onScreenText: { title: `T${i}`, bullets: [] }, narrationSegment: `Frase corta ${i}.`, imagePrompt: 'x',
    }));
    const { slides: fitted, dropped } = fitSlidesToNarrationBudget(slides, 2900);
    expect(fitted).toHaveLength(9);
    expect(dropped).toBe(0);
  });

  it('drops only the trailing slides that would overflow the character budget', () => {
    const slides = [
      { order: 1, onScreenText: { title: 'A', bullets: [] }, narrationSegment: 'x'.repeat(50), imagePrompt: 'x' },
      { order: 2, onScreenText: { title: 'B', bullets: [] }, narrationSegment: 'y'.repeat(50), imagePrompt: 'x' },
      { order: 3, onScreenText: { title: 'C', bullets: [] }, narrationSegment: 'z'.repeat(50), imagePrompt: 'x' },
    ];
    const { slides: fitted, dropped } = fitSlidesToNarrationBudget(slides, 110); // fits ~2 slides, not 3
    expect(fitted).toHaveLength(2);
    expect(dropped).toBe(1);
    expect(fitted[0]!.onScreenText.title).toBe('A');
    expect(fitted[1]!.onScreenText.title).toBe('B');
  });

  it('never returns a slide list whose narration exceeds the given budget', () => {
    const slides = Array.from({ length: 20 }, (_, i) => ({
      order: i + 1, onScreenText: { title: `T${i}`, bullets: [] }, narrationSegment: 'Una oración de tamaño moderado para esta prueba.', imagePrompt: 'x',
    }));
    const { slides: fitted } = fitSlidesToNarrationBudget(slides, 300);
    const totalLen = fitted.map((s) => s.narrationSegment.trim()).join(' ').length;
    expect(totalLen).toBeLessThanOrEqual(300);
  });
});

describe('handleCarouselWorker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for unrelated actions', async () => {
    const ctx = makeAdminCtx({ action: 'wizard-lessons-bulk' });
    const result = await handleCarouselWorker(ctx as any);
    expect(result).toBeNull();
  });

  it('creates a carousel Lesson end-to-end on success', async () => {
    generateCarouselNarrationMock.mockResolvedValue({
      audioUrl: 'https://s3.example.com/carousel.mp3',
      marks: [{ time: 0, value: 'Frase 1.' }, { time: 1200, value: 'Frase 2.' }, { time: 2400, value: 'Frase 3.' }],
    });
    generateLessonImageMock.mockResolvedValue('https://s3.example.com/slide.jpg');
    const prisma = makePrisma();
    prisma.module.findUnique = vi.fn().mockResolvedValue({ title: 'Redes Neuronales' });
    prisma.lesson.count = vi.fn().mockResolvedValue(4);
    prisma.lesson.create = vi.fn().mockResolvedValue({ id: 'lesson-carousel-1' });

    const ctx = makeAdminCtx({
      action: 'carousel-generate', prisma,
      body: { _jobId: 'job-1', moduleId: 'm1', slides: makeSlides(3), courseLanguage: 'ES', creatorUserId: 'user-1' },
    });
    const result = await handleCarouselWorker(ctx as any);
    expect(result?.statusCode).toBe(200);

    expect(prisma.lesson.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        moduleId: 'm1', type: 'carousel', order: 5, audioUrl: 'https://s3.example.com/carousel.mp3',
      }),
    }));
    const doneCall = vi.mocked(saveAiJob).mock.calls.find((c) => (c[1] as any)?.status === 'done');
    expect(doneCall?.[1]).toMatchObject({ lessonId: 'lesson-carousel-1' });
  });

  it('reports an error status when narration generation fails, without creating a lesson', async () => {
    generateCarouselNarrationMock.mockResolvedValue(null);
    const prisma = makePrisma();
    prisma.module.findUnique = vi.fn().mockResolvedValue({ title: 'Mod' });
    prisma.lesson.create = vi.fn();

    const ctx = makeAdminCtx({
      action: 'carousel-generate', prisma,
      body: { _jobId: 'job-2', moduleId: 'm1', slides: makeSlides(3) },
    });
    await handleCarouselWorker(ctx as any);

    expect(prisma.lesson.create).not.toHaveBeenCalled();
    const errCall = vi.mocked(saveAiJob).mock.calls.find((c) => (c[1] as any)?.status === 'error');
    expect(errCall).toBeDefined();
  });

  it('drops trailing slides (and never generates images for them) when narration would overflow Polly\'s limit', async () => {
    generateCarouselNarrationMock.mockResolvedValue({ audioUrl: 'https://s3.example.com/carousel.mp3', marks: [] });
    generateLessonImageMock.mockResolvedValue('https://s3.example.com/slide.jpg');
    const prisma = makePrisma();
    prisma.module.findUnique = vi.fn().mockResolvedValue({ title: 'Mod' });
    prisma.lesson.count = vi.fn().mockResolvedValue(0);
    prisma.lesson.create = vi.fn().mockResolvedValue({ id: 'lesson-1' });

    // 3 slides with 1000-char narration each — well past a small 500-char test budget
    const bigSlides = Array.from({ length: 3 }, (_, i) => ({
      order: i + 1, onScreenText: { title: `T${i}`, bullets: [] }, narrationSegment: 'x'.repeat(1000), imagePrompt: 'x',
    }));
    const ctx = makeAdminCtx({
      action: 'carousel-generate', prisma,
      body: { _jobId: 'job-fit', moduleId: 'm1', slides: bigSlides },
    });
    await handleCarouselWorker(ctx as any);

    // Only the slides that fit within Polly's real 2900-char budget got an image call —
    // 2 slides of 1000 chars fit (≈2001 with the joining space), the 3rd does not (≈3002).
    expect(generateLessonImageMock).toHaveBeenCalledTimes(2);
    const created = prisma.lesson.create.mock.calls[0]![0].data;
    expect(created.carouselSlides).toHaveLength(2);
  });

  it('reports an error status when the module does not exist', async () => {
    const prisma = makePrisma();
    prisma.module.findUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeAdminCtx({
      action: 'carousel-generate', prisma,
      body: { _jobId: 'job-3', moduleId: 'missing', slides: makeSlides(3) },
    });
    await handleCarouselWorker(ctx as any);
    const errCall = vi.mocked(saveAiJob).mock.calls.find((c) => (c[1] as any)?.status === 'error');
    expect(errCall).toBeDefined();
  });
});
