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

// Background music (Trello DmPpbrff, 2026-09-04 — Mack: "Ni música como se conversó...
// con opción de reproducirse"). No music API exists to pull from at generation time
// (Pixabay's Music API was investigated and confirmed not to exist — a live request to
// pixabay.com/api/videos/music/ returned 404), so this is a small curated, manually
// uploaded library (royalty-free tracks Mack sent directly) instead of anything
// AI-selected or AI-generated. Lives here, not in a DB table — 6 static S3 URLs don't
// need admin CRUD, and the whole point per Mack's own scoping was to keep this cheap
// and simple, unblocked by API costs/availability.
export interface BgmTrack { id: string; title: string; url: string; }

const BGM_BASE_URL = 'https://lux-learning-images.s3.amazonaws.com/audio/bgm';
export const BGM_TRACKS: BgmTrack[] = [
  { id: 'chillhop-coffee-shop', title: 'Chillhop Jazz Coffee Shop', url: `${BGM_BASE_URL}/chillhop-coffee-shop.mp3` },
  { id: 'lofi-chill-vlog', title: 'Lofi Chill Vlog Beats', url: `${BGM_BASE_URL}/lofi-chill-vlog.mp3` },
  { id: 'lofi-restaurant', title: 'Lofi Restaurant', url: `${BGM_BASE_URL}/lofi-restaurant.mp3` },
  { id: 'lofi-study-session', title: 'Lofi Study Session', url: `${BGM_BASE_URL}/lofi-study-session.mp3` },
  { id: 'lofi-relax', title: 'Lofi Relax', url: `${BGM_BASE_URL}/lofi-relax.mp3` },
  { id: 'no-copyright-bg', title: 'Ambient Background', url: `${BGM_BASE_URL}/no-copyright-bg.mp3` },
  // Second batch, 2026-09-05 (Mack)
  { id: 'lofi-study-rainy-night', title: 'Lofi Study Rainy Night', url: `${BGM_BASE_URL}/lofi-study-rainy-night.mp3` },
  { id: 'lofi-cocktail-bar', title: 'Lofi Cocktail Bar', url: `${BGM_BASE_URL}/lofi-cocktail-bar.mp3` },
  { id: 'lofi-midnight-club', title: 'Lofi Midnight Club', url: `${BGM_BASE_URL}/lofi-midnight-club.mp3` },
  { id: 'lofi-smooth', title: 'Lofi Smooth', url: `${BGM_BASE_URL}/lofi-smooth.mp3` },
];

/** Deterministic per-lesson track pick — same lesson always plays the same track (no
 *  jarring change on replay), different lessons spread across the library instead of
 *  everyone hearing track #1. Pure string hash, no Math.random (untestable/unstable). */
export function pickBgmTrack(lessonId: string, tracks: BgmTrack[] = BGM_TRACKS): BgmTrack | null {
  if (tracks.length === 0) return null;
  let hash = 0;
  for (let i = 0; i < lessonId.length; i++) hash = (hash * 31 + lessonId.charCodeAt(i)) >>> 0;
  return tracks[hash % tracks.length]!;
}
