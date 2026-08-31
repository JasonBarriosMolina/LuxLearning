// ─── ai-wizard-lesson-visuals.ts ──────────────────────────────────────────────
// Attaches ONE AI-generated infographic per module (not per lesson) + an honest,
// word-count-derived duration to every lesson from a bulk-generation batch.
//
// Trello DmPpbrff, 2026-08-31: first asked (15:19) for an image in every lesson —
// implemented that way, then reversed at 19:53: "se están creando un montón de
// imágenes... abstractas que no están generando ningún apoyo visual... no vuelvas
// a crear imágenes por cada módulo [sic — por cada lección]. Lo más que puedes
// hacer es una o dos imágenes por módulo, que tengan el concepto de infografía...
// Si quieres crear una imagen ilustrativa, la puedes hacer solo al inicio, en la
// primera lección." Also (19:58) wants LEGIBLE text in the image, not gibberish —
// generateLessonInfographic (Bedrock-authored SVG, real text elements, not a
// diffusion raster) satisfies that natively, no need to revisit the Stability-vs-
// Nova-Canvas decision Jason already made explicitly.
//
// Extracted out of ai-wizard-worker.ts to stay under the domain-module 600-line
// limit (CLAUDE.md).
import { generateLessonInfographic } from './ai-image-helpers';
import { lessonDurationLabel } from '../shared/reading-time';

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
 * Mutates `lessons` in place: generates ONE infographic image (best-effort — a
 * failed generation just leaves imageUrl null, never fails the batch) summarizing
 * the whole module's topics, attached to the FIRST lesson only, and overwrites
 * every lesson's `duration` with an honest estimate derived from its actual final
 * word count (content, including any appended bibliography/YouTube resources,
 * plus points and tip).
 */
export async function attachLessonVisuals(lessons: DraftLessonRow[], moduleTitle: string): Promise<void> {
  if (lessons.length > 0) {
    const overview = lessons.map((l) => l.title).filter(Boolean).join(', ');
    const url = await generateLessonInfographic(moduleTitle, moduleTitle, overview).catch(() => null);
    lessons[0]!.imageUrl = url;
  }
  for (const lesson of lessons) {
    lesson.duration = lessonDurationLabel(lesson.content, lesson.points, lesson.tip);
  }
}
