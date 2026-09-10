// Reports domain handler for lux-admin.
import { ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getAllReflections, getAllLessonProgress, getAllEnrollments } from '../shared/db-dynamo';
import { ok } from '../shared/response';
import { AdminCtx, isAdmin, cognito, USER_POOL_ID } from './ctx';

// Trello DmPpbrff, 2026-09-07 (Mack): "el dashboard... solo brinda información
// acerca de los estudiantes... debería incluir información relevante... también
// de los evaluadores." Admin-only (evaluators don't need visibility into peers'
// review load) — built from data this handler already fetches for the student-
// facing summary above, plus one paginated Cognito group listing for names.
async function buildEvaluatorStats(
  allReflections: any[], allEnrollments: any[], courses: any[],
): Promise<{ evaluatorId: string; name: string; coursesManaged: number; studentsManaged: number; totalReviewed: number; approved: number; rejected: number; avgHoursToReview: number | null }[]> {
  const evaluators: { Username?: string; Attributes?: { Name?: string; Value?: string }[] }[] = [];
  let token: string | undefined;
  do {
    const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: 'EVALUATOR', Limit: 60, NextToken: token }));
    evaluators.push(...(res.Users ?? []));
    token = res.NextToken;
  } while (token);

  const attr = (u: { Attributes?: { Name?: string; Value?: string }[] }, name: string) =>
    u.Attributes?.find((a) => a.Name === name)?.Value ?? '';

  return evaluators.filter((u) => u.Username).map((u) => {
    const evaluatorId = u.Username!;
    const name = attr(u, 'name') || attr(u, 'email') || evaluatorId;

    const ownCourses = courses.filter((c: any) => c.evaluatorId === evaluatorId);
    const ownCourseIds = new Set(ownCourses.map((c: any) => c.id));
    const studentsManaged = new Set(allEnrollments.filter((e: any) => ownCourseIds.has(e.courseId)).map((e: any) => e.userId)).size;

    const ownReflections = allReflections.filter((r: any) => r.evaluatorId === evaluatorId);
    const reviewed = ownReflections.filter((r: any) => r.status === 'APPROVED' || r.status === 'REJECTED');
    let totalReviewTime = 0; let reviewedWithTime = 0;
    reviewed.forEach((r: any) => {
      if (!r.reviewedAt || !r.submittedAt) return;
      const ms = new Date(r.reviewedAt).getTime() - new Date(r.submittedAt).getTime();
      if (ms > 0) { totalReviewTime += ms; reviewedWithTime++; }
    });

    return {
      evaluatorId, name,
      coursesManaged: ownCourses.length,
      studentsManaged,
      totalReviewed: reviewed.length,
      approved: reviewed.filter((r: any) => r.status === 'APPROVED').length,
      rejected: reviewed.filter((r: any) => r.status === 'REJECTED').length,
      avgHoursToReview: reviewedWithTime > 0 ? Math.round(totalReviewTime / reviewedWithTime / 3600000 * 10) / 10 : null,
    };
  }).sort((a, b) => b.totalReviewed - a.totalReviewed);
}

export async function handleReports(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma } = ctx;

  // ── GET /admin/reports ──────────────────────────────────────────────────────
  if (path === '/admin/reports' && method === 'GET') {
    // Both EVALUATOR and ADMIN can view reports

    const [allReflections, allProgress, allEnrollments, courses] = await Promise.all([
      getAllReflections(),
      getAllLessonProgress(),
      getAllEnrollments(),
      prisma.course.findMany({
        include: {
          modules: {
            orderBy: { order: 'asc' },
            include: { lessons: { select: { id: true } } },
          },
        },
      }),
    ]);

    // ── Tasa de aprobación por módulo ──────────────────────────────────────────
    const moduleMap = new Map<string, { title: string; courseTitle: string; total: number; approved: number; rejected: number; avgDaysToReview: number; totalReviewTime: number; reviewedCount: number }>();
    courses.forEach((c: any) =>
      c.modules.forEach((m: any) => moduleMap.set(m.id, { title: m.title, courseTitle: c.title, total: 0, approved: 0, rejected: 0, avgDaysToReview: 0, totalReviewTime: 0, reviewedCount: 0 }))
    );

    allReflections.forEach((r: any) => {
      const entry = moduleMap.get(r.moduleId);
      if (!entry) return;
      entry.total++;
      if (r.status === 'APPROVED') entry.approved++;
      if (r.status === 'REJECTED') entry.rejected++;
      if ((r.status === 'APPROVED' || r.status === 'REJECTED') && r.reviewedAt && r.submittedAt) {
        const ms = new Date(r.reviewedAt).getTime() - new Date(r.submittedAt).getTime();
        if (ms > 0) {
          entry.totalReviewTime += ms;
          entry.reviewedCount++;
        }
      }
    });

    const moduleStats = Array.from(moduleMap.entries()).map(([moduleId, e]) => ({
      moduleId,
      title: e.title,
      courseTitle: e.courseTitle,
      total: e.total,
      approved: e.approved,
      rejected: e.rejected,
      approvalRate: e.total > 0 ? Math.round((e.approved / e.total) * 100) : null,
      avgHoursToReview: e.reviewedCount > 0 ? Math.round(e.totalReviewTime / e.reviewedCount / 3600000 * 10) / 10 : null,
    })).filter((m) => m.total > 0).sort((a, b) => (b.approvalRate ?? 0) - (a.approvalRate ?? 0));

    // ── Estudiantes en riesgo (inscrito, sin actividad en >7 días) ─────────────
    const INACTIVITY_DAYS = 7;
    const now = Date.now();
    const lastActivityByStudent = new Map<string, number>();

    allProgress.forEach((p: any) => {
      const t = new Date(p.completedAt).getTime();
      if (!lastActivityByStudent.has(p.userId) || t > lastActivityByStudent.get(p.userId)!) {
        lastActivityByStudent.set(p.userId, t);
      }
    });
    allReflections.forEach((r: any) => {
      const t = new Date(r.submittedAt).getTime();
      if (!lastActivityByStudent.has(r.userId) || t > lastActivityByStudent.get(r.userId)!) {
        lastActivityByStudent.set(r.userId, t);
      }
    });

    const enrolledUserIds: string[] = [...new Set(allEnrollments.map((e: any) => e.userId as string))] as string[];
    const atRiskStudents = enrolledUserIds.filter((uid: string) => {
      const last = lastActivityByStudent.get(uid);
      if (!last) return true; // never active
      return (now - last) / 86400000 > INACTIVITY_DAYS;
    }).length;

    // ── Totals ─────────────────────────────────────────────────────────────────
    const totalReflections = allReflections.length;
    const totalApproved = allReflections.filter((r: any) => r.status === 'APPROVED').length;
    const totalRejected = allReflections.filter((r: any) => r.status === 'REJECTED').length;
    const totalPending = allReflections.filter((r: any) => r.status === 'PENDING_EVAL').length;
    const overallApprovalRate = totalReflections > 0 ? Math.round((totalApproved / totalReflections) * 100) : 0;
    const totalEnrolled = enrolledUserIds.length;
    const activeStudents = enrolledUserIds.filter((uid: string) => {
      const last = lastActivityByStudent.get(uid);
      return last && (now - last) / 86400000 <= 7;
    }).length;

    // ── Avg quality score ──────────────────────────────────────────────────────
    const scored = allReflections.filter((r: any) => r.qualityScore != null);
    const avgQuality = scored.length > 0
      ? Math.round(scored.reduce((sum: any, r: any) => sum + (r.qualityScore ?? 0), 0) / scored.length * 10) / 10
      : null;

    const evaluatorStats = isAdmin(event) ? await buildEvaluatorStats(allReflections, allEnrollments, courses) : undefined;

    return ok({
      summary: { totalReflections, totalApproved, totalRejected, totalPending, overallApprovalRate, totalEnrolled, activeStudents, atRiskStudents, avgQuality },
      moduleStats,
      evaluatorStats,
    });
  }

  return null; // not handled by this domain
}
