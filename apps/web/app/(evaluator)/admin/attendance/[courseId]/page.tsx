'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, QrCode, CheckCircle, XCircle, Clock, AlertCircle, Loader2, X, ShieldAlert, ClipboardList, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { QrScannerModal } from './_components/QrScannerModal';

const STATUS_CELL: Record<string, { label: string; bg: string; short: string }> = {
  PRESENT:               { label: 'Presente',    bg: 'bg-green-100 text-green-700',    short: '✅' },
  ABSENT:                { label: 'Ausente',      bg: 'bg-red-100 text-red-700',        short: '❌' },
  LATE:                  { label: 'Tarde',        bg: 'bg-orange-100 text-orange-700',  short: '🕐' },
  JUSTIFICATION_PENDING: { label: 'En revisión',  bg: 'bg-yellow-100 text-yellow-700',  short: '⏳' },
  JUSTIFIED:             { label: 'Justificado',  bg: 'bg-blue-100 text-blue-700',      short: '📄' },
  REJECTED:              { label: 'Rechazado',    bg: 'bg-red-100 text-red-700',        short: '🚫' },
  NONE:                  { label: 'Sin marcar',   bg: 'bg-gray-100 text-gray-500',      short: '—' },
};

type Session = { id: string; sessionDate: string; order: number; present?: number; absent?: number; justified?: number };
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
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);

  // Panel data
  const [pendingList, setPendingList] = useState<AttendanceRecord[]>([]);
  const [riskData, setRiskData] = useState<{ scores: any[]; cohortInsight: string } | null>(null);

  // Record attendance state
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  // FIX #12: three-state attendance — track LATE separately
  const [markedPresent, setMarkedPresent] = useState<Set<string>>(new Set());
  const [markedLate, setMarkedLate] = useState<Set<string>>(new Set());
  const [enrolledStudents, setEnrolledStudents] = useState<{ userId: string; name: string; email: string }[]>([]);

  // Review modal
  const [reviewRecord, setReviewRecord] = useState<AttendanceRecord | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  // Override modal
  const [overrideRecord, setOverrideRecord] = useState<AttendanceRecord | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideHours, setOverrideHours] = useState(24);
  const [overrideLoading, setOverrideLoading] = useState(false);

  // QR scan
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function loadMatrix() {
    try {
      const [matrixRes, pendingRes, riskRes] = await Promise.all([
        api.attendance.matrix(courseId) as Promise<any>,
        api.attendance.pending(courseId) as Promise<any>,
        api.attendance.risk(courseId) as Promise<any>,
      ]);
      const d = matrixRes.data ?? matrixRes;
      setSessions(d.sessions ?? []);
      setStudentRows(d.studentRows ?? []);
      setPendingList((pendingRes.data ?? pendingRes) ?? []);
      setRiskData(riskRes.data ?? riskRes ?? null);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadMatrix(); }, [courseId]);

  // FIX #2: Fetch student names from pool to build nameMap
  useEffect(() => {
    api.evaluator.groups.studentPool().then((res: any) => {
      const pool: { userId: string; name: string }[] = res.data ?? res ?? [];
      const map: Record<string, string> = {};
      pool.forEach((s) => { if (s.userId) map[s.userId] = s.name || s.userId; });
      setNameMap(map);
    }).catch(() => {});
  }, []);

  // FIX #1: Load enrolled students when recording session — correct response destructuring
  useEffect(() => {
    if (!selectedSession) return;
    api.evaluator.groups.studentPool().then((res: any) => {
      const pool: { userId: string; name: string; email: string }[] = res.data ?? res ?? [];
      setEnrolledStudents(pool);
    }).catch(() => {});
  }, [selectedSession]);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const res = await api.attendance.exportCsv(courseId) as any;
      const { csvContent, filename } = res.data ?? res;
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Error al exportar: ' + (err?.message ?? 'desconocido'));
    } finally {
      setExporting(false);
    }
  }

  async function saveAttendance() {
    if (!selectedSession) return;
    setRecording(true);
    try {
      const records = enrolledStudents.map((s) => ({
        userId: s.userId,
        status: markedPresent.has(s.userId) ? 'PRESENT' as const
              : markedLate.has(s.userId) ? 'LATE' as const
              : 'ABSENT' as const,
      }));
      await api.attendance.record({ courseId, sessionId: selectedSession.id, records });
      await loadMatrix();
      setSelectedSession(null);
      setMarkedPresent(new Set());
      setMarkedLate(new Set());
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
      await api.attendance.review({ courseId, sk: reviewRecord.sk, status, evaluatorFeedback: reviewFeedback || undefined });
      await loadMatrix();
      setReviewRecord(null);
      setReviewFeedback('');
    } catch (err: any) {
      alert('Error: ' + (err?.message ?? 'desconocido'));
    } finally {
      setReviewLoading(false);
    }
  }

  async function submitOverride() {
    if (!overrideRecord || !overrideReason.trim()) return;
    setOverrideLoading(true);
    try {
      await api.attendance.override({ courseId, sk: overrideRecord.sk, overrideReason, extraHours: overrideHours });
      await loadMatrix();
      setOverrideRecord(null);
      setOverrideReason('');
    } catch (err: any) {
      alert('Error: ' + (err?.message ?? 'desconocido'));
    } finally {
      setOverrideLoading(false);
    }
  }

  const togglePresent = useCallback((userId: string) => {
    setMarkedPresent((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) { next.delete(userId); return next; }
      setMarkedLate((l) => { const nl = new Set(l); nl.delete(userId); return nl; });
      next.add(userId);
      return next;
    });
  }, []);

  const toggleLate = useCallback((userId: string) => {
    setMarkedLate((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) { next.delete(userId); return next; }
      setMarkedPresent((p) => { const np = new Set(p); np.delete(userId); return np; });
      next.add(userId);
      return next;
    });
  }, []);

  const displayName = (uid: string) => nameMap[uid] || uid;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-blue-500" size={36} />
      </div>
    );
  }

  const highRisk = riskData?.scores.filter((s) => s.riskLevel === 'HIGH') ?? [];
  const moderateRisk = riskData?.scores.filter((s) => s.riskLevel === 'MODERATE') ?? [];

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
            onClick={handleExportCsv}
            disabled={exporting}
            className="flex items-center gap-1.5 text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Exportar CSV
          </button>
          <button
            onClick={() => setShowQrScanner(true)}
            className="flex items-center gap-1.5 text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200"
          >
            <QrCode size={15} /> Escanear QR
          </button>
          {sessions.length > 0 && (
            <button
              onClick={() => { setSelectedSession(sessions[0]!); setMarkedPresent(new Set()); setMarkedLate(new Set()); }}
              className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700"
            >
              ✅ Registrar Asistencia
            </button>
          )}
        </div>
      </div>

      {/* FIX #13: Session summary bar */}
      {sessions.some((s) => s.present !== undefined) && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
          {sessions.map((s) => (
            <div key={s.id} className="flex-shrink-0 bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs text-center min-w-[72px]">
              <div className="font-medium text-gray-600">Ses. {s.order}</div>
              <div className="mt-1 space-y-0.5">
                <div className="text-green-600">✅ {s.present ?? 0}</div>
                <div className="text-red-500">❌ {s.absent ?? 0}</div>
                <div className="text-blue-500">📄 {s.justified ?? 0}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FIX #5: Pending justifications panel */}
      {pendingList.length > 0 && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-yellow-200">
            <ClipboardList size={16} className="text-yellow-600" />
            <span className="font-semibold text-yellow-800 text-sm">Justificaciones pendientes ({pendingList.length})</span>
          </div>
          <div className="divide-y divide-yellow-100">
            {pendingList.map((rec) => (
              <div key={rec.sk} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{displayName(rec.userId)}</p>
                  <p className="text-xs text-gray-500">{new Date(rec.sessionDate).toLocaleDateString('es-CR', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                </div>
                <div className="flex gap-1.5">
                  {/* FIX #6: Override deadline button */}
                  <button
                    onClick={() => { setOverrideRecord(rec); setOverrideReason(''); setOverrideHours(24); }}
                    className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100"
                    title="Extender plazo de justificación"
                  >
                    ⏱ Extender plazo
                  </button>
                  <button
                    onClick={() => { setReviewRecord(rec); setReviewFeedback(''); }}
                    className="text-xs bg-yellow-600 text-white px-2.5 py-1 rounded-lg hover:bg-yellow-700"
                  >
                    Revisar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FIX #5: Risk panel */}
      {(highRisk.length > 0 || moderateRisk.length > 0) && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-red-200">
            <ShieldAlert size={16} className="text-red-600" />
            <span className="font-semibold text-red-800 text-sm">Riesgo de abandono — {highRisk.length + moderateRisk.length} estudiantes</span>
          </div>
          {riskData?.cohortInsight && (
            <p className="px-4 py-2 text-xs text-gray-600 italic border-b border-red-100">{riskData.cohortInsight}</p>
          )}
          <div className="divide-y divide-red-100">
            {[...highRisk, ...moderateRisk].map((s) => (
              <div key={s.userId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{displayName(s.userId)}</p>
                  <p className="text-xs text-gray-500">{s.reason}</p>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${s.riskLevel === 'HIGH' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {s.riskLevel === 'HIGH' ? '🚨 Alto' : '⚠️ Moderado'} · {s.absenceRate}% ausencias
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  {/* FIX #2: Show real name from nameMap */}
                  <td className="px-4 py-3 font-medium text-gray-800 sticky left-0 bg-white">
                    {displayName(row.userId)}
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

            <div className="px-5 pt-3">
              <label className="text-xs text-gray-500 font-medium">Seleccionar sesión:</label>
              <select
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={selectedSession.id}
                onChange={(e) => {
                  const s = sessions.find((s) => s.id === e.target.value);
                  if (s) { setSelectedSession(s); setMarkedPresent(new Set()); setMarkedLate(new Set()); }
                }}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    Ses. {s.order} — {new Date(s.sessionDate).toLocaleDateString('es-CR')}
                  </option>
                ))}
              </select>
            </div>

            {/* FIX #12: Three-state toggle (PRESENT / LATE / ABSENT) */}
            <div className="overflow-y-auto flex-1 p-5 space-y-2">
              {enrolledStudents.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Sin estudiantes inscritos</p>
              )}
              {enrolledStudents.map((s) => {
                const isPresent = markedPresent.has(s.userId);
                const isLate = markedLate.has(s.userId);
                return (
                  <div key={s.userId} className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                    isPresent ? 'bg-green-50 border-green-300' : isLate ? 'bg-orange-50 border-orange-300' : 'bg-gray-50 border-gray-200'
                  }`}>
                    <span className="font-medium text-gray-800 text-sm">{s.name || s.userId}</span>
                    <div className="flex gap-1">
                      <button onClick={() => togglePresent(s.userId)}
                        className={`text-xs px-2.5 py-1 rounded-lg font-medium transition ${isPresent ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-green-400'}`}>
                        ✅ Presente
                      </button>
                      <button onClick={() => toggleLate(s.userId)}
                        className={`text-xs px-2.5 py-1 rounded-lg font-medium transition ${isLate ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-orange-400'}`}>
                        🕐 Tarde
                      </button>
                    </div>
                  </div>
                );
              })}
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
              <h3 className="font-bold text-gray-900">Revisar Justificación — {displayName(reviewRecord.userId)}</h3>
              <button onClick={() => setReviewRecord(null)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {reviewRecord.documentKey && (
                <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-600">
                  <p className="font-medium mb-1">📎 Comprobante</p>
                  <p className="text-xs text-gray-400 break-all">{reviewRecord.documentKey}</p>
                </div>
              )}
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
                <button onClick={() => submitReview('REJECTED')} disabled={reviewLoading}
                  className="flex-1 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium hover:bg-red-100 disabled:opacity-50">
                  {reviewLoading ? '...' : '❌ Rechazar'}
                </button>
                <button onClick={() => submitReview('JUSTIFIED')} disabled={reviewLoading}
                  className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                  {reviewLoading ? '...' : '✅ Aprobar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FIX #6: Override deadline modal */}
      {overrideRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-gray-900">Extender plazo de justificación</h3>
              <button onClick={() => setOverrideRecord(null)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">Estudiante: <span className="font-medium">{displayName(overrideRecord.userId)}</span></p>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Horas adicionales</label>
                <input type="number" min={1} max={720} value={overrideHours}
                  onChange={(e) => setOverrideHours(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <p className="text-xs text-gray-400 mt-1">{overrideHours}h ≈ {(overrideHours / 24).toFixed(1)} días adicionales</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Motivo (requerido)</label>
                <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Ej: Estudiante presentó certificado médico tardío por hospitalización"
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <button onClick={submitOverride} disabled={overrideLoading || !overrideReason.trim()}
                className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {overrideLoading ? <><Loader2 size={14} className="animate-spin" /> Guardando...</> : '⏱ Extender plazo'}
              </button>
            </div>
          </div>
        </div>
      )}

      <QrScannerModal
        open={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        sessions={sessions}
        courseId={courseId}
        nameMap={nameMap}
        onRecorded={loadMatrix}
      />
    </div>
  );
}
