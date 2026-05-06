'use client';

import { useEffect, useState } from 'react';
import { BarChart2, Users, AlertTriangle, CheckCircle, XCircle, Clock, Star, TrendingUp, Download } from 'lucide-react';
import { api } from '@/lib/api';

type ModuleStat = {
  moduleId: string;
  title: string;
  courseTitle: string;
  total: number;
  approved: number;
  rejected: number;
  approvalRate: number | null;
  avgHoursToReview: number | null;
};

type Summary = {
  totalReflections: number;
  totalApproved: number;
  totalRejected: number;
  totalPending: number;
  overallApprovalRate: number;
  totalEnrolled: number;
  activeStudents: number;
  atRiskStudents: number;
  avgQuality: number | null;
};

export default function ReportsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [moduleStats, setModuleStats] = useState<ModuleStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'approvalRate' | 'total' | 'avgHours'>('total');

  useEffect(() => {
    api.admin.reports().then((res: any) => {
      const data = res?.data ?? res;
      setSummary(data.summary);
      setModuleStats(data.moduleStats ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const sorted = [...moduleStats].sort((a, b) => {
    if (sortBy === 'approvalRate') return (b.approvalRate ?? -1) - (a.approvalRate ?? -1);
    if (sortBy === 'avgHours') return (a.avgHoursToReview ?? 999) - (b.avgHoursToReview ?? 999);
    return b.total - a.total;
  });

  const exportCSV = () => {
    const headers = ['Módulo', 'Curso', 'Total', 'Aprobadas', 'Rechazadas', 'Tasa Aprobación %', 'Tiempo Prom. Revisión (h)'];
    const rows = moduleStats.map((m) => [
      m.title, m.courseTitle, m.total, m.approved, m.rejected,
      m.approvalRate ?? 'N/A', m.avgHoursToReview ?? 'N/A',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lux-reportes-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map((n) => <div key={n} className="card h-24" />)}
        </div>
        <div className="card h-64" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">Reportes</h1>
          <p className="text-gray-500 mt-1 text-sm">Analytics de la plataforma</p>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-semibold text-gray-600 hover:bg-surface transition-colors"
        >
          <Download className="w-4 h-4" />
          Exportar CSV
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Tasa de aprobación',
              value: `${summary.overallApprovalRate}%`,
              sub: `${summary.totalApproved} aprobadas de ${summary.totalReflections}`,
              icon: <CheckCircle className="w-5 h-5 text-emerald-500" />,
              bg: 'bg-emerald-50',
              color: 'text-emerald-600',
            },
            {
              label: 'Pendientes de revisión',
              value: summary.totalPending,
              sub: `${summary.totalRejected} rechazadas`,
              icon: <Clock className="w-5 h-5 text-amber-500" />,
              bg: 'bg-amber-50',
              color: 'text-amber-600',
            },
            {
              label: 'Estudiantes activos',
              value: summary.activeStudents,
              sub: `de ${summary.totalEnrolled} inscritos`,
              icon: <Users className="w-5 h-5 text-cta-from" />,
              bg: 'bg-blue-50',
              color: 'text-cta-from',
            },
            {
              label: 'En riesgo de abandono',
              value: summary.atRiskStudents,
              sub: `sin actividad >7 días`,
              icon: <AlertTriangle className="w-5 h-5 text-red-500" />,
              bg: summary.atRiskStudents > 0 ? 'bg-red-50' : 'bg-gray-50',
              color: summary.atRiskStudents > 0 ? 'text-red-600' : 'text-gray-400',
            },
          ].map((card) => (
            <div key={card.label} className="card">
              <div className={`w-10 h-10 ${card.bg} rounded-xl flex items-center justify-center mb-3`}>
                {card.icon}
              </div>
              <p className={`font-heading font-bold text-2xl ${card.color}`}>{card.value}</p>
              <p className="text-xs font-semibold text-charcoal mt-0.5">{card.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Quality & reflections bar */}
      {summary && (
        <div className="card">
          <h2 className="font-heading font-bold text-base text-charcoal mb-4">Estado de reflexiones</h2>
          <div className="space-y-3">
            {[
              { label: 'Aprobadas', count: summary.totalApproved, total: summary.totalReflections, color: 'bg-emerald-400' },
              { label: 'Rechazadas', count: summary.totalRejected, total: summary.totalReflections, color: 'bg-red-400' },
              { label: 'Pendientes', count: summary.totalPending, total: summary.totalReflections, color: 'bg-amber-400' },
            ].map(({ label, count, total, color }) => {
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={label} className="flex items-center gap-4">
                  <span className="text-sm text-gray-600 w-24 shrink-0">{label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className={`${color} h-3 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-charcoal w-16 text-right">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
          {summary.avgQuality != null && (
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              <span className="text-sm text-gray-600">Calidad promedio de reflexiones aprobadas:</span>
              <span className="font-semibold text-charcoal">{summary.avgQuality}/10</span>
            </div>
          )}
        </div>
      )}

      {/* Module stats table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-cta-from" />
            Por módulo
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Ordenar por:</span>
            {(['total', 'approvalRate', 'avgHours'] as const).map((key) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  sortBy === key ? 'bg-cta-from text-white' : 'bg-surface text-gray-600 hover:bg-gray-100'
                }`}
              >
                {key === 'total' ? 'Total' : key === 'approvalRate' ? 'Aprobación' : 'Tiempo'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-semibold text-gray-500 text-xs uppercase tracking-wide">Módulo</th>
                <th className="text-left py-2 pr-4 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden sm:table-cell">Curso</th>
                <th className="text-right py-2 pr-4 font-semibold text-gray-500 text-xs uppercase tracking-wide">Total</th>
                <th className="text-right py-2 pr-4 font-semibold text-gray-500 text-xs uppercase tracking-wide">Tasa</th>
                <th className="text-right py-2 font-semibold text-gray-500 text-xs uppercase tracking-wide">Prom. revisión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((m) => {
                const rate = m.approvalRate ?? null;
                const rateColor = rate == null ? 'text-gray-400' : rate >= 70 ? 'text-emerald-600' : rate >= 40 ? 'text-amber-600' : 'text-red-600';
                return (
                  <tr key={m.moduleId} className="hover:bg-surface transition-colors">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-charcoal">{m.title}</p>
                      <p className="text-xs text-gray-400 sm:hidden">{m.courseTitle}</p>
                    </td>
                    <td className="py-3 pr-4 text-gray-500 hidden sm:table-cell">{m.courseTitle}</td>
                    <td className="py-3 pr-4 text-right font-medium text-charcoal">{m.total}</td>
                    <td className={`py-3 pr-4 text-right font-bold ${rateColor}`}>
                      {rate != null ? `${rate}%` : '—'}
                    </td>
                    <td className="py-3 text-right text-gray-600">
                      {m.avgHoursToReview != null ? `${m.avgHoursToReview}h` : '—'}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400 text-sm">
                    Sin datos aún
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
