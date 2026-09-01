// ─── ai-wizard-carousel-phase.ts ──────────────────────────────────────────────
// Automatic per-module Lux Carrousel generation, run as its own phase inside the
// bulk course-generation worker (Trello DmPpbrff, 2026-08-31 14:02 — Mack: "los
// carruseles no solo se pueden crear manualmente, sino que deberían incluirse
// automáticamente en la creación del curso... podría ser en la penúltima lección
// de cada módulo... que el cierre se haga con una lección escrita como ya existe").
//
// Reverses the earlier "opt-in por módulo" decision for the BULK pipeline only —
// the manual Mini Wizard (carousel.ts / LuxCarrouselWizard.tsx) still exists
// unchanged for one-off/retry use. Phase order (per the 14:02 comment): runs after
// quizzes AND reflections, before Lux Mentor classes.
import { draftCarouselScript } from './carousel';
import { generateCarouselAssets } from './carousel-worker';

/**
 * Drafts a script and generates full carousel assets for one module, inserting the
 * result as that module's PENULTIMATE lesson (shifting the existing last lesson —
 * the written closing lesson — one slot later). Non-fatal on any failure: logs and
 * returns, same pattern as the other phase functions in ai-wizard-worker.ts — a
 * failed carousel must never block or fail the rest of course generation. Returns
 * the carousel's real computed duration (minutes) on success — callers use this
 * to add the ACTUAL narration length to the module's stored duration total,
 * instead of a flat guess (found in code review, 2026-09-01: a flat "+6 min" was
 * exactly the "duration doesn't match real content" bug this session fixed
 * elsewhere) — or `false` when skipped/failed.
 *
 * Idempotent and safe to call again for every module after the completeness
 * sweep (ai-wizard-repair.ts) has run — a module that had 0 lessons on the first
 * pass (skipped below) may have real lessons by then; a module that already got
 * its carousel is a no-op via the existingCarousel guard (found in code review:
 * the sweep only repairs lessons/quiz, never retries carousel generation, so a
 * transiently-empty module used to permanently miss its carousel).
 */
export async function generateModuleCarousel(
  prisma: any,
  courseId: string,
  moduleId: string,
  courseLanguage: string,
): Promise<number | false> {
  try {
    const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true, description: true } });
    if (!mod) return false;

    // Idempotency guard (Trello DmPpbrff, 2026-08-31 19:49 — Mack: carousels were
    // generating up to 3x per module because course regeneration re-runs this whole
    // phase against a course that already has one). A module should get AT MOST ONE
    // auto-generated carousel; re-running the bulk pipeline must never add another.
    const existingCarousel = await prisma.lesson.count({ where: { moduleId, type: 'carousel' } });
    if (existingCarousel > 0) {
      return false;
    }

    const lessonCount = await prisma.lesson.count({ where: { moduleId } });
    if (lessonCount === 0) {
      // No written lessons yet — nothing to be "penultimate" to. Not necessarily
      // permanent: the caller re-runs this phase after the completeness sweep,
      // by which point repaired modules will have real lessons.
      return false;
    }

    const draft = await draftCarouselScript(mod, undefined, moduleId);
    if (!draft) {
      console.error(`[carousel-phase] module ${moduleId}: script draft failed`);
      return false;
    }

    // Penultimate = current last lesson's order (that lesson shifts to lessonCount+1).
    const insertAtOrder = lessonCount;
    const result = await generateCarouselAssets(prisma, moduleId, draft.slides, courseLanguage, insertAtOrder);
    if (!result) {
      console.error(`[carousel-phase] module ${moduleId}: asset generation failed`);
      return false;
    }
    return result.durationMin;
  } catch (e) {
    console.error(`[carousel-phase] module ${moduleId} error:`, e);
    return false;
  }
}
