// ─── LuxCarrouselPlayer.helpers.ts ────────────────────────────────────────────
// Pure logic for the Lux Carrousel player, extracted for unit testing.

export interface CarouselSlide {
  order: number;
  onScreenText: { title: string; bullets: string[] };
  imageUrl: string | null;
  startMs: number;
  endMs: number;
}

/** Finds which slide is active at a given playback position. Returns -1 for an
 *  empty slide list. Clamps to the last slide once playback runs past its endMs
 *  (covers small rounding gaps at the very end of the narration). */
export function findActiveSlideIndex(slides: CarouselSlide[], currentMs: number): number {
  if (slides.length === 0) return -1;
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]!;
    if (currentMs >= s.startMs && currentMs < s.endMs) return i;
  }
  return currentMs >= slides[slides.length - 1]!.endMs ? slides.length - 1 : 0;
}

/** Ken Burns progress (0-1) within the active slide — drives the CSS pan/zoom. */
export function slideProgress(slide: CarouselSlide | undefined, currentMs: number): number {
  if (!slide) return 0;
  const span = slide.endMs - slide.startMs;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (currentMs - slide.startMs) / span));
}

/** Background-music ducking gain (Trello N1bbWdz0 "Soundscaping Inmersivo"): keeps
 *  music low and constant while narration is playing — a full amplitude-reactive
 *  sidechain would need real-time analysis of the narration track; this simpler,
 *  deterministic version still avoids auditory fatigue and is easy to reason about
 *  and test. Music briefly rises during the silence between slides. */
export function musicDuckGain(params: { isNarrationPlaying: boolean; msIntoSlide: number; duckedGain: number; restGain: number; fadeMs: number }): number {
  const { isNarrationPlaying, msIntoSlide, duckedGain, restGain, fadeMs } = params;
  if (!isNarrationPlaying) return restGain;
  if (msIntoSlide < fadeMs) {
    const t = msIntoSlide / fadeMs;
    return restGain + (duckedGain - restGain) * t;
  }
  return duckedGain;
}

/** First-view lock (Trello N1bbWdz0 "Control de Reproducción Restringido"): no
 *  seeking/skipping until the carousel has been completed once. */
export function canScrub(hasCompletedBefore: boolean): boolean {
  return hasCompletedBefore;
}

export interface SpeechMark { time: number; value: string; }

/** Close captions (Trello DmPpbrff, 2026-09-04 — Mack: "No hay close captions en los
 *  carrouseles"): reuses the same Polly sentence-level speech marks already generated
 *  and stored on the Lesson row for slide timing (carousel-worker.ts) — no separate
 *  caption generation needed, `value` is the exact narration text. A mark has no
 *  explicit end, so the active caption is whichever mark's `time` is the latest one
 *  at/before currentMs, until the next mark's `time` takes over. */
export function findActiveCaptionIndex(marks: SpeechMark[], currentMs: number): number {
  if (marks.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < marks.length; i++) {
    if (marks[i]!.time <= currentMs) idx = i; else break;
  }
  return idx;
}

/** Post-class transcript (Trello DmPpbrff, 2026-09-04 — Mack: "Ni transcripción del
 *  texto post clase"): the full narration, reconstructed by joining every speech
 *  mark's text in order — the same text Polly actually spoke, not the abbreviated
 *  on-screen bullets. */
export function buildCarouselTranscript(marks: SpeechMark[]): string {
  return marks.map((m) => m.value.trim()).filter(Boolean).join(' ');
}
