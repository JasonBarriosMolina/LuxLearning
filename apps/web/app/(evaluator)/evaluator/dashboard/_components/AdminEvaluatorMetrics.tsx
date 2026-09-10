'use client';

import { useEffect, useState } from 'react';
import { ClipboardCheck, Users2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';

interface EvaluatorStat {
  evaluatorId: string; name: string;
  coursesManaged: number; studentsManaged: number;
  totalReviewed: number; approved: number; rejected: number;
  avgHoursToReview: number | null;
}

// Trello DmPpbrff, 2026-09-07 (Mack): "el dashboard... solo brinda información
// acerca de los estudiantes... debería incluir información relevante... también
// de los evaluadores... métricas o indicadores clave que reflejen el avance."
// ADMIN-only — GET /admin/reports omits evaluatorStats entirely for an
// EVALUATOR caller (server-side gate in admin/reports.ts), so this panel is
// only ever mounted from the page when role is ADMIN/SUPER_ADMIN.
export function AdminEvaluatorMetrics() {
  const { t } = useLanguage();
  const [stats, setStats] = useState<EvaluatorStat[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.admin.reports()
      .then((res: any) => setStats(res?.data?.evaluatorStats ?? []))
      .catch(() => setStats([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <h2 className="font-heading font-bold text-base text-charcoal mb-4 flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-cta-from" />
        {t.adminDashboard.evaluatorMetricsTitle}
      </h2>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((n) => <div key={n} className="h-10 bg-gray-100 rounded animate-pulse" />)}
        </div>
      ) : !stats || stats.length === 0 ? (
        <div className="text-center py-8">
          <Users2 className="w-8 h-8 text-gray-200 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">{t.adminDashboard.noEvaluators}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-border">
                <th className="text-left pb-2 pr-3 font-semibold">{t.adminDashboard.colEvaluator}</th>
                <th className="text-center pb-2 px-3 font-semibold">{t.adminDashboard.colCourses}</th>
                <th className="text-center pb-2 px-3 font-semibold">{t.adminDashboard.colStudents}</th>
                <th className="text-center pb-2 px-3 font-semibold">{t.adminDashboard.colReviewed}</th>
                <th className="text-center pb-2 px-3 font-semibold">{t.adminDashboard.colApprovalRate}</th>
                <th className="text-right pb-2 pl-3 font-semibold">{t.adminDashboard.colAvgTime}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stats.map((s) => {
                const approvalPct = s.totalReviewed > 0 ? Math.round((s.approved / s.totalReviewed) * 100) : null;
                return (
                  <tr key={s.evaluatorId}>
                    <td className="py-2.5 pr-3 font-medium text-charcoal truncate max-w-[160px]">{s.name}</td>
                    <td className="py-2.5 px-3 text-center text-gray-600">{s.coursesManaged}</td>
                    <td className="py-2.5 px-3 text-center text-gray-600">{s.studentsManaged}</td>
                    <td className="py-2.5 px-3 text-center text-gray-600">{s.totalReviewed}</td>
                    <td className="py-2.5 px-3 text-center text-gray-600">{approvalPct != null ? `${approvalPct}%` : t.adminDashboard.noData}</td>
                    <td className="py-2.5 pl-3 text-right text-gray-600">{s.avgHoursToReview != null ? t.adminDashboard.hoursShort(s.avgHoursToReview) : t.adminDashboard.noData}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
