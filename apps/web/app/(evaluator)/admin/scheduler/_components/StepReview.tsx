'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, ShieldCheck, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { WeekCalendarGrid } from './WeekCalendarGrid';
import type { GenerateResult, ScheduledSession, Conflict } from './types';

const DAY_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAY_OPTIONS = [1, 2, 3, 4, 5, 6]; // Monday-Saturday (Sunday excluded — never a class day here)

interface Props {
  result: GenerateResult;
  academicPeriod: string;
  lunchBreak: { startTime: string; endTime: string };
  presencialDays?: number[];
  institutionalOpen?: string;
  institutionalClose?: string;
  onApproved: () => void;
}

export function StepReview({ result, academicPeriod, lunchBreak, presencialDays, institutionalOpen, institutionalClose, onApproved }: Props) {
  const [proposalIdx, setProposalIdx] = useState(0);
  const [sessions, setSessions] = useState<ScheduledSession[]>(result.proposals[0]?.sessions ?? []);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "necesito saber por qué no se
  // pueden ubicar... que me dé una posible solución" — popover por curso.
  const [expandedUnscheduledId, setExpandedUnscheduledId] = useState<string | null>(null);

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
      const res = await api.admin.scheduler.validate({ sessions, lunchBreak, checkWorkload: true, presencialDays, institutionalOpen, institutionalClose });
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
      await api.admin.scheduler.approve({
        academicPeriod, proposal: { ...result.proposals[proposalIdx], sessions },
        courseTitles: result.courseTitles, teacherNames: result.teacherNames, studentNames: result.studentNames, roomNames: result.roomNames,
      });
      setApproved(true);
      onApproved();
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo aprobar el horario.');
    } finally {
      setApproving(false);
    }
  };

  const proposal = result.proposals[proposalIdx]!;
  const conflictSet = new Set((conflicts ?? []).flatMap((c) => [c.sessionIndex, c.withIndex].filter((x): x is number => x != null)));

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "solo se ve una lista de cosas
  // del sábado... no se entiende bien" — una sola tabla plana mezclando todos
  // los días es ilegible. Agrupar por día (mismo orden lunes→sábado que usa
  // el motor) sin inventar un componente de calendario nuevo — eso queda para
  // una revisión de diseño aparte (ver conversación con Jason).
  const sessionsByDay = DAY_OPTIONS.map((day) => ({
    day,
    rows: sessions.map((s, i) => ({ s, i })).filter(({ s }) => s.dayOfWeek === day),
  })).filter((g) => g.rows.length > 0);

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
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 space-y-1.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="font-medium">No se pudo ubicar {proposal.unscheduledCourseIds.length} curso(s) — clic en cada uno para ver por qué y qué se puede hacer.</span>
          </div>
          <div className="space-y-1 pl-6">
            {proposal.unscheduledCourseIds.map((id) => {
              const open = expandedUnscheduledId === id;
              return (
                <div key={id}>
                  <button
                    type="button" onClick={() => setExpandedUnscheduledId(open ? null : id)}
                    className="flex items-center gap-1 text-sm font-medium hover:underline"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                    {result.courseTitles[id] ?? id}
                  </button>
                  {open && (
                    <p className="text-xs text-amber-600 pl-4.5 pb-1">
                      {proposal.unscheduledReasons?.[id] ?? 'No se encontró un horario disponible para este curso.'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <WeekCalendarGrid sessions={sessions} courseTitles={result.courseTitles} teacherNames={result.teacherNames} studentNames={result.studentNames} roomNames={result.roomNames} />

      {/* Editable session table */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading font-semibold text-charcoal">Ajustes manuales</h2>
          <Button size="sm" variant="secondary" onClick={handleValidate} loading={validating} leftIcon={<ShieldCheck className="w-4 h-4" />}>
            Verificar choques
          </Button>
        </div>
        <div className="space-y-4">
          {sessionsByDay.map(({ day, rows }) => (
            <div key={day} className="overflow-x-auto">
              <p className="text-xs font-bold uppercase tracking-wide text-cta-from mb-1.5">{DAY_LABEL[day]} · {rows.length} clase{rows.length !== 1 ? 's' : ''}</p>
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
                  {rows.map(({ s, i }) => {
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
          ))}
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
