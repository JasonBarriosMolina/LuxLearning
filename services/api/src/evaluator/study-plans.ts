// ─── evaluator/study-plans.ts ────────────────────────────────────────────────
// Evaluator route: generate a locked study plan for a student.
import { createId } from '@paralleldrive/cuid2';
import { ok, badRequest } from '../shared/response';
import {
  getStudyPlan, getStudyPlans, saveStudyPlan, updateStudyPlanField, removeStudyPlanAttributes,
  getStudyPlansBatch, getMonday, type StudyPlan, type DayPlan, type PlanItem,
} from '../shared/db-study-plans';
import { getAllEnrollments, getEnrollments, getLessonProgress, getAllQuizAttemptsForUser, createNotification } from '../shared/db-dynamo';
import { resolveStudentContact } from './ctx';
import { isModuleUnlocked } from '../shared/db-progress';
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
      // Auto-generate from student progress — only include accessible (unlocked) modules
      let dayIndex = 0;
      for (const course of courses) {
        const moduleRefs = (course as any).modules.map((m: any) => ({ id: m.id, order: m.order }));
        for (const mod of (course as any).modules) {
          const unlocked = await isModuleUnlocked(studentId!, mod.order, moduleRefs);
          if (!unlocked) break; // Sequential lock — all further modules are also locked

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
      ...(note ? { mentorNote: String(note).slice(0, 500) } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveStudyPlan(plan);

    // Notify student
    const noteMsg = note ? ` Nota del mentor: "${String(note).slice(0, 100)}"` : '';
    await createNotification({
      userId: studentId!,
      notifId: `splan-lock-${createId()}`,
      type: 'STUDY_PLAN_LOCKED',
      message: `Tu evaluador generó un plan de estudio para la semana del ${weekOf}. Está en modo solo lectura.${noteMsg}`,
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

  // GET /evaluator/study-plan/compliance — students with < 50% plan completion this week
  if (method === 'GET' && path === '/evaluator/study-plan/compliance') {
    const weekOf = getMonday();

    // Get evaluator's courses
    const courses = await prisma.course.findMany({
      where: isAdminRole ? {} : { evaluatorId: userId },
      select: { id: true, title: true },
    });
    const courseIds = new Set(courses.map((c: any) => c.id));
    if (courseIds.size === 0) return ok({ weekOf, compliance: [] });

    // Get all enrolled students for those courses
    const allEnrollments = await getAllEnrollments().catch(() => [] as any[]);
    const studentIds = [...new Set(
      allEnrollments
        .filter((e: any) => courseIds.has(e.courseId))
        .map((e: any) => e.userId as string)
    )];
    if (studentIds.length === 0) return ok({ weekOf, compliance: [] });

    // Batch-get study plans for current week
    const plans = await getStudyPlansBatch(studentIds, weekOf);

    // Calculate compliance — only flag plans with items and < 50% done
    const THRESHOLD = 0.5;
    const compliance = await Promise.all(
      plans
        .map((plan) => {
          const totalItems = plan.days.reduce((s, d) => s + d.items.length, 0);
          const completedItems = plan.days.reduce(
            (s, d) => s + d.items.filter((i) => i.completed).length, 0
          );
          const completionPct = totalItems === 0 ? 1 : completedItems / totalItems;
          return { plan, totalItems, completedItems, completionPct };
        })
        .filter(({ totalItems, completionPct }) => totalItems > 0 && completionPct < THRESHOLD)
        .map(async ({ plan, totalItems, completedItems, completionPct }) => {
          const contact = await resolveStudentContact(plan.userId, {}).catch(() => ({ name: plan.userId, email: '' }));
          return {
            userId: plan.userId,
            studentName: contact.name,
            studentEmail: contact.email,
            weekOf,
            totalItems,
            completedItems,
            completionPct: Math.round(completionPct * 100),
            hasLock: !!plan.lockedBy,
          };
        })
    );

    return ok({ weekOf, compliance });
  }

  return null;
}
