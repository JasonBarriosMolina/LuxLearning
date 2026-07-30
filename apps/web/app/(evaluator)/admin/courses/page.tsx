'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useLanguage } from '@/lib/i18n';
import { CourseForm, CourseFormModal } from './_components/CourseFormModal';
import { ChoiceModal } from './_components/ChoiceModal';
import { AiWizardModal } from './_components/AiWizardModal';
import { RegenPreviewModal } from './_components/RegenPreviewModal';
import { AssignEvaluatorModal } from './_components/AssignEvaluatorModal';
import { DeleteCourseModal } from './_components/DeleteCourseModal';
import { CourseCard } from './_components/CourseCard';

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
      const res0 = await api.admin.courses.aiGenerate({ method: aiMethod, input: aiInput.trim() });
      const jobId = res0?.data?.jobId ?? res0?.jobId;

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
      setAiAcceptedTags(suggested);
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
      if (aiPublishedCourseId && aiAcceptedTags.length > 0) {
        const course = courses.find((c: any) => c.id === aiPublishedCourseId);
        if (course) {
          await api.admin.courses.update(aiPublishedCourseId, {
            ...course,
            tags: aiAcceptedTags,
          }).catch(() => {});
        }
      }
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

  const handleRegenerate = async (courseId: string) => {
    setRegeneratingCourse(courseId);
    try {
      const res = await api.admin.courses.regenerate(courseId);
      if (res?.data?.modules) {
        setRegenPreview({ courseId, title: res.data.title, modules: res.data.modules });
      }
    } catch { /* ignore */ } finally {
      setRegeneratingCourse(null);
    }
  };

  const handleRegenConfirm = async (modules: any[]) => {
    for (const m of modules) {
      try { await api.admin.modules.regenerate(m.id ?? m.moduleId); } catch { /* continue */ }
    }
    load();
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
            <CourseCard
              key={course.id}
              course={course}
              regeneratingCourse={regeneratingCourse}
              onEdit={openEdit}
              onRegenerate={handleRegenerate}
              onEvalModal={openEvalModal}
              onPublish={handlePublish}
              onRestore={handleRestore}
              onArchive={(id) => setArchiveConfirm(id)}
              onDelete={(id) => setConfirmDelete(id)}
              t={t}
            />
          ))}
        </div>
      )}

      <ChoiceModal
        open={choiceModalOpen}
        onClose={() => setChoiceModalOpen(false)}
        onWizard={() => { setChoiceModalOpen(false); router.push('/admin/courses/lux-planner'); }}
        onManual={() => { setChoiceModalOpen(false); openCreate(); }}
        onTopic={() => { setChoiceModalOpen(false); openAiModal('topic', 2); }}
        onUrl={() => { setChoiceModalOpen(false); openAiModal('url', 2); }}
        t={t}
      />

      <CourseFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editingCourse={editingCourse}
        form={form}
        setForm={setForm}
        tagInput={tagInput}
        setTagInput={setTagInput}
        saving={saving}
        error={error}
        onSave={handleSave}
        onTitleChange={handleTitleChange}
        t={t}
      />

      <AiWizardModal
        open={aiModalOpen}
        onClose={() => {
          if (aiStep >= 2 && aiStep < 4) {
            setConfirmCloseOpen(true);
          } else {
            setAiModalOpen(false);
          }
        }}
        aiStep={aiStep}
        setAiStep={setAiStep}
        aiMethod={aiMethod}
        setAiMethod={setAiMethod}
        aiInput={aiInput}
        setAiInput={setAiInput}
        aiLoading={aiLoading}
        aiLoadingMsg={aiLoadingMsg}
        aiResult={aiResult}
        setAiResult={setAiResult}
        aiPublishing={aiPublishing}
        aiError={aiError}
        aiStudentList={aiStudentList}
        aiSelectedStudents={aiSelectedStudents}
        setAiSelectedStudents={setAiSelectedStudents}
        aiAssigning={aiAssigning}
        aiSuggestedTags={aiSuggestedTags}
        aiAcceptedTags={aiAcceptedTags}
        setAiAcceptedTags={setAiAcceptedTags}
        editingModTitle={editingModTitle}
        setEditingModTitle={setEditingModTitle}
        regenModIdx={regenModIdx}
        setRegenModIdx={setRegenModIdx}
        onGenerate={handleAiGenerate}
        onPublish={handleAiPublish}
        onAssign={handleAiAssign}
        t={t}
      />

      <RegenPreviewModal
        regenPreview={regenPreview}
        onClose={() => setRegenPreview(null)}
        onConfirm={handleRegenConfirm}
        t={t}
      />

      <AssignEvaluatorModal
        evalModal={evalModal}
        evaluators={evaluators}
        selectedEval={selectedEval}
        setSelectedEval={setSelectedEval}
        evalLoading={evalLoading}
        evalSaving={evalSaving}
        evalError={evalError}
        onClose={() => setEvalModal(null)}
        onAssign={handleAssignEvaluator}
        t={t}
      />

      <DeleteCourseModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        deleting={deleting}
        t={t}
      />

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
