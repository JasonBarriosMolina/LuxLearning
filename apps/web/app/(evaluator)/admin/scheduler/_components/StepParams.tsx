'use client';

import { RoomsManager } from './RoomsManager';

const DAY_OPTIONS = [
  { value: 1, label: 'Lun' }, { value: 2, label: 'Mar' }, { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' }, { value: 5, label: 'Vie' }, { value: 6, label: 'Sáb' },
]; // domingo nunca es día de clase, en ningún centro educativo

interface Props {
  lunchStart: string;
  lunchEnd: string;
  gapMinutes: number;
  individualMinutes: number;
  groupMinutes: number;
  presencialDays: number[];
  virtualDays: number[];
  institutionalOpen: string;
  institutionalClose: string;
  onChange: (patch: Partial<{
    lunchStart: string; lunchEnd: string; gapMinutes: number; individualMinutes: number; groupMinutes: number;
    presencialDays: number[]; virtualDays: number[]; institutionalOpen: string; institutionalClose: string;
  }>) => void;
}

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "vamos a pensar en diferentes
// centros educativos... que se puedan elegir los días de la semana que son
// cursos presenciales [y] los días que son cursos virtuales... así
// funcionaría con cualquier centro educativo." Antes sábado=presencial y
// lunes-viernes=virtual estaban fijos — ahora son checkboxes, con esos
// mismos valores como default.
function DayPicker({ selected, onToggle }: { selected: number[]; onToggle: (day: number) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {DAY_OPTIONS.map((d) => (
        <button
          key={d.value} type="button" onClick={() => onToggle(d.value)}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
            selected.includes(d.value) ? 'bg-cta-gradient text-white border-transparent' : 'bg-surface text-gray-500 border-border hover:border-gray-300'
          }`}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

export function StepParams({
  lunchStart, lunchEnd, gapMinutes, individualMinutes, groupMinutes,
  presencialDays, virtualDays, institutionalOpen, institutionalClose, onChange,
}: Props) {
  const toggleDay = (field: 'presencialDays' | 'virtualDays', days: number[], day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
    onChange({ [field]: next });
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h2 className="font-heading font-semibold text-charcoal">Duración de bloques</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="p-3 bg-surface rounded-xl space-y-1.5">
            <p className="font-semibold text-charcoal">Lección individual</p>
            <p className="text-gray-500">1 estudiante</p>
            <div className="flex items-center gap-2">
              <input type="number" min={5} max={240} value={individualMinutes} onChange={(e) => onChange({ individualMinutes: Math.max(5, Number(e.target.value) || 5) })} className="input-field w-20 text-sm py-1.5" />
              <span className="text-xs text-gray-500">minutos</span>
            </div>
          </div>
          <div className="p-3 bg-surface rounded-xl space-y-1.5">
            <p className="font-semibold text-charcoal">Lección grupal</p>
            <p className="text-gray-500">2+ estudiantes</p>
            <div className="flex items-center gap-2">
              <input type="number" min={5} max={240} value={groupMinutes} onChange={(e) => onChange({ groupMinutes: Math.max(5, Number(e.target.value) || 5) })} className="input-field w-20 text-sm py-1.5" />
              <span className="text-xs text-gray-500">minutos</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400">Por defecto 55 / 75 min — ajustable por si el estándar institucional cambia.</p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-heading font-semibold text-charcoal">Regla de modalidad por día</h2>
        <p className="text-xs text-gray-500">Elegí qué días de la semana son para cursos presenciales y cuáles para virtuales — así funciona para cualquier centro educativo, no solo sábado/entre-semana.</p>
        <div>
          <p className="text-xs font-semibold text-charcoal mb-1">Cursos presenciales</p>
          <DayPicker selected={presencialDays} onToggle={(d) => toggleDay('presencialDays', presencialDays, d)} />
        </div>
        <div>
          <p className="text-xs font-semibold text-charcoal mb-1">Cursos virtuales</p>
          <DayPicker selected={virtualDays} onToggle={(d) => toggleDay('virtualDays', virtualDays, d)} />
        </div>
        <div className="pt-1">
          <p className="text-xs font-semibold text-charcoal mb-1">Horario de días presenciales</p>
          <div className="flex items-center gap-3 flex-wrap">
            <input type="time" value={institutionalOpen} onChange={(e) => onChange({ institutionalOpen: e.target.value })} className="input-field w-36" />
            <span className="text-gray-400 text-sm">–</span>
            <input type="time" value={institutionalClose} onChange={(e) => onChange({ institutionalClose: e.target.value })} className="input-field w-36" />
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-heading font-semibold text-charcoal">Hora de almuerzo (bloqueo obligatorio)</h2>
        <div className="flex items-center gap-3">
          <input type="time" value={lunchStart} onChange={(e) => onChange({ lunchStart: e.target.value })} className="input-field w-36" />
          <span className="text-gray-400">–</span>
          <input type="time" value={lunchEnd} onChange={(e) => onChange({ lunchEnd: e.target.value })} className="input-field w-36" />
        </div>
        <p className="text-xs text-gray-400">Ninguna clase de los días presenciales puede partir este bloque.</p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-heading font-semibold text-charcoal">Margen entre clases (preferido)</h2>
        <div className="flex items-center gap-3">
          <input type="number" min={0} max={30} value={gapMinutes} onChange={(e) => onChange({ gapMinutes: Math.max(0, Number(e.target.value) || 0) })} className="input-field w-20" />
          <span className="text-sm text-gray-500">minutos</span>
        </div>
        <p className="text-xs text-gray-400">El motor lo respeta cuando puede, pero permite clases seguidas si es la única forma de ubicarlas.</p>
      </div>

      {/* Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "una de las cosas
          importantes que debe existir en parámetros, tal vez como una
          sección intermedia entre parámetros y cursos, son las aulas
          disponibles." */}
      <RoomsManager />
    </div>
  );
}
