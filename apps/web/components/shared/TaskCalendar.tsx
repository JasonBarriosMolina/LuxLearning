'use client';

import { useState } from 'react';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { TASK_TYPE_COLORS, TASK_TYPE_LABELS } from '@/lib/constants/task-colors';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { es },
});

interface Task {
  taskId: string;
  title: string;
  dueDate: string;
  status: 'PENDING' | 'COMPLETED' | 'OVERDUE';
  type: string;
  courseTitle?: string;
  moduleTitle?: string;
  userId?: string;
  description?: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: Task;
}

interface Props {
  tasks: Task[];
  role?: 'STUDENT' | 'EVALUATOR';
  onEventClick?: (task: Task) => void;
}

// Unique types for legend (derived from TASK_TYPE_COLORS)
const TYPE_LEGEND_ENTRIES = Object.entries(TASK_TYPE_LABELS);

export function TaskCalendar({ tasks, role = 'STUDENT', onEventClick }: Props) {
  const [view, setView] = useState<(typeof Views)[keyof typeof Views]>(Views.MONTH);
  const [date, setDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Task | null>(null);

  const events: CalendarEvent[] = tasks.map((t) => {
    const d = new Date(t.dueDate + 'T12:00:00');
    return {
      id: t.taskId,
      title: t.title,
      start: d,
      end: d,
      resource: t,
    };
  });

  const eventPropGetter = (event: CalendarEvent) => ({
    style: {
      backgroundColor: TASK_TYPE_COLORS[event.resource.type] ?? '#6B7280',
      borderRadius: '6px',
      border: 'none',
      color: 'white',
      fontSize: '12px',
      fontWeight: 500,
      opacity: event.resource.status === 'COMPLETED' ? 0.55 : 1,
    },
  });

  const handleSelectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event.resource);
    onEventClick?.(event.resource);
  };

  const messages = {
    next: 'Siguiente',
    previous: 'Anterior',
    today: 'Hoy',
    month: 'Mes',
    week: 'Semana',
    day: 'Día',
    agenda: 'Agenda',
    date: 'Fecha',
    time: 'Hora',
    event: 'Tarea',
    noEventsInRange: 'No hay tareas en este período',
  };

  return (
    <div className="space-y-4">
      {/* Legend — by type */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        {TYPE_LEGEND_ENTRIES.map(([type, label]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ backgroundColor: TASK_TYPE_COLORS[type] }} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 ml-2 pl-2 border-l border-gray-200">
          <span className="w-3 h-3 rounded-full inline-block bg-gray-300 shrink-0 opacity-55" />
          Completada (tenue)
        </span>
      </div>

      <div style={{ height: 520 }}>
        <Calendar
          localizer={localizer}
          events={events}
          view={view}
          onView={(v) => setView(v)}
          date={date}
          onNavigate={setDate}
          eventPropGetter={eventPropGetter}
          onSelectEvent={handleSelectEvent}
          messages={messages}
          culture="es"
          startAccessor="start"
          endAccessor="end"
          popup
        />
      </div>

      {/* Event detail popover */}
      {selectedEvent && (
        <div className="card border border-border p-4 animate-fade-in">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-charcoal">{selectedEvent.title}</h3>
              {selectedEvent.courseTitle && (
                <p className="text-xs text-gray-500 mt-0.5">{selectedEvent.courseTitle}{selectedEvent.moduleTitle ? ` · ${selectedEvent.moduleTitle}` : ''}</p>
              )}
              {selectedEvent.description && (
                <p className="text-sm text-gray-600 mt-2">{selectedEvent.description}</p>
              )}
              <div className="flex items-center gap-3 mt-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  selectedEvent.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                  selectedEvent.status === 'OVERDUE' ? 'bg-red-100 text-red-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {selectedEvent.status === 'COMPLETED' ? 'Completada' : selectedEvent.status === 'OVERDUE' ? 'Vencida' : 'Pendiente'}
                </span>
                <span className="text-xs text-gray-400">
                  Vence: {new Date(selectedEvent.dueDate + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>
            <button onClick={() => setSelectedEvent(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          </div>
        </div>
      )}
    </div>
  );
}
