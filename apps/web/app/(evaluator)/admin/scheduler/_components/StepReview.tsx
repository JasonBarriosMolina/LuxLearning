'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import type { GenerateResult, ScheduledSession, Conflict } from './types';

const DAY_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAY_OPTIONS = [1, 2, 3, 4, 5, 6]; // Monday-Saturday (Sunday excluded — never a class day here)

interface Props {
  result: GenerateResult;
  academicPeriod: string;
  lunchBreak: { startTime: string; endTime: string };
  onApproved: (recipientCount: number) => void;
}

export function StepReview({ result, academicPeriod, lunchBreak, onApproved }: Props) {
  const [proposalIdx, setProposalIdx] = useState(0);
  const [sessions, setSessions] = useState<ScheduledSession[]>(result.proposals[0]?.sessions ?? []);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');

  // Switching proposals resets the working copy — edits don't carry across tabs.
  useEffect(() => {
    setSessions(result.proposals[proposalIdx]?.sessions ?? []);
    setConflicts(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalIdx]);

  const updateSession = (i: number, patch: Partial<ScheduledSession>) => {
    setSessions((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setConflicts(null); // stale until re-validated
  };

  const handleValidate = async () => {
    setValidating(true); setError('');
    try {
      const res = await api.admin.scheduler.validate({ sessions, lunchBreak, checkWorkload: true });
      setConflicts((res as any).data.conflicts);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo verificar choques.');
    } finally {
      setValidating(false);
    }
  };

  const handleApprove = async () => {
    if (conflicts === null) { await handleValidate(); return; } // force a check before approving
    if (conflicts.length > 0) return;
    setApproving(true); setError('');
    try {
      const res = await api.admin.scheduler.approve({ academicPeriod, proposal: { ...result.proposals[proposalIdx], sessions } });
      setApproved(true);
      onApproved((res as any).data?.recipientCount ?? 0);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo aprobar el horario.');
    } finally {
      setApproving(false);
    }
  };

  const proposal = result.proposals[proposalIdx]!;
  const conflictSet = new Set((conflicts ?? []).flatMap((c) => [c.sessionIndex, c.withIndex].filter((x): x is number => x != null)));

  return (
    <div className="space-y-4">
      {/* Proposal tabs */}
      <div className="flex gap-2">
        {result.proposals.map((p, i) => (
          <button
            key={i} onClick={() => setProposalIdx(i)}
            className={`flex-1 text-left p-3 rounded-xl border-2 transition-colors ${i === proposalIdx ? 'border-cta-from bg-blue-50' : 'border-border hover:border-gray-300'}`}
          >
            <p className="text-sm font-semibold text-charcoal">{p.label}</p>
            <p className="text-xs text-gray-500">{p.sessions.length} clase(s){p.unscheduledCourseIds.length > 0 ? ` · ${p.unscheduledCourseIds.length} sin ubicar` : ''}</p>
          </button>
        ))}
      </div>

      {proposal.unscheduledCourseIds.length > 0 && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>No se pudo ubicar: {proposal.unscheduledCourseIds.map((id) => result.courseTitles[id] ?? id).join(', ')}.</span>
        </div>
      )}

      {/* Editable session table */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading font-semibold text-charcoal">Ajustes manuales</h2>
          <Button size="sm" variant="secondary" onClick={handleValidate} loading={validating} leftIcon={<ShieldCheck className="w-4 h-4" />}>
            Verificar choques
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-gray-500">
                <th className="py-2 pr-3">Curso</th>
                <th className="py-2 pr-3">Profesor</th>
                <th className="py-2 pr-3">Día</th>
                <th className="py-2 pr-3">Inicio</th>
                <th className="py-2 pr-3">Fin</th>
                <th className="py-2">Estudiantes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map((s, i) => {
                const hasConflict = conflictSet.has(i);
                return (
                  <tr key={i} className={hasConflict ? 'bg-red-50' : ''}>
                    <td className="py-2 pr-3 font-medium text-charcoal">{result.courseTitles[s.courseId] ?? s.courseId}</td>
                    <td className="py-2 pr-3 text-gray-600">{result.teacherNames[s.evaluatorId] ?? s.evaluatorId}</td>
                    <td className="py-2 pr-3">
                      <select value={s.dayOfWeek} onChange={(e) => updateSession(i, { dayOfWeek: Number(e.target.value) })} className="text-xs border border-gray-200 rounded-lg px-1.5 py-1">
                        {DAY_OPTIONS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3"><input type="time" value={s.startTime} onChange={(e) => updateSession(i, { startTime: e.target.value })} className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 w-24" /></td>
                    <td className="py-2 pr-3"><input type="time" value={s.endTime} onChange={(e) => updateSession(i, { endTime: e.target.value })} className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 w-24" /></td>
                    <td className="py-2 text-gray-500">{s.studentIds.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {conflicts !== null && conflicts.length > 0 && (
          <div className="mt-3 space-y-1">
            {conflicts.map((c, i) => (
              <p key={i} className="text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {c.message}</p>
            ))}
          </div>
        )}
        {conflicts !== null && conflicts.length === 0 && (
          <p className="mt-3 text-xs text-emerald-600 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> Sin choques — listo para aprobar.</p>
        )}

        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

        <div className="flex justify-end mt-4">
          <Button onClick={handleApprove} disabled={approving || approved || (conflicts != null && conflicts.length > 0)} loading={approving}>
            {approved ? <><CheckCircle className="w-4 h-4 mr-1" /> Aprobado</> : conflicts === null ? 'Verificar y aprobar' : 'Aprobar esta opción'}
          </Button>
        </div>
      </div>
    </div>
  );
}
