'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Calendar, CheckCircle, AlertCircle, Clock, BookOpen, Loader2, ExternalLink, List, CalendarDays, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { TaskCalendar } from '@/components/shared/TaskCalendar';

type TaskStatus = 'PENDING' | 'COMPLETED' | 'OVERDUE';
interface Task {
  taskId: string;
  sk: string;
  title: string;
  description?: string;
  courseId?: string;
  moduleId?: string;
  courseTitle?: string;
  moduleTitle?: string;
  type: string;
  dueDate: string;
  status: TaskStatus;
  assignedBy: string;
  createdAt: string;
  completedAt?: string;
  submissionUrl?: string;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: 'Pendiente',
  COMPLETED: 'Completada',
  OVERDUE: 'Vencida',
};

const URL_TASK_TYPES = ['upload_link', 'watch_video', 'read_resource'];

function taskColor(task: Task) {
  if (task.status === 'COMPLETED') return 'text-emerald-500';
  if (task.status === 'OVERDUE') return 'text-red-500';
  const days = (new Date(task.dueDate + 'T00:00:00').getTime() - Date.now()) / 86400000;
  if (days <= 3) return 'text-amber-500';
  return 'text-blue-500';
}

function taskBg(task: Task) {
  if (task.status === 'COMPLETED') return 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900/40';
  if (task.status === 'OVERDUE') return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900/40';
  const days = (new Date(task.dueDate + 'T00:00:00').getTime() - Date.now()) / 86400000;
  if (days <= 3) return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900/40';
  return 'bg-white dark:bg-[#1A1A2E] border-border';
}

function TaskIcon({ task }: { task: Task }) {
  if (task.status === 'COMPLETED') return <CheckCircle className="w-5 h-5 text-emerald-500" />;
  if (task.status === 'OVERDUE') return <AlertCircle className="w-5 h-5 text-red-500" />;
  return <Clock className="w-5 h-5 text-blue-400" />;
}

/** Extract resource URL from description field (stored as [URL]: https://...) */
function extractResourceUrl(description?: string): string | null {
  if (!description) return null;
  const m = description.match(/\[URL\]:\s*(https?:\/\/\S+)/);
  return m ? m[1] : null;
}

/** Description without the [URL]: part */
function cleanDescription(description?: string): string {
  if (!description) return '';
  return description.replace(/\n?\[URL\]:\s*https?:\/\/\S+/, '').trim();
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'COMPLETED' | 'OVERDUE'>('all');
  const [exportLoading, setExportLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [submissionUrls, setSubmissionUrls] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api.tasks.list();
      setTasks((res as any).data ?? []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleComplete = async (taskId: string) => {
    setCompleting(taskId);
    try {
      await api.tasks.complete(taskId);
      setTasks((prev) => prev.map((t) => t.taskId === taskId ? { ...t, status: 'COMPLETED' as const, completedAt: new Date().toISOString() } : t));
    } catch { alert('Error al marcar como completada'); }
    finally { setCompleting(null); }
  };

  const handleSubmitUrl = async (taskId: string) => {
    const url = submissionUrls[taskId]?.trim();
    if (!url) return;
    setSubmitting(taskId);
    try {
      await api.student.tasks.submit(taskId, url);
      setTasks((prev) => prev.map((t) => t.taskId === taskId
        ? { ...t, status: 'COMPLETED' as const, completedAt: new Date().toISOString(), submissionUrl: url }
        : t));
      setSubmissionUrls((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
    } catch { alert('Error al enviar el enlace'); }
    finally { setSubmitting(null); }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const url = await api.tasks.calendarUrl();
      window.open(url, '_blank');
    } finally { setExportLoading(false); }
  };

  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);
  const counts = {
    all: tasks.length,
    PENDING: tasks.filter((t) => t.status === 'PENDING').length,
    COMPLETED: tasks.filter((t) => t.status === 'COMPLETED').length,
    OVERDUE: tasks.filter((t) => t.status === 'OVERDUE').length,
  };

  if (loading) return (
    <div className="max-w-2xl mx-auto space-y-3 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3" />
      {[1, 2, 3].map((n) => <div key={n} className="card h-20" />)}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-cta-from" />
          <h1 className="font-heading font-bold text-2xl text-charcoal">Mis Tareas</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 ${viewMode === 'list' ? 'bg-cta-gradient text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              title="Vista lista"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`p-2 ${viewMode === 'calendar' ? 'bg-cta-gradient text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              title="Vista calendario"
            >
              <CalendarDays className="w-4 h-4" />
            </button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exportLoading}
            leftIcon={<Calendar className="w-4 h-4" />}
          >
            Exportar .ics
          </Button>
        </div>
      </div>

      {/* Calendar view */}
      {viewMode === 'calendar' && (
        <div className="card">
          <TaskCalendar tasks={tasks} role="STUDENT" />
        </div>
      )}

      {viewMode === 'list' && (
        <>
          {/* Calendar tip */}
          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-xl text-xs text-blue-700 dark:text-blue-300">
            <Calendar className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Descarga el archivo <strong>.ics</strong> para importar tus tareas en Google Calendar, Apple Calendar u Outlook. Se actualiza con cada descarga.</span>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 p-1 bg-surface rounded-xl w-fit">
            {([
              { key: 'all', label: 'Todas' },
              { key: 'PENDING', label: 'Pendientes' },
              { key: 'OVERDUE', label: 'Vencidas' },
              { key: 'COMPLETED', label: 'Completadas' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === key ? 'bg-white dark:bg-[#1A1A2E] text-charcoal shadow-sm' : 'text-gray-500 hover:text-charcoal'
                }`}
              >
                {label}
                {counts[key] > 0 && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                    filter === key ? 'bg-cta-from/10 text-cta-from' : 'bg-gray-200 text-gray-500'
                  }`}>{counts[key]}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tasks list */}
          {filtered.length === 0 ? (
            <div className="card text-center py-12">
              <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="font-heading font-semibold text-charcoal">No hay tareas</p>
              <p className="text-sm text-gray-400 mt-1">
                {filter === 'all' ? 'Tu evaluador aún no ha asignado tareas.' : `No hay tareas ${STATUS_LABELS[filter as TaskStatus]?.toLowerCase() ?? ''}.`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((task) => {
                const resourceUrl = extractResourceUrl(task.description);
                const displayDesc = cleanDescription(task.description);
                const isUrlType = URL_TASK_TYPES.includes(task.type);

                return (
                  <div key={task.taskId} className={`border rounded-2xl p-4 flex items-start gap-4 ${taskBg(task)}`}>
                    <div className="shrink-0 mt-0.5"><TaskIcon task={task} /></div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="font-semibold text-charcoal text-sm">{task.title}</p>
                      {displayDesc && (
                        <p className="text-xs text-gray-500">{displayDesc}</p>
                      )}
                      <div className="flex items-center gap-3 flex-wrap">
                        {(task.courseTitle || task.moduleTitle) && (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <BookOpen className="w-3 h-3" />
                            {task.courseTitle}{task.moduleTitle ? ` · ${task.moduleTitle}` : ''}
                          </span>
                        )}
                        <span className={`text-xs font-medium ${taskColor(task)}`}>
                          {task.status === 'COMPLETED' ? `Completada ${task.completedAt ? new Date(task.completedAt).toLocaleDateString('es') : ''}` : `Vence: ${task.dueDate}`}
                        </span>
                      </div>

                      {/* Resource link */}
                      {resourceUrl && (
                        <a
                          href={resourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-cta-from hover:underline"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Abrir recurso →
                        </a>
                      )}

                      {/* URL submission for upload_link type */}
                      {task.type === 'upload_link' && task.status !== 'COMPLETED' && (
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="url"
                            placeholder="Pega aquí el enlace de tu entrega..."
                            value={submissionUrls[task.taskId] ?? ''}
                            onChange={(e) => setSubmissionUrls((prev) => ({ ...prev, [task.taskId]: e.target.value }))}
                            className="input-field text-xs py-1.5 flex-1 min-w-0"
                          />
                          <button
                            onClick={() => handleSubmitUrl(task.taskId)}
                            disabled={submitting === task.taskId || !submissionUrls[task.taskId]?.trim()}
                            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-cta-gradient text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                          >
                            {submitting === task.taskId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            Enviar
                          </button>
                        </div>
                      )}

                      {/* Submitted URL */}
                      {task.submissionUrl && (
                        <p className="text-xs text-gray-400">
                          Enviado: <a href={task.submissionUrl} target="_blank" rel="noopener noreferrer" className="underline">{task.submissionUrl}</a>
                        </p>
                      )}
                    </div>

                    {/* Complete button (non-URL tasks) */}
                    {task.status !== 'COMPLETED' && !isUrlType && (
                      <button
                        onClick={() => handleComplete(task.taskId)}
                        disabled={completing === task.taskId}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 transition-colors disabled:opacity-50"
                      >
                        {completing === task.taskId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                        Completar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
