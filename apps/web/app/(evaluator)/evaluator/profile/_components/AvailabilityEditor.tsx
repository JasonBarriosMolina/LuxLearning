'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Plus, Trash2, Wifi, MapPin } from 'lucide-react';
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

interface Block { dayOfWeek: number; startTime: string; endTime: string; modality: 'VIRTUAL' | 'PRESENTIAL' }

// Trello *LUX SCHEDULER*, 2026-09-10 (Mack) + Trello DmPpbrff (Mack, 2026-09-24):
// Availability split into VIRTUAL (Mon–Fri) and PRESENTIAL (any day, typically Sat)
// categories — Lux Scheduler uses them separately when assigning courses.
export function AvailabilityEditor({ username }: { username: string }) {
  const [virtualBlocks, setVirtualBlocks] = useState<Block[]>([]);
  const [presentialBlocks, setPresentialBlocks] = useState<Block[]>([]);
  const [maxCoursesPerWeek, setMaxCoursesPerWeek] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!username) return;
    api.admin.teachers.getAvailability(username)
      .then((res: any) => {
        const blocks: Block[] = res?.data?.blocks ?? [];
        setVirtualBlocks(blocks.filter((b) => b.modality === 'VIRTUAL' || !b.modality).map((b) => ({ ...b, modality: 'VIRTUAL' as const })));
        setPresentialBlocks(blocks.filter((b) => b.modality === 'PRESENTIAL').map((b) => ({ ...b, modality: 'PRESENTIAL' as const })));
        setMaxCoursesPerWeek(res?.data?.maxCoursesPerWeek ?? 5);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [username]);

  const SUGGESTED_WEEKDAY_START = '18:00';

  const addVirtualBlock = () => setVirtualBlocks((b) => [...b, { dayOfWeek: 1, startTime: SUGGESTED_WEEKDAY_START, endTime: addTwoHours(SUGGESTED_WEEKDAY_START), modality: 'VIRTUAL' }]);
  const addPresentialBlock = () => setPresentialBlocks((b) => [...b, { dayOfWeek: 6, startTime: '08:00', endTime: '10:00', modality: 'PRESENTIAL' }]);

  const removeVirtual = (i: number) => setVirtualBlocks((b) => b.filter((_, idx) => idx !== i));
  const removePresential = (i: number) => setPresentialBlocks((b) => b.filter((_, idx) => idx !== i));

  const updateVirtual = (i: number, patch: Partial<Block>) =>
    setVirtualBlocks((b) => b.map((blk, idx) => (idx === i ? { ...blk, ...patch } : blk)));
  const updatePresential = (i: number, patch: Partial<Block>) =>
    setPresentialBlocks((b) => b.map((blk, idx) => (idx === i ? { ...blk, ...patch } : blk)));

  // Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "automáticamente la siguiente hora
  // disponible se va a correr 2 horas más"
  const updateVirtualStart = (i: number, startTime: string) => updateVirtual(i, { startTime, endTime: addTwoHours(startTime) });
  const updatePresentialStart = (i: number, startTime: string) => updatePresential(i, { startTime, endTime: addTwoHours(startTime) });

  const handleSave = async () => {
    setError(''); setSaved(false);
    setSaving(true);
    try {
      const blocks = [...virtualBlocks, ...presentialBlocks];
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

  const BlockRow = ({ block, i, onRemove, onDayChange, onStartChange, onEndChange }: {
    block: Block; i: number;
    onRemove: (i: number) => void;
    onDayChange: (i: number, day: number) => void;
    onStartChange: (i: number, time: string) => void;
    onEndChange: (i: number, time: string) => void;
  }) => (
    <div className="flex items-center gap-2 p-3 bg-surface rounded-xl">
      <select value={block.dayOfWeek} onChange={(e) => onDayChange(i, Number(e.target.value))} className="input-field text-sm py-1.5 flex-1">
        {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>
      <input type="time" value={block.startTime} onChange={(e) => onStartChange(i, e.target.value)} className="input-field text-sm py-1.5 w-28" />
      <span className="text-gray-400 text-sm">–</span>
      <input type="time" value={block.endTime} onChange={(e) => onEndChange(i, e.target.value)} className="input-field text-sm py-1.5 w-28" />
      <button onClick={() => onRemove(i)} className="p-1.5 text-gray-400 hover:text-red-500 shrink-0"><Trash2 className="w-4 h-4" /></button>
    </div>
  );

  return (
    <div className="card space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
          <CalendarClock className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <h2 className="font-heading font-semibold text-charcoal">Disponibilidad para Lux Scheduler</h2>
          <p className="text-xs text-gray-500">El Scheduler usa tus bloques virtuales y presenciales por separado al asignar cursos</p>
        </div>
      </div>

      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        ⚠️ Cada bloque debería durar al menos <strong>2 horas</strong>. Entre semana, lo sugerido es disponibilidad a partir
        de las <strong>6:00 p.m.</strong> — no es obligatorio, vos elegís tu horario.
      </p>

      {/* Virtual availability */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Wifi className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-charcoal">Disponibilidad Virtual</h3>
          <span className="text-xs text-gray-400">(clases en línea)</span>
        </div>
        {virtualBlocks.map((b, i) => (
          <BlockRow key={i} block={b} i={i}
            onRemove={removeVirtual}
            onDayChange={(i, day) => updateVirtual(i, { dayOfWeek: day })}
            onStartChange={updateVirtualStart}
            onEndChange={(i, time) => updateVirtual(i, { endTime: time })}
          />
        ))}
        {virtualBlocks.length === 0 && <p className="text-sm text-gray-400 italic">Sin bloques virtuales.</p>}
        <Button variant="secondary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={addVirtualBlock}>
          Agregar bloque virtual
        </Button>
      </div>

      {/* Presential availability */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-charcoal">Disponibilidad Presencial</h3>
          <span className="text-xs text-gray-400">(clases en persona, típicamente sábados)</span>
        </div>
        <p className="text-xs text-gray-500">El sábado, si no marcás ningún bloque presencial, queda disponible todo el horario institucional (8am–4pm)</p>
        {presentialBlocks.map((b, i) => (
          <BlockRow key={i} block={b} i={i}
            onRemove={removePresential}
            onDayChange={(i, day) => updatePresential(i, { dayOfWeek: day })}
            onStartChange={updatePresentialStart}
            onEndChange={(i, time) => updatePresential(i, { endTime: time })}
          />
        ))}
        {presentialBlocks.length === 0 && <p className="text-sm text-gray-400 italic">Sin bloques presenciales.</p>}
        <Button variant="secondary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={addPresentialBlock}>
          Agregar bloque presencial
        </Button>
      </div>

      <div className="pt-2 border-t border-border flex items-center gap-3">
        <label className="text-sm font-medium text-charcoal">Máximo de cursos por semana</label>
        <input
          type="number" min={1} max={20} value={maxCoursesPerWeek}
          onChange={(e) => setMaxCoursesPerWeek(Math.max(1, Number(e.target.value) || 1))}
          className="input-field text-sm py-1.5 w-20"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end">
        <Button size="sm" loading={saving} onClick={handleSave}>
          {saved ? '✓ Guardado' : 'Guardar disponibilidad'}
        </Button>
      </div>
    </div>
  );
}
