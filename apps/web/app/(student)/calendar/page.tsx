'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Loader2, Upload, X, CheckSquare, Square } from 'lucide-react';
import { api } from '@/lib/api';
import { TaskCalendar } from '@/components/shared/TaskCalendar';
import { parseIcsText, normalizeDtstart } from '@/lib/parseIcs';
import { Button } from '@/components/ui/Button';

interface Task {
  taskId: string;
  title: string;
  dueDate: string;
  status: 'PENDING' | 'COMPLETED' | 'OVERDUE' | 'SUBMITTED';
  type: string;
  courseId?: string;
  courseTitle?: string;
  moduleTitle?: string;
  description?: string;
}

interface IcsEvent {
  summary: string;
  dtstart: string;
  description?: string;
}

export default function CalendarPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [icsEvents, setIcsEvents] = useState<IcsEvent[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importToast, setImportToast] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const loadTasks = () => {
    api.tasks.list()
      .then((res: any) => setTasks((res as any).data ?? []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTasks(); }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const events = parseIcsText(text);
    setIcsEvents(events);
    setSelectedEvents(new Set(events.map((_, i) => i)));
    e.target.value = '';
  };

  const handleImport = async () => {
    const toImport = icsEvents.filter((_, i) => selectedEvents.has(i));
    if (toImport.length === 0) return;
    setImporting(true);
    try {
      const res = await api.tasks.importIcs(toImport);
      const count = (res as any)?.data?.created ?? toImport.length;
      setImportToast(`✅ ${count} tarea${count !== 1 ? 's' : ''} importada${count !== 1 ? 's' : ''}`);
      setIcsEvents([]);
      setSelectedEvents(new Set());
      loadTasks();
      setTimeout(() => setImportToast(''), 4000);
    } catch {
      setImportToast('❌ Error al importar');
      setTimeout(() => setImportToast(''), 4000);
    } finally {
      setImporting(false);
    }
  };

  const toggleEvent = (i: number) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  // Unique courses for filter
  const courses = Array.from(
    new Map(
      tasks.filter((t) => t.courseId && t.courseTitle).map((t) => [t.courseId, t.courseTitle!])
    ).entries()
  );

  const filtered = selectedCourse ? tasks.filter((t) => t.courseId === selectedCourse) : tasks;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-cta-from" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Toast */}
      {importToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-white shadow-lg border border-border rounded-xl px-4 py-3 text-sm font-medium text-charcoal animate-fade-in">
          {importToast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-6 h-6 text-cta-from" />
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">Calendario</h1>
            <p className="text-sm text-gray-400">Todas tus tareas en vista de calendario</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {courses.length > 1 && (
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="input-field text-sm py-2 max-w-[200px]"
            >
              <option value="">Todos los cursos</option>
              {courses.map(([id, title]) => (
                <option key={id} value={id}>{title}</option>
              ))}
            </select>
          )}
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Upload className="w-4 h-4" />}
            onClick={() => fileRef.current?.click()}
          >
            Importar .ics
          </Button>
          <input ref={fileRef} type="file" accept=".ics" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {/* ICS Import Modal */}
      {icsEvents.length > 0 && (
        <div className="card border-2 border-indigo-200 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-charcoal text-sm">
              📅 {icsEvents.length} evento{icsEvents.length !== 1 ? 's' : ''} encontrado{icsEvents.length !== 1 ? 's' : ''} — selecciona los que quieres importar
            </h2>
            <button onClick={() => setIcsEvents([])} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {icsEvents.map((ev, i) => (
              <button
                key={i}
                onClick={() => toggleEvent(i)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 text-left transition-colors"
              >
                {selectedEvents.has(i)
                  ? <CheckSquare className="w-4 h-4 text-indigo-500 shrink-0" />
                  : <Square className="w-4 h-4 text-gray-300 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-charcoal truncate">{ev.summary}</p>
                  <p className="text-xs text-gray-400">{normalizeDtstart(ev.dtstart)}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-xs text-gray-400">{selectedEvents.size} seleccionado{selectedEvents.size !== 1 ? 's' : ''}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setIcsEvents([])}>Cancelar</Button>
              <Button size="sm" loading={importing} onClick={handleImport} disabled={selectedEvents.size === 0}>
                Importar {selectedEvents.size > 0 ? selectedEvents.size : ''}
              </Button>
            </div>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="card text-center py-16">
          <CalendarDays className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="font-heading font-bold text-charcoal">Sin tareas programadas</p>
          <p className="text-sm text-gray-400 mt-1">Cuando tu evaluador te asigne tareas aparecerán aquí.</p>
        </div>
      ) : (
        <div className="card">
          <TaskCalendar tasks={filtered} role="STUDENT" />
        </div>
      )}
    </div>
  );
}
