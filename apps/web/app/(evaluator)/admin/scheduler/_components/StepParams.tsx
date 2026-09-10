'use client';

interface Props {
  lunchStart: string;
  lunchEnd: string;
  gapMinutes: number;
  individualMinutes: number;
  groupMinutes: number;
  onChange: (patch: Partial<{ lunchStart: string; lunchEnd: string; gapMinutes: number; individualMinutes: number; groupMinutes: number }>) => void;
}

export function StepParams({ lunchStart, lunchEnd, gapMinutes, individualMinutes, groupMinutes, onChange }: Props) {
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

      <div className="card space-y-2">
        <h2 className="font-heading font-semibold text-charcoal">Regla de modalidad por día</h2>
        <p className="text-sm text-gray-500">
          Los cursos <strong>presenciales</strong> se agendan sábado, 8:00 a.m. – 4:00 p.m.
          Los cursos <strong>virtuales</strong> se distribuyen lunes a viernes, dentro de la disponibilidad de cada profesor.
        </p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-heading font-semibold text-charcoal">Almuerzo sabatino (bloqueo obligatorio)</h2>
        <div className="flex items-center gap-3">
          <input type="time" value={lunchStart} onChange={(e) => onChange({ lunchStart: e.target.value })} className="input-field w-28" />
          <span className="text-gray-400">–</span>
          <input type="time" value={lunchEnd} onChange={(e) => onChange({ lunchEnd: e.target.value })} className="input-field w-28" />
        </div>
        <p className="text-xs text-gray-400">Ninguna clase de sábado puede partir este bloque.</p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-heading font-semibold text-charcoal">Margen entre clases (preferido)</h2>
        <div className="flex items-center gap-3">
          <input type="number" min={0} max={30} value={gapMinutes} onChange={(e) => onChange({ gapMinutes: Math.max(0, Number(e.target.value) || 0) })} className="input-field w-20" />
          <span className="text-sm text-gray-500">minutos</span>
        </div>
        <p className="text-xs text-gray-400">El motor lo respeta cuando puede, pero permite clases seguidas si es la única forma de ubicarlas.</p>
      </div>
    </div>
  );
}
