// ─── reading-time.ts ──────────────────────────────────────────────────────────
// Honest lesson-duration estimation from actual word count (Trello DmPpbrff,
// 2026-08-31 15:19 — Mack: "una lectura silenciosa promedio anda entre 200 a 240
// palabras por minuto... no podemos durar 5 minutos leyendo apenas 70 y tantas
// palabras"). 200 wpm sits at the low end of Mack's own stated range — deliberately
// conservative, so a lesson's stated duration never claims MORE time than a student
// will actually spend reading it (the exact failure mode being fixed here).
const WORDS_PER_MINUTE = 200;

/** Word count of an HTML/plain-text string, tags stripped. */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  const stripped = text.replace(/<[^>]+>/g, ' ');
  const words = stripped.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/** Minutes to silently read `wordCount` words at WORDS_PER_MINUTE — min 1. */
export function estimateReadingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}

/** Full lesson duration label ("N min") derived from its actual content + key
 *  points + tip — never a static guess independent of what was really generated. */
export function lessonDurationLabel(content: string | null | undefined, points: string[] = [], tip = ''): string {
  const words = countWords(content) + countWords(points.join(' ')) + countWords(tip);
  return `${estimateReadingMinutes(words)} min`;
}
