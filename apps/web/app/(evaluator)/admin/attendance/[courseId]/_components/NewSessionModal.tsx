'use client';

import { useState } from 'react';
import { X, Loader2, CalendarPlus } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  open: boolean;
  courseId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function NewSessionModal({ open, courseId, onClose, onCreated }: Props) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    if (!date) return;
    setSaving(true);
    setError('');
    try {
      await api.attendance.addSession(courseId, date);
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Error al crear la sesión');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <CalendarPlus size={18} className="text-blue-600" />
            <h3 className="font-bold text-gray-900">Nueva sesión extra</h3>
          </div>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">
              Fecha de la sesión
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <p className="text-xs text-gray-400">
            Úsalo para clases extra, reposiciones o sesiones no planificadas en el Lux Planner.
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={saving || !date}
            className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            Crear sesión
          </button>
        </div>
      </div>
    </div>
  );
}
