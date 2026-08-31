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
 * whether a carousel lesson was actually created — callers use this to add the
 * carousel's ~6 min to the module's stored duration total.
 */
export async function generateModuleCarousel(
  prisma: any,
  courseId: string,
  moduleId: string,
  courseLanguage: string,
): Promise<boolean> {
  try {
    const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true, description: true } });
    if (!mod) return false;

    // Idempotency guard (Trello DmPpbrff, 2026-08-31 19:49 — Mack: carousels were
    // generating up to 3x per module because course regeneration re-runs this whole
    // phase against a course that already has one). A module should get AT MOST ONE
    // auto-generated carousel; re-running the bulk pipeline must never add another.
    const existingCarousel = await prisma.lesson.count({ where: { moduleId, type: 'carousel' } });
    if (existingCarousel > 0) {
      console.log(`[carousel-phase] module ${moduleId}: already has a carousel, skipping`);
      return false;
    }

    const lessonCount = await prisma.lesson.count({ where: { moduleId } });
    if (lessonCount === 0) {
      // No written lessons yet (Phase 1 failed for this module) — nothing to be
      // "penultimate" to. Skip; the completeness sweep already flags this module.
      console.warn(`[carousel-phase] module ${moduleId}: no lessons found, skipping auto-carousel`);
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
    return true;
  } catch (e) {
    console.error(`[carousel-phase] module ${moduleId} error:`, e);
    return false;
  }
}
