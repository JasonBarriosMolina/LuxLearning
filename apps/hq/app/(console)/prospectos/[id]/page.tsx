'use client';

import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Mail, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import { LEAD_STATUSES, formatDateTime } from '@/lib/statuses';
import { DetailShell, InfoRow } from '@/components/DetailShell';
import { RecordPanel, StatusBadge } from '@/components/RecordPanel';

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const load = useCallback(() => api.leads.get(id), [id]);

  return (
    <DetailShell backHref="/prospectos" backLabel="Demos de instituciones" load={load}>
      {({ lead, notes, history }, reload) => (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <header>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-navy">{lead.organization}</h1>
                <StatusBadge statuses={LEAD_STATUSES} value={lead.status} />
              </div>
              <p className="mt-1.5 text-muted">Recibida el {formatDateTime(lead.created_at)} · {lead.source}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={`mailto:${lead.email}?subject=${encodeURIComponent('Tu demo de Lux Learning')}`} className="btn-primary">
                  <Mail className="h-4 w-4" aria-hidden="true" /> Escribirle
                </a>
                {lead.phone && (
                  <a href={`tel:${lead.phone.replace(/\s/g, '')}`} className="btn-ghost">
                    <Phone className="h-4 w-4" aria-hidden="true" /> {lead.phone}
                  </a>
                )}
              </div>
            </header>

            <section className="card px-6 py-3">
              <dl className="divide-y divide-line">
                <InfoRow label="Contacto">{lead.name}</InfoRow>
                <InfoRow label="Correo">{lead.email}</InfoRow>
                <InfoRow label="Teléfono">{lead.phone}</InfoRow>
                <InfoRow label="Tipo de institución">{lead.org_type}</InfoRow>
                <InfoRow label="Estudiantes o colaboradores">{lead.size_range}</InfoRow>
              </dl>
            </section>

            <section className="card p-6">
              <h2 className="text-sm font-bold text-navy">Qué le gustaría lograr</h2>
              <p className="mt-2 whitespace-pre-wrap leading-relaxed text-ink">{lead.message || 'No dejó mensaje.'}</p>
            </section>
          </div>

          <RecordPanel
            statuses={LEAD_STATUSES}
            status={lead.status}
            owner={lead.owner_email}
            notes={notes}
            history={history}
            onUpdate={async (patch) => { await api.leads.update(id, patch); await reload(); }}
            onAddNote={async (body) => { await api.leads.addNote(id, body); await reload(); }}
          />
        </div>
      )}
    </DetailShell>
  );
}
