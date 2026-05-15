'use client';

import { useEffect, useRef, useState } from 'react';
import { ClipboardList, Plus, Trash2, Pencil, CheckCircle, AlertCircle, Clock, Users, User, Loader2, X, Search, List, CalendarDays } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { TaskCalendar } from '@/components/shared/TaskCalendar';

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

const TYPE_LABELS: Record<string, string> = {
  custom: 'Tarea personalizada',
  complete_module: 'Completar módulo',
  submit_reflection: 'Enviar reflexión',
  pass_quiz: 'Aprobar quiz',
  upload_link: 'Subir enlace (Drive/YouTube)',
  watch_video: 'Ver video externo',
  read_resource: 'Leer recurso',
};

const URL_TASK_TYPES = ['upload_link', 'watch_video', 'read_resource'];

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

export default function EvaluatorTasksPage() {
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

  const load = async () => {
    const [tasksRes, usersRes, coursesRes] = await Promise.allSettled([
      api.evaluator.tasks.list(),
      api.admin.users.list(),
      api.admin.courses.list(),
    ]);
    if (tasksRes.status === 'fulfilled') setTasks((tasksRes.value as any).data ?? []);
    if (usersRes.status === 'fulfilled') {
      const allUsers: any[] = (usersRes.value as any).data ?? [];
      const studentUsers = allUsers
        .filter((u: any) => u.role === 'STUDENT')
        .map((u: any) => ({ userId: u.username, studentName: u.name || u.email }));
      setStudents(studentUsers);
    }
    if (coursesRes.status === 'fulfilled') setCourses((coursesRes.value as any).data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setError('');
    setStudentSearch('');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return; // sync guard against double-submit
    if (!form.title || !form.dueDate) { setError('Título y fecha límite son requeridos'); return; }
    if (form.assignTo === 'individual' && !form.userId) { setError('Selecciona un estudiante'); return; }
    if (form.assignTo === 'course' && !form.targetCourseId) { setError('Selecciona un curso'); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const selectedCourse = courses.find((c: any) => c.id === form.courseId);
      const resourceNote = URL_TASK_TYPES.includes(form.type) && form.resourceUrl
        ? `\n[URL]: ${form.resourceUrl}` : '';
      await api.evaluator.tasks.create({
        title: form.title,
        description: (form.description || '') + resourceNote || undefined,
        type: form.type,
        dueDate: form.dueDate,
        courseId: form.courseId || undefined,
        moduleId: form.moduleId || undefined,
        courseTitle: selectedCourse?.title || form.courseTitle || undefined,
        moduleTitle: form.moduleTitle || undefined,
        assignTo: form.assignTo,
        userId: form.assignTo === 'individual' ? form.userId : undefined,
        targetCourseId: form.assignTo === 'course' ? form.targetCourseId : undefined,
      });
      setModalOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Error al crear la tarea');
    } finally { savingRef.current = false; setSaving(false); }
  };

  const handleDelete = async (task: any) => {
    setDeleting(task.taskId);
    try {
      await api.evaluator.tasks.delete(task.taskId, task.userId);
      setTasks((prev) => prev.filter((t) => t.taskId !== task.taskId));
    } catch { alert('Error al eliminar'); }
    finally { setDeleting(null); }
  };

  const openEdit = (task: any) => {
    setEditTask(task);
    setEditForm({ title: task.title, description: task.description ?? '', dueDate: task.dueDate ?? '' });
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editSavingRef.current || !editTask) return;
    editSavingRef.current = true;
    setEditSaving(true);
    try {
      await api.evaluator.tasks.update(editTask.taskId, {
        userId: editTask.userId,
        title: editForm.title,
        description: editForm.description || undefined,
        dueDate: editForm.dueDate || undefined,
      });
      setTasks((prev) => prev.map((t) => t.taskId === editTask.taskId
        ? { ...t, title: editForm.title, description: editForm.description, dueDate: editForm.dueDate }
        : t));
      setEditTask(null);
    } catch { alert('Error al actualizar'); }
    finally { editSavingRef.current = false; setEditSaving(false); }
  };

  // Group tasks by student
  const byStudent = tasks.reduce<Record<string, any[]>>((acc, t) => {
    (acc[t.userId] ??= []).push(t);
    return acc;
  }, {});

  const getStudentName = (userId: string) => {
    const s = students.find((s: any) => s.userId === userId);
    return s?.studentName ?? userId.split('@')[0] ?? userId;
  };

  if (loading) return (
    <div className="max-w-3xl mx-auto space-y-3 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3" />
      {[1, 2].map((n) => <div key={n} className="card h-32" />)}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-cta-from" />
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">Gestión de Tareas</h1>
            <p className="text-sm text-gray-500">Asigna y gestiona tareas para tus estudiantes</p>
          </div>
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
          <Button onClick={openCreate} leftIcon={<Plus className="w-4 h-4" />}>
            Nueva tarea
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: tasks.length, color: 'text-charcoal' },
          { label: 'Pendientes', value: tasks.filter((t) => t.status === 'PENDING').length, color: 'text-blue-600' },
          { label: 'Vencidas', value: tasks.filter((t) => t.status === 'OVERDUE').length, color: 'text-red-500' },
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

      {/* Tasks grouped by student (list view) */}
      {viewMode === 'list' && (Object.keys(byStudent).length === 0 ? (
        <div className="card text-center py-16">
          <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-semibold text-charcoal">Sin tareas asignadas</p>
          <p className="text-sm text-gray-400 mt-1">Crea tu primera tarea con el botón de arriba.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(byStudent).map(([userId, studentTasks]) => (
            <div key={userId} className="card">
              <div className="flex items-center gap-2 mb-3">
                <User className="w-4 h-4 text-gray-400" />
                <p className="font-semibold text-charcoal text-sm">{getStudentName(userId)}</p>
                <span className="text-xs text-gray-400">({studentTasks.length} tarea{studentTasks.length !== 1 ? 's' : ''})</span>
              </div>
              <div className="space-y-2">
                {studentTasks.map((task) => (
                  <div key={task.taskId} className="flex items-center gap-3 p-3 rounded-xl bg-surface">
                    {taskStatusIcon(task.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-medium text-charcoal truncate">{task.title}</p>
                        {looksLikeUUID(task.title) && (
                          <span className="shrink-0 text-[10px] font-semibold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">⚠ revisar título</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">{task.dueDate} · {TYPE_LABELS[task.type as keyof typeof TYPE_LABELS] ?? task.type}</p>
                    </div>
                    <Badge variant={taskStatusVariant(task.status)}>
                      {task.status === 'PENDING' ? 'Pendiente' : task.status === 'COMPLETED' ? 'Completada' : 'Vencida'}
                    </Badge>
                    <button
                      onClick={() => openEdit(task)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(task)}
                      disabled={deleting === task.taskId}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      {deleting === task.taskId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Edit Task Modal */}
      <Modal open={!!editTask} onClose={() => setEditTask(null)} title="Editar tarea" size="md">
        <form onSubmit={handleEditSave} className="space-y-4">
          <Input
            label="Título"
            value={editForm.title}
            onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Descripción</label>
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              className="input-field min-h-[60px] resize-y"
            />
          </div>
          <Input
            label="Fecha límite"
            type="date"
            value={editForm.dueDate}
            onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditTask(null)}>Cancelar</Button>
            <Button type="submit" loading={editSaving}>Guardar cambios</Button>
          </div>
        </form>
      </Modal>

      {/* Create Task Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nueva tarea" size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Título de la tarea"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="ej. Completar el módulo 2 antes del viernes"
            required
          />

          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Descripción (opcional)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Instrucciones adicionales..."
              className="input-field min-h-[60px] resize-y"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Tipo</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as any, resourceUrl: '' }))}
                className="input-field"
              >
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <Input
              label="Fecha límite"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              required
            />
          </div>

          {/* Resource URL field for URL-based task types */}
          {URL_TASK_TYPES.includes(form.type) && (
            <Input
              label={form.type === 'upload_link' ? 'URL del recurso (Drive, YouTube, etc.)' : form.type === 'watch_video' ? 'URL del video' : 'URL de lectura'}
              value={form.resourceUrl}
              onChange={(e) => setForm((f) => ({ ...f, resourceUrl: e.target.value }))}
              placeholder="https://..."
              type="url"
            />
          )}

          {/* Assign to */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">Asignar a</label>
            <div className="flex gap-3">
              {(['individual', 'course'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, assignTo: opt }))}
                  className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-colors ${
                    form.assignTo === opt ? 'border-cta-from bg-blue-50 dark:bg-blue-900/20 text-cta-from' : 'border-border text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {opt === 'individual' ? <User className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                  {opt === 'individual' ? 'Estudiante individual' : 'Todos en un curso'}
                </button>
              ))}
            </div>
          </div>

          {form.assignTo === 'individual' ? (
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Estudiante</label>
              <div className="relative mb-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Buscar estudiante..."
                  className="input-field pl-9 text-sm py-2"
                />
              </div>
              <select
                value={form.userId}
                onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
                className="input-field"
                size={5}
                required
              >
                <option value="">— selecciona —</option>
                {students
                  .filter((s: any) => {
                    const q = studentSearch.toLowerCase();
                    return !q || (s.studentName ?? '').toLowerCase().includes(q) || s.userId.toLowerCase().includes(q);
                  })
                  .map((s: any) => (
                    <option key={s.userId} value={s.userId}>{s.studentName ?? s.userId}</option>
                  ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Curso</label>
              <select
                value={form.targetCourseId}
                onChange={(e) => setForm((f) => ({ ...f, targetCourseId: e.target.value }))}
                className="input-field"
                required
              >
                <option value="">Selecciona un curso...</option>
                {courses.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
          )}

          {/* Optional course link */}
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-400 hover:text-charcoal transition-colors py-1">
              + Vincular a curso/módulo (opcional)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-charcoal">Curso</label>
                <select
                  value={form.courseId}
                  onChange={(e) => {
                    const c = courses.find((c: any) => c.id === e.target.value);
                    setForm((f) => ({ ...f, courseId: e.target.value, courseTitle: c?.title ?? '', moduleId: '', moduleTitle: '' }));
                  }}
                  className="input-field text-sm py-2"
                >
                  <option value="">—</option>
                  {courses.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-charcoal">Módulo</label>
                <select
                  value={form.moduleId}
                  onChange={(e) => {
                    const selectedCourse = courses.find((c: any) => c.id === form.courseId);
                    const mod = selectedCourse?.modules?.find((m: any) => m.id === e.target.value);
                    setForm((f) => ({ ...f, moduleId: e.target.value, moduleTitle: mod?.title ?? '' }));
                  }}
                  className="input-field text-sm py-2"
                  disabled={!form.courseId}
                >
                  <option value="">—</option>
                  {(courses.find((c: any) => c.id === form.courseId)?.modules ?? []).map((m: any) => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
              </div>
            </div>
          </details>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={saving} disabled={saving}>Asignar tarea</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
