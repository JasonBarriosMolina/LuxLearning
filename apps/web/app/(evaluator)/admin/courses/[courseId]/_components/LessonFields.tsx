'use client';

import { useState } from 'react';
import { Plus, X, ImagePlus } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { RichTextEditor, ImageModal } from '@/components/shared/RichTextEditor';
import type { LessonForm } from './types';

// Trello DmPpbrff, 2026-09-07 (Mack): "como profesor, debo tener también la
// opción de poder agregar imágenes en el editor de curso, en la sección de
// carruseles... [que] reemplacen las que se crearon automáticamente [y] una
// opción en donde yo pueda agregar imágenes de algún proveedor." Reuses
// RichTextEditor's ImageModal (AI/stock/upload picker) instead of the old raw
// "pega una URL" text input — stockProvider='pexels' per Jason's pick
// (2026-09-08, AskUserQuestion) for this specific picker.
function LessonImagePicker({ imageUrl, onChange }: { imageUrl: string; onChange: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState(false);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-charcoal">Imagen de portada</label>
      {imageUrl && (
        <img src={imageUrl} alt="Portada de la lección" className="w-full max-w-xs rounded-lg object-cover aspect-video border border-border" />
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
        >
          <ImagePlus className="w-3.5 h-3.5" /> {imageUrl ? 'Cambiar imagen' : 'Elegir imagen'}
        </button>
        <button type="button" onClick={() => setManualUrl((v) => !v)} className="text-xs text-gray-400 hover:text-charcoal underline">
          {manualUrl ? 'Ocultar URL manual' : 'Pegar URL manual'}
        </button>
      </div>
      {manualUrl && (
        <Input label="URL imagen (opcional)" value={imageUrl} onChange={(e) => onChange(e.target.value)} />
      )}
      {open && (
        <ImageModal
          title="Imagen de portada de la lección"
          confirmLabel="Usar como portada"
          stockProvider="pexels"
          uploadFolder="covers"
          onInsert={(url) => { onChange(url); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

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
      </div>
      <LessonImagePicker imageUrl={form.imageUrl} onChange={(url) => setForm({ ...form, imageUrl: url })} />
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
