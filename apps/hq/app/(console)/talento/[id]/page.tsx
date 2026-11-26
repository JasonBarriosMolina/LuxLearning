'use client';

import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ExternalLink, Mail, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import { TEACHER_STATUSES, formatDateTime } from '@/lib/statuses';
import { DetailShell, InfoRow } from '@/components/DetailShell';
import { RecordPanel, StatusBadge } from '@/components/RecordPanel';

type Answers = Record<string, unknown>;

// Same order and wording as the public form (apps/web/components/landing/TeacherApplicationForm.tsx).
const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Experiencia',
    rows: [['areas', 'Áreas de especialidad'], ['areaOther', 'Otra área'], ['yearsProfessional', 'Años de experiencia profesional'], ['yearsTeaching', 'Años enseñando o capacitando'], ['education', 'Formación más alta'], ['certifications', 'Certificaciones']],
  },
  {
    title: 'Cómo enseña',
    rows: [['liveInterest', '¿Le interesa dar clases en vivo?'], ['audiences', 'Públicos con los que ha trabajado'], ['hasOnlineCourses', '¿Ha creado cursos en línea?'], ['onlineCourseUrl', 'Enlace a un curso']],
  },
  {
    title: 'Su primer curso en Lux',
    rows: [['courseTopic', 'Tema'], ['courseAudience', 'Dirigido a'], ['courseOutcome', 'Qué logrará el estudiante'], ['courseModules', 'Módulos que imagina']],
  },
  {
    title: 'Participación y recursos',
    rows: [['roles', 'Cómo quiere participar'], ['hoursPerWeek', 'Horas por semana'], ['timezone', 'Zona horaria'], ['materials', 'Material preparado'], ['videoComfort', 'Comodidad grabando video'], ['equipment', 'Equipo']],
  },
];

function show(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {value.map((v) => <span key={String(v)} className="rounded-full bg-ice px-2.5 py-0.5 text-sm font-semibold text-lux">{String(v)}</span>)}
      </span>
    );
  }
  const text = String(value);
  if (/^https?:\/\//.test(text)) {
    return <a href={text} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-royal hover:underline">{text}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>;
  }
  return <span className="whitespace-pre-wrap">{text}</span>;
}

export default function TeacherDetailPage() {
  const { id } = useParams<{ id: string }>();
  const load = useCallback(() => api.teachers.get(id), [id]);

  return (
    <DetailShell backHref="/talento" backLabel="Postulaciones de profesores" load={load}>
      {({ application: a, notes, history }, reload) => {
        const answers = a.answers as Answers;
        return (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-6">
              <header>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-navy">{a.name}</h1>
                  <StatusBadge statuses={TEACHER_STATUSES} value={a.status} />
                </div>
                <p className="mt-1.5 text-muted">
                  {[a.city, a.country].filter(Boolean).join(', ')} · Recibida el {formatDateTime(a.created_at)} · formulario v{a.form_version}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a href={`mailto:${a.email}?subject=${encodeURIComponent('Tu postulación en Lux Learning')}`} className="btn-primary">
                    <Mail className="h-4 w-4" aria-hidden="true" /> Escribirle
                  </a>
                  {a.phone && (
                    <a href={`tel:${a.phone.replace(/\s/g, '')}`} className="btn-ghost">
                      <Phone className="h-4 w-4" aria-hidden="true" /> {a.phone}
                    </a>
                  )}
                  {a.profile_url && (
                    <a href={a.profile_url} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" /> Perfil
                    </a>
                  )}
                </div>
              </header>

              <section className="card bg-[linear-gradient(135deg,#FFFFFF,#F2F8FD)] p-6">
                <p className="text-sm font-bold text-muted">Curso que propone</p>
                <p className="mt-1 text-xl font-extrabold text-navy">{String(answers.courseTopic ?? '')}</p>
                <p className="mt-2 leading-relaxed text-ink">{String(answers.courseOutcome ?? '')}</p>
              </section>

              {SECTIONS.map((section) => (
                <section key={section.title} className="card px-6 py-4">
                  <h2 className="pb-1 pt-2 text-sm font-bold text-navy">{section.title}</h2>
                  <dl className="divide-y divide-line">
                    {section.rows.map(([key, label]) => <InfoRow key={key} label={label}>{show(answers[key])}</InfoRow>)}
                  </dl>
                </section>
              ))}

              <section className="card p-6">
                <h2 className="text-sm font-bold text-navy">Por qué quiere enseñar con Lux</h2>
                <p className="mt-2 whitespace-pre-wrap leading-relaxed text-ink">{String(answers.motivation ?? '')}</p>
              </section>
            </div>

            <RecordPanel
              statuses={TEACHER_STATUSES}
              status={a.status}
              owner={a.owner_email}
              notes={notes}
              history={history}
              onUpdate={async (patch) => { await api.teachers.update(id, patch); await reload(); }}
              onAddNote={async (body) => { await api.teachers.addNote(id, body); await reload(); }}
            />
          </div>
        );
      }}
    </DetailShell>
  );
}
