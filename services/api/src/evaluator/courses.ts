// Courses and students domain handler for lux-evaluator.
import { ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { EvalCtx, getCognitoUser, cognito, USER_POOL_ID } from './ctx';
import {
  getAllReflections, getAllLessonProgress, getAllQuizAttempts, getAllEnrollments,
  getLastSeenAll, getTasksByCourse,
} from '../shared/db-dynamo';
import { batchTranslate } from '../shared/translate';
import { ok } from '../shared/response';

export async function handleCourses(ctx: EvalCtx): Promise<any | null> {
  const { event, method, path, prisma, userId, isAdminRole } = ctx;

  // ── GET /evaluator/my-courses ───────────────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/my-courses') {
    const rawLang = event.queryStringParameters?.lang ?? 'es';
    const lang = ['en', 'es'].includes(rawLang) ? rawLang : 'es';

    const courses = await prisma.course.findMany({
      where: { evaluatorId: userId },
      include: { modules: { select: { id: true, title: true, order: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const allEnrollments = await getAllEnrollments();
    const allReflections = await getAllReflections();

    let enriched: any[] = courses.map((course: any) => {
      const enrollmentCount = allEnrollments.filter((e: any) => e.courseId === course.id).length;
      const pendingReflections = allReflections.filter(
        (r: any) => r.status === 'PENDING_EVAL' && course.modules.some((m: any) => m.id === r.moduleId)
      ).length;
      return {
        ...course,
        enrollmentCount,
        pendingReflections,
        groupChatId: `group_${course.id}`,
      };
    });

    if (lang !== 'es' && enriched.length > 0) {
      const translations = await batchTranslate(
        enriched.map((c) => ({ type: 'course' as const, id: c.id, fields: { title: c.title, description: c.description } })),
        lang
      );
      enriched = enriched.map((c) => {
        const t = translations.get(`course#${c.id}`);
        return t ? { ...c, title: (t.title as string) ?? c.title, description: (t.description as string) ?? c.description } : c;
      });
    }

    return ok(enriched);
  }

  // ── GET /evaluator/students ─────────────────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/students') {
    const courseIdFilter = event.queryStringParameters?.courseId ?? null;
    const [allProgress, allReflections, allAttempts, allEnrollments, courses, allLastSeen] = await Promise.all([
      getAllLessonProgress(),
      getAllReflections(),
      getAllQuizAttempts(),
      getAllEnrollments(),
      prisma.course.findMany({
        where: { ...(isAdminRole ? {} : { evaluatorId: userId }) },
        orderBy: { createdAt: 'asc' },
        include: {
          modules: {
            orderBy: { order: 'asc' },
            include: { lessons: { select: { id: true } } },
          },
        },
      }),
      getLastSeenAll(),
    ]);

    // Build lastSeen map — merge lesson completedAt + reflection submittedAt (fully paginated)
    // then override with heartbeat if more recent (heartbeat = actual browser activity)
    const lastSeenMap = new Map<string, string>();
    for (const p of allProgress) {
      if (!p.userId || !p.completedAt) continue;
      const prev = lastSeenMap.get(p.userId);
      if (!prev || p.completedAt > prev) lastSeenMap.set(p.userId, p.completedAt);
    }
    for (const r of allReflections) {
      if (!r.userId || !r.submittedAt) continue;
      const prev = lastSeenMap.get(r.userId);
      if (!prev || r.submittedAt > prev) lastSeenMap.set(r.userId, r.submittedAt);
    }
    for (const ls of allLastSeen) {
      if (!ls.userId || !ls.lastSeen) continue;
      const prev = lastSeenMap.get(ls.userId);
      if (!prev || ls.lastSeen > prev) lastSeenMap.set(ls.userId, ls.lastSeen);
    }
    const now = Date.now();
    const getPresenceStatus = (uid: string): 'online' | 'active' | 'inactive' => {
      const ls = lastSeenMap.get(uid);
      if (!ls) return 'inactive';
      const diffMs = now - new Date(ls).getTime();
      if (diffMs < 5 * 60 * 1000) return 'online';       // < 5 min = online
      if (diffMs < 72 * 60 * 60 * 1000) return 'active'; // < 72h = active
      return 'inactive';
    };

    // Build per-student maps
    type StudentAccum = {
      userId: string;
      completedLessons: Record<string, Set<string>>; // courseId -> Set<lessonId>
      quizPassed: Set<string>;                        // moduleId
      reflections: Record<string, string>;            // moduleId -> status
    };

    const byStudent = new Map<string, StudentAccum>();

    const getOrCreate = (uid: string): StudentAccum => {
      if (!byStudent.has(uid)) {
        byStudent.set(uid, { userId: uid, completedLessons: {}, quizPassed: new Set(), reflections: {} });
      }
      return byStudent.get(uid)!;
    };

    // Only consider enrollments in this evaluator's courses
    const myCourseIds = new Set(courses.map((c: any) => c.id));
    const myEnrollments = allEnrollments.filter((e: any) => myCourseIds.has(e.courseId));

    // Seed all enrolled students so they appear even with 0 activity
    myEnrollments.forEach((e: any) => getOrCreate(e.userId));

    allProgress.forEach((p: any) => {
      const s = getOrCreate(p.userId);
      if (!s.completedLessons[p.courseId]) s.completedLessons[p.courseId] = new Set();
      s.completedLessons[p.courseId]!.add(p.lessonId);
    });

    allAttempts.forEach((a: any) => {
      if (a.passed) getOrCreate(a.userId).quizPassed.add(a.moduleId);
    });

    allReflections.forEach((r: any) => {
      getOrCreate(r.userId).reflections[r.moduleId] = r.status;
    });

    // Build enrollment map: userId -> Set<courseId> (only this evaluator's courses)
    const enrollmentMap = new Map<string, Set<string>>();
    myEnrollments.forEach((e: any) => {
      if (!enrollmentMap.has(e.userId)) enrollmentMap.set(e.userId, new Set());
      enrollmentMap.get(e.userId)!.add(e.courseId);
    });

    const students = await Promise.all(Array.from(byStudent.values()).map(async (s) => {
      const cognitoUser = await getCognitoUser(s.userId);
      const studentName = cognitoUser?.name ?? s.userId;
      const studentEmail = cognitoUser?.email ?? null;
      const enrolledCourseIds = enrollmentMap.get(s.userId) ?? new Set<string>();
      const visibleCourses = enrolledCourseIds.size > 0
        ? courses.filter((c: any) => enrolledCourseIds.has(c.id))
        : courses;

      const courseStats = visibleCourses.map((course: any) => {
        const allLessonIds = course.modules.flatMap((m: any) => m.lessons.map((l: any) => l.id));
        const completedSet = s.completedLessons[course.id] ?? new Set<string>();
        const completedCount = allLessonIds.filter((id: string) => completedSet.has(id)).length;

        const moduleStats = course.modules.map((mod: any) => ({
          moduleId: mod.id,
          title: mod.title,
          order: mod.order,
          totalLessons: mod.lessons.length,
          completedLessons: mod.lessons.filter((l: any) => completedSet.has(l.id)).length,
          quizPassed: s.quizPassed.has(mod.id),
          reflectionStatus: s.reflections[mod.id] ?? null,
        }));

        return {
          courseId: course.id,
          title: course.title,
          totalLessons: allLessonIds.length,
          completedLessons: completedCount,
          progressPct: allLessonIds.length > 0 ? Math.round((completedCount / allLessonIds.length) * 100) : 0,
          modulesApproved: moduleStats.filter((m: any) => m.reflectionStatus === 'APPROVED').length,
          modules: moduleStats,
        };
      });

      const lastSeen = lastSeenMap.get(s.userId) ?? null;
      const presenceStatus = getPresenceStatus(s.userId);
      return { userId: s.userId, studentName, studentEmail, courses: courseStats, lastSeen, presenceStatus };
    }));

    // Filter out non-STUDENT users (evaluators, admins who may have enrollments/heartbeats) —
    // role lives in Cognito Groups, not a custom attribute, so list group members directly.
    const listAllInGroup = async (GroupName: string) => {
      const all: NonNullable<Awaited<ReturnType<typeof cognito.send>>['Users']>[number][] = [];
      let token: string | undefined;
      do {
        const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName, Limit: 60, NextToken: token }));
        all.push(...(res.Users ?? []));
        token = res.NextToken;
      } while (token);
      return all;
    };
    const [evaluatorUsers, adminUsers] = await Promise.all([
      listAllInGroup('EVALUATOR'),
      listAllInGroup('ADMIN'),
    ]);
    const nonStudentUsernames = new Set([...evaluatorUsers, ...adminUsers].map((u) => u.Username));
    const studentsOnly = students.filter((s) => !nonStudentUsernames.has(s.userId));

    // Sort: online first, then active, then inactive, then by progress
    const statusOrder = { online: 0, active: 1, inactive: 2 };
    studentsOnly.sort((a, b) => {
      const sA = statusOrder[a.presenceStatus as keyof typeof statusOrder] ?? 2;
      const sB = statusOrder[b.presenceStatus as keyof typeof statusOrder] ?? 2;
      if (sA !== sB) return sA - sB;
      const pA = a.courses.reduce((sum: number, c: any) => sum + c.progressPct, 0);
      const pB = b.courses.reduce((sum: number, c: any) => sum + c.progressPct, 0);
      return pB - pA;
    });

    let tasksByCourse: Record<string, { pending: number; overdue: number; completed: number }> = {};
    if (courseIdFilter) {
      const tasks = await getTasksByCourse(courseIdFilter);
      for (const task of tasks) {
        if (!tasksByCourse[task.userId]) tasksByCourse[task.userId] = { pending: 0, overdue: 0, completed: 0 };
        if (task.status === 'PENDING' || task.status === 'SUBMITTED') tasksByCourse[task.userId]!.pending++;
        else if (task.status === 'OVERDUE') tasksByCourse[task.userId]!.overdue++;
        else if (task.status === 'COMPLETED') tasksByCourse[task.userId]!.completed++;
      }
    }

    return ok({
      students: studentsOnly.map((s) => ({ ...s, taskCounts: tasksByCourse[s.userId] ?? null })),
      courses: courses.map((c: any) => ({ id: c.id, title: c.title })),
    });
  }

  return null; // not handled by this domain
}
