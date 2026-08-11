'use client';

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';

interface OcrData {
  extractedName?: string;
  extractedDate?: string;
  hasMedicalStamp?: boolean;
  issuer?: string;
  aiConfidenceScore?: number;
  aiRecommendation?: string;
  reasoning?: string;
}

interface ReviewRecord {
  sk: string;
  userId: string;
  sessionDate: string;
  documentKey?: string;
  aiOcrData?: OcrData;
}

interface Props {
  record: ReviewRecord;
  displayName: (uid: string) => string;
  onClose: () => void;
  onSubmit: (status: 'JUSTIFIED' | 'REJECTED', feedback: string) => Promise<void>;
}

export function ReviewModal({ record, displayName, onClose, onSubmit }: Props) {
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(status: 'JUSTIFIED' | 'REJECTED') {
    setLoading(true);
    try { await onSubmit(status, feedback); } finally { setLoading(false); }
  }

  const ocr = record.aiOcrData;
  const ocrColor = ocr?.aiRecommendation === 'VALID_MATCH'
    ? 'bg-green-50 border-green-200'
    : ocr?.aiRecommendation === 'NEEDS_REVIEW'
    ? 'bg-yellow-50 border-yellow-200'
    : 'bg-red-50 border-red-200';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold text-gray-900">Revisar Justificación — {displayName(record.userId)}</h3>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {record.documentKey && (
            <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-600">
              <p className="font-medium mb-1">📎 Comprobante</p>
              <p className="text-xs text-gray-400 break-all">{record.documentKey}</p>
            </div>
          )}
          {ocr && (
            <div className={`rounded-xl p-4 border ${ocrColor}`}>
              <p className="font-semibold text-sm mb-2">🤖 Análisis IA</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-700">
                <div><span className="font-medium">Nombre:</span> {ocr.extractedName ?? '—'}</div>
                <div><span className="font-medium">Fecha:</span> {ocr.extractedDate ?? '—'}</div>
                <div><span className="font-medium">Sello:</span> {ocr.hasMedicalStamp ? '✅ Sí' : '❌ No'}</div>
                <div><span className="font-medium">Emisor:</span> {ocr.issuer ?? '—'}</div>
                <div><span className="font-medium">Confianza:</span> {ocr.aiConfidenceScore ?? 0}%</div>
                <div><span className="font-medium">Recomendación:</span> {ocr.aiRecommendation ?? '—'}</div>
              </div>
              {ocr.reasoning && <p className="mt-2 text-xs text-gray-600 italic">💡 {ocr.reasoning}</p>}
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Comentario para el estudiante (opcional)</label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Ej: El documento presentado tiene fechas que no coinciden…"
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleSubmit('REJECTED')} disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium hover:bg-red-100 disabled:opacity-50">
              {loading ? '…' : '❌ Rechazar'}
            </button>
            <button onClick={() => handleSubmit('JUSTIFIED')} disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              {loading ? <Loader2 size={14} className="animate-spin mx-auto" /> : '✅ Aprobar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
