'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, dateFnsLocalizer, Views, SlotInfo } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import {
  CalendarDays, Plus, X, Pencil, Trash2, Loader2,
  Users, User, Globe, Lock, MapPin, BookOpen, ChevronDown,
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
  { value: 'private',    label: 'Solo yo',            icon: <Lock className="w-3.5 h-3.5" /> },
  { value: 'evaluators', label: 'Evaluadores',         icon: <User className="w-3.5 h-3.5" /> },
  { value: 'students',   label: 'Estudiantes',         icon: <Users className="w-3.5 h-3.5" /> },
  { value: 'community',  label: 'Toda la comunidad',   icon: <Globe className="w-3.5 h-3.5" /> },
] as const;

type Visibility = typeof VISIBILITY_OPTIONS[number]['value'];

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
  return VISIBILITY_OPTIONS.find((v) => v.value === vis)?.label ?? vis;
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

  // Create / edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
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
    const end = slot.end instanceof Date ? slot.end : new Date(slot.end);
    const pad = (n: number) => String(n).padStart(2, '0');
    const toInput = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setEditingEvent(null);
    setForm({ ...EMPTY_FORM, startDate: toInput(start), endDate: toInput(end), allDay: slot.action === 'select' });
    setError('');
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditingEvent(null);
    setForm(EMPTY_FORM);
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
    });
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

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Inicio</label>
              <input
                type="datetime-local"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
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
              {VISIBILITY_OPTIONS.filter((v) =>
                isAdmin ? true : v.value !== 'students' || true // evaluadores también pueden compartir con estudiantes
              ).map((v) => (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, visibility: v.value }))}
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
