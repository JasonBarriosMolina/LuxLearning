// Pure prerequisite-gate logic for the course dashboard's evaluation-plan table.
// Mirrors the module page's blockingStep hierarchy (lessons → class → quiz →
// reflection → interview) — extracted so "Ir al quiz"/"Presentar" can be gated
// here too instead of always rendering regardless of prior progress
// (Trello DmPpbrff item 3, 2026-08-30 20:18).

export type BlockingStep = 'lessons' | 'class' | 'quiz' | null;

export interface ModulePrereqResult {
  blockingStep: BlockingStep;
  quizReady: boolean;
  interviewReady: boolean;
}

interface ModuleLike {
  id: string;
  lessons?: { completed?: boolean }[];
  classCompleted?: boolean;
  quizPassed?: boolean;
  reflectionStatus?: string | null;
}

interface EvalEventLike {
  moduleId?: string | null;
  type: string;
}

export function getModulePrereq(
  moduleId: string,
  modules: ModuleLike[] | undefined,
  evaluationEvents: EvalEventLike[] | undefined,
): ModulePrereqResult {
  const mod = modules?.find((m) => m.id === moduleId);
  if (!mod) return { blockingStep: 'lessons', quizReady: false, interviewReady: false };

  const modLessons = mod.lessons ?? [];
  const allLessonsDone = modLessons.length > 0 && modLessons.every((l) => l.completed);
  const modEvents = (evaluationEvents ?? []).filter((e) => e.moduleId === moduleId);
  const hasClassPlanned = modEvents.some((e) => e.type === 'CLASS');
  const hasQuizPlanned = modEvents.some((e) => e.type === 'QUIZ');
  const hasReflectionPlanned = modEvents.some((e) => e.type === 'REFLECTION');

  const blockingStep: BlockingStep =
    !allLessonsDone ? 'lessons'
    : (hasClassPlanned && !mod.classCompleted) ? 'class'
    : (hasQuizPlanned && !mod.quizPassed) ? 'quiz'
    : null;

  const quizReady = blockingStep === 'quiz' || blockingStep === null;
  const interviewReady = hasReflectionPlanned ? mod.reflectionStatus === 'APPROVED' : quizReady;

  return { blockingStep, quizReady, interviewReady };
}
