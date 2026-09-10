'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/hooks/useAuth';
import { ProposalTable, type ScheduleProposal } from './_components/ProposalTable';

// Lux Scheduler (Trello *LUX SCHEDULER*, 2026-09-10) — Fase 1: motor + UI mínima
// funcional (tablas, sin calendario visual pulido todavía — ver plan aprobado).
export default function SchedulerPage() {
  const { role } = useAuth();
  const isAdminRole = role === 'ADMIN' || role === 'SUPER_ADMIN';

  const [periods, setPeriods] = useState<{ id: string; name: string }[]>([]);
  const [academicPeriod, setAcademicPeriod] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    proposals: ScheduleProposal[]; courseTitles: Record<string, string>; teacherNames: Record<string, string>;
    skippedAsyncCourseIds: string[];
  } | null>(null);
  const [approvingIdx, setApprovingIdx] = useState<number | null>(null);
  const [approvedIdx, setApprovedIdx] = useState<number | null>(null);
  const [unpublishing, setUnpublishing] = useState(false);

  useEffect(() => {
    api.admin.periods.list().then((res: any) => setPeriods(res?.data ?? [])).catch(() => {});
  }, []);

  const handleGenerate = async () => {
    if (!academicPeriod) return;
    setGenerating(true); setError(''); setResult(null); setApprovedIdx(null);
    try {
      const res = await api.admin.scheduler.generate({ academicPeriod });
      setResult((res as any).data);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo generar el horario.');
    } finally {
      setGenerating(false);
    }
  };

  const handleApprove = async (idx: number) => {
    if (!result) return;
    setApprovingIdx(idx); setError('');
    try {
      await api.admin.scheduler.approve({ academicPeriod, proposal: result.proposals[idx] });
      setApprovedIdx(idx);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo aprobar el horario.');
    } finally {
      setApprovingIdx(null);
    }
  };

  const handleUnpublish = async () => {
    if (!academicPeriod || !confirm(`¿Quitar el horario publicado de ${academicPeriod}?`)) return;
    setUnpublishing(true); setError('');
    try {
      await api.admin.scheduler.unpublish(academicPeriod);
      setApprovedIdx(null);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo quitar el horario.');
    } finally {
      setUnpublishing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <CalendarClock className="w-6 h-6 text-cta-from" />
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">Lux Scheduler</h1>
          <p className="text-sm text-gray-500">Genera y aprueba el horario semanal institucional por período académico</p>
        </div>
      </div>

      {!isAdminRole && (
        <div className="card bg-amber-50 border border-amber-200 text-sm text-amber-700">
          Solo un administrador puede generar y aprobar horarios. Podés ver esta pantalla, pero los botones están deshabilitados.
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3">
        <div className="space-y-1 flex-1 min-w-[200px]">
          <label className="text-xs font-semibold text-gray-500">Período académico</label>
          <select value={academicPeriod} onChange={(e) => setAcademicPeriod(e.target.value)} className="input-field">
            <option value="">—</option>
            {periods.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <Button onClick={handleGenerate} disabled={!academicPeriod || !isAdminRole || generating} loading={generating}>
          Generar horario
        </Button>
        {academicPeriod && (
          <Button variant="secondary" leftIcon={<Trash2 className="w-4 h-4" />} onClick={handleUnpublish} disabled={!isAdminRole || unpublishing}>
            {unpublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Quitar horario publicado'}
          </Button>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>}

      {result?.skippedAsyncCourseIds && result.skippedAsyncCourseIds.length > 0 && (
        <p className="text-xs text-gray-400">
          {result.skippedAsyncCourseIds.length} curso(s) asincrónico(s) excluidos (no requieren clase en vivo).
        </p>
      )}

      {result?.proposals.map((proposal, idx) => (
        <ProposalTable
          key={idx}
          proposal={proposal}
          courseTitles={result.courseTitles}
          teacherNames={result.teacherNames}
          onApprove={() => handleApprove(idx)}
          approving={approvingIdx === idx}
          approved={approvedIdx === idx}
        />
      ))}
    </div>
  );
}
