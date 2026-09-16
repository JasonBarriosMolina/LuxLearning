'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Edit2, Save, Laptop } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "en el perfil de los
// estudiantes, que se diga si es un estudiante virtual, un estudiante
// presencial, o un estudiante híbrido, para que esos permisos y esas
// limitantes no existan." Componente propio (no directo en page.tsx, que ya
// está sobre el límite de 500 líneas) — mismo patrón de edición inline que
// el resto de secciones del perfil, pero con su propio estado.
const LABELS: Record<string, string> = { VIRTUAL: 'Virtual', PRESENCIAL: 'Presencial', HIBRIDA: 'Híbrido' };

interface Props {
  value: string | null;
  onSaved: (value: string | null) => void;
}

export function ModalityField({ value, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await api.profile.update({ studentModality: (draft || '') as any });
      onSaved(draft || null);
      setEditing(false);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Laptop className="w-4 h-4 text-gray-400" />
          <div>
            <h2 className="font-heading font-semibold text-charcoal">Modalidad</h2>
            <p className="text-xs text-gray-500">Cómo recibís tus clases — define tus horarios disponibles.</p>
          </div>
        </div>
        {!editing && (
          <Button variant="secondary" size="sm" leftIcon={<Edit2 className="w-3.5 h-3.5" />} onClick={() => { setEditing(true); setDraft(value ?? ''); }}>
            Editar
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <select value={draft} onChange={(e) => setDraft(e.target.value)} className="input-field text-sm py-1.5">
            <option value="">— sin definir —</option>
            {Object.entries(LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          {error && <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}</div>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-gray-700 px-2">Cancelar</button>
            <Button size="sm" onClick={handleSave} loading={saving} leftIcon={<Save className="w-4 h-4" />}>Guardar</Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-charcoal flex items-center gap-1.5">
          {value ? <><Check className="w-3.5 h-3.5 text-emerald-500" /> {LABELS[value] ?? value}</> : <span className="text-gray-400 italic">Sin definir</span>}
        </p>
      )}
    </div>
  );
}
