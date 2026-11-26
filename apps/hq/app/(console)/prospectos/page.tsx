'use client';

import { useCallback } from 'react';
import { api, type LeadRow } from '@/lib/api';
import { LEAD_STATUSES, formatDate } from '@/lib/statuses';
import { PipelineList } from '@/components/PipelineList';
import { StatusBadge } from '@/components/RecordPanel';

export default function LeadsPage() {
  const load = useCallback(async (p: { status?: string; q?: string }) => {
    const r = await api.leads.list(p);
    return { rows: r.leads, counts: r.counts };
  }, []);

  return (
    <PipelineList<LeadRow>
      title="Demos de instituciones"
      intro="Solicitudes que llegan desde la página de Instituciones."
      statuses={LEAD_STATUSES}
      load={load}
      emptyText="Todavía no hay solicitudes de demo"
      hrefFor={(r) => `/prospectos/${r.id}`}
      primary={(r) => <p className="truncate font-bold text-navy">{r.organization}</p>}
      secondary={(r) => (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <StatusBadge statuses={LEAD_STATUSES} value={r.status} />
          <span>{r.name}</span>
          <span>{formatDate(r.created_at)}</span>
        </div>
      )}
      columns={[
        { header: 'Institución', cell: (r) => (<><p className="font-bold text-navy">{r.organization}</p><p className="text-xs text-muted">{r.org_type} · {r.size_range}</p></>) },
        { header: 'Contacto', cell: (r) => (<><p className="text-ink">{r.name}</p><p className="text-xs text-muted">{r.email}</p></>) },
        { header: 'Estado', cell: (r) => <StatusBadge statuses={LEAD_STATUSES} value={r.status} /> },
        { header: 'Responsable', cell: (r) => <span className="text-xs text-muted">{r.owner_email ?? 'Sin asignar'}</span> },
        { header: 'Recibida', cell: (r) => <span className="whitespace-nowrap text-xs text-muted">{formatDate(r.created_at)}</span> },
      ]}
    />
  );
}
