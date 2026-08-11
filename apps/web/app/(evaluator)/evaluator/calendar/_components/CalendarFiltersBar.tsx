'use client';

import { Lock, User, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const EVENT_TYPES = [
  { value: 'class',    label: 'Clase',         color: '#17527E' },
  { value: 'meeting',  label: 'Reunión',        color: '#7C3AED' },
  { value: 'event',    label: 'Evento',         color: '#E2BA50' },
  { value: 'deadline', label: 'Fecha límite',   color: '#EF4444' },
  { value: 'reminder', label: 'Recordatorio',   color: '#10B981' },
  { value: 'other',    label: 'Otro',           color: '#6B7280' },
] as const;

type LayerFilter = 'own' | 'evaluators' | 'students';

interface Props {
  layers: Set<LayerFilter>;
  onToggle: (layer: LayerFilter) => void;
  isAdmin: boolean;
}

export function CalendarFiltersBar({ layers, onToggle, isAdmin }: Props) {
  const layerOptions = [
    { key: 'own' as LayerFilter,        label: 'Mis eventos',       icon: <Lock className="w-3.5 h-3.5" /> },
    { key: 'evaluators' as LayerFilter, label: 'Otros evaluadores', icon: <User className="w-3.5 h-3.5" /> },
    ...(isAdmin ? [{ key: 'students' as LayerFilter, label: 'Estudiantes', icon: <Users className="w-3.5 h-3.5" /> }] : []),
  ];

  return (
    <div className="card p-4 flex flex-wrap items-center gap-4">
      <span className="text-xs font-medium text-gray-500 shrink-0">Mostrar calendarios:</span>
      <div className="flex flex-wrap gap-2">
        {layerOptions.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
              layers.has(key)
                ? 'bg-[#17527E] border-[#17527E] text-white'
                : 'border-gray-200 text-gray-500 hover:border-gray-300',
            )}
          >
            {icon} {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 ml-auto">
        {EVENT_TYPES.map((t) => (
          <span key={t.value} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
