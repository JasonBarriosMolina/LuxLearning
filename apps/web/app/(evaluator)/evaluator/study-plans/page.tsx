'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ListTodo, Lock, Unlock, Search, Loader2, RefreshCw,
  AlertCircle, Check, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanStatus = 'none' | 'free' | 'locked' | 'change_requested';
type SortKey = 'name' | 'status';

interface StudentPlanRow {
  userId: string;
  studentName: string;
  studentEmail: string | null;
  planStatus: PlanStatus;
  weekOf?: string;
  generatedBy?: string;
  changeRequestNote?: string;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, note }: { status: PlanStatus; note?: string }) {
  if (status === 'none')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
        Sin plan
      </span>
    );
  if (status === 'locked')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
        <Lock className="w-3 h-3" />
        Bloqueado
      </span>
    );
  if (status === 'change_requested')
    return (
      <span
        title={note}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 cursor-help"
      >
        <AlertCircle className="w-3 h-3" />
        Cambio solicitado
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
      <Check className="w-3 h-3" />
      Libre
    </span>
  );
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<PlanStatus, number> = {
  change_requested: 0,
  locked: 1,
  none: 2,
  free: 3,
};

function sortRows(rows: StudentPlanRow[], key: SortKey, asc: boolean): StudentPlanRow[] {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (key === 'name') cmp = a.studentName.localeCompare(b.studentName);
    else cmp = STATUS_ORDER[a.planStatus] - STATUS_ORDER[b.planStatus];
    return asc ? cmp : -cmp;
  });
}

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ col, sortKey, sortAsc }: { col: SortKey; sortKey: SortKey; sortAsc: boolean }) {
  if (sortKey !== col) return null;
  return sortAsc
    ? <ChevronUp className="w-3 h-3 inline ml-0.5" />
    : <ChevronDown className="w-3 h-3 inline ml-0.5" />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EvalStudyPlansPage() {
  const [rows, setRows] = useState<StudentPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [generating, setGenerating] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [sortAsc, setSortAsc] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const studentsRes = await api.evaluator.students();
      const students: any[] = Array.isArray(studentsRes)
        ? studentsRes
        : (studentsRes as any)?.data ?? [];

      const planResults = await Promise.allSettled(
        students.map((s: any) => api.evaluator.studyPlan.get(s.userId, 1)),
      );

      const built: StudentPlanRow[] = students.map((s: any, i: number) => {
        const result = planResults[i];
        const raw = result.status === 'fulfilled' ? result.value : null;
        const plans: any[] = Array.isArray(raw) ? raw : (raw as any)?.data ?? [];
        const plan = plans[0] ?? null;

        let planStatus: PlanStatus = 'none';
        if (plan) {
          if (plan.changeRequested) planStatus = 'change_requested';
          else if (plan.lockedBy) planStatus = 'locked';
          else planStatus = 'free';
        }

        return {
          userId: s.userId,
          studentName: s.studentName ?? s.userId,
          studentEmail: s.studentEmail ?? null,
          planStatus,
          weekOf: plan?.weekOf,
          generatedBy: plan?.generatedBy,
          changeRequestNote: plan?.changeRequestNote,
        };
      });

      setRows(built);
    } catch (e: any) {
      setError(e?.body?.error ?? 'Error al cargar los datos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async (row: StudentPlanRow) => {
    setGenerating(row.userId);
    setError('');
    try {
      await api.evaluator.studyPlan.generate(row.userId, {});
      setSuccessId(row.userId);
      setTimeout(() => setSuccessId(null), 3000);
      await load();
    } catch (e: any) {
      setError(e?.body?.error ?? 'Error al generar el plan');
    } finally {
      setGenerating(null);
    }
  };

  const handleUnlock = async (row: StudentPlanRow) => {
    if (!row.weekOf) return;
    setUnlocking(row.userId);
    setError('');
    try {
      await api.evaluator.studyPlan.unlock(row.userId, row.weekOf);
      setSuccessId(row.userId);
      setTimeout(() => setSuccessId(null), 3000);
      await load();
    } catch (e: any) {
      setError(e?.body?.error ?? 'Error al desbloquear el plan');
    } finally {
      setUnlocking(null);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };


  const lc = search.toLowerCase();
  const filtered = sortRows(
    rows.filter(
      r => r.studentName.toLowerCase().includes(lc) || (r.studentEmail ?? '').toLowerCase().includes(lc),
    ),
    sortKey,
    sortAsc,
  );

  const counts = {
    none: rows.filter(r => r.planStatus === 'none').length,
    locked: rows.filter(r => r.planStatus === 'locked').length,
    change_requested: rows.filter(r => r.planStatus === 'change_requested').length,
    free: rows.filter(r => r.planStatus === 'free').length,
  };

  return (
    <div className="min-h-screen bg-[#F0F4FF] dark:bg-[#0D0D1A] p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7B2FBE] to-[#00B4D8] flex items-center justify-center shrink-0">
              <ListTodo className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Planes de Estudio</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Gestiona los planes semanales de tus estudiantes
              </p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Stats bar */}
        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Sin plan', count: counts.none, color: 'bg-gray-400' },
              { label: 'Bloqueados', count: counts.locked, color: 'bg-orange-500' },
              { label: 'Con cambios', count: counts.change_requested, color: 'bg-yellow-500' },
              { label: 'Libres', count: counts.free, color: 'bg-green-500' },
            ].map(({ label, count, color }) => (
              <div key={label} className="bg-white dark:bg-[#1A1A2E] rounded-xl p-3 border border-gray-100 dark:border-white/5 flex items-center gap-2.5">
                <span className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} />
                <div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white leading-none">{count}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar estudiante…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1A1A2E] text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-500 dark:text-gray-400 text-sm">
            {search
              ? 'Sin resultados para esta búsqueda'
              : 'No tienes estudiantes asignados aún'}
          </div>
        ) : (
          <div className="bg-white dark:bg-[#1A1A2E] rounded-2xl shadow-sm border border-gray-100 dark:border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/5 text-left bg-gray-50 dark:bg-white/2">
                    <th
                      className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                      onClick={() => toggleSort('name')}
                    >
                      Estudiante <SortIcon col="name" sortKey={sortKey} sortAsc={sortAsc} />
                    </th>
                    <th
                      className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                      onClick={() => toggleSort('status')}
                    >
                      Estado del plan <SortIcon col="status" sortKey={sortKey} sortAsc={sortAsc} />
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                      Semana
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {filtered.map(row => {
                    const isBusy = generating === row.userId || unlocking === row.userId;
                    const isSuccess = successId === row.userId;
                    return (
                      <tr
                        key={row.userId}
                        className={`hover:bg-gray-50 dark:hover:bg-white/3 transition-colors ${isSuccess ? 'bg-green-50 dark:bg-green-900/10' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-white">{row.studentName}</div>
                          {row.studentEmail && (
                            <div className="text-xs text-gray-400 mt-0.5">{row.studentEmail}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.planStatus} note={row.changeRequestNote} />
                          {row.changeRequestNote && (
                            <p className="text-xs text-gray-400 mt-1 max-w-[200px] truncate" title={row.changeRequestNote}>
                              {row.changeRequestNote}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                          {row.weekOf ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 justify-end">
                            {(row.planStatus === 'locked' || row.planStatus === 'change_requested') && (
                              <button
                                onClick={() => handleUnlock(row)}
                                disabled={isBusy}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50 transition-colors"
                              >
                                {unlocking === row.userId
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <Unlock className="w-3 h-3" />}
                                Desbloquear
                              </button>
                            )}
                            <button
                              onClick={() => handleGenerate(row)}
                              disabled={isBusy}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-[#7B2FBE] to-[#00B4D8] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                            >
                              {generating === row.userId
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <ListTodo className="w-3 h-3" />}
                              {row.planStatus === 'none' ? 'Generar plan' : 'Regenerar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer count */}
            <div className="px-4 py-2 border-t border-gray-50 dark:border-white/5 text-xs text-gray-400">
              {filtered.length} estudiante{filtered.length !== 1 ? 's' : ''}
              {search ? ` (filtrado de ${rows.length})` : ''}
            </div>
          </div>
        )}

        {/* Legend */}
        {!loading && rows.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-400 dark:text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              Sin plan — el evaluador aún no generó un plan
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Libre — el estudiante puede editar libremente
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              Bloqueado — solo lectura para el estudiante
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-yellow-500" />
              Cambio solicitado — el estudiante pidió modificaciones
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
