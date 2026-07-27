'use client';

import { Star } from 'lucide-react';

type Summary = {
  totalReflections: number; totalApproved: number; totalRejected: number;
  totalPending: number; overallApprovalRate: number; totalEnrolled: number;
  activeStudents: number; atRiskStudents: number; neverStarted: number; avgQuality: number | null;
};

interface Props {
  summary: Summary;
  labels: {
    title: string;
    approved: string;
    rejected: string;
    pending: string;
    avgQuality: string;
  };
}

export function ReflectionStatusCard({ summary, labels }: Props) {
  const bars = [
    { label: labels.approved, count: summary.totalApproved,  color: 'bg-emerald-400' },
    { label: labels.rejected, count: summary.totalRejected,  color: 'bg-red-400' },
    { label: labels.pending,  count: summary.totalPending,   color: 'bg-amber-400' },
  ];
  return (
    <div className="card">
      <h2 className="font-heading font-bold text-base text-charcoal mb-4">{labels.title}</h2>
      <div className="space-y-3">
        {bars.map(({ label, count, color }) => {
          const pct = summary.totalReflections > 0 ? Math.round((count / summary.totalReflections) * 100) : 0;
          return (
            <div key={label} className="flex items-center gap-4">
              <span className="text-sm text-gray-600 w-24 shrink-0">{label}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                <div className={`${color} h-3 rounded-full transition-all`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm font-semibold text-charcoal w-20 text-right">{count} ({pct}%)</span>
            </div>
          );
        })}
      </div>
      {summary.avgQuality != null && (
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
          <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
          <span className="text-sm text-gray-600">{labels.avgQuality}</span>
          <span className="font-semibold text-charcoal">{summary.avgQuality}/10</span>
        </div>
      )}
    </div>
  );
}
