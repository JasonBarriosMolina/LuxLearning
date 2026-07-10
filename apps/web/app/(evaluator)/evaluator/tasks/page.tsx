'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ClipboardList, Plus, Trash2, Pencil, CheckCircle, AlertCircle, Clock,
  Users, User, Loader2, X, Search, List, CalendarDays, ChevronRight,
  BookOpen, Filter,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { TaskCalendar } from '@/components/shared/TaskCalendar';
import { useLanguage } from '@/lib/i18n';

interface TaskFormState {
  title: string;
  description: string;
  type: 'custom' | 'complete_module' | 'submit_reflection' | 'pass_quiz' | 'upload_link' | 'watch_video' | 'read_resource';
  dueDate: string;
  assignTo: 'individual' | 'course';
  userId: string;
  targetCourseId: string;
  courseId: string;
  moduleId: string;
  courseTitle: string;
  moduleTitle: string;
  resourceUrl: string;
}

const EMPTY_FORM: TaskFormState = {
  title: '', description: '', type: 'custom',
  dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
  assignTo: 'individual', userId: '', targetCourseId: '',
  courseId: '', moduleId: '', courseTitle: '', moduleTitle: '', resourceUrl: '',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const looksLikeUUID = (s: string) => UUID_RE.test((s ?? '').trim());
const URL_TASK_TYPES = ['upload_link', 'watch_video', 'read_resource'];

type GroupBy = 'student' | 'course' | 'dueDate' | 'status';

function taskStatusIcon(status: string) {
  if (status === 'COMPLETED') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
  if (status === 'OVERDUE') return <AlertCircle className="w-4 h-4 text-red-500" />;
  return <Clock className="w-4 h-4 text-blue-400" />;
}

function taskStatusVariant(status: string): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'OVERDUE') return 'error';
  return 'default';
}

function dueDateGroup(dueDate: string): string {
  if (!dueDate) return 'Sin fecha';
  const due = new Date(dueDate + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return '🔴 Vencidas';
  if (diff === 0) return '🟠 Hoy';
  if (diff <= 7) return '🟡 Esta semana';
  if (diff <= 14) return '🔵 Próxima semana';
  return '⚪ Más adelante';
}

const DUE_GROUP_ORDER = ['🔴 Vencidas', '🟠 Hoy', '🟡 Esta semana', '🔵 Próxima semana', '⚪ Más adelante', 'Sin fecha'];
const STATUS_ORDER = ['OVERDUE', 'PENDING', 'SUBMITTED', 'COMPLETED'];
const STATUS_LABELS: Record<string, string> = {
  OVERDUE: '🔴 Vencidas', PENDING: '🔵 Pendientes', SUBMITTED: '🟡 Entregadas', COMPLETED: '✅ Completadas',
};

export default function EvaluatorTasksPage() {
  const { t } = useLanguage();
  const router = useRouter();

  const TYPE_LABELS: Record<string, string> = {
    custom: t.evaluator.taskTypeCustom,
    complete_module: t.evaluator.taskTypeCompleteModule,
    submit_reflection: t.evaluator.taskTypeSubmitReflection,
    pass_quiz: t.evaluator.taskTypePassQuiz,
    upload_link: t.evaluator.taskTypeUploadLink,
    watch_video: t.evaluator.taskTypeWatchVideo,
    read_resource: t.evaluator.taskTypeReadResource,
  };

  const [tasks, setTasks] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const savingRef = useRef(false);
  const [editTask, setEditTask] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', dueDate: '' });
  const [editSaving, setEditSaving] = useState(false);
  const editSavingRef = useRef(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCourse, setFilterCourse] = useState<string>('all');
  const [filterStudent, setFilterStudent] = useState<string>('all');
  const [filterDueFrom, setFilterDueFrom] = useState<string>('');
  const [filterDueTo, setFilterDueTo] = useState<string>('');
  const [groupBy, setGroupBy] = useState<GroupBy>('student');

  const load = async () => {
    const [tasksRes, usersRes, coursesRes] = await Promise.allSettled([
      api.evaluator.tasks.list(),
      api.admin.users.list(),
      api.admin.courses.list(),
    ]);
    if (tasksRes.status === 'fulfilled') setTasks((tasksRes.value as any).data ?? []);
    if (usersRes.status === 'fulfilled') {
      const allUsers: any[] = (usersRes.value as any).data ?? [];
      setStudents(
        allUsers
          .filter((u: any) => u.role === 'STUDENT')
          .map((u: any) => ({ userId: u.username, sub: u.sub ?? '', studentName: u.name || u.email }))
      );
    }
    if (coursesRes.status === 'fulfilled') setCourses((coursesRes.value as any).data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const getStudentName = (userId: string) => {
    const s = students.find((s: any) => s.sub === userId || s.userId === userId);
    return s?.studentName ?? userId.split('@')[0] ?? userId;
  };

  const getCourseName = (courseId: string) => {
    const c = courses.find((c: any) => c.id === courseId);
    return c?.title ?? courseId;
  };

  // ── Task navigation ───────────────────────────────────────────────────────────
  const getTaskHref = (task: any): string | null => {
    if (task.courseId) return `/evaluator/students?courseId=${task.courseId}`;
    if (task.targetCourseId) return `/evaluator/students?courseId=${task.targetCourseId}`;
    if (task.userId) return `/evaluator/students`;
    return null;
  };

  // ── Filtered tasks ────────────────────────────────────────────────────────────
  const activeFilters = [
    filterStatus !== 'all',
    filterCourse !== 'all',
    filterStudent !== 'all',
    !!filterDueFrom,
    !!filterDueTo,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilterStatus('all');
    setFilterCourse('all');
    setFilterStudent('all');
    setFilterDueFrom('');
    setFilterDueTo('');
  };

  const filtered = useMemo(() => tasks.filter((task) => {
    if (filterStatus !== 'all' && task.status !== filterStatus) return false;
    if (filterCourse !== 'all' && task.courseId !== filterCourse && task.targetCourseId !== filterCourse) return false;
    if (filterStudent !== 'all') {
      const s = students.find((s: any) => s.sub === task.userId || s.userId === task.userId);
      if (!s || (s.sub !== filterStudent && s.userId !== filterStudent)) return false;
    }
    if (filterDueFrom && task.dueDate && task.dueDate < filterDueFrom) return false;
    if (filterDueTo && task.dueDate && task.dueDate > filterDueTo) return false;
    return true;
  }), [tasks, filterStatus, filterCourse, filterStudent, filterDueFrom, filterDueTo, students]);

  // ── Grouped tasks ─────────────────────────────────────────────────────────────
  const grouped = useMemo((): [string, any[]][] => {
    const map = new Map<string, any[]>();
    for (const task of filtered) {
      let key = '';
      if (groupBy === 'student') key = getStudentName(task.userId);
      else if (groupBy === 'course') key = task.courseTitle || task.courseId || 'Sin curso';
      else if (groupBy === 'dueDate') key = dueDateGroup(task.dueDate);
      else if (groupBy === 'status') key = STATUS_LABELS[task.status] ?? task.status;
      (map.get(key) ?? map.set(key, []).get(key)!).push(task);
    }
    let entries = Array.from(map.entries());
    if (groupBy === 'dueDate') entries.sort((a, b) => DUE_GROUP_ORDER.indexOf(a[0]) - DUE_GROUP_ORDER.indexOf(b[0]));
    else if (groupBy === 'status') entries.sort((a, b) => {
      const ai = STATUS_ORDER.findIndex((s) => STATUS_LABELS[s] === a[0]);
      const bi = STATUS_ORDER.findIndex((s) => STATUS_LABELS[s] === b[0]);
      return ai - bi;
    });
    else entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries;
  }, [filtered, groupBy, students]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create ────────────────────────────────────────────────────────────────────
  const openCreate = () => { setForm(EMPTY_FORM); setError(''); setStudentSearch(''); setModalOpen(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    if (!form.title || !form.dueDate) { setError('Título y fecha límite son requeridos'); return; }
    if (form.assignTo === 'individual' && !form.userId) { setError('Selecciona un estudiante'); return; }
    if (form.assignTo === 'course' && !form.targetCourseId) { setError('Selecciona un curso'); return; }
    savingRef.current = true; setSaving(true); setError('');
    try {
      const selectedCourse = courses.find((c: any) => c.id === form.courseId);
      const resourceNote = URL_TASK_TYPES.includes(form.type) && form.resourceUrl ? `\n[URL]: ${form.resourceUrl}` : '';
      await api.evaluator.tasks.create({
        title: form.title,
        description: (form.description || '') + resourceNote || undefined,
        type: form.type, dueDate: form.dueDate,
        courseId: form.courseId || undefined, moduleId: form.moduleId || undefined,
        courseTitle: selectedCourse?.title || form.courseTitle || undefined,
        moduleTitle: form.moduleTitle || undefined,
        assignTo: form.assignTo,
        userId: form.assignTo === 'individual' ? form.userId : undefined,
        targetCourseId: form.assignTo === 'course' ? form.targetCourseId : undefined,
      });
      setModalOpen(false);
      await load();
    } catch (err: any) { setError(err.message ?? 'Error al crear la tarea'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDelete = async (task: any) => {
    setDeleting(task.taskId);
    try {
      await api.evaluator.tasks.delete(task.taskId, task.userId);
      setTasks((prev) => prev.filter((t) => t.taskId !== task.taskId));
    } catch { alert('Error al eliminar'); }
    finally { setDeleting(null); }
  };

  // ── Edit ──────────────────────────────────────────────────────────────────────
  const openEdit = (task: any) => {
    setEditTask(task);
    setEditForm({ title: task.title, description: task.description ?? '', dueDate: task.dueDate ?? '' });
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editSavingRef.current || !editTask) return;
    editSavingRef.current = true; setEditSaving(true);
    try {
      await api.evaluator.tasks.update(editTask.taskId, {
        userId: editTask.userId, title: editForm.title,
        description: editForm.description || undefined, dueDate: editForm.dueDate || undefined,
      });
      setTasks((prev) => prev.map((t) => t.taskId === editTask.taskId
        ? { ...t, title: editForm.title, description: editForm.description, dueDate: editForm.dueDate } : t));
      setEditTask(null);
    } catch { alert('Error al actualizar'); }
    finally { editSavingRef.current = false; setEditSaving(false); }
  };

  if (loading) return (
    <div className="max-w-3xl mx-auto space-y-3 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3" />
      {[1, 2].map((n) => <div key={n} className="card h-32" />)}
    </div>
  );

  const groupIcon = (gb: GroupBy) => {
    if (gb === 'student') return <User className="w-3.5 h-3.5" />;
    if (gb === 'course') return <BookOpen className="w-3.5 h-3.5" />;
    if (gb === 'dueDate') return <CalendarDays className="w-3.5 h-3.5" />;
    return <Filter className="w-3.5 h-3.5" />;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-cta-from" />
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">{t.evaluator.tasksTitle}</h1>
            <p className="text-sm text-gray-500">{t.evaluator.tasksSubtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button onClick={() => setViewMode('list')} className={`p-2 ${viewMode === 'list' ? 'bg-cta-gradient text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title={t.evaluator.taskListView}>
              <List className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('calendar')} className={`p-2 ${viewMode === 'calendar' ? 'bg-cta-gradient text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title={t.evaluator.taskCalView}>
              <CalendarDays className="w-4 h-4" />
            </button>
          </div>
          <Button onClick={openCreate} leftIcon={<Plus className="w-4 h-4" />}>{t.evaluator.createTask}</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t.evaluator.statsTotal, value: tasks.length, color: 'text-charcoal' },
          { label: t.evaluator.statsPending, value: tasks.filter((t) => t.status === 'PENDING').length, color: 'text-blue-600' },
          { label: t.evaluator.statsOverdue, value: tasks.filter((t) => t.status === 'OVERDUE').length, color: 'text-red-500' },
        ].map((s) => (
          <div key={s.label} className="card text-center py-3">
            <p className={`font-heading font-bold text-2xl ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Calendar view */}
      {viewMode === 'calendar' && (
        <div className="card">
          <TaskCalendar tasks={tasks} role="EVALUATOR" />
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <>
          {/* ── Filter bar ── */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              {/* Status */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Estado</p>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  <option value="all">Todos</option>
                  <option value="PENDING">Pendiente</option>
                  <option value="OVERDUE">Vencida</option>
                  <option value="COMPLETED">Completada</option>
                </select>
              </div>

              {/* Course */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Curso</p>
                <select value={filterCourse} onChange={(e) => setFilterCourse(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  <option value="all">Todos</option>
                  {courses.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>

              {/* Student */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Estudiante</p>
                <select value={filterStudent} onChange={(e) => setFilterStudent(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  <option value="all">Todos</option>
                  {students.map((s: any) => <option key={s.sub || s.userId} value={s.sub || s.userId}>{s.studentName}</option>)}
                </select>
              </div>

              {/* Due date range */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Fecha límite desde</p>
                <input type="date" value={filterDueFrom} onChange={(e) => setFilterDueFrom(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">hasta</p>
                <input type="date" value={filterDueTo} onChange={(e) => setFilterDueTo(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>

              {/* Clear */}
              {activeFilters > 0 && (
                <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 pb-1.5">
                  <X className="w-3.5 h-3.5" /> Limpiar ({activeFilters})
                </button>
              )}
            </div>

            {/* Group by */}
            <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
              <span className="text-xs text-gray-400">Agrupar por:</span>
              <div className="flex gap-1">
                {([['student', 'Estudiante'], ['course', 'Curso'], ['dueDate', 'Fecha límite'], ['status', 'Estado']] as [GroupBy, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setGroupBy(key)}
                    className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${groupBy === key ? 'bg-indigo-100 border-indigo-300 text-indigo-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-indigo-200'}`}
                  >
                    {groupIcon(key)} {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Results count */}
          <p className="text-xs text-gray-400">{filtered.length} tarea{filtered.length !== 1 ? 's' : ''}</p>

          {/* Grouped task list */}
          {grouped.length === 0 ? (
            <div className="card text-center py-16">
              <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="font-heading font-semibold text-charcoal">{activeFilters > 0 ? 'Sin resultados para estos filtros' : t.evaluator.noTasks}</p>
              <p className="text-sm text-gray-400 mt-1">{activeFilters > 0 ? 'Prueba cambiando los filtros.' : t.evaluator.noTasksHint}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map(([groupLabel, groupTasks]) => (
                <div key={groupLabel} className="card">
                  {/* Group header */}
                  <div className="flex items-center gap-2 mb-3">
                    {groupBy === 'student' && <User className="w-4 h-4 text-gray-400" />}
                    {groupBy === 'course' && <BookOpen className="w-4 h-4 text-indigo-400" />}
                    {groupBy === 'dueDate' && <CalendarDays className="w-4 h-4 text-gray-400" />}
                    {groupBy === 'status' && taskStatusIcon(Object.entries(STATUS_LABELS).find(([, v]) => v === groupLabel)?.[0] ?? '')}
                    <p className="font-semibold text-charcoal text-sm">{groupLabel}</p>
                    <span className="text-xs text-gray-400">({groupTasks.length})</span>
                  </div>

                  {/* Task cards */}
                  <div className="space-y-2">
                    {groupTasks.map((task) => {
                      const href = getTaskHref(task);
                      const cardContent = (
                        <div className={`flex items-center gap-3 p-3 rounded-xl bg-surface transition-colors ${href ? 'cursor-pointer hover:bg-indigo-50 group' : ''}`}>
                          {taskStatusIcon(task.status)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="text-sm font-medium text-charcoal truncate">{task.title}</p>
                              {looksLikeUUID(task.title) && (
                                <span className="shrink-0 text-[10px] font-semibold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{t.evaluator.reviewTitleFlag}</span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 text-xs text-gray-400 mt-0.5">
                              <span>{task.dueDate}</span>
                              <span>·</span>
                              <span>{TYPE_LABELS[task.type] ?? task.type}</span>
                              {groupBy !== 'student' && task.userId && (
                                <><span>·</span><span>{getStudentName(task.userId)}</span></>
                              )}
                              {groupBy !== 'course' && (task.courseTitle || task.courseId) && (
                                <><span>·</span><span className="text-indigo-500">{task.courseTitle || getCourseName(task.courseId)}</span></>
                              )}
                            </div>
                          </div>
                          <Badge variant={taskStatusVariant(task.status)}>
                            {task.status === 'PENDING' ? t.evaluator.taskStatusPending : task.status === 'COMPLETED' ? t.evaluator.taskStatusCompleted : t.evaluator.taskStatusOverdue}
                          </Badge>
                          {href && <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 shrink-0 transition-colors" />}
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(task); }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors shrink-0"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(task); }}
                            disabled={deleting === task.taskId}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 shrink-0"
                          >
                            {deleting === task.taskId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      );

                      return href ? (
                        <div key={task.taskId} onClick={() => router.push(href)}>
                          {cardContent}
                        </div>
                      ) : (
                        <div key={task.taskId}>{cardContent}</div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Edit Modal */}
      <Modal open={!!editTask} onClose={() => setEditTask(null)} title={t.evaluator.editTaskTitle} size="md">
        <form onSubmit={handleEditSave} className="space-y-4">
          <Input label={t.evaluator.taskTitle} value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} required />
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">{t.evaluator.taskDescription}</label>
            <textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} className="input-field min-h-[60px] resize-y" />
          </div>
          <Input label={t.evaluator.taskDueDate} type="date" value={editForm.dueDate} onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditTask(null)}>{t.evaluator.cancelBtn}</Button>
            <Button type="submit" loading={editSaving}>{t.evaluator.saveTaskChanges}</Button>
          </div>
        </form>
      </Modal>

      {/* Create Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t.evaluator.createTask} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <Input label={t.evaluator.taskTitleInput} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder={t.evaluator.taskTitlePlaceholder} required />
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">{t.evaluator.descriptionOptional}</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder={t.evaluator.taskDescPlaceholder} className="input-field min-h-[60px] resize-y" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{t.evaluator.taskType}</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as any, resourceUrl: '' }))} className="input-field">
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <Input label={t.evaluator.taskDueDate} type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} required />
          </div>
          {URL_TASK_TYPES.includes(form.type) && (
            <Input
              label={form.type === 'upload_link' ? t.evaluator.taskUrlLabel : form.type === 'watch_video' ? t.evaluator.taskVideoUrl : t.evaluator.taskReadingUrl}
              value={form.resourceUrl} onChange={(e) => setForm((f) => ({ ...f, resourceUrl: e.target.value }))} placeholder="https://..." type="url"
            />
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">{t.evaluator.assignToLabel}</label>
            <div className="flex gap-3">
              {(['individual', 'course'] as const).map((opt) => (
                <button key={opt} type="button" onClick={() => setForm((f) => ({ ...f, assignTo: opt }))}
                  className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-colors ${form.assignTo === opt ? 'border-cta-from bg-blue-50 text-cta-from' : 'border-border text-gray-500 hover:border-gray-300'}`}>
                  {opt === 'individual' ? <User className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                  {opt === 'individual' ? t.evaluator.individualStudent : t.evaluator.allInCourse}
                </button>
              ))}
            </div>
          </div>
          {form.assignTo === 'individual' ? (
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{t.evaluator.studentLabel}</label>
              <div className="relative mb-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input type="text" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder={t.evaluator.searchStudent} className="input-field pl-9 text-sm py-2" />
              </div>
              <select value={form.userId} onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))} className="input-field" size={5} required>
                <option value="">{t.evaluator.selectStudent}</option>
                {students.filter((s: any) => {
                  const q = studentSearch.toLowerCase();
                  return !q || (s.studentName ?? '').toLowerCase().includes(q) || s.userId.toLowerCase().includes(q);
                }).map((s: any) => <option key={s.userId} value={s.userId}>{s.studentName ?? s.userId}</option>)}
              </select>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{t.evaluator.courseLabel}</label>
              <select value={form.targetCourseId} onChange={(e) => setForm((f) => ({ ...f, targetCourseId: e.target.value }))} className="input-field" required>
                <option value="">{t.evaluator.selectCourseOption}</option>
                {courses.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-400 hover:text-charcoal transition-colors py-1">{t.evaluator.optionalLink}</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-charcoal">{t.evaluator.courseLabel}</label>
                <select value={form.courseId} onChange={(e) => { const c = courses.find((c: any) => c.id === e.target.value); setForm((f) => ({ ...f, courseId: e.target.value, courseTitle: c?.title ?? '', moduleId: '', moduleTitle: '' })); }} className="input-field text-sm py-2">
                  <option value="">—</option>
                  {courses.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-charcoal">{t.evaluator.moduleLabel}</label>
                <select value={form.moduleId} onChange={(e) => { const mod = courses.find((c: any) => c.id === form.courseId)?.modules?.find((m: any) => m.id === e.target.value); setForm((f) => ({ ...f, moduleId: e.target.value, moduleTitle: mod?.title ?? '' })); }} className="input-field text-sm py-2" disabled={!form.courseId}>
                  <option value="">—</option>
                  {(courses.find((c: any) => c.id === form.courseId)?.modules ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </div>
            </div>
          </details>
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>{t.evaluator.cancelBtn}</Button>
            <Button type="submit" loading={saving} disabled={saving}>{t.evaluator.assignTask}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
