'use client';

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  academicPeriod: string;
  onChange: (period: string) => void;
}

export function StepPeriod({ academicPeriod, onChange }: Props) {
  const [periods, setPeriods] = useState<{ id: string; name: string }[]>([]);
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [newPeriodInput, setNewPeriodInput] = useState('');
  const [periodError, setPeriodError] = useState('');

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
        <div className="flex gap-1.5">
          <select value={academicPeriod} onChange={(e) => onChange(e.target.value)} className="input-field flex-1">
            <option value="">— Seleccionar —</option>
            {periods.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          <button onClick={() => setShowNewPeriod(true)} title="Crear nuevo" className="px-2 text-cta-from hover:text-cta-to"><Plus className="w-4 h-4" /></button>
        </div>
      )}
      {periodError && <p className="text-xs text-red-500">{periodError}</p>}
    </div>
  );
}
