'use client';

import { BarChart2 } from 'lucide-react';

type ModuleStat = {
  moduleId: string; title: string; courseTitle: string; total: number;
  approved: number; rejected: number; approvalRate: number | null; avgHoursToReview: number | null;
};

interface Props {
  moduleStats: ModuleStat[];
  labels: {
    title: string;
    colModule: string;
    colCourse: string;
    colTotal: string;
    colRate: string;
    colAvgReview: string;
  };
}

export function ModuleStatsTable({ moduleStats, labels }: Props) {
  if (moduleStats.length === 0) return null;
  return (
    <div className="card">
      <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
        <BarChart2 className="w-5 h-5 text-cta-from" /> {labels.title}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-gray-500">
              <th className="text-left py-2 pr-4 font-semibold">{labels.colModule}</th>
              <th className="text-left py-2 pr-4 font-semibold hidden sm:table-cell">{labels.colCourse}</th>
              <th className="text-right py-2 pr-4 font-semibold">{labels.colTotal}</th>
              <th className="text-right py-2 pr-4 font-semibold">{labels.colRate}</th>
              <th className="text-right py-2 font-semibold">{labels.colAvgReview}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {moduleStats.map((m) => {
              const rate = m.approvalRate;
              const rc = rate == null ? 'text-gray-400' : rate >= 70 ? 'text-emerald-600' : rate >= 40 ? 'text-amber-600' : 'text-red-600';
              return (
                <tr key={m.moduleId} className="hover:bg-surface transition-colors">
                  <td className="py-3 pr-4 font-medium text-charcoal">{m.title}</td>
                  <td className="py-3 pr-4 text-gray-500 hidden sm:table-cell">{m.courseTitle}</td>
                  <td className="py-3 pr-4 text-right">{m.total}</td>
                  <td className={`py-3 pr-4 text-right font-bold ${rc}`}>{rate != null ? `${rate}%` : '—'}</td>
                  <td className="py-3 text-right text-gray-600">{m.avgHoursToReview != null ? `${m.avgHoursToReview}h` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
