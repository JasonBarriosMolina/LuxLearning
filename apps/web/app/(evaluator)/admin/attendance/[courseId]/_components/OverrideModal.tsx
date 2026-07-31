'use client';

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';

interface OverrideRecord { sk: string; userId: string }

interface Props {
  record: OverrideRecord;
  displayName: (uid: string) => string;
  onClose: () => void;
  onSubmit: (reason: string, extraHours: number) => Promise<void>;
}

export function OverrideModal({ record, displayName, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!reason.trim()) return;
    setLoading(true);
    try { await onSubmit(reason, hours); } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold text-gray-900">Extender plazo de justificación</h3>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">Estudiante: <span className="font-medium">{displayName(record.userId)}</span></p>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Horas adicionales</label>
            <input type="number" min={1} max={720} value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <p className="text-xs text-gray-400 mt-1">{hours}h ≈ {(hours / 24).toFixed(1)} días adicionales</p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Motivo (requerido)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: Estudiante presentó certificado médico tardío por hospitalización"
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <button onClick={handleSubmit} disabled={loading || !reason.trim()}
            className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Guardando…</> : '⏱ Extender plazo'}
          </button>
        </div>
      </div>
    </div>
  );
}
