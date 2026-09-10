'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Trash2, Plus, X } from 'lucide-react';
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
  // Trello *LUX SCHEDULER* (Mack, 2026-09-10): "no puedo pasar de la primera sección...
  // el periodo académico se puede agregar e incluso se puede crear desde ahí" — the
  // dropdown only ever listed periods some Course already used, with no way to create
  // one, so a fresh test env with zero courses in a period left the button permanently
  // disabled. Same create-inline pattern as Lux Planner's StepIdentidad.tsx, so the
  // period stays the one shared vocabulary across both screens.
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [newPeriodInput, setNewPeriodInput] = useState('');
  const [periodError, setPeriodError] = useState('');
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

  const handleCreatePeriod = async () => {
    if (!newPeriodInput.trim()) return;
    setPeriodError('');
    try {
      const res = await api.admin.periods.create(newPeriodInput.trim());
      const created = (res as any)?.data ?? res;
      setPeriods((p) => [created, ...p]);
      setAcademicPeriod(created.name);
      setNewPeriodInput(''); setShowNewPeriod(false);
    } catch (err: any) {
      setPeriodError(err?.message ?? 'No se pudo crear el período.');
    }
  };

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
          {showNewPeriod ? (
            <div className="flex gap-1.5">
              <input
                autoFocus type="text" value={newPeriodInput} onChange={(e) => setNewPeriodInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreatePeriod(); } else if (e.key === 'Escape') { setShowNewPeriod(false); setNewPeriodInput(''); } }}
                placeholder="Ej. I Cuatrimestre 2026" className="input-field flex-1"
              />
              <button onClick={() => { setShowNewPeriod(false); setNewPeriodInput(''); }} className="px-2 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <select value={academicPeriod} onChange={(e) => setAcademicPeriod(e.target.value)} className="input-field flex-1">
                <option value="">— Seleccionar —</option>
                {periods.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
              <button onClick={() => setShowNewPeriod(true)} title="Crear nuevo" className="px-2 text-cta-from hover:text-cta-to"><Plus className="w-4 h-4" /></button>
            </div>
          )}
          {periodError && <p className="text-xs text-red-500">{periodError}</p>}
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
