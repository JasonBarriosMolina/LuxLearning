'use client';

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  academicPeriod: string;
  onChange: (period: string) => void;
}

interface PeriodRow { id: string; name: string; createdAt?: string | null }

// Trello *LUX SCHEDULER* (Mack, 2026-09-10): "deben de estar disponibles
// también horarios anteriores de otros periodos... no es el foco principal
// visualmente en esta sección, pero sí es importante que estén. También se
// le pueden asignar colores en caso de ser necesario." — el backend ya
// devuelve TODO el historial (ver admin/groups.ts GET /admin/periods); lo que
// faltaba era la distinción visual entre recientes y antiguos.
const RECENT_COUNT = 4;

export function StepPeriod({ academicPeriod, onChange }: Props) {
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [newPeriodInput, setNewPeriodInput] = useState('');
  const [periodError, setPeriodError] = useState('');

  useEffect(() => {
    api.admin.periods.list().then((res: any) => setPeriods(res?.data ?? [])).catch(() => {});
  }, []);

  // El backend ya ordena el registro por createdAt desc y agrega al final los
  // periodos "derivados" (sin createdAt, típicamente los más antiguos/legacy)
  // — los primeros RECENT_COUNT con fecha son "recientes", el resto "anteriores".
  const datedCount = periods.filter((p) => p.createdAt).length;
  const recentPeriods = periods.slice(0, Math.min(RECENT_COUNT, datedCount));
  const olderPeriods = periods.slice(recentPeriods.length);
  const selectedIsRecent = recentPeriods.some((p) => p.name === academicPeriod);
  const selectedIsOlder = olderPeriods.some((p) => p.name === academicPeriod);

  const handleCreatePeriod = async () => {
    if (!newPeriodInput.trim()) return;
    setPeriodError('');
    try {
      const res = await api.admin.periods.create(newPeriodInput.trim());
      const created = (res as any)?.data ?? res;
      setPeriods((p) => [created, ...p]);
      onChange(created.name);
      setNewPeriodInput(''); setShowNewPeriod(false);
    } catch (err: any) {
      setPeriodError(err?.message ?? 'No se pudo crear el período.');
    }
  };

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-heading font-semibold text-charcoal">Período académico</h2>
        <p className="text-xs text-gray-500">Ciclo, cuatrimestre o semestre a planificar — ancla todas las asignaciones de este horario.</p>
      </div>

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
        <div className="flex gap-1.5 items-center">
          <select value={academicPeriod} onChange={(e) => onChange(e.target.value)} className="input-field flex-1">
            <option value="">— Seleccionar —</option>
            {recentPeriods.length > 0 && (
              <optgroup label="Recientes">
                {recentPeriods.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </optgroup>
            )}
            {olderPeriods.length > 0 && (
              <optgroup label="Anteriores">
                {olderPeriods.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </optgroup>
            )}
          </select>
          {academicPeriod && (selectedIsRecent || selectedIsOlder) && (
            <span className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full ${
              selectedIsRecent ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}>
              {selectedIsRecent ? 'Reciente' : 'Anterior'}
            </span>
          )}
          <button onClick={() => setShowNewPeriod(true)} title="Crear nuevo" className="px-2 text-cta-from hover:text-cta-to"><Plus className="w-4 h-4" /></button>
        </div>
      )}
      {periodError && <p className="text-xs text-red-500">{periodError}</p>}
    </div>
  );
}
