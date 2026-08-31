// ─── carousel-worker.ts ───────────────────────────────────────────────────────
// Async asset generation for Lux Carrousel (Trello N1bbWdz0): narration audio +
// speech marks (Polly) + per-slide images (Stability, reusing ai-image-helpers —
// same no-text negative-prompt pipeline the spec asks for), then saves the
// finished carousel as a new Lesson (type="carousel") on the target module. The
// "Lux Recap" PDF is built later, on demand (see shared/carousel-pdf.ts) — not
// here (2026-08-31 15:21: building it eagerly for every carousel, whether or not
// anyone ever downloads it, was adding real time to every generation).
import { createId } from '@paralleldrive/cuid2';
import { AdminCtx, generateCarouselNarration, defaultVoiceForLanguage } from './ctx';
import { generateLessonImage } from './ai-image-helpers';
import { saveAiJob, createNotification } from '../shared/db-dynamo';
import { ok } from '../shared/response';

const IMAGE_CONCURRENCY = 3;
// ~750 chars/min is a rough Polly neural speaking-rate estimate — only used as a fallback
// when the number of sentence speech marks doesn't line up 1:1 with the slide count (the
// model didn't phrase each slide as exactly one Polly-recognized sentence).
const CHARS_PER_MINUTE_ESTIMATE = 750;
// Polly's per-SynthesizeSpeech request limit (matches generateLessonAudio's own .slice(0,2900)
// in ctx.ts). Kept as its own constant here because the fix below has to decide BEFORE
// synthesis which slides survive — ctx.ts's silent .slice() truncates the raw text after
// the fact, which would cut the narration audio short while every slide's image/text still
// plays, an audio/slide desync bug found in review (2026-08-30).
const POLLY_MAX_CHARS = 2900;

export interface DraftSlide {
  order: number;
  onScreenText: { title: string; bullets: string[] };
  narrationSegment: string;
  imagePrompt: string;
}

/** Normalizes a narration segment to end in sentence punctuation — needed both to build
 *  the final narration text AND to size it against Polly's per-request character limit,
 *  so the two stay consistent. */
function normalizedSegment(s: DraftSlide): string {
  const t = s.narrationSegment.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Drops trailing slides whose combined narration would exceed Polly's per-request
 *  character limit — BEFORE synthesis, so the slides that remain always have real
 *  narration audio behind them. Silently truncating the TEXT afterwards (as
 *  generateLessonAudio's own defensive .slice(0,2900) does) would desync the last
 *  slides from the actual audio: their images/text would show with no voice reading
 *  them, since the cut-off point lands mid-sentence with no relationship to slide
 *  boundaries. Found in review (2026-08-30). */
export function fitSlidesToNarrationBudget(slides: DraftSlide[], maxChars = POLLY_MAX_CHARS): { slides: DraftSlide[]; dropped: number } {
  const kept: DraftSlide[] = [];
  let used = 0;
  for (const s of slides) {
    const seg = normalizedSegment(s);
    const nextUsed = used + seg.length + (kept.length > 0 ? 1 : 0); // +1 for the joining space
    if (nextUsed > maxChars) break;
    kept.push(s);
    used = nextUsed;
  }
  return { slides: kept, dropped: slides.length - kept.length };
}

export function computeSlideTiming(slides: DraftSlide[], marks: Array<{ time: number; value: string }>) {
  if (marks.length === slides.length) {
    return slides.map((s, i) => ({
      ...s,
      startMs: marks[i]!.time,
      endMs: i + 1 < marks.length ? marks[i + 1]!.time : marks[i]!.time + 4000,
    }));
  }
  // Fallback: distribute proportionally by narration character count.
  const totalChars = slides.reduce((sum, s) => sum + s.narrationSegment.length, 0) || 1;
  const estTotalMs = Math.round((totalChars / CHARS_PER_MINUTE_ESTIMATE) * 60000);
  let acc = 0;
  return slides.map((s) => {
    const dur = Math.max(1500, Math.round((s.narrationSegment.length / totalChars) * estTotalMs));
    const startMs = acc;
    acc += dur;
    return { ...s, startMs, endMs: acc };
  });
}

export async function handleCarouselWorker(ctx: AdminCtx): Promise<any | null> {
  if (ctx.action !== 'carousel-generate') return null;
  const { prisma, body } = ctx;
  const { _jobId, moduleId, slides, courseLanguage, creatorUserId } = body as {
    _jobId: string; moduleId: string; slides: DraftSlide[]; courseLanguage?: string; creatorUserId?: string;
  };

  try {
    const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true } });
    if (!mod) { await saveAiJob(_jobId, { status: 'error', error: 'Módulo no encontrado' }); return ok({}); }

    const { slides: fittedSlides, dropped } = fitSlidesToNarrationBudget(slides);
    if (dropped > 0) {
      console.warn(`[carousel-worker] module ${moduleId}: dropped ${dropped} trailing slide(s) — combined narration exceeded Polly's ${POLLY_MAX_CHARS}-char limit`);
    }

    const voiceId = defaultVoiceForLanguage(courseLanguage);
    const narrationText = fittedSlides.map(normalizedSegment).join(' ');

    const narration = await generateCarouselNarration(`carousel-${moduleId}`, narrationText, voiceId);
    if (!narration) {
      await saveAiJob(_jobId, { status: 'error', error: 'No se pudo generar la narración de audio' });
      return ok({});
    }

    const timedSlides = computeSlideTiming(fittedSlides, narration.marks);
    await saveAiJob(_jobId, { status: 'processing', phase: 'images', modulesProcessed: 0, totalModules: fittedSlides.length });

    const slideImages: (string | null)[] = new Array(fittedSlides.length).fill(null);
    for (let i = 0; i < fittedSlides.length; i += IMAGE_CONCURRENCY) {
      const batch = fittedSlides.slice(i, i + IMAGE_CONCURRENCY);
      await Promise.all(batch.map(async (s, bi) => {
        const idx = i + bi;
        const url = await generateLessonImage(mod.title, mod.title, idx, { promptText: s.imagePrompt, style: 'diagram' }).catch(() => null);
        slideImages[idx] = url;
      }));
      await saveAiJob(_jobId, { status: 'processing', phase: 'images', modulesProcessed: Math.min(i + IMAGE_CONCURRENCY, fittedSlides.length), totalModules: fittedSlides.length });
    }

    const finalSlides = timedSlides.map((s, i) => ({
      order: s.order, onScreenText: s.onScreenText, imageUrl: slideImages[i], startMs: s.startMs, endMs: s.endMs,
    }));

    // pdfRecapUrl is intentionally left null here — the "Lux Recap" PDF is built
    // on demand by the student-facing courses lambda the first time anyone asks
    // for it (Trello N1bbWdz0, 2026-08-31 15:21), not eagerly during generation.
    const lessonCount = await prisma.lesson.count({ where: { moduleId } });
    const lesson = await prisma.lesson.create({
      data: {
        moduleId, order: lessonCount + 1, title: `Lux Carrousel: ${mod.title}`, duration: '6 min',
        type: 'carousel', content: null, points: [], tip: '', youtubeId: '',
        audioUrl: narration.audioUrl, carouselSlides: finalSlides, speechMarks: narration.marks as any, pdfRecapUrl: null,
      },
    });

    await saveAiJob(_jobId, { status: 'done', lessonId: lesson.id });

    if (creatorUserId) {
      await createNotification({
        userId: creatorUserId, notifId: createId(), type: 'GENERAL',
        message: `Lux Carrousel listo — ${mod.title}`,
        read: false, createdAt: new Date().toISOString(), actionUrl: `/admin/courses`,
      }).catch(() => {});
    }
  } catch (err: any) {
    console.error('[carousel-worker] fatal error:', err);
    await saveAiJob(_jobId, { status: 'error', error: err?.message ?? 'Error generando el carrousel' });
  }
  return ok({});
}
