'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Upload, Clock, CheckCircle, XCircle, AlertCircle, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import QRCode from 'qrcode';

const SEMAPHORE_CONFIG = {
  LOW:      { label: 'Asistencia regular',  color: 'text-green-600',  bg: 'bg-green-100',  icon: '🟢' },
  MODERATE: { label: 'Riesgo de inasistencia', color: 'text-yellow-600', bg: 'bg-yellow-100', icon: '🟡' },
  HIGH:     { label: 'Asistencia crítica',  color: 'text-red-600',    bg: 'bg-red-100',    icon: '🔴' },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PRESENT:              { label: 'Presente',          color: 'text-green-700 bg-green-100' },
  ABSENT:               { label: 'Ausente',            color: 'text-red-700 bg-red-100' },
  JUSTIFICATION_PENDING:{ label: 'En revisión',        color: 'text-yellow-700 bg-yellow-100' },
  JUSTIFIED:            { label: 'Justificado',        color: 'text-blue-700 bg-blue-100' },
  REJECTED:             { label: 'Rechazado',          color: 'text-red-700 bg-red-100' },
};

export default function StudentAttendancePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [justifyRecord, setJustifyRecord] = useState<any>(null);
  const [justifyFile, setJustifyFile] = useState<File | null>(null);
  const [justifyLoading, setJustifyLoading] = useState(false);
  const [justifyError, setJustifyError] = useState('');
  const [justifySuccess, setJustifySuccess] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.attendance.my(courseId).then((res: any) => {
      setData(res.data ?? res);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [courseId]);

  // Generate QR for this student (userId is not available here — handled via profile page)
  // QR is shown in /profile — here we just show attendance data

  const semaphore = data ? (SEMAPHORE_CONFIG[data.semaphore as keyof typeof SEMAPHORE_CONFIG] ?? SEMAPHORE_CONFIG.LOW) : null;
  const absences = (data?.records ?? []).filter((r: any) => r.status === 'ABSENT');
  const justified = (data?.records ?? []).filter((r: any) => r.status === 'JUSTIFICATION_PENDING' || r.status === 'JUSTIFIED');
  const allRecords = (data?.records ?? []).sort((a: any, b: any) =>
    new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime()
  );

  async function handleJustify(record: any) {
    const deadline = record.justificationDeadline ? new Date(record.justificationDeadline) : null;
    if (deadline && Date.now() > deadline.getTime()) {
      alert('El plazo de 72 horas para justificar esta ausencia ha vencido. Contacta a tu evaluador.');
      return;
    }
    setJustifyRecord(record);
    setJustifyFile(null);
    setJustifyError('');
    setJustifySuccess(false);
  }

  async function submitJustification() {
    if (!justifyFile || !justifyRecord) return;
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(justifyFile.type)) {
      setJustifyError('Solo se aceptan archivos PDF, JPG o PNG.');
      return;
    }
    setJustifyLoading(true);
    setJustifyError('');
    try {
      const presignRes = await api.attendance.presignJustify({
        courseId,
        sk: justifyRecord.sk,
        fileName: justifyFile.name,
        fileType: justifyFile.type,
      }) as any;
      const { presignedUrl, s3Key } = presignRes.data ?? presignRes;

      // Upload to S3
      const uploadRes = await fetch(presignedUrl, {
        method: 'PUT',
        body: justifyFile,
        headers: { 'Content-Type': justifyFile.type },
      });
      if (!uploadRes.ok) throw new Error('Error al subir el archivo');

      // Register
      await api.attendance.submitJustify({ courseId, sk: justifyRecord.sk, documentKey: s3Key });
      setJustifySuccess(true);

      // Refresh
      const fresh = await api.attendance.my(courseId) as any;
      setData(fresh.data ?? fresh);
    } catch (err: any) {
      setJustifyError(err?.message ?? 'Error al enviar justificación');
    } finally {
      setJustifyLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-blue-500" size={36} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-gray-900">Mi Asistencia</h1>
      </div>

      {/* Summary card */}
      {data && semaphore && (
        <div className={`rounded-2xl p-5 mb-6 ${semaphore.bg} border border-opacity-20`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-4xl font-bold text-gray-900">{data.attendanceRate}%</p>
              <p className={`text-sm font-medium mt-1 ${semaphore.color}`}>
                {semaphore.icon} {semaphore.label}
              </p>
            </div>
            <div className="text-right text-sm text-gray-600 space-y-1">
              <p>✅ {data.presentCount} sesiones presentes</p>
              <p>❌ {data.absentCount} ausencias</p>
              <p>📅 {data.totalSessions} sesiones totales</p>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-4 h-3 bg-white/60 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                data.semaphore === 'HIGH' ? 'bg-red-500' :
                data.semaphore === 'MODERATE' ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${data.attendanceRate}%` }}
            />
          </div>
        </div>
      )}

      {/* Absence list with justify buttons */}
      <div className="space-y-3">
        <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Registro de sesiones</h2>
        {allRecords.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-8">Sin registros de asistencia aún</p>
        )}
        {allRecords.map((rec: any, i: number) => {
          const deadline = rec.justificationDeadline ? new Date(rec.justificationDeadline) : null;
          const canJustify = rec.status === 'ABSENT' && deadline && Date.now() < deadline.getTime();
          const expired = rec.status === 'ABSENT' && deadline && Date.now() > deadline.getTime();
          const statusCfg = STATUS_LABELS[rec.status] ?? STATUS_LABELS.ABSENT;
          return (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm">
                  {new Date(rec.sessionDate).toLocaleDateString('es-CR', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </p>
                <span className={`mt-1 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${statusCfg.color}`}>
                  {statusCfg.label}
                </span>
                {rec.evaluatorFeedback && (
                  <p className="text-xs text-gray-500 mt-1">💬 {rec.evaluatorFeedback}</p>
                )}
                {canJustify && deadline && (
                  <p className="text-xs text-yellow-600 mt-1">
                    ⏰ Plazo para justificar: {deadline.toLocaleDateString('es-CR')} {deadline.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
                {expired && (
                  <p className="text-xs text-red-500 mt-1">⌛ Plazo de 3 días vencido. Contacta a tu evaluador.</p>
                )}
              </div>
              {canJustify && (
                <button
                  onClick={() => handleJustify(rec)}
                  className="flex-shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700 transition"
                >
                  Justificar
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Justification modal */}
      {justifyRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Justificar ausencia</h3>
              <button onClick={() => setJustifyRecord(null)} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {justifySuccess ? (
                <div className="text-center py-6">
                  <CheckCircle className="text-green-500 mx-auto mb-3" size={40} />
                  <p className="font-semibold text-gray-900">Comprobante enviado</p>
                  <p className="text-sm text-gray-500 mt-1">Tu evaluador lo revisará pronto.</p>
                  <button
                    onClick={() => setJustifyRecord(null)}
                    className="mt-4 bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
                  >
                    Cerrar
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-600">
                    Adjunta un comprobante válido (PDF, JPG o PNG): dictamen médico, constancia laboral, u otro documento oficial.
                  </p>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 transition"
                  >
                    {justifyFile ? (
                      <p className="text-sm font-medium text-gray-800">📄 {justifyFile.name}</p>
                    ) : (
                      <>
                        <Upload className="text-gray-400 mx-auto mb-2" size={28} />
                        <p className="text-sm text-gray-500">Toca para seleccionar archivo</p>
                        <p className="text-xs text-gray-400 mt-1">PDF, JPG o PNG</p>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => { setJustifyFile(e.target.files?.[0] ?? null); setJustifyError(''); }}
                  />
                  {justifyError && (
                    <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {justifyError}</p>
                  )}
                  <button
                    disabled={!justifyFile || justifyLoading}
                    onClick={submitJustification}
                    className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-medium text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {justifyLoading ? <><Loader2 size={16} className="animate-spin" /> Enviando...</> : 'Enviar comprobante'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
