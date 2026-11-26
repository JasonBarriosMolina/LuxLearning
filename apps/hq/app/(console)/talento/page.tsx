'use client';

import { useCallback } from 'react';
import { api, type TeacherRow } from '@/lib/api';
import { TEACHER_STATUSES, formatDate } from '@/lib/statuses';
import { PipelineList } from '@/components/PipelineList';
import { StatusBadge } from '@/components/RecordPanel';

export default function TeachersPage() {
  const load = useCallback(async (p: { status?: string; q?: string }) => {
    const r = await api.teachers.list(p);
    return { rows: r.applications, counts: r.counts };
  }, []);

  return (
    <PipelineList<TeacherRow>
      title="Postulaciones de profesores"
      intro="Profesionales que quieren crear cursos y enseñar con Lux."
      statuses={TEACHER_STATUSES}
      load={load}
      emptyText="Todavía no hay postulaciones"
      hrefFor={(r) => `/talento/${r.id}`}
      primary={(r) => <p className="truncate font-bold text-navy">{r.name}</p>}
      secondary={(r) => (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <StatusBadge statuses={TEACHER_STATUSES} value={r.status} />
          <span className="truncate">{r.course_topic}</span>
        </div>
      )}
      columns={[
        { header: 'Profesional', cell: (r) => (<><p className="font-bold text-navy">{r.name}</p><p className="text-xs text-muted">{[r.city, r.country].filter(Boolean).join(', ')}</p></>) },
        { header: 'Primer curso', cell: (r) => (<><p className="text-ink">{r.course_topic}</p><p className="text-xs text-muted">{(r.areas ?? []).join(', ')}</p></>) },
        { header: 'Clases en vivo', cell: (r) => <span className="text-xs text-muted">{r.live_interest}</span> },
        { header: 'Estado', cell: (r) => <StatusBadge statuses={TEACHER_STATUSES} value={r.status} /> },
        { header: 'Recibida', cell: (r) => <span className="whitespace-nowrap text-xs text-muted">{formatDate(r.created_at)}</span> },
      ]}
    />
  );
}
