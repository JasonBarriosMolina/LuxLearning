'use client';

import { useState } from 'react';
import { Download, Mail, CheckCircle2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

interface Props {
  academicPeriod: string;
  recipientCount: number;
  onUnpublish: () => void;
}

export function StepReports({ academicPeriod, recipientCount, onUnpublish }: Props) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [unpublishing, setUnpublishing] = useState(false);

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
    if (!confirm(`¿Quitar el horario publicado de ${academicPeriod}?`)) return;
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

  return (
    <div className="card flex flex-col items-center text-center py-10 gap-4">
      <CheckCircle2 className="w-12 h-12 text-emerald-500" />
      <div>
        <p className="font-heading font-bold text-xl text-charcoal">Horario publicado — {academicPeriod}</p>
        <p className="text-sm text-gray-500 mt-1 flex items-center justify-center gap-1.5">
          <Mail className="w-4 h-4" /> {recipientCount} profesor(es)/estudiante(s) recibieron su agenda personal por correo.
        </p>
      </div>

      <div className="flex gap-3">
        <Button onClick={handleExport} loading={exporting} leftIcon={<Download className="w-4 h-4" />}>
          Exportar CSV
        </Button>
        <Button variant="secondary" onClick={handleUnpublish} loading={unpublishing} leftIcon={<Trash2 className="w-4 h-4" />}>
          Quitar horario publicado
        </Button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
