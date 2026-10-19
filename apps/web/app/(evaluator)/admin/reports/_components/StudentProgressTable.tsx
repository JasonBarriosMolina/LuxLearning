'use client';

import { TrendingUp, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

type StudentProgress = {
  userId: string; studentName: string; reflectionsApproved: number; reflectionsTotal: number;
  avgQuizScore: number; integratedScore: number; lastActivity: string | null;
};

function riskLevel(s: StudentProgress): 'high' | 'medium' | 'ok' {
  if (s.integratedScore === 0 && s.reflectionsTotal === 0) return 'high';
  if (s.integratedScore < 50 || (s.reflectionsTotal > 0 && s.reflectionsApproved / s.reflectionsTotal < 0.5)) return 'medium';
  return 'ok';
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

interface Props {
  studentProgress: StudentProgress[];
  lang: string;
  onSelectStudent?: (userId: string) => void;
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

export function StudentProgressTable({ studentProgress, lang, onSelectStudent, labels }: Props) {
  if (studentProgress.length === 0) return null;

  const highRisk = studentProgress.filter((s) => riskLevel(s) === 'high').length;
  const medRisk = studentProgress.filter((s) => riskLevel(s) === 'medium').length;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-cta-from" /> {labels.title}
          <span className="text-xs font-normal text-gray-400 ml-1">{labels.hint}</span>
        </h2>
        {(highRisk > 0 || medRisk > 0) && (
          <div className="flex gap-2">
            {highRisk > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                <AlertTriangle className="w-3 h-3" /> {highRisk} sin actividad
              </span>
            )}
            {medRisk > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                <Clock className="w-3 h-3" /> {medRisk} en riesgo
              </span>
            )}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-gray-500">
              <th className="text-left py-2 pr-4 font-semibold">{labels.colStudent}</th>
              <th className="text-right py-2 pr-4 font-semibold">{labels.colReflections}</th>
              <th className="text-right py-2 pr-4 font-semibold">{labels.colQuiz}</th>
              <th className="text-right py-2 pr-4 font-semibold">{labels.colScore}</th>
              <th className="text-right py-2 font-semibold hidden sm:table-cell">{labels.colActivity}</th>
              <th className="text-right py-2 font-semibold w-16">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {studentProgress.map((s) => {
              const risk = riskLevel(s);
              const days = daysSince(s.lastActivity);
              const stale = days !== null && days > 14;
              const scoreNum = s.integratedScore;
              const scoreStr = scoreNum > 0 ? `${scoreNum}%` : '—';
              const scoreClass = scoreNum >= 75 ? 'text-emerald-600' : scoreNum >= 50 ? 'text-amber-600' : 'text-red-500';

              return (
                <tr
                  key={s.userId}
                  onClick={() => onSelectStudent?.(s.userId)}
                  className={`transition-colors ${onSelectStudent ? 'cursor-pointer hover:bg-indigo-50' : 'hover:bg-surface'} ${risk === 'high' ? 'bg-red-50/40' : risk === 'medium' && stale ? 'bg-amber-50/30' : ''}`}
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${risk === 'high' ? 'bg-red-500' : risk === 'medium' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                      <span className="font-medium text-charcoal">{s.studentName}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-right text-gray-600">
                    {s.reflectionsTotal > 0
                      ? <span className={s.reflectionsApproved / s.reflectionsTotal < 0.5 ? 'text-amber-600 font-semibold' : ''}>{s.reflectionsApproved}/{s.reflectionsTotal}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-3 pr-4 text-right text-gray-600">{s.avgQuizScore > 0 ? `${s.avgQuizScore}%` : '—'}</td>
                  <td className={`py-3 pr-4 text-right font-bold text-base ${scoreClass}`}>{scoreStr}</td>
                  <td className="py-3 text-right hidden sm:table-cell">
                    {s.lastActivity ? (
                      <span className={`text-xs ${stale ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                        {stale ? `${days}d inactivo` : new Date(s.lastActivity).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES')}
                      </span>
                    ) : (
                      <span className="text-xs text-red-500 font-semibold">{labels.noActivityRow}</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    {risk === 'high'
                      ? <AlertTriangle className="w-4 h-4 text-red-500 ml-auto" />
                      : risk === 'medium'
                      ? <Clock className="w-4 h-4 text-amber-500 ml-auto" />
                      : <CheckCircle className="w-4 h-4 text-emerald-400 ml-auto" />
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {onSelectStudent && (
        <p className="text-xs text-gray-400 mt-3 text-right">Clic en estudiante para ver su reporte detallado</p>
      )}
    </div>
  );
}
