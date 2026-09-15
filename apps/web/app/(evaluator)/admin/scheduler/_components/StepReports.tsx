'use client';

import { useEffect, useState } from 'react';
import { Download, Mail, CheckCircle2, Trash2, Send, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

interface Props {
  academicPeriod: string;
  onBackToReview: () => void;
  onUnpublish: () => void;
}

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "probar los horarios no significa
// que deban publicarse; deben aprobarse... las opciones que tengo que tener
// son: enviar notificación a estudiantes / a evaluadores... el botón de
// publicar debe existir... después de enviar las notificaciones." Este paso
// ahora es el panel de control post-aprobación: notificar cada audiencia por
// separado, publicar solo una vez enviada al menos una, y volver a revisar
// (editar) si la versión final no convenció.
export function StepReports({ academicPeriod, onBackToReview, onUnpublish }: Props) {
  const [approval, setApproval] = useState<{ status: string; notifiedStudents: boolean; notifiedEvaluators: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifying, setNotifying] = useState<'students' | 'evaluators' | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [error, setError] = useState('');
  const [lastNotifyCount, setLastNotifyCount] = useState<{ audience: string; count: number } | null>(null);

  const loadApproval = async () => {
    try {
      const res = await api.admin.scheduler.getApproval(academicPeriod);
      setApproval((res as any)?.data ?? null);
    } catch {
      setApproval(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadApproval(); }, [academicPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNotify = async (audience: 'students' | 'evaluators') => {
    setNotifying(audience); setError('');
    try {
      const res = await api.admin.scheduler.notify({ academicPeriod, audience });
      setLastNotifyCount({ audience, count: (res as any)?.data?.recipientCount ?? 0 });
      await loadApproval();
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo enviar la notificación.');
    } finally {
      setNotifying(null);
    }
  };

  const handlePublish = async () => {
    setPublishing(true); setError('');
    try {
      await api.admin.scheduler.publish(academicPeriod);
      await loadApproval();
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo publicar el horario.');
    } finally {
      setPublishing(false);
    }
  };

  const handleExport = async () => {
    setExporting(true); setError('');
    try {
      const res = await api.admin.scheduler.export(academicPeriod);
      const url = (res as any).data?.url;
      if (url) window.open(url, '_blank');
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo exportar el horario.');
    } finally {
      setExporting(false);
    }
  };

  const handleUnpublish = async () => {
    if (!confirm(`¿Quitar el horario de ${academicPeriod}? Esto borra la aprobación y lo publicado, si lo hay.`)) return;
    setUnpublishing(true);
    try {
      await api.admin.scheduler.unpublish(academicPeriod);
      onUnpublish();
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo quitar el horario.');
    } finally {
      setUnpublishing(false);
    }
  };

  if (loading) return <div className="card py-10 text-center text-gray-400 text-sm">Cargando…</div>;

  const isPublished = approval?.status === 'PUBLISHED';
  const canPublish = !!approval && (approval.notifiedStudents || approval.notifiedEvaluators) && !isPublished;

  return (
    <div className="card flex flex-col items-center text-center py-10 gap-4">
      <CheckCircle2 className="w-12 h-12 text-emerald-500" />
      <div>
        <p className="font-heading font-bold text-xl text-charcoal">
          {isPublished ? 'Horario publicado' : 'Horario aprobado — sin publicar todavía'} — {academicPeriod}
        </p>
        {lastNotifyCount && (
          <p className="text-sm text-gray-500 mt-1 flex items-center justify-center gap-1.5">
            <Mail className="w-4 h-4" /> {lastNotifyCount.count} {lastNotifyCount.audience === 'students' ? 'estudiante(s)' : 'evaluador(es)'} notificado(s).
          </p>
        )}
      </div>

      {!isPublished && (
        <div className="flex flex-wrap gap-3 justify-center">
          <Button
            variant={approval?.notifiedStudents ? 'secondary' : 'primary'} onClick={() => handleNotify('students')}
            loading={notifying === 'students'} disabled={!!notifying} leftIcon={<Send className="w-4 h-4" />}
          >
            {approval?.notifiedStudents ? '✓ Estudiantes notificados' : 'Notificar a estudiantes'}
          </Button>
          <Button
            variant={approval?.notifiedEvaluators ? 'secondary' : 'primary'} onClick={() => handleNotify('evaluators')}
            loading={notifying === 'evaluators'} disabled={!!notifying} leftIcon={<Send className="w-4 h-4" />}
          >
            {approval?.notifiedEvaluators ? '✓ Evaluadores notificados' : 'Notificar a evaluadores'}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 justify-center">
        {!isPublished && (
          <Button onClick={handlePublish} loading={publishing} disabled={!canPublish} leftIcon={<CheckCircle2 className="w-4 h-4" />}>
            Publicar
          </Button>
        )}
        {isPublished && (
          <Button onClick={handleExport} loading={exporting} leftIcon={<Download className="w-4 h-4" />}>
            Exportar horario: documento editable
          </Button>
        )}
        <Button variant="secondary" onClick={onBackToReview} leftIcon={<ArrowLeft className="w-4 h-4" />}>
          Volver a revisar / editar
        </Button>
        <Button variant="secondary" onClick={handleUnpublish} loading={unpublishing} leftIcon={<Trash2 className="w-4 h-4" />}>
          Quitar horario
        </Button>
      </div>
      {!isPublished && !canPublish && (
        <p className="text-xs text-gray-400">Enviá al menos una notificación antes de poder publicar.</p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
