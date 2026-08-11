'use client';

import { useState } from 'react';
import { NotebookPen, ChevronDown } from 'lucide-react';

export const RECORD_STATUSES = [
  { value: 'PRESENT',        label: 'Presente',               color: 'text-green-700',  dot: 'bg-green-500' },
  { value: 'ABSENT',         label: 'Ausencia Injustificada',  color: 'text-red-600',    dot: 'bg-red-500' },
  { value: 'JUSTIFIED',      label: 'Ausencia Justificada',    color: 'text-blue-600',   dot: 'bg-blue-500' },
  { value: 'LATE',           label: 'Tardía Injustificada',    color: 'text-orange-600', dot: 'bg-orange-400' },
  { value: 'LATE_JUSTIFIED', label: 'Tardía Justificada',      color: 'text-indigo-600', dot: 'bg-indigo-400' },
] as const;

export type RecordStatus = typeof RECORD_STATUSES[number]['value'];

interface Props {
  userId: string;
  name: string;
  status: RecordStatus;
  observations: string;
  hasPendingJustification: boolean;
  onChange: (userId: string, field: 'status' | 'observations', value: string) => void;
}

export function StudentAttendanceRow({ userId, name, status, observations, hasPendingJustification, onChange }: Props) {
  const [showObs, setShowObs] = useState(false);

  const currentStatus = RECORD_STATUSES.find((s) => s.value === status) ?? RECORD_STATUSES[0]!;
  const initials = name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

  const rowBg =
    status === 'PRESENT' ? 'border-green-100 bg-green-50/40' :
    status === 'ABSENT'  ? 'border-red-100 bg-red-50/30' :
    status === 'LATE'    ? 'border-orange-100 bg-orange-50/30' :
    status === 'JUSTIFIED' || status === 'LATE_JUSTIFIED' ? 'border-blue-100 bg-blue-50/20' :
    'border-gray-100 bg-white';

  return (
    <div className={`border rounded-xl px-4 py-3 transition-colors ${rowBg}`}>
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-gray-600">
          {initials}
        </div>

        {/* Name + pending badge */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 truncate">{name}</span>
            {hasPendingJustification && (
              <span className="flex-shrink-0 text-[10px] font-semibold bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full border border-yellow-200">
                ⏳ Justificación
              </span>
            )}
          </div>
        </div>

        {/* Status dropdown */}
        <div className="relative flex-shrink-0">
          <select
            value={status}
            onChange={(e) => onChange(userId, 'status', e.target.value)}
            className={`appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-gray-200 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer ${currentStatus.color}`}
          >
            {RECORD_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
        </div>

        {/* Observations toggle */}
        <button
          onClick={() => setShowObs((v) => !v)}
          title="Agregar observación"
          className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${observations ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
        >
          <NotebookPen size={15} />
        </button>
      </div>

      {showObs && (
        <div className="mt-2 pl-12">
          <input
            type="text"
            value={observations}
            onChange={(e) => onChange(userId, 'observations', e.target.value)}
            placeholder="Observación rápida (ej: llegó tarde por transporte)"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
          />
        </div>
      )}
    </div>
  );
}
