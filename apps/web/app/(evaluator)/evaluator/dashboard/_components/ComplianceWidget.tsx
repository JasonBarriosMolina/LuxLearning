'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Loader2, CheckCircle2, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';

interface ComplianceEntry {
  userId: string;
  studentName: string;
  studentEmail: string;
  weekOf: string;
  totalItems: number;
  completedItems: number;
  completionPct: number;
  hasLock: boolean;
}

interface ComplianceData {
  weekOf: string;
  compliance: ComplianceEntry[];
}

export function ComplianceWidget() {
  const [data, setData] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [regenerated, setRegenerated] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await api.evaluator.studyPlan.compliance();
      setData(res);
    } catch { /* non-fatal */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRegenerate = async (entry: ComplianceEntry) => {
    setRegenerating(entry.userId);
    try {
      await api.evaluator.studyPlan.generate(entry.userId, {});
      setRegenerated((prev) => new Set([...prev, entry.userId]));
    } catch { /* non-fatal */ } finally {
      setRegenerating(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-[#1A1A2E] rounded-2xl border border-gray-200 dark:border-white/10 p-4 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-[#17527E]" />
        <span className="text-sm text-gray-500">Cargando cumplimiento…</span>
      </div>
    );
  }

  const count = data?.compliance.length ?? 0;
  const hasIssues = count > 0;

  return (
    <div className={[
      'rounded-2xl border p-4 transition-all',
      hasIssues
        ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700/40'
        : 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-700/40',
    ].join(' ')}>
      {/* Header row */}
      <div className="flex items-center gap-3">
        {hasIssues
          ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          : <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {hasIssues
              ? `${count} estudiante${count !== 1 ? 's' : ''} con bajo cumplimiento`
              : 'Todos los estudiantes al día'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {data?.weekOf ? `Semana del ${data.weekOf}` : 'Semana actual'} · menos del 50% completado
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={load}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 transition-colors"
            title="Actualizar"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {hasIssues && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Expandable student list */}
      {expanded && hasIssues && (
        <div className="mt-3 space-y-2">
          {data!.compliance.map((entry) => {
            const isRegenerated = regenerated.has(entry.userId);
            const isRegenerating = regenerating === entry.userId;
            return (
              <div key={entry.userId}
                className="flex items-center gap-3 bg-white dark:bg-white/5 rounded-xl border border-amber-200/60 dark:border-amber-700/30 px-3 py-2.5">
                {/* Progress ring placeholder */}
                <div className="relative w-9 h-9 shrink-0">
                  <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor"
                      className="text-gray-100 dark:text-white/10" strokeWidth="3" />
                    <circle cx="18" cy="18" r="14" fill="none"
                      stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"
                      strokeDasharray={`${(entry.completionPct / 100) * 87.96} 87.96`} />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-amber-600">
                    {entry.completionPct}%
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                    {entry.studentName || entry.userId}
                  </p>
                  <p className="text-xs text-gray-400">
                    {entry.completedItems}/{entry.totalItems} actividades
                    {entry.hasLock && <span className="ml-1 text-[10px] text-[#17527E] dark:text-blue-300 font-semibold">· plan bloqueado</span>}
                  </p>
                </div>

                {isRegenerated ? (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Regenerado
                  </span>
                ) : (
                  <button
                    onClick={() => handleRegenerate(entry)}
                    disabled={!!regenerating}
                    className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-[#17527E] hover:bg-[#0f3d5e] text-white transition-colors disabled:opacity-50 shrink-0"
                  >
                    {isRegenerating
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <RotateCcw className="w-3 h-3" />}
                    {isRegenerating ? 'Generando…' : 'Regenerar'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
