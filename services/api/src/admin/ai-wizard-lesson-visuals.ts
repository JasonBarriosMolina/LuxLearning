// ─── ai-wizard-lesson-visuals.ts ──────────────────────────────────────────────
// Attaches one AI-generated image + an honest, word-count-derived duration to
// every lesson from a bulk-generation batch (Trello DmPpbrff, 2026-08-31 15:19 —
// Mack: "es necesario que este tipo de actividad [imágenes] exista en todas las
// lecciones" + duration must match actual reading time). Extracted out of
// ai-wizard-worker.ts to stay under the domain-module 600-line limit (CLAUDE.md).
import { generateLessonImage } from './ai-image-helpers';
import { lessonDurationLabel } from '../shared/reading-time';

const IMAGE_CONCURRENCY = 3;

export interface DraftLessonRow {
  title: string;
  content: string;
  points: string[];
  tip: string;
  imageUrl: string | null;
  duration: string;
  [key: string]: any;
}

/**
 * Mutates `lessons` in place: generates one AI image per lesson (best-effort —
 * a failed generation just leaves imageUrl null, never fails the batch — "solo
 * con incluir una imagen... es suficiente, para que el estudiante tenga también
 * un descanso visual de solo letras"), and overwrites `duration` with an honest
 * estimate derived from the lesson's actual final word count (content, including
 * any appended bibliography/YouTube resources, plus points and tip).
 */
export async function attachLessonVisuals(lessons: DraftLessonRow[], moduleTitle: string): Promise<void> {
  for (let i = 0; i < lessons.length; i += IMAGE_CONCURRENCY) {
    const batch = lessons.slice(i, i + IMAGE_CONCURRENCY);
    await Promise.all(batch.map(async (lesson, bi) => {
      const idx = i + bi;
      const url = await generateLessonImage(lesson.title, moduleTitle, idx, { lessonContent: lesson.content }).catch(() => null);
      lesson.imageUrl = url;
    }));
  }
  for (const lesson of lessons) {
    lesson.duration = lessonDurationLabel(lesson.content, lesson.points, lesson.tip);
  }
}
