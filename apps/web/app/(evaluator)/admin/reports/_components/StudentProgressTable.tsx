'use client';

import { TrendingUp } from 'lucide-react';

type StudentProgress = {
  userId: string; studentName: string; reflectionsApproved: number; reflectionsTotal: number;
  avgQuizScore: number; integratedScore: number; lastActivity: string | null;
};

function scoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-500';
}

interface Props {
  studentProgress: StudentProgress[];
  lang: string;
  labels: {
    title: string;
    hint: string;
    colStudent: string;
    colReflections: string;
    colQuiz: string;
    colScore: string;
    colActivity: string;
    noActivityRow: string;
  };
}

export function StudentProgressTable({ studentProgress, lang, labels }: Props) {
  if (studentProgress.length === 0) return null;
  return (
    <div className="card">
      <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-cta-from" /> {labels.title}
        <span className="text-xs font-normal text-gray-400 ml-1">{labels.hint}</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-gray-500">
              <th className="text-left py-2 pr-4 font-semibold">{labels.colStudent}</th>
              <th className="text-right py-2 pr-4 font-semibold">{labels.colReflections}</th>
              <th className="text-right py-2 pr-4 font-semibold">{labels.colQuiz}</th>
              <th className="text-right py-2 pr-4 font-semibold">{labels.colScore}</th>
              <th className="text-right py-2 font-semibold hidden sm:table-cell">{labels.colActivity}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {studentProgress.map((s) => (
              <tr key={s.userId} className="hover:bg-surface transition-colors">
                <td className="py-3 pr-4 font-medium text-charcoal">{s.studentName}</td>
                <td className="py-3 pr-4 text-right text-gray-600">{s.reflectionsApproved}/{s.reflectionsTotal}</td>
                <td className="py-3 pr-4 text-right text-gray-600">{s.avgQuizScore > 0 ? `${s.avgQuizScore}%` : '—'}</td>
                <td className={`py-3 pr-4 text-right font-bold text-lg ${scoreColor(s.integratedScore)}`}>{s.integratedScore > 0 ? `${s.integratedScore}%` : '—'}</td>
                <td className="py-3 text-right text-gray-400 text-xs hidden sm:table-cell">
                  {s.lastActivity ? new Date(s.lastActivity).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES') : labels.noActivityRow}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
