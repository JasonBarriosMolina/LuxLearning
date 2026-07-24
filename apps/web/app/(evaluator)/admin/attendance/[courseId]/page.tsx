'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, QrCode, CheckCircle, XCircle, Clock, AlertCircle, Loader2, X, Eye, Camera } from 'lucide-react';
import { api } from '@/lib/api';

const STATUS_CELL: Record<string, { label: string; bg: string; short: string }> = {
  PRESENT:               { label: 'Presente',   bg: 'bg-green-100 text-green-700',   short: '✅' },
  ABSENT:                { label: 'Ausente',     bg: 'bg-red-100 text-red-700',       short: '❌' },
  JUSTIFICATION_PENDING: { label: 'En revisión', bg: 'bg-yellow-100 text-yellow-700', short: '⏳' },
  JUSTIFIED:             { label: 'Justificado', bg: 'bg-blue-100 text-blue-700',     short: '📄' },
  REJECTED:              { label: 'Rechazado',   bg: 'bg-red-100 text-red-700',       short: '🚫' },
  NONE:                  { label: 'Sin marcar',  bg: 'bg-gray-100 text-gray-500',     short: '—' },
};

type Session = { id: string; sessionDate: string; order: number };
type AttendanceRecord = {
  courseId: string; sk: string; userId: string; sessionId: string; sessionDate: string;
  status: string; justificationDeadline?: string; documentKey?: string;
  aiOcrData?: any; evaluatorFeedback?: string;
};

export default function AttendanceMatrixPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [studentRows, setStudentRows] = useState<{ userId: string; sessions: Record<string, AttendanceRecord> }[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);

  // Record attendance state
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [markedPresent, setMarkedPresent] = useState<Set<string>>(new Set());
  const [enrolledStudents, setEnrolledStudents] = useState<any[]>([]);

  // Review modal
  const [reviewRecord, setReviewRecord] = useState<AttendanceRecord | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  // QR scan
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [scannedUserId, setScannedUserId] = useState('');
  const qrVideoRef = useRef<HTMLVideoElement>(null);

  async function loadMatrix() {
    try {
      const res = await api.attendance.matrix(courseId) as any;
      const d = res.data ?? res;
      setSessions(d.sessions ?? []);
      setStudentRows(d.studentRows ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadMatrix(); }, [courseId]);

  // Load enrolled students when recording session
  useEffect(() => {
    if (!selectedSession) return;
    api.evaluator.students().then((res: any) => {
      const students = (res.data ?? res)?.filter?.((s: any) => true) ?? [];
      setEnrolledStudents(students);
    }).catch(() => {});
  }, [selectedSession]);

  async function saveAttendance() {
    if (!selectedSession) return;
    setRecording(true);
    try {
      const records = enrolledStudents.map((s: any) => ({
        userId: s.username ?? s.userId,
        status: markedPresent.has(s.username ?? s.userId) ? 'PRESENT' as const : 'ABSENT' as const,
      }));
      await api.attendance.record({ courseId, sessionId: selectedSession.id, records });
      await loadMatrix();
      setSelectedSession(null);
      setMarkedPresent(new Set());
    } catch (err: any) {
      alert('Error al registrar asistencia: ' + (err?.message ?? 'desconocido'));
    } finally {
      setRecording(false);
    }
  }

  async function submitReview(status: 'JUSTIFIED' | 'REJECTED') {
    if (!reviewRecord) return;
    setReviewLoading(true);
    try {
      await api.attendance.review({
        courseId,
        sk: reviewRecord.sk,
        status,
        evaluatorFeedback: reviewFeedback || undefined,
      });
      await loadMatrix();
      setReviewRecord(null);
      setReviewFeedback('');
    } catch (err: any) {
      alert('Error: ' + (err?.message ?? 'desconocido'));
    } finally {
      setReviewLoading(false);
    }
  }

  const togglePresent = useCallback((userId: string) => {
    setMarkedPresent((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-blue-500" size={36} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-gray-900">Control de Asistencia</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowQrScanner(true)}
            className="flex items-center gap-1.5 text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200"
          >
            <QrCode size={15} /> Escanear QR
          </button>
          {sessions.length > 0 && (
            <button
              onClick={() => { setSelectedSession(sessions[0]!); setMarkedPresent(new Set()); }}
              className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700"
            >
              ✅ Registrar Asistencia
            </button>
          )}
        </div>
      </div>

      {/* Matrix table */}
      {sessions.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No hay sesiones de clase registradas</p>
          <p className="text-sm mt-2">Las sesiones se crean al guardar el curso desde el Lux Planner</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 min-w-[160px]">
                  Estudiante
                </th>
                {sessions.map((s) => (
                  <th key={s.id} className="px-3 py-3 text-center font-medium text-gray-500 whitespace-nowrap min-w-[90px]">
                    <div className="text-xs">{new Date(s.sessionDate).toLocaleDateString('es-CR', { month: 'short', day: 'numeric' })}</div>
                    <div className="text-[10px] text-gray-400">Ses. {s.order}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {studentRows.length === 0 && (
                <tr>
                  <td colSpan={sessions.length + 1} className="text-center py-10 text-gray-400">
                    Sin registros de asistencia
                  </td>
                </tr>
              )}
              {studentRows.map((row) => (
                <tr key={row.userId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800 sticky left-0 bg-white">
                    {row.userId}
                  </td>
                  {sessions.map((s) => {
                    const rec = row.sessions[s.id];
                    const cfg = rec ? STATUS_CELL[rec.status] ?? STATUS_CELL.NONE : STATUS_CELL.NONE;
                    return (
                      <td key={s.id} className="px-2 py-3 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium cursor-default ${cfg.bg}
                            ${rec?.status === 'JUSTIFICATION_PENDING' ? 'cursor-pointer ring-2 ring-yellow-400' : ''}`}
                          title={cfg.label}
                          onClick={() => {
                            if (rec?.status === 'JUSTIFICATION_PENDING') {
                              setReviewRecord(rec);
                              setReviewFeedback('');
                            }
                          }}
                        >
                          {cfg.short}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4">
        {Object.entries(STATUS_CELL).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center ${cfg.bg}`}>{cfg.short}</span>
            {cfg.label}
          </div>
        ))}
        <p className="text-xs text-gray-400 ml-auto">Toca ⏳ para revisar justificaciones</p>
      </div>

      {/* Record attendance modal */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h3 className="font-bold text-gray-900">Registrar Asistencia</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {new Date(selectedSession.sessionDate).toLocaleDateString('es-CR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
              <button onClick={() => setSelectedSession(null)}><X size={20} className="text-gray-400" /></button>
            </div>

            {/* Session selector */}
            <div className="px-5 pt-3">
              <label className="text-xs text-gray-500 font-medium">Seleccionar sesión:</label>
              <select
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={selectedSession.id}
                onChange={(e) => {
                  const s = sessions.find((s) => s.id === e.target.value);
                  if (s) { setSelectedSession(s); setMarkedPresent(new Set()); }
                }}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    Ses. {s.order} — {new Date(s.sessionDate).toLocaleDateString('es-CR')}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-2">
              {studentRows.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Sin estudiantes inscritos</p>
              )}
              {studentRows.map((row) => (
                <button
                  key={row.userId}
                  onClick={() => togglePresent(row.userId)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition ${
                    markedPresent.has(row.userId)
                      ? 'bg-green-50 border-green-300 text-green-800'
                      : 'bg-gray-50 border-gray-200 text-gray-700'
                  }`}
                >
                  <span className="font-medium">{row.userId}</span>
                  <span>{markedPresent.has(row.userId) ? '✅ Presente' : '❌ Ausente'}</span>
                </button>
              ))}
            </div>

            <div className="p-5 border-t flex gap-2">
              <button
                onClick={() => setSelectedSession(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={saveAttendance}
                disabled={recording}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {recording ? <><Loader2 size={14} className="animate-spin" /> Guardando...</> : 'Guardar asistencia'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Justification review modal */}
      {reviewRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-gray-900">Revisar Justificación</h3>
              <button onClick={() => setReviewRecord(null)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Document preview */}
              {reviewRecord.documentKey && (
                <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-600">
                  <p className="font-medium mb-1">📎 Comprobante</p>
                  <p className="text-xs text-gray-400 break-all">{reviewRecord.documentKey}</p>
                </div>
              )}

              {/* AI analysis */}
              {reviewRecord.aiOcrData && (
                <div className={`rounded-xl p-4 border ${
                  reviewRecord.aiOcrData.aiRecommendation === 'VALID_MATCH' ? 'bg-green-50 border-green-200' :
                  reviewRecord.aiOcrData.aiRecommendation === 'NEEDS_REVIEW' ? 'bg-yellow-50 border-yellow-200' :
                  'bg-red-50 border-red-200'
                }`}>
                  <p className="font-semibold text-sm mb-2">🤖 Análisis IA (pre-filtro)</p>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-700">
                    <div><span className="font-medium">Nombre:</span> {reviewRecord.aiOcrData.extractedName ?? '—'}</div>
                    <div><span className="font-medium">Fecha:</span> {reviewRecord.aiOcrData.extractedDate ?? '—'}</div>
                    <div><span className="font-medium">Sello:</span> {reviewRecord.aiOcrData.hasMedicalStamp ? '✅ Sí' : '❌ No'}</div>
                    <div><span className="font-medium">Emisor:</span> {reviewRecord.aiOcrData.issuer ?? '—'}</div>
                    <div><span className="font-medium">Confianza:</span> {reviewRecord.aiOcrData.aiConfidenceScore ?? 0}%</div>
                    <div><span className="font-medium">Recomendación:</span> {reviewRecord.aiOcrData.aiRecommendation ?? '—'}</div>
                  </div>
                  {reviewRecord.aiOcrData.reasoning && (
                    <p className="mt-2 text-xs text-gray-600 italic">💡 {reviewRecord.aiOcrData.reasoning}</p>
                  )}
                </div>
              )}

              {/* Feedback */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Comentario para el estudiante (opcional)</label>
                <textarea
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  placeholder="Ej: El documento presentado tiene fechas que no coinciden..."
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => submitReview('REJECTED')}
                  disabled={reviewLoading}
                  className="flex-1 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium hover:bg-red-100 disabled:opacity-50"
                >
                  {reviewLoading ? '...' : '❌ Rechazar'}
                </button>
                <button
                  onClick={() => submitReview('JUSTIFIED')}
                  disabled={reviewLoading}
                  className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {reviewLoading ? '...' : '✅ Aprobar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Scanner placeholder */}
      {showQrScanner && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-gray-900">Escanear QR del estudiante</h3>
              <button onClick={() => setShowQrScanner(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-gray-100 rounded-xl aspect-square flex items-center justify-center text-gray-400">
                <Camera size={48} />
              </div>
              <p className="text-sm text-center text-gray-500">Apunta la cámara al código QR del perfil del estudiante</p>
              <div>
                <label className="text-xs font-medium text-gray-600">O ingresa el ID manualmente:</label>
                <div className="flex gap-2 mt-1">
                  <input
                    value={scannedUserId}
                    onChange={(e) => setScannedUserId(e.target.value)}
                    placeholder="userId del estudiante"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <button
                    onClick={() => {
                      if (scannedUserId) {
                        togglePresent(scannedUserId);
                        setScannedUserId('');
                        setShowQrScanner(false);
                        if (!selectedSession && sessions[0]) setSelectedSession(sessions[0]);
                      }
                    }}
                    className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700"
                  >
                    Marcar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
