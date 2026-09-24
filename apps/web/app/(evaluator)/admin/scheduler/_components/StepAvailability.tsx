'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, CheckCircle, Bell, Wifi, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import type { CourseCatalogRow } from './types';

const DAY_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function relativeTime(date: string | null | undefined): string {
  if (!date) return 'nunca';
  const diff = Date.now() - new Date(date).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'hace menos de un minuto';
  if (min < 60) return `hace ${min} minuto${min !== 1 ? 's' : ''}`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `hace ${hrs} hora${hrs !== 1 ? 's' : ''}`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `hace ${days} día${days !== 1 ? 's' : ''}`;
  const wks = Math.floor(days / 7);
  if (wks < 5) return `hace ${wks} semana${wks !== 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months !== 1 ? 'es' : ''}`;
}

interface BlockSummary { dayOfWeek: number; startTime: string; endTime: string; modality?: string }
interface TeacherSummary {
  evaluatorId: string; name: string;
  blocks: BlockSummary[]; days: string;
  maxCoursesPerWeek: number; updatedAt: string | null;
}

interface Props { courses: CourseCatalogRow[] }

export function StepAvailability({ courses }: Props) {
  const [summaries, setSummaries] = useState<TeacherSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const teachers = [...new Map(courses.map((c) => [c.evaluatorId, c.teacherName])).entries()];
    if (!teachers.length) { setLoading(false); return; }
    setLoading(true);
    Promise.all(teachers.map(async ([evaluatorId, name]) => {
      const res: any = await api.admin.teachers.getAvailability(evaluatorId).catch(() => null);
      const blocks: BlockSummary[] = res?.data?.blocks ?? [];
      const days = [...new Set(blocks.map((b) => DAY_LABEL[b.dayOfWeek]))].join(', ');
      return {
        evaluatorId, name: name ?? evaluatorId,
        blocks, days,
        maxCoursesPerWeek: res?.data?.maxCoursesPerWeek ?? 5,
        updatedAt: res?.data?.updatedAt ?? null,
      };
    })).then(setSummaries).finally(() => setLoading(false));
  }, [courses]);

  const sendReminder = async (evaluatorId: string) => {
    setSending((s) => ({ ...s, [evaluatorId]: true }));
    try {
      await api.admin.teachers.sendAvailabilityReminder(evaluatorId);
      setSent((s) => ({ ...s, [evaluatorId]: true }));
      setTimeout(() => setSent((s) => ({ ...s, [evaluatorId]: false })), 3000);
    } catch { /* non-fatal */ }
    setSending((s) => ({ ...s, [evaluatorId]: false }));
  };

  if (loading) return (
    <div className="card flex items-center justify-center py-12 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Revisando disponibilidad docente…
    </div>
  );

  const virtualBlocks = (s: TeacherSummary) => s.blocks.filter((b) => b.modality === 'VIRTUAL' || !b.modality);
  const presentialBlocks = (s: TeacherSummary) => s.blocks.filter((b) => b.modality === 'PRESENTIAL');

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-heading font-semibold text-charcoal">Disponibilidad docente</h2>
        <p className="text-xs text-gray-500">Autogestionada por cada profesor en su perfil — acá solo se revisa antes de generar.</p>
      </div>
      <div className="space-y-2">
        {summaries.map((s) => (
          <div key={s.evaluatorId} className="p-3 bg-surface rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-charcoal">{s.name}</p>
                <p className="text-xs text-gray-500">
                  {s.blocks.length > 0
                    ? `${s.blocks.length} bloque(s) — ${s.days} · actualizado ${relativeTime(s.updatedAt)}`
                    : `Sin bloques · ${relativeTime(s.updatedAt) === 'nunca' ? 'nunca configurado' : `última vez ${relativeTime(s.updatedAt)}`}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Tope: {s.maxCoursesPerWeek}/sem</span>
                {s.blocks.length === 0 ? (
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                ) : (
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                )}
                {s.blocks.length > 0 && (
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [s.evaluatorId]: !e[s.evaluatorId] }))}
                    className="text-[10px] text-cta-from hover:underline"
                  >
                    {expanded[s.evaluatorId] ? 'ocultar' : 'ver horario'}
                  </button>
                )}
                {s.blocks.length === 0 && (
                  <button
                    onClick={() => sendReminder(s.evaluatorId)}
                    disabled={sending[s.evaluatorId] || sent[s.evaluatorId]}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-60 transition-colors"
                  >
                    {sending[s.evaluatorId] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}
                    {sent[s.evaluatorId] ? '¡Enviado!' : 'Enviar recordatorio'}
                  </button>
                )}
              </div>
            </div>
            {expanded[s.evaluatorId] && s.blocks.length > 0 && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {virtualBlocks(s).length > 0 && (
                  <div className="space-y-1">
                    <p className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 uppercase tracking-wide">
                      <Wifi className="w-3 h-3" /> Virtual
                    </p>
                    {virtualBlocks(s).map((b, i) => (
                      <p key={i} className="text-xs text-gray-600">{DAY_LABEL[b.dayOfWeek]} {b.startTime}–{b.endTime}</p>
                    ))}
                  </div>
                )}
                {presentialBlocks(s).length > 0 && (
                  <div className="space-y-1">
                    <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">
                      <MapPin className="w-3 h-3" /> Presencial
                    </p>
                    {presentialBlocks(s).map((b, i) => (
                      <p key={i} className="text-xs text-gray-600">{DAY_LABEL[b.dayOfWeek]} {b.startTime}–{b.endTime}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {summaries.some((s) => s.blocks.length === 0) && (
        <p className="text-xs text-amber-600">⚠️ Profesores sin disponibilidad marcada solo recibirán clases presenciales de sábado. Usá "Enviar recordatorio" para notificarles.</p>
      )}
    </div>
  );
}
