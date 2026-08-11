'use client';

import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

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
  { value: 'private',     label: 'Solo yo',           advanced: false },
  { value: 'evaluators',  label: 'Evaluadores',        advanced: false },
  { value: 'students',    label: 'Estudiantes',        advanced: false },
  { value: 'community',   label: 'Toda la comunidad',  advanced: false },
  { value: 'course_mine', label: 'Mis cursos',         advanced: true },
  { value: 'course_all',  label: 'Todos los cursos',   advanced: true },
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

export interface CalendarFormState {
  title: string;
  description: string;
  type: EventType;
  startDate: string;
  endDate: string;
  allDay: boolean;
  visibility: Visibility;
  location: string;
  recurrence: Recurrence;
  recurrenceDays: number[];
  recurrenceEndDate: string;
  targetCourseId: string;
  targetStudentIds: string[];
  targetEvaluatorIds: string[];
}

interface CalEvent {
  eventId: string;
  title: string;
}

interface Props {
  editingEvent: CalEvent | null;
  form: CalendarFormState;
  setForm: React.Dispatch<React.SetStateAction<CalendarFormState>>;
  durationMinutes: number;
  setDurationMinutes: (n: number) => void;
  showAdvancedVisibility: boolean;
  setShowAdvancedVisibility: React.Dispatch<React.SetStateAction<boolean>>;
  studentSearch: string;
  setStudentSearch: (s: string) => void;
  evaluatorSearch: string;
  setEvaluatorSearch: (s: string) => void;
  myCourses: { id: string; title: string }[];
  allStudents: { userId: string; name: string; email: string }[];
  allEvaluators: { userId: string; name: string; email: string }[];
  saving: boolean;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  addMinutes: (datetimeLocal: string, minutes: number) => string;
}

export function CalendarEventForm({
  editingEvent, form, setForm, durationMinutes, setDurationMinutes,
  showAdvancedVisibility, setShowAdvancedVisibility,
  studentSearch, setStudentSearch, evaluatorSearch, setEvaluatorSearch,
  myCourses, allStudents, allEvaluators,
  saving, error, onSubmit, onClose, addMinutes,
}: Props) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
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
                  : 'border-border text-gray-500 hover:border-gray-300 bg-white',
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
                    : 'border-border text-gray-500 hover:border-gray-300',
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
                  : 'border-border text-gray-500 hover:border-gray-300',
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
                    : 'border-border text-gray-500 hover:border-gray-300',
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
              onClick={() => {
                setForm((f) => ({ ...f, visibility: v.value, targetCourseId: '', targetStudentIds: [], targetEvaluatorIds: [] }));
                setStudentSearch('');
                setEvaluatorSearch('');
              }}
              className={cn(
                'flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all text-left',
                form.visibility === v.value
                  ? 'border-cta-from bg-blue-50 text-[#17527E]'
                  : 'border-border text-gray-500 hover:border-gray-300',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Advanced visibility toggle */}
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
                      : 'border-border text-gray-500 hover:border-gray-300',
                  )}
                >
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
                  : 'border-border text-gray-500 hover:border-gray-300',
              )}
            >
              Todos los estudiantes
            </button>
            {allStudents.length > 0 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Buscar estudiante..."
                  className="input-field w-full pl-8 py-1.5 text-xs"
                />
              </div>
            )}
            {allStudents.length > 0 && (
              <div className="max-h-40 overflow-y-auto border-2 border-border rounded-xl divide-y divide-border">
                {allStudents
                  .filter((s) => !studentSearch || s.name.toLowerCase().includes(studentSearch.toLowerCase()) || s.email.toLowerCase().includes(studentSearch.toLowerCase()))
                  .map((s) => {
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
                  : 'border-border text-gray-500 hover:border-gray-300',
              )}
            >
              Todos los evaluadores
            </button>
            {allEvaluators.length > 0 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={evaluatorSearch}
                  onChange={(e) => setEvaluatorSearch(e.target.value)}
                  placeholder="Buscar evaluador..."
                  className="input-field w-full pl-8 py-1.5 text-xs"
                />
              </div>
            )}
            {allEvaluators.length > 0 && (
              <div className="max-h-40 overflow-y-auto border-2 border-border rounded-xl divide-y divide-border">
                {allEvaluators
                  .filter((e) => !evaluatorSearch || e.name.toLowerCase().includes(evaluatorSearch.toLowerCase()) || e.email.toLowerCase().includes(evaluatorSearch.toLowerCase()))
                  .map((e) => {
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
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" loading={saving}>{editingEvent ? 'Guardar cambios' : 'Crear evento'}</Button>
      </div>
    </form>
  );
}
