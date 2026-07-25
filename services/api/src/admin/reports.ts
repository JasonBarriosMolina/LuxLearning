// Reports domain handler for lux-admin.
import { getAllReflections, getAllLessonProgress, getAllEnrollments } from '../shared/db-dynamo';
import { ok } from '../shared/response';
import { AdminCtx } from './ctx';

export async function handleReports(ctx: AdminCtx): Promise<any | null> {
  const { method, path, prisma } = ctx;

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

    return ok({
      summary: { totalReflections, totalApproved, totalRejected, totalPending, overallApprovalRate, totalEnrolled, activeStudents, atRiskStudents, avgQuality },
      moduleStats,
    });
  }

  return null; // not handled by this domain
}
