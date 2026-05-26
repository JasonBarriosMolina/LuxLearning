'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, BookOpen, CheckCircle, XCircle, Pencil, Trash2, ArrowRight, Tag, X, Sparkles, Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';

interface CourseForm {
  title: string;
  slug: string;
  description: string;
  imageUrl: string;
  isActive: boolean;
  isPilot: boolean;
  tags: string[];
  startDate: string;
  closeDate: string;
}

const EMPTY_FORM: CourseForm = {
  title: '', slug: '', description: '', imageUrl: '', isActive: false, isPilot: false, tags: [], startDate: '', closeDate: '',
};

function slugify(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<any | null>(null);
  const [form, setForm] = useState<CourseForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [regeneratingCourse, setRegeneratingCourse] = useState<string | null>(null);
  const [regenPreview, setRegenPreview] = useState<{ courseId: string; title: string; modules: any[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tagInput, setTagInput] = useState('');

  // AI wizard state
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiStep, setAiStep] = useState<1 | 2 | 3 | 4>(1);
  const [aiMethod, setAiMethod] = useState<'topic' | 'url'>('topic');
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingMsg, setAiLoadingMsg] = useState('');
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiPublishing, setAiPublishing] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiPublishedCourseId, setAiPublishedCourseId] = useState<string | null>(null);
  const [aiStudentList, setAiStudentList] = useState<{ username: string; email: string; name: string }[]>([]);
  const [aiSelectedStudents, setAiSelectedStudents] = useState<string[]>([]);
  const [aiAssigning, setAiAssigning] = useState(false);
  const [aiSuggestedTags, setAiSuggestedTags] = useState<string[]>([]);
  const [aiAcceptedTags, setAiAcceptedTags] = useState<string[]>([]);

  const load = async () => {
    try {
      const res = await api.admin.courses.list();
      setCourses((res as any).data ?? []);
    } catch (err: any) {
      setLoadError(err.message ?? 'Error al cargar cursos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditingCourse(null);
    setForm(EMPTY_FORM);
    setError('');
    setModalOpen(true);
  };

  const openEdit = (course: any) => {
    setEditingCourse(course);
    setForm({
      title: course.title,
      slug: course.slug,
      description: course.description,
      imageUrl: course.imageUrl ?? '',
      isActive: course.isActive,
      isPilot: course.isPilot,
      tags: course.tags ?? [],
      startDate: course.startDate ? new Date(course.startDate).toISOString().slice(0, 10) : '',
      closeDate: course.closeDate ? new Date(course.closeDate).toISOString().slice(0, 10) : '',
    });
    setTagInput('');
    setError('');
    setModalOpen(true);
  };

  const handleTitleChange = (val: string) => {
    setForm((f) => ({
      ...f,
      title: val,
      slug: editingCourse ? f.slug : slugify(val),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingCourse) {
        await api.admin.courses.update(editingCourse.id, form);
      } else {
        await api.admin.courses.create(form);
      }
      setModalOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const openAiModal = () => {
    setAiStep(1);
    setAiMethod('topic');
    setAiInput('');
    setAiResult(null);
    setAiError('');
    setAiPublishedCourseId(null);
    setAiStudentList([]);
    setAiSelectedStudents([]);
    setAiModalOpen(true);
  };

  const handleAiGenerate = async () => {
    if (!aiInput.trim()) return;
    setAiLoading(true);
    setAiError('');
    setAiLoadingMsg('Diseñando estructura del curso...');
    try {
      // Step 1: dispatch — returns jobId immediately (~200ms)
      const res0 = await api.admin.courses.aiGenerate({ method: aiMethod, input: aiInput.trim() });
      const jobId = res0?.data?.jobId ?? res0?.jobId;

      // Step 2: poll for result
      setAiLoadingMsg('Generando módulos, lecciones y preguntas...');
      let attempts = 0;
      const res = await new Promise<any>((resolve, reject) => {
        const poll = setInterval(async () => {
          attempts++;
          try {
            const raw = await api.admin.courses.aiJob(jobId);
            const job = raw?.data ?? raw;
            if (job.status === 'done') { clearInterval(poll); resolve(job.result); }
            else if (job.status === 'error') { clearInterval(poll); reject(new Error(job.error ?? 'Error generando curso')); }
            else if (attempts > 60) { clearInterval(poll); reject(new Error('Tiempo de espera agotado')); }
          } catch (e) { clearInterval(poll); reject(e); }
        }, 2000);
      });
      setAiResult(res);
      setAiStep(3);
    } catch (err: any) {
      setAiError(err.message ?? 'Error al generar el curso');
    } finally {
      setAiLoading(false);
      setAiLoadingMsg('');
    }
  };

  const handleAiPublish = async () => {
    if (!aiResult) return;
    setAiPublishing(true);
    setAiError('');
    try {
      const res = await api.admin.courses.aiPublish(aiResult);
      const resData = (res as any).data ?? res;
      const courseId = resData?.id;
      const suggested: string[] = Array.isArray(resData?.suggestedTags) ? resData.suggestedTags : [];
      setAiPublishedCourseId(courseId);
      setAiSuggestedTags(suggested);
      setAiAcceptedTags(suggested); // all accepted by default
      // Load students for step 4
      const usersRes = await api.admin.users.list();
      const allUsers = (usersRes as any).data ?? [];
      const students = allUsers.filter((u: any) => u.role === 'STUDENT' && u.enabled);
      setAiStudentList(students);
      setAiSelectedStudents(students.map((s: any) => s.username));
      setAiStep(4);
      await load();
    } catch (err: any) {
      setAiError(err.message ?? 'Error al publicar el curso');
    } finally {
      setAiPublishing(false);
    }
  };

  const handleAiAssign = async () => {
    setAiAssigning(true);
    try {
      // Save accepted tags if any
      if (aiPublishedCourseId && aiAcceptedTags.length > 0) {
        const course = courses.find((c: any) => c.id === aiPublishedCourseId);
        if (course) {
          await api.admin.courses.update(aiPublishedCourseId, {
            ...course,
            tags: aiAcceptedTags,
          }).catch(() => {});
        }
      }
      // Enroll selected students
      if (aiPublishedCourseId && aiSelectedStudents.length > 0) {
        await Promise.all(
          aiSelectedStudents.map((username) =>
            api.admin.users.addEnrollment(username, aiPublishedCourseId).catch(() => {})
          )
        );
      }
      setAiModalOpen(false);
      await load();
    } catch {
      setAiModalOpen(false);
    } finally {
      setAiAssigning(false);
    }
  };

  const handleDelete = async (courseId: string) => {
    setDeleting(true);
    try {
      await api.admin.courses.delete(courseId);
      setConfirmDelete(null);
      await load();
    } catch (err: any) {
      alert(err.message ?? 'Error al eliminar');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">Gestión de Contenido</h1>
          <p className="text-gray-500 mt-1 text-sm">Crea y administra cursos, módulos, lecciones y evaluaciones</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" onClick={openAiModal} leftIcon={<Sparkles className="w-4 h-4 text-purple-500" />}>
            Crear con IA
          </Button>
          <Button onClick={openCreate} leftIcon={<Plus className="w-4 h-4" />}>
            Nuevo curso
          </Button>
        </div>
      </div>

      {/* Load error */}
      {loadError && (
        <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          Error al cargar cursos: {loadError}
        </div>
      )}

      {/* Courses list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <div key={n} className="card h-24 animate-pulse" />)}
        </div>
      ) : !loadError && courses.length === 0 ? (
        <div className="card text-center py-16">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">No hay cursos todavía</p>
          <p className="text-gray-500 text-sm mt-1">Crea el primer curso con el botón de arriba.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {courses.map((course) => (
            <div key={course.id} className="card flex items-center gap-4">
              {/* Status indicator */}
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${course.isActive ? 'bg-emerald-500' : 'bg-gray-300'}`} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <p className="font-semibold text-charcoal truncate">{course.title}</p>
                  {course.isPilot && <Badge variant="info">Piloto</Badge>}
                  <Badge variant={course.isActive ? 'success' : 'default'}>
                    {course.isActive ? 'Activo' : 'Inactivo'}
                  </Badge>
                  {course.isLegacy && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">⚠ Solo video</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <p className="text-xs text-gray-500">
                    {course.modules?.length ?? 0} módulos
                  </p>
                  {course.tags?.map((tag: string) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-600 font-medium">
                      <Tag className="w-2.5 h-2.5" />{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/admin/courses/${course.id}`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-cta-from hover:bg-blue-50 transition-colors"
                >
                  Editar contenido <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <button
                  onClick={() => openEdit(course)}
                  className="p-2 rounded-lg text-gray-400 hover:text-charcoal hover:bg-surface transition-colors"
                  title="Editar información"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={async () => {
                    setRegeneratingCourse(course.id);
                    try {
                      const res = await api.admin.courses.regenerate(course.id);
                      if (res?.data?.modules) setRegenPreview({ courseId: course.id, title: res.data.title, modules: res.data.modules });
                    } catch { /* ignore */ } finally { setRegeneratingCourse(null); }
                  }}
                  disabled={regeneratingCourse === course.id}
                  className="p-2 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                  title="Regenerar estructura con IA"
                >
                  {regeneratingCourse === course.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setConfirmDelete(course.id)}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Eliminar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingCourse ? 'Editar curso' : 'Nuevo curso'}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Título del curso"
            value={form.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="ej. StaffPad para Compositores"
            required
          />
          <Input
            label="Slug (URL)"
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="staffpad-para-compositores"
            required
          />
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Descripción</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Descripción del curso..."
              className="input-field min-h-[80px] resize-y"
              required
            />
          </div>
          <Input
            label="URL de imagen (opcional)"
            value={form.imageUrl}
            onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
            placeholder="https://..."
          />
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Fecha de inicio</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                className="input-field"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Fecha de cierre</label>
              <input
                type="date"
                value={form.closeDate}
                onChange={(e) => setForm((f) => ({ ...f, closeDate: e.target.value }))}
                className="input-field"
              />
            </div>
          </div>
          {/* Tags */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-indigo-500" />
              Etiquetas / Categorías
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                    e.preventDefault();
                    const tag = tagInput.trim().toLowerCase();
                    if (!form.tags.includes(tag)) {
                      setForm((f) => ({ ...f, tags: [...f.tags, tag] }));
                    }
                    setTagInput('');
                  }
                }}
                placeholder="Escribe una etiqueta y presiona Enter..."
                className="input-field text-sm py-2 flex-1"
              />
            </div>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }))}
                      className="text-indigo-400 hover:text-indigo-700 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="w-4 h-4 accent-cta-from"
              />
              <span className="text-sm font-medium text-charcoal">Curso activo</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isPilot}
                onChange={(e) => setForm((f) => ({ ...f, isPilot: e.target.checked }))}
                className="w-4 h-4 accent-cta-from"
              />
              <span className="text-sm font-medium text-charcoal">Curso piloto</span>
            </label>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              {editingCourse ? 'Guardar cambios' : 'Crear curso'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* AI Wizard Modal */}
      <Modal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        title="Crear curso con IA"
        size="2xl"
      >
        <div className="space-y-5">
          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  aiStep >= s ? 'bg-gradient-to-br from-cta-from to-cta-to text-white' : 'bg-gray-100 text-gray-400'
                }`}>{s}</div>
                {s < 4 && <div className={`w-6 h-0.5 ${aiStep > s ? 'bg-cta-from' : 'bg-gray-200'}`} />}
              </div>
            ))}
            <span className="ml-2 text-xs text-gray-400">
              {aiStep === 1 ? 'Método' : aiStep === 2 ? 'Información' : aiStep === 3 ? 'Revisar' : 'Asignar'}
            </span>
          </div>

          {/* Step 1 — Method */}
          {aiStep === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">¿Cómo quieres generar el curso?</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { id: 'topic', icon: '💡', title: 'Tema libre', desc: 'Describe el tema y la IA construye la estructura' },
                  { id: 'url', icon: '🌐', title: 'Desde URL', desc: 'Pega una URL y la IA extrae el contenido' },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAiMethod(opt.id)}
                    className={`text-left p-4 rounded-xl border-2 transition-colors ${
                      aiMethod === opt.id ? 'border-cta-from bg-blue-50 dark:bg-blue-900/20' : 'border-border hover:border-gray-300'
                    }`}
                  >
                    <div className="text-2xl mb-2">{opt.icon}</div>
                    <p className="font-semibold text-charcoal text-sm">{opt.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
              <div className="p-3 rounded-xl border-2 border-dashed border-gray-200 opacity-50">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📄</span>
                  <div>
                    <p className="font-semibold text-charcoal text-sm">Desde PDF</p>
                    <p className="text-xs text-gray-500">Próximamente</p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setAiStep(2)}>Siguiente</Button>
              </div>
            </div>
          )}

          {/* Step 2 — Input */}
          {aiStep === 2 && (
            <div className="space-y-4">
              {aiMethod === 'topic' ? (
                <div className="space-y-1">
                  <label className="text-sm font-medium text-charcoal">Tema del curso</label>
                  <textarea
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder="ej. Liderazgo empresarial para jóvenes profesionales, con enfoque en comunicación y toma de decisiones"
                    className="input-field min-h-[100px] resize-y"
                    autoFocus
                  />
                  <p className="text-xs text-gray-400">Sé específico: incluye el público objetivo y el enfoque del curso.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-sm font-medium text-charcoal">URL del contenido</label>
                  <input
                    type="url"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder="https://ejemplo.com/articulo-o-pagina"
                    className="input-field"
                    autoFocus
                  />
                  <p className="text-xs text-gray-400">La IA extraerá el texto de la página y construirá la estructura del curso.</p>
                </div>
              )}
              {aiError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{aiError}</div>
              )}
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setAiStep(1)}>Atrás</Button>
                <Button
                  onClick={handleAiGenerate}
                  loading={aiLoading}
                  leftIcon={!aiLoading ? <Sparkles className="w-4 h-4" /> : undefined}
                  disabled={!aiInput.trim()}
                >
                  {aiLoading ? (aiLoadingMsg || 'Generando...') : 'Generar con IA'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3 — Preview */}
          {aiStep === 3 && aiResult && (
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl border border-blue-100 dark:border-blue-900/40">
                <p className="font-heading font-bold text-charcoal text-lg">{aiResult.title}</p>
                <p className="text-sm text-gray-500 mt-1">{aiResult.description}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                    {(aiResult.modules ?? []).length} módulos
                  </span>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                    {(aiResult.modules ?? []).reduce((s: number, m: any) => s + (m.lessons?.length ?? 0), 0)} lecciones
                  </span>
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                    {(aiResult.modules ?? []).reduce((s: number, m: any) => s + (m.questions?.length ?? 0), 0)} preguntas de quiz
                  </span>
                </div>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {(aiResult.modules ?? []).map((m: any, i: number) => (
                  <div key={i} className="border border-border rounded-xl overflow-hidden">
                    {/* Module header */}
                    <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 flex items-center justify-between">
                      <p className="font-semibold text-sm text-charcoal">{m.order}. {m.title}</p>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                          {(m.lessons ?? []).length} lec
                        </span>
                        <span className="text-xs bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-medium">
                          {(m.questions ?? []).length} quiz
                        </span>
                      </div>
                    </div>
                    {/* Lessons list — single column */}
                    <div className="px-3 py-2 space-y-0.5">
                      {(m.lessons ?? []).map((l: any, j: number) => (
                        <p key={j} className={`text-xs ${l.type === 'video' ? 'text-purple-500' : 'text-gray-400'}`}>
                          {l.type === 'video' ? '🎬' : '📄'} {l.title}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                El curso se publicará como <strong>inactivo</strong>. Puedes activarlo después de revisar el contenido.
              </p>
              {aiError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{aiError}</div>
              )}
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => { setAiStep(2); setAiResult(null); }}>Regenerar</Button>
                <Button onClick={handleAiPublish} loading={aiPublishing} leftIcon={<CheckCircle className="w-4 h-4" />}>
                  Publicar curso
                </Button>
              </div>
            </div>
          )}

          {/* Step 4 — Assign students */}
          {aiStep === 4 && (
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-r from-emerald-50 to-blue-50 dark:from-emerald-900/20 dark:to-blue-900/20 rounded-xl border border-emerald-200">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-emerald-500 shrink-0" />
                  <div>
                    <p className="font-heading font-bold text-charcoal">¡Curso publicado exitosamente!</p>
                    <p className="text-sm text-gray-500 mt-0.5">Ahora puedes asignarlo a tus estudiantes.</p>
                  </div>
                </div>
              </div>

              {/* Suggested tags */}
              {aiSuggestedTags.length > 0 && (
                <div className="p-3 bg-surface rounded-xl border border-border">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tags sugeridos por IA</p>
                  <div className="flex flex-wrap gap-2">
                    {aiSuggestedTags.map((tag) => {
                      const active = aiAcceptedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setAiAcceptedTags((prev) =>
                            active ? prev.filter((t) => t !== tag) : [...prev, tag]
                          )}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                            active
                              ? 'bg-cta-from text-white border-cta-from'
                              : 'bg-white text-gray-400 border-border hover:border-gray-400'
                          }`}
                        >
                          {active ? '✓ ' : '+ '}{tag}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Haz clic para activar/desactivar. Se guardarán al asignar.</p>
                </div>
              )}

              {aiStudentList.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-sm">No hay estudiantes registrados todavía.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-charcoal">Selecciona estudiantes a inscribir</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAiSelectedStudents(aiStudentList.map((s) => s.username))}
                        className="text-xs text-cta-from font-medium hover:opacity-70"
                      >
                        Todos
                      </button>
                      <span className="text-xs text-gray-300">|</span>
                      <button
                        type="button"
                        onClick={() => setAiSelectedStudents([])}
                        className="text-xs text-gray-400 font-medium hover:opacity-70"
                      >
                        Ninguno
                      </button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
                    {aiStudentList.map((s) => {
                      const checked = aiSelectedStudents.includes(s.username);
                      return (
                        <label key={s.username} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface cursor-pointer transition-colors">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setAiSelectedStudents((prev) =>
                              checked ? prev.filter((u) => u !== s.username) : [...prev, s.username]
                            )}
                            className="w-4 h-4 accent-cta-from"
                          />
                          <div className="w-8 h-8 rounded-full bg-cta-gradient flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(s.name || s.email)[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-charcoal truncate">{s.name || s.email}</p>
                            <p className="text-xs text-gray-400 truncate">{s.email}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400">{aiSelectedStudents.length} de {aiStudentList.length} estudiantes seleccionados</p>
                </>
              )}

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setAiModalOpen(false)}>
                  Omitir
                </Button>
                <Button
                  onClick={handleAiAssign}
                  loading={aiAssigning}
                  disabled={aiSelectedStudents.length === 0}
                  leftIcon={<CheckCircle className="w-4 h-4" />}
                >
                  Asignar y cerrar
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Regenerate course preview modal (X-1) */}
      <Modal
        open={!!regenPreview}
        onClose={() => setRegenPreview(null)}
        title="Nueva estructura del curso"
        size="md"
      >
        {regenPreview && (
          <>
            <p className="text-sm text-gray-600 mb-3">
              La IA propone la siguiente estructura para <strong>{regenPreview.title}</strong>. Si confirmas, se regenerará cada módulo (proceso asíncrono).
            </p>
            <ol className="space-y-1 mb-5 max-h-48 overflow-y-auto text-sm">
              {regenPreview.modules.map((m: any) => (
                <li key={m.order} className="flex gap-2 text-gray-700">
                  <span className="font-semibold text-indigo-600 shrink-0">{m.order}.</span>
                  <span>{m.title}</span>
                </li>
              ))}
            </ol>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setRegenPreview(null)}>Cancelar</Button>
              <Button
                onClick={async () => {
                  const { courseId, modules } = regenPreview;
                  setRegenPreview(null);
                  for (const m of modules) {
                    try { await api.admin.modules.regenerate(m.id ?? m.moduleId); } catch { /* continue */ }
                  }
                  load();
                }}
              >
                Confirmar y regenerar
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Eliminar curso"
        size="sm"
      >
        <p className="text-gray-600 text-sm mb-6">
          ¿Seguro que quieres eliminar este curso? Se borrarán todos sus módulos, lecciones y preguntas. Esta acción no se puede deshacer.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            loading={deleting}
            onClick={() => confirmDelete && handleDelete(confirmDelete)}
          >
            Eliminar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
