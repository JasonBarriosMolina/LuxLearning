'use client';

import { Pencil, Trash2, Loader2, X, MapPin } from 'lucide-react';

const EVENT_TYPES = [
  { value: 'class',    label: 'Clase',         color: '#17527E' },
  { value: 'meeting',  label: 'Reunión',        color: '#7C3AED' },
  { value: 'event',    label: 'Evento',         color: '#E2BA50' },
  { value: 'deadline', label: 'Fecha límite',   color: '#EF4444' },
  { value: 'reminder', label: 'Recordatorio',   color: '#10B981' },
  { value: 'other',    label: 'Otro',           color: '#6B7280' },
] as const;

const VISIBILITY_LABELS: Record<string, string> = {
  private: 'Solo yo', evaluators: 'Evaluadores', students: 'Estudiantes',
  community: 'Toda la comunidad', course_mine: 'Mis cursos', course_all: 'Todos los cursos',
};

function typeColor(type: string) {
  return EVENT_TYPES.find((t) => t.value === type)?.color ?? '#6B7280';
}
function typeLabel(type: string) {
  return EVENT_TYPES.find((t) => t.value === type)?.label ?? type;
}
function formatDisplayDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export interface CalEvent {
  creatorId: string;
  eventId: string;
  title: string;
  description?: string;
  type: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  visibility: string;
  color?: string;
  location?: string;
  targetCourseId?: string;
  creatorRole?: string;
  createdAt: string;
  recurrence?: string;
  recurrenceDays?: number[];
  recurrenceEndDate?: string;
  recurrenceGroupId?: string;
}

interface Props {
  selected: CalEvent;
  currentUserId: string | undefined;
  isAdmin: boolean;
  deleting: boolean;
  onEdit: (ev: CalEvent) => void;
  onDelete: (ev: CalEvent) => void;
  onClose: () => void;
}

export function CalendarEventDetail({ selected, currentUserId, isAdmin, deleting, onEdit, onDelete, onClose }: Props) {
  return (
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
            <span className="text-xs text-gray-400">
              {VISIBILITY_LABELS[selected.visibility] ?? selected.visibility}
            </span>
          </div>
          <h3 className="font-heading font-bold text-lg text-charcoal">{selected.title}</h3>
          <div className="text-sm text-gray-500 space-y-1">
            <p>🕐 {formatDisplayDate(selected.startDate)} → {formatDisplayDate(selected.endDate)}</p>
            {selected.location && (
              <p className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> {selected.location}
              </p>
            )}
            {selected.description && <p className="text-gray-600 mt-1">{selected.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(selected.creatorId === currentUserId || isAdmin) && (
            <>
              <button
                onClick={() => onEdit(selected)}
                className="p-2 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => onDelete(selected)}
                disabled={deleting}
                className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
