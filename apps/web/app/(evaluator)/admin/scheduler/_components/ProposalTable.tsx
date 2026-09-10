'use client';

import { CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

const DAY_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export interface ScheduledSession {
  courseId: string; evaluatorId: string; dayOfWeek: number; startTime: string; endTime: string;
  modality: 'PRESENCIAL' | 'VIRTUAL'; classType: 'INDIVIDUAL' | 'GRUPAL'; studentIds: string[];
}
export interface ScheduleProposal {
  label: string; strategy: string; sessions: ScheduledSession[]; unscheduledCourseIds: string[];
}

interface Props {
  proposal: ScheduleProposal;
  courseTitles: Record<string, string>;
  teacherNames: Record<string, string>;
  onApprove: () => void;
  approving: boolean;
  approved: boolean;
}

export function ProposalTable({ proposal, courseTitles, teacherNames, onApprove, approving, approved }: Props) {
  const sorted = [...proposal.sessions].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-heading font-semibold text-charcoal">{proposal.label}</h3>
          <p className="text-xs text-gray-500">{sorted.length} clase{sorted.length !== 1 ? 's' : ''} programada{sorted.length !== 1 ? 's' : ''}</p>
        </div>
        <Button size="sm" onClick={onApprove} disabled={approving || approved} loading={approving} leftIcon={approved ? <CheckCircle className="w-4 h-4" /> : undefined}>
          {approved ? 'Aprobada' : 'Aprobar esta opción'}
        </Button>
      </div>

      {proposal.unscheduledCourseIds.length > 0 && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 mb-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>No se pudo ubicar: {proposal.unscheduledCourseIds.map((id) => courseTitles[id] ?? id).join(', ')} (sin disponibilidad suficiente del profesor).</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold text-gray-500">
              <th className="py-2 pr-3">Curso</th>
              <th className="py-2 pr-3">Profesor</th>
              <th className="py-2 pr-3">Día</th>
              <th className="py-2 pr-3">Hora</th>
              <th className="py-2 pr-3">Tipo</th>
              <th className="py-2">Estudiantes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((s, i) => (
              <tr key={i}>
                <td className="py-2 pr-3 font-medium text-charcoal">{courseTitles[s.courseId] ?? s.courseId}</td>
                <td className="py-2 pr-3 text-gray-600">{teacherNames[s.evaluatorId] ?? s.evaluatorId}</td>
                <td className="py-2 pr-3 text-gray-600">{DAY_LABEL[s.dayOfWeek]}</td>
                <td className="py-2 pr-3 text-gray-600">{s.startTime}–{s.endTime}</td>
                <td className="py-2 pr-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.modality === 'PRESENCIAL' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                    {s.modality === 'PRESENCIAL' ? 'Presencial' : 'Virtual'} · {s.classType === 'GRUPAL' ? 'Grupal' : 'Individual'}
                  </span>
                </td>
                <td className="py-2 text-gray-500">{s.studentIds.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <p className="text-sm text-gray-400 italic py-4">Ningún curso pudo ubicarse en esta propuesta.</p>}
      </div>
    </div>
  );
}
