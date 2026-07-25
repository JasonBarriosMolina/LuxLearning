'use client';

import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { RichTextEditor } from '@/components/shared/RichTextEditor';
import type { LessonForm } from './types';

// ─── PointsList ── private helper used only by LessonFields ──────────────────

function PointsList({ points, onChange }: { points: string[]; onChange: (pts: string[]) => void }) {
  const update = (i: number, val: string) => {
    const next = [...points]; next[i] = val; onChange(next);
  };
  const add = () => onChange([...points, '']);
  const remove = (i: number) => onChange(points.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-charcoal">Puntos clave</label>
      {points.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{i + 1}.</span>
          <input
            value={p}
            onChange={(e) => update(i, e.target.value)}
            placeholder={`Punto clave ${i + 1}`}
            className="input-field flex-1 text-sm py-2"
          />
          {points.length > 1 && (
            <button type="button" onClick={() => remove(i)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-xs font-semibold text-cta-from hover:opacity-80 transition-opacity mt-1"
      >
        <Plus className="w-3.5 h-3.5" /> Agregar punto
      </button>
    </div>
  );
}

// ─── LessonFields ─────────────────────────────────────────────────────────────

export function LessonFields({ form, setForm }: { form: LessonForm; setForm: (f: LessonForm) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Input label="Título" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <Input label="Duración" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="ej. 12 min" required />
        <Input label="YouTube ID (opcional)" value={form.youtubeId} onChange={(e) => setForm({ ...form, youtubeId: e.target.value })} placeholder="dQw4w9WgXcQ" />
        <Input label="Orden" type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} required />
        <div className="col-span-1">
          <Input label="URL imagen (opcional)" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-charcoal">Contenido</label>
        <RichTextEditor
          value={form.content}
          onChange={(html) => setForm({ ...form, content: html })}
          minHeight={220}
        />
        <p className="text-xs text-gray-400">Editor WYSIWYG. El contenido se guarda como HTML enriquecido.</p>
      </div>
      <PointsList points={form.points} onChange={(pts) => setForm({ ...form, points: pts })} />
      <Input label="Consejo (tip)" value={form.tip} onChange={(e) => setForm({ ...form, tip: e.target.value })} placeholder="Consejo práctico para el estudiante..." />
    </div>
  );
}
