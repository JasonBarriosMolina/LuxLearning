// ─── moduleStatus.ts ────────────────────────────────────────────────────────────
// Pure extraction of page.tsx's getModuleStatus decision (page.tsx can't export
// anything beyond Next's reserved names without breaking `tsc --noEmit` — see
// CLAUDE.md/project_tech_debt — so this lives in a sibling file, same pattern as
// lessonHighlights.ts / reorder.ts elsewhere in this app).
//
// Trello DmPpbrff, 2026-09-06 (Mack): "si todavía hay pendiente una entrevista, no
// debería poder continuar al siguiente módulo... veo el botón de continuar, pero no
// me deja." The old inline version returned "completed" the moment reflectionStatus
// was APPROVED, never checking whether a planned interview had actually been
// completed — the "Continuar con el Módulo N" CTA showed (and was clickable) while
// the interview was still pending/in review.

export type ModuleStatusVariant = 'success' | 'pending' | 'info' | 'error' | 'default' | 'warning';

// Matches the labelKey exactly to a key on t.moduleView so callers can do
// `t.moduleView[labelKey]` without a separate lookup table to keep in sync.
export type ModuleStatusLabelKey =
  | 'statusCompleted' | 'statusInReview' | 'reflectionStatusPendingAi' | 'reflectionStatusRejected'
  | 'statusPendingLessons' | 'statusPendingClass' | 'statusPendingQuiz'
  | 'statusPendingReflection' | 'statusPendingInterview';

export interface ModuleStatusInput {
  reflectionStatus: string | null | undefined;
  blockingStep: 'lessons' | 'class' | 'quiz' | null;
  hasReflectionPlanned: boolean;
  hasInterviewPlanned: boolean;
  /** true when no interview is planned OR the latest one has status 'completed'. */
  interviewDone: boolean;
}

export function computeModuleStatus(input: ModuleStatusInput): { labelKey: ModuleStatusLabelKey; variant: ModuleStatusVariant } {
  const { reflectionStatus, blockingStep, hasReflectionPlanned, hasInterviewPlanned, interviewDone } = input;

  if (reflectionStatus === 'APPROVED' && interviewDone) return { labelKey: 'statusCompleted', variant: 'success' };
  if (reflectionStatus === 'APPROVED' && hasInterviewPlanned) return { labelKey: 'statusPendingInterview', variant: 'warning' };
  if (reflectionStatus === 'PENDING_EVAL') return { labelKey: 'statusInReview', variant: 'pending' };
  if (reflectionStatus === 'PENDING_AI') return { labelKey: 'reflectionStatusPendingAi', variant: 'info' };
  if (reflectionStatus === 'REJECTED') return { labelKey: 'reflectionStatusRejected', variant: 'error' };
  if (blockingStep === 'lessons') return { labelKey: 'statusPendingLessons', variant: 'default' };
  if (blockingStep === 'class') return { labelKey: 'statusPendingClass', variant: 'default' };
  if (blockingStep === 'quiz') return { labelKey: 'statusPendingQuiz', variant: 'default' };
  // blockingStep === null — every planned prerequisite before reflection cleared
  if (hasReflectionPlanned) return { labelKey: 'statusPendingReflection', variant: 'warning' };
  return { labelKey: 'statusCompleted', variant: 'success' };
}
