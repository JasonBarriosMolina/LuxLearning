'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, dateFnsLocalizer, Views, SlotInfo } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { CalendarDays, Plus, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CalendarFiltersBar } from './_components/CalendarFiltersBar';
import { CalendarEventDetail, CalEvent } from './_components/CalendarEventDetail';
import { CalendarEventForm, CalendarFormState } from './_components/CalendarEventForm';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { es },
});

const EVENT_TYPES = [
  { value: 'class',    color: '#17527E' },
  { value: 'meeting',  color: '#7C3AED' },
  { value: 'event',    color: '#E2BA50' },
  { value: 'deadline', color: '#EF4444' },
  { value: 'reminder', color: '#10B981' },
  { value: 'other',    color: '#6B7280' },
] as const;

type EventType = typeof EVENT_TYPES[number]['value'];
type Visibility = 'private' | 'evaluators' | 'students' | 'community' | 'course_mine' | 'course_all';
type Recurrence = 'none' | 'weekly' | 'monthly' | 'weekdays' | 'custom_days';
type LayerFilter = 'own' | 'evaluators' | 'students';

interface BigCalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CalEvent;
}

const EMPTY_FORM: CalendarFormState = {
  title: '',
  description: '',
  type: 'event' as EventType,
  startDate: '',
  endDate: '',
  allDay: false,
  visibility: 'evaluators' as Visibility,
  location: '',
  recurrence: 'none' as Recurrence,
  recurrenceDays: [],
  recurrenceEndDate: '',
  targetCourseId: '',
  targetStudentIds: [],
  targetEvaluatorIds: [],
};

const calMessages = {
  next: 'Siguiente', previous: 'Anterior', today: 'Hoy',
  month: 'Mes', week: 'Semana', day: 'Día', agenda: 'Agenda',
  date: 'Fecha', time: 'Hora', event: 'Evento',
  noEventsInRange: 'Sin eventos en este período',
  showMore: (n: number) => `+${n} más`,
};

function typeColor(type: string) {
  return (EVENT_TYPES as readonly { value: string; color: string }[]).find((t) => t.value === type)?.color ?? '#6B7280';
}

function toLocalDatetimeInput(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addMinutes(datetimeLocal: string, minutes: number): string {
  if (!datetimeLocal) return '';
  const d = new Date(datetimeLocal);
  d.setMinutes(d.getMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EvaluatorCalendarPage() {
  const { role, userId: currentUserId } = useAuth();
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<string>(Views.MONTH);
  const [date, setDate] = useState(new Date());
  const [layers, setLayers] = useState<Set<LayerFilter>>(new Set(['own', 'evaluators']));
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [myCourses, setMyCourses] = useState<{ id: string; title: string }[]>([]);
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

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [form, setForm] = useState<CalendarFormState>(EMPTY_FORM);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [showAdvancedVisibility, setShowAdvancedVisibility] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [evaluatorSearch, setEvaluatorSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);

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

  const toggleLayer = (layer: LayerFilter) => {
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        if (next.size > 1) next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  };

  const filtered = useMemo(() => events.filter((ev) => {
    const isOwn = ev.creatorId === currentUserId;
    if (isOwn && layers.has('own')) return true;
    if (!isOwn && layers.has('evaluators') && (ev.creatorRole === 'EVALUATOR' || ev.creatorRole === 'ADMIN' || ev.creatorRole === 'SUPER_ADMIN')) return true;
    return false;
  }), [events, layers, currentUserId]);

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

  const handleSelectSlot = (slot: SlotInfo) => {
    const start = slot.start instanceof Date ? slot.start : new Date(slot.start);
    const end   = slot.end   instanceof Date ? slot.end   : new Date(slot.end);
    const pad = (n: number) => String(n).padStart(2, '0');
    const toInput = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const startStr = toInput(start);
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
      type: ev.type as EventType,
      startDate: toLocalDatetimeInput(ev.startDate),
      endDate: toLocalDatetimeInput(ev.endDate),
      allDay: ev.allDay,
      visibility: ev.visibility as Visibility,
      location: ev.location ?? '',
      recurrence: (ev.recurrence ?? 'none') as Recurrence,
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
      <CalendarFiltersBar layers={layers} onToggle={toggleLayer} isAdmin={isAdmin} />

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
        <CalendarEventDetail
          selected={selected}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          deleting={deleting}
          onEdit={openEdit}
          onDelete={handleDelete}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingEvent ? 'Editar evento' : 'Nuevo evento'}
        size="lg"
      >
        <CalendarEventForm
          editingEvent={editingEvent}
          form={form}
          setForm={setForm}
          durationMinutes={durationMinutes}
          setDurationMinutes={setDurationMinutes}
          showAdvancedVisibility={showAdvancedVisibility}
          setShowAdvancedVisibility={setShowAdvancedVisibility}
          studentSearch={studentSearch}
          setStudentSearch={setStudentSearch}
          evaluatorSearch={evaluatorSearch}
          setEvaluatorSearch={setEvaluatorSearch}
          myCourses={myCourses}
          allStudents={allStudents}
          allEvaluators={allEvaluators}
          saving={saving}
          error={error}
          onSubmit={handleSave}
          onClose={() => setModalOpen(false)}
          addMinutes={addMinutes}
        />
      </Modal>
    </div>
  );
}
