// ─── evaluator/study-plans.ts ────────────────────────────────────────────────
// Evaluator route: generate a locked study plan for a student.
import { createId } from '@paralleldrive/cuid2';
import { ok, badRequest } from '../shared/response';
import {
  getStudyPlan, getStudyPlans, saveStudyPlan, updateStudyPlanField, removeStudyPlanAttributes,
  getMonday, type StudyPlan, type DayPlan, type PlanItem,
} from '../shared/db-study-plans';
import { getEnrollments, getLessonProgress, getAllQuizAttemptsForUser, createNotification } from '../shared/db-dynamo';
import type { EvalCtx } from './ctx';

function buildEmptyDays(weekOf: string): DayPlan[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekOf + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return { dayIndex: i, date: d.toISOString().slice(0, 10), items: [] };
  });
}

export async function handleEvalStudyPlans(ctx: EvalCtx): Promise<any | null> {
  const { method, path, body, userId, prisma, isAdminRole } = ctx;

  // POST /evaluator/students/:studentId/study-plan — generate locked plan
  const genMatch = path.match(/^\/evaluator\/students\/([^/]+)\/study-plan$/);
  if (genMatch && method === 'POST') {
    const [, studentId] = genMatch;
    const { weekOf: weekParam, items, note } = body as {
      weekOf?: string;
      items?: Array<{ dayIndex: number; title: string; type?: string; description?: string; estimatedMinutes?: number; courseId?: string; moduleId?: string }>;
      note?: string;
    };

    const weekOf = weekParam ?? getMonday();

    // Build course data for the student
    const [courseIds, quizAttempts] = await Promise.all([
      getEnrollments(studentId!),
      getAllQuizAttemptsForUser(studentId!),
    ]);

    const courses = courseIds.length > 0
      ? await prisma.course.findMany({
          where: { id: { in: courseIds } },
          include: { modules: { orderBy: { order: 'asc' }, include: { lessons: { select: { id: true, title: true }, orderBy: { order: 'asc' } } } } },
        })
      : [];

    const progressResults = await Promise.all(courseIds.map((cid: string) => getLessonProgress(studentId!, cid)));
    const completedLessonIds = new Set(progressResults.flat().map((p: any) => p.lessonId));
    const passedModuleIds = new Set(quizAttempts.filter((a: any) => a.passed).map((a: any) => a.moduleId));

    const days = buildEmptyDays(weekOf);

    // If evaluator provided custom items use those, otherwise auto-generate
    if (items && items.length > 0) {
      for (const item of items) {
        const dayIdx = Math.max(0, Math.min(6, item.dayIndex));
        days[dayIdx].items.push({
          id: createId(),
          type: (item.type as any) ?? 'custom',
          title: String(item.title).slice(0, 120),
          description: item.description ? String(item.description).slice(0, 300) : undefined,
          courseId: item.courseId,
          moduleId: item.moduleId,
          pinned: true,
          completed: false,
          estimatedMinutes: item.estimatedMinutes ?? 30,
          source: 'evaluator',
        });
      }
    } else {
      // Auto-generate from student progress
      let dayIndex = 0;
      for (const course of courses) {
        for (const mod of (course as any).modules) {
          if (passedModuleIds.has(mod.id)) continue;
          const pendingLessons = mod.lessons.filter((l: any) => !completedLessonIds.has(l.id));
          const needsQuiz = pendingLessons.length === 0 && !passedModuleIds.has(mod.id);

          for (const lesson of pendingLessons.slice(0, 5)) {
            const targetDay = Math.min(dayIndex % 5, 4);
            days[targetDay].items.push({
              id: createId(),
              type: 'lesson',
              title: lesson.title,
              description: `Módulo: ${mod.title} — ${course.title}`,
              courseId: course.id,
              moduleId: mod.id,
              lessonId: lesson.id,
              pinned: true,
              completed: false,
              estimatedMinutes: 30,
              source: 'evaluator',
            });
            dayIndex++;
          }

          if (needsQuiz) {
            const targetDay = Math.min(dayIndex % 5, 4);
            days[targetDay].items.push({
              id: createId(),
              type: 'quiz',
              title: `Quiz — ${mod.title}`,
              description: `Quiz pendiente en ${course.title}`,
              courseId: course.id,
              moduleId: mod.id,
              pinned: true,
              completed: false,
              estimatedMinutes: 20,
              source: 'evaluator',
            });
            dayIndex++;
          }
        }
      }
    }

    const existing = await getStudyPlan(studentId!, weekOf);

    const plan: StudyPlan = {
      userId: studentId!,
      weekOf,
      planId: existing?.planId ?? createId(),
      days,
      lockedBy: userId,
      changeRequested: false,
      generatedBy: 'evaluator',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveStudyPlan(plan);

    // Notify student
    await createNotification({
      userId: studentId!,
      notifId: `splan-lock-${createId()}`,
      type: 'STUDY_PLAN_LOCKED',
      message: `Tu evaluador generó un plan de estudio para la semana del ${weekOf}. Está en modo solo lectura.`,
      actionUrl: '/plan',
      read: false,
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    return ok({ plan });
  }

  // GET /evaluator/students/:studentId/study-plan?weeks=N
  const getMatch = path.match(/^\/evaluator\/students\/([^/]+)\/study-plan$/);
  if (getMatch && method === 'GET') {
    const [, studentId] = getMatch;
    const weeksParam = ctx.event.queryStringParameters?.weeks;
    const plans = await getStudyPlans(studentId!, Math.min(parseInt(weeksParam ?? '4', 10), 12));
    return ok(plans);
  }

  // POST /evaluator/students/:studentId/study-plan/unlock — remove lock
  const unlockMatch = path.match(/^\/evaluator\/students\/([^/]+)\/study-plan\/unlock$/);
  if (unlockMatch && method === 'POST') {
    const [, studentId] = unlockMatch;
    const { weekOf: weekParam } = body as { weekOf?: string };
    const weekOf = weekParam ?? getMonday();
    await removeStudyPlanAttributes(studentId!, weekOf, ['lockedBy', 'lockedByName', 'changeRequested', 'changeRequestNote']);
    await updateStudyPlanField(studentId!, weekOf, { updatedAt: new Date().toISOString() });
    await createNotification({
      userId: studentId!,
      notifId: `splan-unlock-${createId()}`,
      type: 'STUDY_PLAN_UNLOCKED',
      message: 'Tu evaluador desbloqueó tu plan de estudio. Ya puedes editarlo.',
      actionUrl: '/plan',
      read: false,
      createdAt: new Date().toISOString(),
    }).catch(() => {});
    return ok({ unlocked: true });
  }

  return null;
}
