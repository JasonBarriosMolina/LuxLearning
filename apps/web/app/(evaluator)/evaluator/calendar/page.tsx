'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, dateFnsLocalizer, Views, SlotInfo } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import {
  CalendarDays, Plus, X, Pencil, Trash2, Loader2,
  Users, User, Globe, Lock, MapPin, ChevronDown, ChevronRight, RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { es },
});

const EVENT_TYPES = [
  { value: 'class',    label: 'Clase',         color: '#17527E', bg: 'bg-[#17527E]' },
  { value: 'meeting',  label: 'Reunión',        color: '#7C3AED', bg: 'bg-purple-600' },
  { value: 'event',    label: 'Evento',         color: '#E2BA50', bg: 'bg-[#E2BA50]' },
  { value: 'deadline', label: 'Fecha límite',   color: '#EF4444', bg: 'bg-red-500' },
  { value: 'reminder', label: 'Recordatorio',   color: '#10B981', bg: 'bg-emerald-500' },
  { value: 'other',    label: 'Otro',           color: '#6B7280', bg: 'bg-gray-500' },
] as const;

type EventType = typeof EVENT_TYPES[number]['value'];

const VISIBILITY_OPTIONS = [
  { value: 'private',     label: 'Solo yo',            icon: <Lock className="w-3.5 h-3.5" />,    advanced: false },
  { value: 'evaluators',  label: 'Evaluadores',         icon: <User className="w-3.5 h-3.5" />,    advanced: false },
  { value: 'students',    label: 'Estudiantes',         icon: <Users className="w-3.5 h-3.5" />,   advanced: false },
  { value: 'community',   label: 'Toda la comunidad',   icon: <Globe className="w-3.5 h-3.5" />,   advanced: false },
  { value: 'course_mine', label: 'Mis cursos',          icon: <CalendarDays className="w-3.5 h-3.5" />, advanced: true },
  { value: 'course_all',  label: 'Todos los cursos',    icon: <Globe className="w-3.5 h-3.5" />,   advanced: true },
] as const;

type Visibility = typeof VISIBILITY_OPTIONS[number]['value'];

const RECURRENCE_OPTIONS = [
  { value: 'none',        label: 'Sin recurrencia' },
  { value: 'weekly',      label: 'Semanal' },
  { value: 'monthly',     label: 'Mensual' },
  { value: 'weekdays',    label: 'Lunes a viernes' },
  { value: 'custom_days', label: 'Días específicos' },
] as const;

type Recurrence = typeof RECURRENCE_OPTIONS[number]['value'];

const WEEKDAYS = [
  { label: 'D', value: 0 }, { label: 'L', value: 1 }, { label: 'M', value: 2 },
  { label: 'X', value: 3 }, { label: 'J', value: 4 }, { label: 'V', value: 5 },
  { label: 'S', value: 6 },
];

const DURATIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '2 horas', minutes: 120 },
  { label: '3 horas', minutes: 180 },
];

interface CalEvent {
  creatorId: string;
  eventId: string;
  title: string;
  description?: string;
  type: EventType;
  startDate: string;
  endDate: string;
  allDay: boolean;
  visibility: Visibility;
  color?: string;
  location?: string;
  targetCourseId?: string;
  creatorRole?: string;
  createdAt: string;
  recurrence?: Recurrence;
  recurrenceDays?: number[];
  recurrenceEndDate?: string;
  recurrenceGroupId?: string;
}

interface BigCalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CalEvent;
}

type LayerFilter = 'own' | 'evaluators' | 'students';

const EMPTY_FORM = {
  title: '',
  description: '',
  type: 'event' as EventType,
  startDate: '',
  endDate: '',
  allDay: false,
  visibility: 'evaluators' as Visibility,
  location: '',
  recurrence: 'none' as Recurrence,
  recurrenceDays: [] as number[],
  recurrenceEndDate: '',
  targetCourseId: '',
  targetStudentIds: [] as string[],
  targetEvaluatorIds: [] as string[],
};

const calMessages = {
  next: 'Siguiente', previous: 'Anterior', today: 'Hoy',
  month: 'Mes', week: 'Semana', day: 'Día', agenda: 'Agenda',
  date: 'Fecha', time: 'Hora', event: 'Evento',
  noEventsInRange: 'Sin eventos en este período',
  showMore: (n: number) => `+${n} más`,
};

function typeColor(type: string) {
  return EVENT_TYPES.find((t) => t.value === type)?.color ?? '#6B7280';
}
function typeLabel(type: string) {
  return EVENT_TYPES.find((t) => t.value === type)?.label ?? type;
}
function visLabel(vis: string) {
  const labels: Record<string, string> = {
    private: 'Solo yo', evaluators: 'Evaluadores', students: 'Estudiantes',
    community: 'Toda la comunidad', course_mine: 'Mis cursos', course_all: 'Todos los cursos',
  };
  return labels[vis] ?? vis;
}

function toLocalDatetimeInput(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDisplayDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function EvaluatorCalendarPage() {
  const { role, userId: currentUserId } = useAuth();
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<string>(Views.MONTH);
  const [date, setDate] = useState(new Date());

  // Layer filters
  const [layers, setLayers] = useState<Set<LayerFilter>>(new Set(['own', 'evaluators']));

  // Selected event (detail panel)
  const [selected, setSelected] = useState<CalEvent | null>(null);

  // My courses (for course_mine visibility selector)
  const [myCourses, setMyCourses] = useState<{ id: string; title: string }[]>([]);
  // Students + evaluators for visibility sub-selectors
  const [allStudents, setAllStudents] = useState<{ userId: string; name: string; email: string }[]>([]);
  const [allEvaluators, setAllEvaluators] = useState<{ userId: string; name: string; email: string }[]>([]);

  useEffect(() => {
    if (!currentUserId) return;
    api.evaluator.myCourses().then((res: any) => {
      const list = Array.isArray(res) ? res : (res?.data ?? res?.courses ?? []);
      setMyCourses(list.map((c: any) => ({ id: c.id ?? c.courseId, title: c.title })));
    }).catch(() => {});
    api.evaluator.groups.studentPool().then((res: any) => {
      const list = Array.isArray(res) ? res : (res?.data ?? res?.students ?? []);
      setAllStudents(list);
    }).catch(() => {});
    api.evaluator.evaluatorsList().then((res: any) => {
      const list = Array.isArray(res) ? res : (res?.data ?? res?.evaluators ?? []);
      setAllEvaluators(list);
    }).catch(() => {});
  }, [currentUserId]);

  // Create / edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [showAdvancedVisibility, setShowAdvancedVisibility] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);

  const addMinutes = (datetimeLocal: string, minutes: number): string => {
    if (!datetimeLocal) return '';
    const d = new Date(datetimeLocal);
    d.setMinutes(d.getMinutes() + minutes);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const load = async () => {
    try {
      const res = await api.evaluator.calendar.list();
      setEvents(Array.isArray(res) ? res : (res?.data ?? []));
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Toggle layer filter
  const toggleLayer = (layer: LayerFilter) => {
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        if (next.size > 1) next.delete(layer); // keep at least one
      } else {
        next.add(layer);
      }
      return next;
    });
  };

  // Filter events by active layers
  const filtered = useMemo(() => events.filter((ev) => {
    const isOwn = ev.creatorId === currentUserId;
    if (isOwn && layers.has('own')) return true;
    if (!isOwn && layers.has('evaluators') && (ev.creatorRole === 'EVALUATOR' || ev.creatorRole === 'ADMIN' || ev.creatorRole === 'SUPER_ADMIN')) return true;
    return false;
  }), [events, layers, currentUserId]);

  // Convert to react-big-calendar events
  const bigCalEvents: BigCalEvent[] = filtered.map((ev) => ({
    id: ev.eventId,
    title: ev.title,
    start: new Date(ev.startDate),
    end: new Date(ev.endDate),
    allDay: ev.allDay,
    resource: ev,
  }));

  const eventPropGetter = (event: BigCalEvent) => ({
    style: {
      backgroundColor: typeColor(event.resource.type),
      borderRadius: '6px',
      border: 'none',
      color: 'white',
      fontSize: '12px',
      fontWeight: 500,
      opacity: event.resource.creatorId !== currentUserId ? 0.75 : 1,
    },
  });

  // Click on a slot → pre-fill form
  const handleSelectSlot = (slot: SlotInfo) => {
    const start = slot.start instanceof Date ? slot.start : new Date(slot.start);
    const end   = slot.end   instanceof Date ? slot.end   : new Date(slot.end);
    const pad = (n: number) => String(n).padStart(2, '0');
    const toInput = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const startStr = toInput(start);
    // Month-view click lands on midnight → treat as all-day; week/day time-grid clicks should never be all-day
    const inMonthView = view === Views.MONTH;
    const isMidnightClick = inMonthView && start.getHours() === 0 && start.getMinutes() === 0 && slot.action === 'click';
    const isAllDay = slot.action === 'select' || isMidnightClick;
    const endStr = isAllDay ? toInput(end) : addMinutes(startStr, 60);
    setEditingEvent(null);
    setDurationMinutes(60);
    setShowAdvancedVisibility(false);
    setForm({ ...EMPTY_FORM, startDate: startStr, endDate: endStr, allDay: isAllDay });
    setError('');
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditingEvent(null);
    setForm(EMPTY_FORM);
    setDurationMinutes(60);
    setShowAdvancedVisibility(false);
    setError('');
    setModalOpen(true);
  };

  const openEdit = (ev: CalEvent) => {
    setSelected(null);
    setEditingEvent(ev);
    setForm({
      title: ev.title,
      description: ev.description ?? '',
      type: ev.type,
      startDate: toLocalDatetimeInput(ev.startDate),
      endDate: toLocalDatetimeInput(ev.endDate),
      allDay: ev.allDay,
      visibility: ev.visibility,
      location: ev.location ?? '',
      recurrence: ev.recurrence ?? 'none',
      recurrenceDays: ev.recurrenceDays ?? [],
      recurrenceEndDate: ev.recurrenceEndDate ?? '',
      targetCourseId: ev.targetCourseId ?? '',
      targetStudentIds: (ev as any).targetStudentIds ?? [],
      targetEvaluatorIds: (ev as any).targetEvaluatorIds ?? [],
    });
    setDurationMinutes(60);
    setShowAdvancedVisibility(ev.visibility === 'course_mine' || ev.visibility === 'course_all');
    setError('');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    if (!form.title || !form.startDate || !form.endDate) {
      setError('Título, fecha de inicio y fin son requeridos');
      return;
    }
    if (!form.allDay && new Date(form.endDate) <= new Date(form.startDate)) {
      setError('La fecha de fin debe ser posterior a la de inicio');
      return;
    }
    if (form.recurrence === 'custom_days' && form.recurrenceDays.length === 0) {
      setError('Selecciona al menos un día para la recurrencia personalizada');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description || undefined,
        type: form.type,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
        allDay: form.allDay,
        visibility: form.visibility,
        location: form.location || undefined,
        ...(form.visibility === 'course_mine' && form.targetCourseId ? { targetCourseId: form.targetCourseId } : {}),
        ...(form.visibility === 'students' && form.targetStudentIds.length > 0 ? { targetStudentIds: form.targetStudentIds } : {}),
        ...(form.visibility === 'evaluators' && form.targetEvaluatorIds.length > 0 ? { targetEvaluatorIds: form.targetEvaluatorIds } : {}),
        ...(form.recurrence !== 'none' ? {
          recurrence: form.recurrence,
          recurrenceDays: form.recurrenceDays.length > 0 ? form.recurrenceDays : undefined,
          recurrenceEndDate: form.recurrenceEndDate || undefined,
        } : {}),
      };
      if (editingEvent) {
        await api.evaluator.calendar.update(editingEvent.eventId, {
          ...payload,
          ...(isAdmin && editingEvent.creatorId !== currentUserId ? { creatorId: editingEvent.creatorId } : {}),
        });
      } else {
        await api.evaluator.calendar.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Error al guardar');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async (ev: CalEvent) => {
    if (!confirm(`¿Eliminar "${ev.title}"?`)) return;
    setDeleting(true);
    try {
      const creatorId = ev.creatorId !== currentUserId ? ev.creatorId : undefined;
      await api.evaluator.calendar.delete(ev.eventId, creatorId);
      setSelected(null);
      await load();
    } catch {
      alert('Error al eliminar');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-cta-from" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-6 h-6 text-cta-from" />
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">Calendario</h1>
            <p className="text-sm text-gray-400">
              {isAdmin ? 'Gestión de eventos para toda la comunidad' : 'Eventos y clases para tus estudiantes'}
            </p>
          </div>
        </div>
        <Button onClick={openCreate} leftIcon={<Plus className="w-4 h-4" />}>
          Nuevo evento
        </Button>
      </div>

      {/* Layer filters + legend */}
      <div className="card p-4 flex flex-wrap items-center gap-4">
        <span className="text-xs font-medium text-gray-500 shrink-0">Mostrar calendarios:</span>
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'own' as LayerFilter, label: 'Mis eventos', icon: <Lock className="w-3.5 h-3.5" /> },
            { key: 'evaluators' as LayerFilter, label: 'Otros evaluadores', icon: <User className="w-3.5 h-3.5" /> },
            ...(isAdmin ? [{ key: 'students' as LayerFilter, label: 'Estudiantes', icon: <Users className="w-3.5 h-3.5" /> }] : []),
          ]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => toggleLayer(key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                layers.has(key)
                  ? 'bg-[#17527E] border-[#17527E] text-white'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              )}
            >
              {icon} {label}
            </button>
          ))}
        </div>
        {/* Type legend */}
        <div className="flex flex-wrap gap-3 ml-auto">
          {EVENT_TYPES.map((t) => (
            <span key={t.value} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {/* Calendar */}
      <div className="card p-0 overflow-hidden">
        <div style={{ height: 620 }} className="p-4">
          <Calendar
            localizer={localizer}
            events={bigCalEvents}
            view={view as any}
            onView={(v) => setView(v)}
            date={date}
            onNavigate={setDate}
            eventPropGetter={eventPropGetter}
            onSelectEvent={(ev: BigCalEvent) => setSelected(ev.resource)}
            onSelectSlot={handleSelectSlot}
            selectable
            messages={calMessages}
            culture="es"
            startAccessor="start"
            endAccessor="end"
            popup
          />
        </div>
      </div>

      {/* Event detail panel */}
      {selected && (
        <div className="card border-l-4 animate-fade-in" style={{ borderLeftColor: typeColor(selected.type) }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: typeColor(selected.type) }}
                >
                  {typeLabel(selected.type)}
                </span>
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  {VISIBILITY_OPTIONS.find((v) => v.value === selected.visibility)?.icon}
                  {visLabel(selected.visibility)}
                </span>
              </div>
              <h3 className="font-heading font-bold text-lg text-charcoal">{selected.title}</h3>
              <div className="text-sm text-gray-500 space-y-1">
                <p>🕐 {formatDisplayDate(selected.startDate)} → {formatDisplayDate(selected.endDate)}</p>
                {selected.location && <p className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {selected.location}</p>}
                {selected.description && <p className="text-gray-600 mt-1">{selected.description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(selected.creatorId === currentUserId || isAdmin) && (
                <>
                  <button onClick={() => openEdit(selected)} className="p-2 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(selected)} disabled={deleting} className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40">
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </>
              )}
              <button onClick={() => setSelected(null)} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingEvent ? 'Editar evento' : 'Nuevo evento'}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Título"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Clase de introducción, Reunión de equipo…"
            required
          />

          {/* Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">Tipo de evento</label>
            <div className="grid grid-cols-3 gap-2">
              {EVENT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t.value }))}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-medium transition-all',
                    form.type === t.value
                      ? 'border-transparent text-white'
                      : 'border-border text-gray-500 hover:border-gray-300 bg-white'
                  )}
                  style={form.type === t.value ? { backgroundColor: t.color, borderColor: t.color } : {}}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: form.type === t.value ? 'white' : t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dates + duration */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-charcoal">Inicio</label>
                <input
                  type="datetime-local"
                  value={form.startDate}
                  onChange={(e) => {
                    const start = e.target.value;
                    setForm((f) => ({
                      ...f,
                      startDate: start,
                      endDate: (!f.endDate || new Date(f.endDate) <= new Date(start))
                        ? addMinutes(start, durationMinutes)
                        : f.endDate,
                    }));
                  }}
                  className="input-field"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-charcoal">Fin</label>
                <input
                  type="datetime-local"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  className="input-field"
                  required
                />
              </div>
            </div>
            {/* Duration chips */}
            {!form.allDay && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400">Duración:</span>
                {DURATIONS.map((d) => (
                  <button
                    key={d.minutes}
                    type="button"
                    onClick={() => {
                      setDurationMinutes(d.minutes);
                      if (form.startDate) {
                        setForm((f) => ({ ...f, endDate: addMinutes(f.startDate, d.minutes) }));
                      }
                    }}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                      durationMinutes === d.minutes && form.endDate === addMinutes(form.startDate, d.minutes)
                        ? 'bg-[#17527E] border-[#17527E] text-white'
                        : 'border-border text-gray-500 hover:border-gray-300'
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* All day */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(e) => setForm((f) => ({ ...f, allDay: e.target.checked }))}
              className="w-4 h-4 accent-cta-from"
            />
            <span className="text-sm text-charcoal">Todo el día</span>
          </label>

          {/* Recurrence */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Recurrencia
            </label>
            <div className="flex flex-wrap gap-2">
              {RECURRENCE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, recurrence: r.value }))}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                    form.recurrence === r.value
                      ? 'bg-[#17527E] border-[#17527E] text-white'
                      : 'border-border text-gray-500 hover:border-gray-300'
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {form.recurrence === 'custom_days' && (
              <div className="flex gap-1.5 mt-2">
                {WEEKDAYS.map((wd) => (
                  <button
                    key={wd.value}
                    type="button"
                    onClick={() => setForm((f) => ({
                      ...f,
                      recurrenceDays: f.recurrenceDays.includes(wd.value)
                        ? f.recurrenceDays.filter((d) => d !== wd.value)
                        : [...f.recurrenceDays, wd.value],
                    }))}
                    className={cn(
                      'w-8 h-8 rounded-full text-xs font-bold border transition-all',
                      form.recurrenceDays.includes(wd.value)
                        ? 'bg-[#17527E] border-[#17527E] text-white'
                        : 'border-border text-gray-500 hover:border-gray-300'
                    )}
                  >
                    {wd.label}
                  </button>
                ))}
              </div>
            )}
            {form.recurrence !== 'none' && (
              <div className="space-y-1 mt-2">
                <label className="text-xs text-gray-500">Repetir hasta (opcional)</label>
                <input
                  type="date"
                  value={form.recurrenceEndDate}
                  onChange={(e) => setForm((f) => ({ ...f, recurrenceEndDate: e.target.value }))}
                  className="input-field text-sm"
                />
              </div>
            )}
          </div>

          {/* Location */}
          <Input
            label="Lugar / enlace (opcional)"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            placeholder="Sala de reuniones, https://meet.google.com/…"
          />

          {/* Description */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Descripción (opcional)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Agenda, notas, instrucciones…"
              className="input-field min-h-[72px] resize-y"
            />
          </div>

          {/* Visibility */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">Visibilidad</label>
            <div className="grid grid-cols-2 gap-2">
              {VISIBILITY_OPTIONS.filter((v) => !v.advanced).map((v) => (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, visibility: v.value, targetCourseId: '', targetStudentIds: [], targetEvaluatorIds: [] }))}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all text-left',
                    form.visibility === v.value
                      ? 'border-cta-from bg-blue-50 text-[#17527E]'
                      : 'border-border text-gray-500 hover:border-gray-300'
                  )}
                >
                  {v.icon}
                  {v.label}
                </button>
              ))}
            </div>
            {/* Advanced visibility */}
            <button
              type="button"
              onClick={() => setShowAdvancedVisibility((v) => !v)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mt-1 transition-colors"
            >
              {showAdvancedVisibility ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Opciones avanzadas por curso
            </button>
            {showAdvancedVisibility && (
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  {VISIBILITY_OPTIONS.filter((v) => v.advanced).map((v) => (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, visibility: v.value, targetCourseId: '', targetStudentIds: [], targetEvaluatorIds: [] }))}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all text-left',
                        form.visibility === v.value
                          ? 'border-cta-from bg-blue-50 text-[#17527E]'
                          : 'border-border text-gray-500 hover:border-gray-300'
                      )}
                    >
                      {v.icon}
                      {v.label}
                    </button>
                  ))}
                </div>
                {form.visibility === 'course_mine' && myCourses.length > 0 && (
                  <select
                    value={form.targetCourseId}
                    onChange={(e) => setForm((f) => ({ ...f, targetCourseId: e.target.value }))}
                    className="w-full rounded-xl border-2 border-border px-3 py-2.5 text-sm text-gray-700 bg-white focus:outline-none focus:border-cta-from transition-colors"
                  >
                    <option value="">— Todos mis cursos —</option>
                    {myCourses.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Students sub-selector */}
            {form.visibility === 'students' && (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-gray-500 font-medium">¿A quiénes va dirigido?</p>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, targetStudentIds: [] }))}
                  className={cn(
                    'px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all',
                    form.targetStudentIds.length === 0
                      ? 'border-cta-from bg-blue-50 text-[#17527E]'
                      : 'border-border text-gray-500 hover:border-gray-300'
                  )}
                >
                  Todos los estudiantes
                </button>
                {allStudents.length > 0 && (
                  <div className="max-h-40 overflow-y-auto border-2 border-border rounded-xl divide-y divide-border">
                    {allStudents.map((s) => {
                      const checked = form.targetStudentIds.includes(s.userId);
                      return (
                        <label
                          key={s.userId}
                          className={cn('flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors text-sm', checked ? 'bg-blue-50' : 'hover:bg-surface')}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setForm((f) => ({
                              ...f,
                              targetStudentIds: checked
                                ? f.targetStudentIds.filter((id) => id !== s.userId)
                                : [...f.targetStudentIds, s.userId],
                            }))}
                            className="rounded accent-[#17527E]"
                          />
                          <span className="flex-1 truncate font-medium text-charcoal">{s.name}</span>
                          <span className="text-xs text-gray-400 truncate">{s.email}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {form.targetStudentIds.length > 0 && (
                  <p className="text-xs text-[#17527E] font-medium">
                    {form.targetStudentIds.length} estudiante{form.targetStudentIds.length > 1 ? 's' : ''} seleccionado{form.targetStudentIds.length > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )}

            {/* Evaluators sub-selector */}
            {form.visibility === 'evaluators' && (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-gray-500 font-medium">¿A quiénes va dirigido?</p>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, targetEvaluatorIds: [] }))}
                  className={cn(
                    'px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all',
                    form.targetEvaluatorIds.length === 0
                      ? 'border-cta-from bg-blue-50 text-[#17527E]'
                      : 'border-border text-gray-500 hover:border-gray-300'
                  )}
                >
                  Todos los evaluadores
                </button>
                {allEvaluators.length > 0 && (
                  <div className="max-h-40 overflow-y-auto border-2 border-border rounded-xl divide-y divide-border">
                    {allEvaluators.map((e) => {
                      const checked = form.targetEvaluatorIds.includes(e.userId);
                      return (
                        <label
                          key={e.userId}
                          className={cn('flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors text-sm', checked ? 'bg-blue-50' : 'hover:bg-surface')}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setForm((f) => ({
                              ...f,
                              targetEvaluatorIds: checked
                                ? f.targetEvaluatorIds.filter((id) => id !== e.userId)
                                : [...f.targetEvaluatorIds, e.userId],
                            }))}
                            className="rounded accent-[#17527E]"
                          />
                          <span className="flex-1 truncate font-medium text-charcoal">{e.name}</span>
                          <span className="text-xs text-gray-400 truncate">{e.email}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {form.targetEvaluatorIds.length > 0 && (
                  <p className="text-xs text-[#17527E] font-medium">
                    {form.targetEvaluatorIds.length} evaluador{form.targetEvaluatorIds.length > 1 ? 'es' : ''} seleccionado{form.targetEvaluatorIds.length > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={saving}>{editingEvent ? 'Guardar cambios' : 'Crear evento'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
