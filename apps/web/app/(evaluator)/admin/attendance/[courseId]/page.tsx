'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, QrCode, CheckCircle, Loader2, Download, ShieldAlert, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { QrScannerModal } from './_components/QrScannerModal';
import { ReviewModal } from './_components/ReviewModal';
import { OverrideModal } from './_components/OverrideModal';
import { StudentAttendanceRow, RECORD_STATUSES, type RecordStatus } from './_components/StudentAttendanceRow';

// ── Status cell config for the read-only matrix ────────────────────────────────
const STATUS_CELL: Record<string, { label: string; bg: string; short: string }> = {
  PRESENT:               { label: 'Presente',            bg: 'bg-green-100 text-green-700',  short: '✅' },
  ABSENT:                { label: 'Aus. Injustificada',  bg: 'bg-red-100 text-red-700',      short: '❌' },
  LATE:                  { label: 'Tardía Injust.',      bg: 'bg-orange-100 text-orange-700', short: '🕐' },
  LATE_JUSTIFIED:        { label: 'Tardía Justificada',  bg: 'bg-indigo-100 text-indigo-700', short: '📄' },
  JUSTIFICATION_PENDING: { label: 'En revisión',         bg: 'bg-yellow-100 text-yellow-700', short: '⏳' },
  JUSTIFIED:             { label: 'Aus. Justificada',    bg: 'bg-blue-100 text-blue-700',    short: '📄' },
  REJECTED:              { label: 'Rechazado',           bg: 'bg-red-100 text-red-700',      short: '🚫' },
  NONE:                  { label: 'Sin marcar',          bg: 'bg-gray-100 text-gray-500',    short: '—' },
};

type Session = { id: string; sessionDate: string; order: number; present?: number; absent?: number; justified?: number };
type AttendanceRecord = {
  courseId: string; sk: string; userId: string; sessionId: string; sessionDate: string;
  status: string; justificationDeadline?: string; documentKey?: string;
  aiOcrData?: any; evaluatorFeedback?: string; observations?: string;
};
type DraftRecord = { status: RecordStatus; observations: string };

export default function AttendanceMatrixPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();

  // ── Remote data ───────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[]>([]);
  const [studentRows, setStudentRows] = useState<{ userId: string; sessions: Record<string, AttendanceRecord> }[]>([]);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [enrolledStudents, setEnrolledStudents] = useState<{ userId: string; name: string; email: string }[]>([]);
  const [pendingList, setPendingList] = useState<AttendanceRecord[]>([]);
  const [riskData, setRiskData] = useState<{ scores: any[]; cohortInsight: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Inline recording state ────────────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, DraftRecord>>({});
  const [saving, setSaving] = useState(false);

  // ── Modals ────────────────────────────────────────────────────────────────────
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [reviewRecord, setReviewRecord] = useState<AttendanceRecord | null>(null);
  const [overrideRecord, setOverrideRecord] = useState<AttendanceRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);

  const displayName = useCallback((uid: string) => nameMap[uid] || uid, [nameMap]);

  // ── Load data ─────────────────────────────────────────────────────────────────
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

  useEffect(() => {
    api.evaluator.students({ courseId }).then((res: any) => {
      const payload = res.data ?? res;
      const raw: any[] = payload.students ?? payload ?? [];
      // Filter to students enrolled in this course, map to the shape we need
      const list = raw
        .filter((s: any) => s.courses?.some((c: any) => c.courseId === courseId))
        .map((s: any) => ({ userId: s.userId, name: s.studentName || s.userId, email: s.studentEmail || '' }));
      setEnrolledStudents(list);
      const map: Record<string, string> = {};
      list.forEach((s) => { map[s.userId] = s.name; });
      setNameMap(map);
    }).catch(() => {});
  }, [courseId]);

  // ── Set default session ────────────────────────────────────────────────────────
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[sessions.length - 1]!.id);
    }
  }, [sessions]);

  // ── Pre-populate drafts from existing records when session changes ─────────────
  useEffect(() => {
    if (!selectedSessionId || enrolledStudents.length === 0) return;
    const newDrafts: Record<string, DraftRecord> = {};
    enrolledStudents.forEach((s) => {
      newDrafts[s.userId] = { status: 'ABSENT', observations: '' };
    });
    studentRows.forEach((row) => {
      const rec = row.sessions[selectedSessionId];
      if (rec) {
        const validStatus = RECORD_STATUSES.find((s) => s.value === rec.status);
        newDrafts[row.userId] = {
          status: (validStatus?.value ?? 'ABSENT') as RecordStatus,
          observations: rec.observations ?? '',
        };
      }
    });
    setDrafts(newDrafts);
  }, [selectedSessionId, enrolledStudents, studentRows]);

  // ── Pending justification set ────────────────────────────────────────────────
  const pendingUserIds = useMemo(() => new Set(pendingList.map((r) => r.userId)), [pendingList]);

  // ── Draft handlers ─────────────────────────────────────────────────────────────
  function handleDraftChange(userId: string, field: 'status' | 'observations', value: string) {
    setDrafts((prev) => ({
      ...prev,
      [userId]: { ...(prev[userId] ?? { status: 'ABSENT', observations: '' }), [field]: value },
    }));
  }

  function markAllPresent() {
    setDrafts((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((uid) => { next[uid] = { ...next[uid]!, status: 'PRESENT' }; });
      return next;
    });
  }

  async function saveAttendance() {
    if (!selectedSessionId) return;
    setSaving(true);
    try {
      const records = Object.entries(drafts).map(([userId, d]) => ({
        userId,
        status: d.status,
        observations: d.observations || undefined,
      }));
      await api.attendance.record({ courseId, sessionId: selectedSessionId, records });
      await loadMatrix();
    } catch (err: any) {
      alert('Error al guardar: ' + (err?.message ?? 'desconocido'));
    } finally {
      setSaving(false);
    }
  }

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

  async function submitReview(status: 'JUSTIFIED' | 'REJECTED', feedback: string) {
    if (!reviewRecord) return;
    await api.attendance.review({ courseId, sk: reviewRecord.sk, status, evaluatorFeedback: feedback || undefined });
    await loadMatrix();
    setReviewRecord(null);
  }

  async function submitOverride(reason: string, extraHours: number) {
    if (!overrideRecord) return;
    await api.attendance.override({ courseId, sk: overrideRecord.sk, overrideReason: reason, extraHours });
    await loadMatrix();
    setOverrideRecord(null);
  }

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const highRisk = riskData?.scores.filter((s) => s.riskLevel === 'HIGH') ?? [];
  const moderateRisk = riskData?.scores.filter((s) => s.riskLevel === 'MODERATE') ?? [];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-blue-500" size={36} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700 transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Lux Attendance</h1>
              <p className="text-xs text-gray-400 mt-0.5">Hoja de asistencia por sesión</p>
            </div>
          </div>
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Exportar CSV
          </button>
        </div>

        {/* ── Session filter bar ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-6 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3">
          <div className="flex-1">
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 block">Sesión</label>
            {sessions.length === 0 ? (
              <p className="text-sm text-gray-400">Sin sesiones</p>
            ) : (
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="w-full bg-transparent text-sm font-medium text-gray-800 focus:outline-none cursor-pointer"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    Sesión {s.order} — {new Date(s.sessionDate).toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="h-8 w-px bg-gray-200" />
          <div className="text-right flex-shrink-0">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Presentes</p>
            <p className="text-sm font-bold text-gray-700">
              {selectedSession?.present ?? 0} / {enrolledStudents.length}
            </p>
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg font-medium">Sin sesiones de clase</p>
            <p className="text-sm mt-2">Las sesiones se crean al guardar el curso desde el Lux Planner</p>
          </div>
        ) : (
          <>
            {/* ── Action buttons ──────────────────────────────────────────────── */}
            <div className="flex gap-3 mb-6">
              <button
                onClick={() => setShowQrScanner(true)}
                className="flex items-center gap-2 flex-1 justify-center py-3 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition-colors shadow-sm"
              >
                <QrCode size={18} /> Activar Escáner QR
              </button>
              <button
                onClick={markAllPresent}
                className="flex items-center gap-2 flex-1 justify-center py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 font-medium text-sm hover:bg-green-100 transition-colors"
              >
                <CheckCircle size={18} /> Marcar todos Presentes
              </button>
            </div>

            {/* ── Pending justification inline alerts ─────────────────────────── */}
            {pendingList.filter((r) => r.sessionId === selectedSessionId).length > 0 && (
              <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-xl text-xs text-yellow-700">
                <ClipboardList size={14} />
                <span>{pendingList.filter((r) => r.sessionId === selectedSessionId).length} justificacion(es) pendientes en esta sesión — haz clic en ⏳ para revisar</span>
              </div>
            )}

            {/* ── Student list ────────────────────────────────────────────────── */}
            <div className="space-y-2 mb-6">
              {enrolledStudents.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">Sin estudiantes matriculados</p>
              )}
              {enrolledStudents.map((s) => (
                <StudentAttendanceRow
                  key={s.userId}
                  userId={s.userId}
                  name={s.name || s.userId}
                  status={drafts[s.userId]?.status ?? 'ABSENT'}
                  observations={drafts[s.userId]?.observations ?? ''}
                  hasPendingJustification={pendingUserIds.has(s.userId)}
                  onChange={handleDraftChange}
                />
              ))}
            </div>

            {/* ── Save button ─────────────────────────────────────────────────── */}
            <button
              onClick={saveAttendance}
              disabled={saving || enrolledStudents.length === 0}
              className="w-full py-3.5 rounded-2xl bg-gray-900 text-white font-semibold text-sm hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              {saving ? <><Loader2 size={16} className="animate-spin" /> Guardando…</> : 'Guardar Asistencia'}
            </button>
          </>
        )}

        {/* ── Risk panel ──────────────────────────────────────────────────────── */}
        {(highRisk.length > 0 || moderateRisk.length > 0) && (
          <div className="mt-8 bg-red-50 border border-red-200 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-red-200">
              <ShieldAlert size={16} className="text-red-600" />
              <span className="font-semibold text-red-800 text-sm">
                Riesgo de abandono — {highRisk.length + moderateRisk.length} estudiantes
              </span>
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
                    {s.riskLevel === 'HIGH' ? '🚨 Alto' : '⚠️ Moderado'} · {s.absenceRate}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Pending justifications (all sessions) ───────────────────────────── */}
        {pendingList.length > 0 && (
          <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-yellow-200">
              <div className="flex items-center gap-2">
                <ClipboardList size={16} className="text-yellow-600" />
                <span className="font-semibold text-yellow-800 text-sm">Justificaciones pendientes ({pendingList.length})</span>
              </div>
            </div>
            <div className="divide-y divide-yellow-100">
              {pendingList.map((rec) => (
                <div key={rec.sk} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{displayName(rec.userId)}</p>
                    <p className="text-xs text-gray-500">{new Date(rec.sessionDate).toLocaleDateString('es-CR', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setOverrideRecord(rec)}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100"
                    >
                      ⏱ Extender
                    </button>
                    <button
                      onClick={() => setReviewRecord(rec)}
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

        {/* ── Historical matrix (collapsible) ─────────────────────────────────── */}
        {sessions.length > 0 && (
          <div className="mt-8">
            <button
              onClick={() => setShowMatrix((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors mb-3"
            >
              {showMatrix ? '▾' : '▸'} Historial completo de asistencia
            </button>
            {showMatrix && (
              <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 min-w-[140px]">Estudiante</th>
                      {sessions.map((s) => (
                        <th key={s.id} className="px-3 py-3 text-center font-medium text-gray-500 whitespace-nowrap min-w-[80px]">
                          <div>{new Date(s.sessionDate).toLocaleDateString('es-CR', { month: 'short', day: 'numeric' })}</div>
                          <div className="text-[10px] text-gray-400">Ses. {s.order}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {studentRows.length === 0 && (
                      <tr><td colSpan={sessions.length + 1} className="text-center py-8 text-gray-400">Sin registros</td></tr>
                    )}
                    {studentRows.map((row) => (
                      <tr key={row.userId} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-800 sticky left-0 bg-white">{displayName(row.userId)}</td>
                        {sessions.map((s) => {
                          const rec = row.sessions[s.id];
                          const cfg = rec ? (STATUS_CELL[rec.status] ?? STATUS_CELL.NONE) : STATUS_CELL.NONE;
                          return (
                            <td key={s.id} className="px-2 py-2.5 text-center">
                              <span
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-medium ${cfg.bg}
                                  ${rec?.status === 'JUSTIFICATION_PENDING' ? 'cursor-pointer ring-2 ring-yellow-400' : ''}`}
                                title={cfg.label}
                                onClick={() => rec?.status === 'JUSTIFICATION_PENDING' && setReviewRecord(rec)}
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
                <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-gray-100">
                  {Object.entries(STATUS_CELL).map(([key, cfg]) => (
                    <div key={key} className="flex items-center gap-1 text-[10px] text-gray-500">
                      <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center ${cfg.bg}`}>{cfg.short}</span>
                      {cfg.label}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────────── */}
      <QrScannerModal
        open={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        sessions={sessions}
        courseId={courseId}
        nameMap={nameMap}
        onRecorded={loadMatrix}
      />

      {reviewRecord && (
        <ReviewModal
          record={reviewRecord}
          displayName={displayName}
          onClose={() => setReviewRecord(null)}
          onSubmit={submitReview}
        />
      )}

      {overrideRecord && (
        <OverrideModal
          record={overrideRecord}
          displayName={displayName}
          onClose={() => setOverrideRecord(null)}
          onSubmit={submitOverride}
        />
      )}
    </div>
  );
}
