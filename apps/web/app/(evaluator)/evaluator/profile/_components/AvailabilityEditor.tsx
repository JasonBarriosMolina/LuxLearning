'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

// Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "el día sábado no está incluido...
// agrega también el día sábado. El día domingo no se da clases, por lo tanto
// no debería estar." Saturday here narrows the fixed 8am-4pm institutional
// window (see scheduler-engine.ts baseWindowsForDay) — leaving Saturday alone
// keeps the full window, same as before this change.
const DAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
];

function addTwoHours(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, (h ?? 0) * 60 + (m ?? 0) + 120);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

interface Block { dayOfWeek: number; startTime: string; endTime: string }

// Lux Scheduler (Trello *LUX SCHEDULER*, 2026-09-10) — self-managed weekly
// availability + workload cap. Feeds the schedule-generation engine directly;
// the evaluator edits this once, no admin data entry required (per spec).
export function AvailabilityEditor({ username }: { username: string }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [maxCoursesPerWeek, setMaxCoursesPerWeek] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!username) return;
    api.admin.teachers.getAvailability(username)
      .then((res: any) => {
        setBlocks(res?.data?.blocks ?? []);
        setMaxCoursesPerWeek(res?.data?.maxCoursesPerWeek ?? 5);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [username]);

  const addBlock = () => setBlocks((b) => [...b, { dayOfWeek: 1, startTime: '08:00', endTime: '10:00' }]);
  const removeBlock = (i: number) => setBlocks((b) => b.filter((_, idx) => idx !== i));
  const updateBlock = (i: number, patch: Partial<Block>) =>
    setBlocks((b) => b.map((blk, idx) => (idx === i ? { ...blk, ...patch } : blk)));
  // Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "automáticamente la siguiente hora
  // disponible se va a correr 2 horas más" — picking a start time jumps the end
  // time 2h ahead by default (still freely editable after).
  const updateStartTime = (i: number, startTime: string) => updateBlock(i, { startTime, endTime: addTwoHours(startTime) });

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await api.admin.teachers.setAvailability(username, { blocks, maxCoursesPerWeek });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo guardar la disponibilidad.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
          <CalendarClock className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <h2 className="font-heading font-semibold text-charcoal">Disponibilidad para Lux Scheduler</h2>
          <p className="text-xs text-gray-500">Tus bloques libres — el sábado, si no marcás nada, queda disponible todo el horario institucional (8am-4pm)</p>
        </div>
      </div>

      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
        ⚠️ Cada bloque debería durar al menos <strong>2 horas</strong> — hay clases que pueden empezar a la media hora (ej. 7:30–8:45),
        así que un bloque corto puede quedar sin uso real. Para clases virtuales, lo ideal es disponibilidad después de las 5pm.
      </p>

      <div className="space-y-2">
        {blocks.map((b, i) => (
          <div key={i} className="flex items-center gap-2 p-3 bg-surface rounded-xl">
            <select value={b.dayOfWeek} onChange={(e) => updateBlock(i, { dayOfWeek: Number(e.target.value) })} className="input-field text-sm py-1.5 flex-1">
              {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <input type="time" value={b.startTime} onChange={(e) => updateStartTime(i, e.target.value)} className="input-field text-sm py-1.5 w-28" />
            <span className="text-gray-400 text-sm">–</span>
            <input type="time" value={b.endTime} onChange={(e) => updateBlock(i, { endTime: e.target.value })} className="input-field text-sm py-1.5 w-28" />
            <button onClick={() => removeBlock(i)} className="p-1.5 text-gray-400 hover:text-red-500 shrink-0"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {blocks.length === 0 && <p className="text-sm text-gray-400 italic">Sin bloques de disponibilidad todavía.</p>}
      </div>

      <Button variant="secondary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={addBlock} className="mt-3">
        Agregar bloque
      </Button>

      <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
        <label className="text-sm font-medium text-charcoal">Máximo de cursos por semana</label>
        <input
          type="number" min={1} max={20} value={maxCoursesPerWeek}
          onChange={(e) => setMaxCoursesPerWeek(Math.max(1, Number(e.target.value) || 1))}
          className="input-field text-sm py-1.5 w-20"
        />
      </div>

      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}

      <div className="mt-4 flex justify-end">
        <Button size="sm" loading={saving} onClick={handleSave}>
          {saved ? '✓ Guardado' : 'Guardar disponibilidad'}
        </Button>
      </div>
    </div>
  );
}
