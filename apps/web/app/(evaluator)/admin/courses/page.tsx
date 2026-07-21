'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, BookOpen, CheckCircle, XCircle, Pencil, Trash2, ArrowRight, Tag, X, Sparkles, Loader2, RefreshCw, UserCircle, FolderOpen, ClipboardList, Users, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useLanguage } from '@/lib/i18n';

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
  const router = useRouter();
  const { t, lang } = useLanguage();
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'draft' | 'archived'>('active');
  const [archiveConfirm, setArchiveConfirm] = useState<string | null>(null);
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

  // Evaluator assignment modal state
  const [evalModal, setEvalModal] = useState<{ courseId: string; courseName: string } | null>(null);
  const [evaluators, setEvaluators] = useState<{ sub: string; email: string; name: string; username: string }[]>([]);
  const [selectedEval, setSelectedEval] = useState('');
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalError, setEvalError] = useState('');

  // Choice modal state (unified "Nuevo Curso" menu)
  const [choiceModalOpen, setChoiceModalOpen] = useState(false);

  // AI wizard close-confirmation state
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

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
  // G2-B: per-module edit/regen in wizard step 3
  const [editingModTitle, setEditingModTitle] = useState<{ idx: number; value: string } | null>(null);
  const [regenModIdx, setRegenModIdx] = useState<number | null>(null);

  const load = async (tab = activeTab) => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.admin.courses.listByStatus(tab);
      setCourses((res as any).data ?? []);
    } catch (err: any) {
      setLoadError(err.message ?? 'Error al cargar cursos');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(activeTab); }, [activeTab, lang]);

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

  const openAiModal = (method: 'topic' | 'url' = 'topic', startStep: 1 | 2 | 3 | 4 = 1) => {
    setAiStep(startStep);
    setAiMethod(method);
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
    setAiLoadingMsg(t.admin.aiDesigningMsg);
    try {
      // Step 1: dispatch — returns jobId immediately (~200ms)
      const res0 = await api.admin.courses.aiGenerate({ method: aiMethod, input: aiInput.trim() });
      const jobId = res0?.data?.jobId ?? res0?.jobId;

      // Step 2: poll for result
      setAiLoadingMsg(t.admin.aiGeneratingMsg);
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

  const openEvalModal = async (courseId: string, courseName: string) => {
    setEvalModal({ courseId, courseName });
    setSelectedEval('');
    setEvalError('');
    setEvalLoading(true);
    try {
      const res = await api.admin.users.list();
      const allUsers = (res as any).data ?? [];
      const evls = allUsers.filter((u: any) => u.role === 'EVALUATOR' && u.enabled !== false);
      setEvaluators(evls.map((u: any) => ({ sub: u.sub ?? u.username, email: u.email, name: u.name ?? u.email, username: u.username })));
    } catch {
      setEvaluators([]);
    } finally {
      setEvalLoading(false);
    }
  };

  const handleAssignEvaluator = async () => {
    if (!evalModal || !selectedEval) return;
    const evaluator = evaluators.find((e) => e.sub === selectedEval || e.username === selectedEval);
    if (!evaluator) return;
    setEvalSaving(true);
    setEvalError('');
    try {
      await api.admin.courses.assignEvaluator(evalModal.courseId, {
        evaluatorId: evaluator.sub,
        evaluatorName: evaluator.name,
      });
      setEvalModal(null);
      await load();
    } catch (err: any) {
      setEvalError(err.message ?? 'Error al asignar evaluador');
    } finally {
      setEvalSaving(false);
    }
  };

  const handlePublish = async (courseId: string) => {
    try {
      await api.admin.courses.publish(courseId);
      await load();
    } catch (err: any) {
      alert(err.message ?? 'Error al publicar');
    }
  };

  const handleArchive = async (courseId: string) => {
    try {
      await api.admin.courses.archive(courseId);
      setArchiveConfirm(null);
      await load();
    } catch (err: any) {
      alert(err.message ?? 'Error al archivar');
    }
  };

  const handleRestore = async (courseId: string) => {
    try {
      await api.admin.courses.restore(courseId);
      await load();
    } catch (err: any) {
      alert(err.message ?? 'Error al restaurar');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">{t.admin.contentMgmt}</h1>
          <p className="text-gray-500 mt-1 text-sm">{t.admin.contentMgmtSubtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={() => setChoiceModalOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
            {t.admin.newCourse}
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 bg-surface rounded-xl p-1 w-fit">
        {([
          { key: 'active', label: t.admin.tabActive },
          { key: 'draft', label: t.admin.tabDraft },
          { key: 'archived', label: t.admin.tabArchived },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-charcoal shadow-sm'
                : 'text-gray-500 hover:text-charcoal'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Load error */}
      {loadError && (
        <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {t.admin.loadError}: {loadError}
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
          <p className="font-heading font-bold text-charcoal">
            {activeTab === 'draft' ? t.admin.noDrafts : activeTab === 'archived' ? t.admin.noArchivedCourses : t.admin.noActiveCoursesMsg}
          </p>
          <p className="text-gray-500 text-sm mt-1">
            {activeTab === 'active' ? t.admin.createFirstCourse : ''}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {courses.map((course) => (
            <div key={course.id} className={`card flex items-center gap-4 ${course.isArchived ? 'opacity-70' : ''}`}>
              {/* Status indicator */}
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                course.isArchived ? 'bg-gray-300' :
                course.isDraft ? 'bg-yellow-400' :
                course.isActive ? 'bg-emerald-500' : 'bg-gray-300'
              }`} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-charcoal truncate mb-0.5">{course.title}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {course.isArchived ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 font-medium">{t.admin.statusArchived}</span>
                  ) : course.isDraft ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700 font-medium">{t.admin.statusDraft}</span>
                  ) : (
                    <Badge variant={course.isActive ? 'success' : 'default'}>
                      {course.isActive ? t.admin.courseActive : t.admin.courseInactive}
                    </Badge>
                  )}
                  {course.isPilot && <Badge variant="info">{t.admin.coursePilot}</Badge>}
                  {course.isLegacy && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{t.admin.statusLegacy}</span>
                  )}
                  <p className="text-xs text-gray-500">
                    {t.admin.modulesCount(course.modules?.length ?? 0)}
                  </p>
                  {course.evaluatorName && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-teal-50 text-teal-700 font-medium">
                      <UserCircle className="w-2.5 h-2.5" />{course.evaluatorName}
                    </span>
                  )}
                  {course.tags?.map((tag: string) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-600 font-medium">
                      <Tag className="w-2.5 h-2.5" />{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {course.isArchived ? (
                  // Archived: restore + resources
                  <>
                    <Link
                      href={`/evaluator/my-resources?courseId=${course.id}`}
                      className="p-2 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
                      title="Recursos del curso"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => handleRestore(course.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-600 border border-border hover:bg-surface transition-colors"
                    >
                      {t.admin.restoreBtn}
                    </button>
                  </>
                ) : (
                  <>
                    {course.isDraft && (
                      <button
                        onClick={() => handlePublish(course.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                      >
                        {t.admin.publishBtn}
                      </button>
                    )}
                    <Link
                      href={`/admin/courses/${course.id}`}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-cta-from hover:bg-blue-50 transition-colors"
                    >
                      {t.admin.editContent} <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    <Link
                      href={`/evaluator/my-resources?courseId=${course.id}`}
                      className="p-2 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
                      title="Recursos del curso"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </Link>
                    <Link
                      href={`/evaluator/reflections?courseId=${course.id}`}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-purple-600 hover:bg-purple-50 transition-colors"
                      title="Ver reflexiones de este curso"
                    >
                      <ClipboardList className="w-3.5 h-3.5" />
                      {(course as any).pendingReflections > 0 && (
                        <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 rounded-full">
                          {(course as any).pendingReflections}
                        </span>
                      )}
                    </Link>
                    <Link
                      href={`/evaluator/students?courseId=${course.id}`}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                      title="Ver estudiantes de este curso"
                    >
                      <Users className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => openEdit(course)}
                      className="p-2 rounded-lg text-gray-400 hover:text-charcoal hover:bg-surface transition-colors"
                      title={t.admin.editInfo}
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
                      title={t.admin.regenAI}
                    >
                      {regeneratingCourse === course.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => openEvalModal(course.id, course.title)}
                      className="p-2 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                      title={course.evaluatorName ? `${t.admin.assignEvaluatorPrefix}: ${course.evaluatorName}` : t.admin.assignEvaluator}
                    >
                      <UserCircle className={`w-4 h-4 ${course.evaluatorName ? 'text-teal-500' : ''}`} />
                    </button>
                    {!course.isDraft && (
                      <button
                        onClick={() => setArchiveConfirm(course.id)}
                        className="p-2 rounded-lg text-gray-400 hover:text-orange-500 hover:bg-orange-50 transition-colors"
                        title={t.admin.archiveBtn}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmDelete(course.id)}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title={t.admin.deleteBtn}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Nuevo Curso — choice modal */}
      <Modal
        open={choiceModalOpen}
        onClose={() => setChoiceModalOpen(false)}
        title={t.admin.choiceModalTitle}
        size="md"
      >
        <div className="space-y-3 pb-2">
          {/* Wizard completo */}
          <button
            type="button"
            onClick={() => { setChoiceModalOpen(false); router.push('/admin/courses/wizard'); }}
            className="w-full text-left p-4 rounded-xl border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center shrink-0">
                <Wand2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-charcoal text-sm">Wizard de Planeamiento Completo</p>
                <p className="text-xs text-gray-500 mt-0.5">Calendario, tipo de evaluación, Copilot IA y generación del plan de estudios oficial (Word)</p>
              </div>
            </div>
          </button>

          <div className="grid grid-cols-2 gap-3">
          {/* Manual */}
          <button
            type="button"
            onClick={() => { setChoiceModalOpen(false); openCreate(); }}
            className="text-left p-4 rounded-xl border-2 border-border hover:border-cta-from hover:bg-blue-50 transition-colors"
          >
            <div className="text-2xl mb-2">📝</div>
            <p className="font-semibold text-charcoal text-sm">{t.admin.choiceManualTitle}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.admin.choiceManualDesc}</p>
          </button>

          {/* AI — topic */}
          <button
            type="button"
            onClick={() => { setChoiceModalOpen(false); openAiModal('topic', 2); }}
            className="text-left p-4 rounded-xl border-2 border-border hover:border-purple-400 hover:bg-purple-50 transition-colors"
          >
            <div className="text-2xl mb-2">💡</div>
            <p className="font-semibold text-charcoal text-sm">{t.admin.choiceTopicTitle}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.admin.choiceTopicDesc}</p>
          </button>

          {/* AI — URL */}
          <button
            type="button"
            onClick={() => { setChoiceModalOpen(false); openAiModal('url', 2); }}
            className="text-left p-4 rounded-xl border-2 border-border hover:border-purple-400 hover:bg-purple-50 transition-colors"
          >
            <div className="text-2xl mb-2">🌐</div>
            <p className="font-semibold text-charcoal text-sm">{t.admin.choiceUrlTitle}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.admin.choiceUrlDesc}</p>
          </button>

          {/* PDF — disabled */}
          <div className="text-left p-4 rounded-xl border-2 border-dashed border-gray-200 opacity-50 cursor-not-allowed">
            <div className="text-2xl mb-2">📄</div>
            <p className="font-semibold text-charcoal text-sm">{t.admin.choicePdfTitle}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t.admin.choicePdfDesc}</p>
          </div>
          </div>{/* end inner grid */}
        </div>
      </Modal>

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingCourse ? t.admin.editCourseTitle : t.admin.createCourseTitle}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label={t.admin.courseTitleLabel}
            value={form.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder={t.admin.courseTitlePlaceholder}
            required
          />
          <Input
            label={t.admin.slugLabel}
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder={t.admin.slugPlaceholder}
            required
          />
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">{t.admin.descriptionLabel}</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t.admin.descriptionPlaceholder}
              className="input-field min-h-[80px] resize-y"
              required
            />
          </div>
          <Input
            label={t.admin.imageUrlLabel}
            value={form.imageUrl}
            onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
            placeholder="https://..."
          />
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{t.admin.startDateLabel}</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                className="input-field"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{t.admin.closeDateLabel}</label>
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
              {t.admin.tagsLabel}
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
                placeholder={t.admin.tagsPlaceholder}
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
              <span className="text-sm font-medium text-charcoal">{t.admin.courseActiveLabel}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isPilot}
                onChange={(e) => setForm((f) => ({ ...f, isPilot: e.target.checked }))}
                className="w-4 h-4 accent-cta-from"
              />
              <span className="text-sm font-medium text-charcoal">{t.admin.coursePilotLabel}</span>
            </label>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              {t.admin.deleteUserCancelBtn}
            </Button>
            <Button type="submit" loading={saving}>
              {editingCourse ? t.admin.saveChangesBtn : t.admin.createCourseBtn}
            </Button>
          </div>
        </form>
      </Modal>

      {/* AI Wizard Modal */}
      <Modal
        open={aiModalOpen}
        onClose={() => {
          // Guard: ask for confirmation mid-flow (steps 2 and 3); step 4 = already published, close freely
          if (aiStep >= 2 && aiStep < 4) {
            setConfirmCloseOpen(true);
          } else {
            setAiModalOpen(false);
          }
        }}
        title={t.admin.aiWizardTitle}
        size="2xl"
        closeOnOverlay={false}
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
              {aiStep === 1 ? t.admin.aiStepMethod : aiStep === 2 ? t.admin.aiStepInfo : aiStep === 3 ? t.admin.aiStepReview : t.admin.aiStepAssign}
            </span>
          </div>

          {/* Step 1 — Method */}
          {aiStep === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">{t.admin.aiMethodQuestion}</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { id: 'topic', icon: '💡', title: t.admin.aiTopicTitle, desc: t.admin.aiTopicDesc },
                  { id: 'url', icon: '🌐', title: t.admin.aiUrlTitle, desc: t.admin.aiUrlDesc },
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
                    <p className="font-semibold text-charcoal text-sm">{t.admin.choicePdfTitle}</p>
                    <p className="text-xs text-gray-500">{t.admin.choicePdfDesc}</p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setAiStep(2)}>{t.admin.aiNextBtn}</Button>
              </div>
            </div>
          )}

          {/* Step 2 — Input */}
          {aiStep === 2 && (
            <div className="space-y-4">
              {aiMethod === 'topic' ? (
                <div className="space-y-1">
                  <label className="text-sm font-medium text-charcoal">{t.admin.aiTopicLabel}</label>
                  <textarea
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder={t.admin.aiTopicPlaceholder}
                    className="input-field min-h-[100px] resize-y"
                    autoFocus
                  />
                  <p className="text-xs text-gray-400">{t.admin.aiTopicHint}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-sm font-medium text-charcoal">{t.admin.aiUrlLabel}</label>
                  <input
                    type="url"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder={t.admin.aiUrlPlaceholder}
                    className="input-field"
                    autoFocus
                  />
                  <p className="text-xs text-gray-400">{t.admin.aiUrlHint}</p>
                </div>
              )}
              {aiError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{aiError}</div>
              )}
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setAiStep(1)}>{t.admin.aiBackBtn}</Button>
                <Button
                  onClick={handleAiGenerate}
                  loading={aiLoading}
                  leftIcon={!aiLoading ? <Sparkles className="w-4 h-4" /> : undefined}
                  disabled={!aiInput.trim()}
                >
                  {aiLoading ? (aiLoadingMsg || t.admin.aiGenerating) : t.admin.aiGenerateBtn}
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
                    {t.admin.modulesCount((aiResult.modules ?? []).length)}
                  </span>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                    {t.admin.lessonsCount((aiResult.modules ?? []).reduce((s: number, m: any) => s + (m.lessons?.length ?? 0), 0))}
                  </span>
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                    {t.admin.quizQuestionsCount((aiResult.modules ?? []).reduce((s: number, m: any) => s + (m.questions?.length ?? 0), 0))}
                  </span>
                </div>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {(aiResult.modules ?? []).map((m: any, i: number) => (
                  <div key={i} className="border border-border rounded-xl overflow-hidden">
                    {/* Module header */}
                    <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 flex items-center justify-between gap-2">
                      {editingModTitle?.idx === i ? (
                        <input
                          autoFocus
                          value={editingModTitle.value}
                          onChange={(e) => setEditingModTitle({ idx: i, value: e.target.value })}
                          onBlur={() => {
                            if (editingModTitle.value.trim()) {
                              setAiResult((prev: any) => {
                                const modules = [...(prev.modules ?? [])];
                                modules[i] = { ...modules[i], title: editingModTitle.value.trim() };
                                return { ...prev, modules };
                              });
                            }
                            setEditingModTitle(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setEditingModTitle(null);
                          }}
                          className="input-field text-sm font-semibold py-0.5 flex-1 min-w-0"
                        />
                      ) : (
                        <p className="font-semibold text-sm text-charcoal truncate flex-1">{m.order}. {m.title}</p>
                      )}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                          {(m.lessons ?? []).length} lec
                        </span>
                        <span className="text-xs bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-medium">
                          {(m.questions ?? []).length} quiz
                        </span>
                        {editingModTitle?.idx !== i && (
                          <button
                            type="button"
                            title={t.admin.editInfo}
                            onClick={() => setEditingModTitle({ idx: i, value: m.title })}
                            className="p-1 rounded text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          title={t.admin.regenAI}
                          disabled={regenModIdx !== null}
                          onClick={async () => {
                            setRegenModIdx(i);
                            try {
                              const res = await api.admin.courses.aiGenerateModule({
                                topic: m.title,
                                courseTitle: aiResult?.title,
                              });
                              const generated = (res as any).data ?? res;
                              if (generated?.title) {
                                setAiResult((prev: any) => {
                                  const modules = [...(prev.modules ?? [])];
                                  modules[i] = {
                                    ...generated,
                                    order: m.order,
                                    // keep question count display working
                                    questions: generated.questions ?? modules[i].questions,
                                  };
                                  return { ...prev, modules };
                                });
                              }
                            } catch { /* silent */ } finally { setRegenModIdx(null); }
                          }}
                          className="p-1 rounded text-gray-400 hover:text-purple-500 hover:bg-purple-50 transition-colors disabled:opacity-40"
                        >
                          {regenModIdx === i ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                        </button>
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
                {t.admin.aiPublishNote}
              </p>
              {aiError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{aiError}</div>
              )}
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => { setAiStep(2); setAiResult(null); }}>{t.admin.aiRegenBtn}</Button>
                <Button onClick={handleAiPublish} loading={aiPublishing} leftIcon={<CheckCircle className="w-4 h-4" />}>
                  {t.admin.aiPublishBtn}
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
                    <p className="font-heading font-bold text-charcoal">{t.admin.aiPublishedTitle}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{t.admin.aiPublishedSubtitle}</p>
                  </div>
                </div>
              </div>

              {/* Suggested tags */}
              {aiSuggestedTags.length > 0 && (
                <div className="p-3 bg-surface rounded-xl border border-border">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.admin.aiTagsSuggestedLabel}</p>
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
                  <p className="text-xs text-gray-400 mt-2">{t.admin.aiTagsHint}</p>
                </div>
              )}

              {aiStudentList.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-sm">{t.admin.aiNoStudents}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-charcoal">{t.admin.aiSelectStudentsLabel}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAiSelectedStudents(aiStudentList.map((s) => s.username))}
                        className="text-xs text-cta-from font-medium hover:opacity-70"
                      >
                        {t.admin.aiSelectAll}
                      </button>
                      <span className="text-xs text-gray-300">|</span>
                      <button
                        type="button"
                        onClick={() => setAiSelectedStudents([])}
                        className="text-xs text-gray-400 font-medium hover:opacity-70"
                      >
                        {t.admin.aiSelectNone}
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
                  <p className="text-xs text-gray-400">{t.admin.aiSelectedCount(aiSelectedStudents.length, aiStudentList.length)}</p>
                </>
              )}

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setAiModalOpen(false)}>
                  {t.admin.aiSkipBtn}
                </Button>
                <Button
                  onClick={handleAiAssign}
                  loading={aiAssigning}
                  disabled={aiSelectedStudents.length === 0}
                  leftIcon={<CheckCircle className="w-4 h-4" />}
                >
                  {t.admin.aiAssignBtn}
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
        title={t.admin.regenModalTitle}
        size="md"
      >
        {regenPreview && (
          <>
            <p className="text-sm text-gray-600 mb-3">
              {t.admin.regenModalDesc(regenPreview.title)}
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
              <Button variant="secondary" onClick={() => setRegenPreview(null)}>{t.admin.deleteUserCancelBtn}</Button>
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
                {t.admin.regenConfirmBtn}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* Assign Evaluator Modal */}
      <Modal
        open={!!evalModal}
        onClose={() => setEvalModal(null)}
        title={t.admin.assignEvalModalTitle(evalModal?.courseName ?? '')}
        size="sm"
      >
        <div className="space-y-4">
          {evalLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : evaluators.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">{t.admin.assignEvalNoEvals}</p>
          ) : (
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{t.admin.assignEvalLabel}</label>
              <select
                value={selectedEval}
                onChange={(e) => setSelectedEval(e.target.value)}
                className="input-field w-full"
              >
                <option value="">{t.admin.assignEvalPlaceholder}</option>
                {evaluators.map((ev) => (
                  <option key={ev.username} value={ev.username}>{ev.name} ({ev.email})</option>
                ))}
              </select>
            </div>
          )}
          {evalError && <p className="text-xs text-red-500">{evalError}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="secondary" onClick={() => setEvalModal(null)}>{t.admin.deleteUserCancelBtn}</Button>
            <Button
              loading={evalSaving}
              disabled={!selectedEval}
              onClick={handleAssignEvaluator}
            >
              {t.admin.assignEvalBtn}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={t.admin.deleteCourseModalTitle}
        size="sm"
      >
        <p className="text-gray-600 text-sm mb-6">
          {t.admin.deleteCourseModalMsg}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
            {t.admin.deleteUserCancelBtn}
          </Button>
          <Button
            variant="danger"
            loading={deleting}
            onClick={() => confirmDelete && handleDelete(confirmDelete)}
          >
            {t.admin.deleteUserConfirmBtn}
          </Button>
        </div>
      </Modal>
      {/* Archive confirmation */}
      <ConfirmDialog
        open={!!archiveConfirm}
        title={t.admin.archiveConfirmTitle}
        message={t.admin.archiveConfirmMsg}
        confirmLabel={t.admin.archiveConfirmBtn}
        cancelLabel={t.admin.deleteUserCancelBtn}
        variant="danger"
        onConfirm={() => archiveConfirm && handleArchive(archiveConfirm)}
        onCancel={() => setArchiveConfirm(null)}
      />

      {/* AI wizard — close confirmation */}
      <ConfirmDialog
        open={confirmCloseOpen}
        title={t.admin.aiCloseConfirmTitle}
        message={t.admin.aiCloseConfirmMsg}
        confirmLabel={t.admin.aiCloseConfirmBtn}
        cancelLabel={t.admin.aiCloseKeepBtn}
        variant="danger"
        onConfirm={() => { setConfirmCloseOpen(false); setAiModalOpen(false); }}
        onCancel={() => setConfirmCloseOpen(false)}
      />
    </div>
  );
}
