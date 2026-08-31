'use client';

import { useState, useEffect, useRef } from 'react';
import {
  GripVertical, ChevronDown, ChevronRight, ChevronUp, BookOpen, ClipboardCheck,
  Eye, RefreshCw, Pencil, Trash2, Loader2, Sparkles, PlayCircle, Plus, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { api } from '@/lib/api';
import { formatCourseDuration } from '@/lib/utils';
import { ConfirmDelete } from './ConfirmDelete';
import { LessonRow } from './LessonRow';
import { QuestionRow } from './QuestionRow';
import { LessonFields } from './LessonFields';
import { QuestionFields } from './QuestionFields';
import { LuxCarrouselWizard } from './LuxCarrouselWizard';
import type { ModuleForm, LessonForm, QuestionForm } from './types';
import { newLessonForm, newQuestionForm } from './types';

export function ModuleCard({ mod, courseId, onRefresh, onMoveUp, onMoveDown, isFirst, isLast, hasQuizPlanned = true, hasClassPlanned = false, hasReflectionPlanned = false, hasInterviewPlanned = false }: {
  mod: any; courseId: string; onRefresh: () => void;
  onMoveUp?: () => Promise<void>; onMoveDown?: () => Promise<void>;
  isFirst?: boolean; isLast?: boolean;
  /** Was a quiz explicitly planned for this module (EvaluationEvent type=QUIZ)? Distinct from
   *  mod.questions.length===0, which can't tell "never planned" from "planned but not generated
   *  yet" — Trello DmPpbrff comment 6a91f73f. Defaults true when omitted (legacy callers / tests)
   *  so existing behavior is preserved unless the caller explicitly opts into the new signal. */
  hasQuizPlanned?: boolean;
  /** Was a Lux Mentor class planned for this module (EvaluationEvent type=CLASS)? Shown as a
   *  badge so the admin/evaluator can see it without leaving this edit view — was only
   *  visible to students before (Trello DmPpbrff comment 6a926775: "esa información debe
   *  ser visible para mí como administrador o editor del curso"). */
  hasClassPlanned?: boolean;
  /** Was reflection explicitly planned for this module (EvaluationEvent type=REFLECTION)?
   *  Trello DmPpbrff comment 6a9269e2 — reflection/interview used to be unconditional. */
  hasReflectionPlanned?: boolean;
  /** Was an interview with Lux Mentor explicitly planned for this module (EvaluationEvent
   *  type=INTERVIEW)? Same comment as hasReflectionPlanned. */
  hasInterviewPlanned?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingMod, setEditingMod] = useState(false);
  const [form, setForm] = useState<ModuleForm>({
    title: mod.title, description: mod.description, duration: mod.duration,
    passingScore: mod.passingScore, order: mod.order,
  });
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lessonModal, setLessonModal] = useState(false);
  const [lessonForm, setLessonForm] = useState<LessonForm>(newLessonForm());
  const [savingLesson, setSavingLesson] = useState(false);
  const [questionModal, setQuestionModal] = useState(false);
  const [questionForm, setQuestionForm] = useState<QuestionForm>(newQuestionForm());
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [regeneratingMod, setRegeneratingMod] = useState(false);
  const [regenJobId, setRegenJobId] = useState<string | null>(null);
  const [regenModError, setRegenModError] = useState<string | null>(null);
  const regenJobIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [modPreviewOpen, setModPreviewOpen] = useState(false);
  const [aiLessonOpen, setAiLessonOpen] = useState(false);
  const [aiLessonTopic, setAiLessonTopic] = useState('');
  const [aiLessonLoading, setAiLessonLoading] = useState(false);
  const [aiLessonError, setAiLessonError] = useState('');
  const aiLessonIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [carouselWizardOpen, setCarouselWizardOpen] = useState(false);

  const [aiQuestionsOpen, setAiQuestionsOpen] = useState(false);
  const [aiQuestionsContent, setAiQuestionsContent] = useState('');
  const [aiQuestionsCount, setAiQuestionsCount] = useState(5);
  const [aiQuestionsLoading, setAiQuestionsLoading] = useState(false);
  const [aiQuestionsError, setAiQuestionsError] = useState('');
  // Quiz section collapsed by default when empty (no questions from AI plan or manual)
  const [quizExpanded, setQuizExpanded] = useState((mod.questions?.length ?? 0) > 0);

  // Cleanup polling intervals on unmount
  useEffect(() => {
    return () => {
      if (regenJobIntervalRef.current) clearInterval(regenJobIntervalRef.current);
      if (aiLessonIntervalRef.current) clearInterval(aiLessonIntervalRef.current);
    };
  }, []);

  const handleAiLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiLessonTopic.trim()) return;
    setAiLessonLoading(true); setAiLessonError('');
    try {
      const res = await api.admin.lessons.aiGenerate(mod.id, { topic: aiLessonTopic.trim() });
      const jobId = (res as any)?.data?.jobId ?? (res as any)?.jobId;
      if (!jobId) { setAiLessonOpen(false); setAiLessonTopic(''); onRefresh(); return; }
      // Poll every 3 s, give up after 120 s
      let elapsed = 0;
      aiLessonIntervalRef.current = setInterval(async () => {
        elapsed += 3;
        try {
          const poll = await api.admin.courses.aiJob(jobId);
          const status = (poll as any)?.data?.status ?? (poll as any)?.status;
          if (status === 'done') {
            clearInterval(aiLessonIntervalRef.current!); aiLessonIntervalRef.current = null;
            setAiLessonLoading(false); setAiLessonOpen(false); setAiLessonTopic(''); onRefresh();
          } else if (status === 'error') {
            clearInterval(aiLessonIntervalRef.current!); aiLessonIntervalRef.current = null;
            setAiLessonLoading(false);
            setAiLessonError('Error al generar la lección. Intenta de nuevo.');
          } else if (elapsed >= 120) {
            clearInterval(aiLessonIntervalRef.current!); aiLessonIntervalRef.current = null;
            setAiLessonLoading(false);
            setAiLessonError('Tiempo de espera agotado. Recarga la página para verificar si se creó la lección.');
          }
        } catch { /* network hiccup — keep polling */ }
      }, 3000);
    } catch (err: any) {
      setAiLessonError(err.message ?? 'Error al generar lección');
      setAiLessonLoading(false);
    }
  };

  const handleAiQuestions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuestionsContent.trim()) return;
    setAiQuestionsLoading(true);
    setAiQuestionsError('');
    try {
      const res = await api.admin.questions.aiGenerate(mod.id, {
        content: aiQuestionsContent.trim(),
        count: aiQuestionsCount,
      });
      const created = (res as any)?.data?.created ?? 0;
      setAiQuestionsOpen(false);
      setAiQuestionsContent('');
      setAiQuestionsCount(5);
      if (created > 0) onRefresh();
    } catch (err: any) {
      setAiQuestionsError(err.message ?? 'Error al generar preguntas. Intenta de nuevo.');
    } finally {
      setAiQuestionsLoading(false);
    }
  };

  const handleRegenerateMod = async () => {
    setRegeneratingMod(true);
    setRegenModError(null);
    try {
      const res = await api.admin.modules.regenerate(mod.id);
      const jobId = res?.data?.jobId;
      if (!jobId) return;
      setRegenJobId(jobId);
      // Poll every 3 s, give up after 180 s
      let elapsed = 0;
      regenJobIntervalRef.current = setInterval(async () => {
        elapsed += 3;
        try {
          const poll = await api.admin.courses.aiJob(jobId);
          const status = poll?.data?.status ?? poll?.status;
          if (status === 'done') {
            clearInterval(regenJobIntervalRef.current!);
            regenJobIntervalRef.current = null;
            setRegenJobId(null);
            onRefresh();
          } else if (status === 'error') {
            clearInterval(regenJobIntervalRef.current!);
            regenJobIntervalRef.current = null;
            setRegenJobId(null);
            setRegenModError((poll?.data?.error ?? poll?.error) ? `Error: ${poll?.data?.error ?? poll?.error}` : 'Error al regenerar el módulo. Intenta de nuevo.');
          } else if (elapsed >= 180) {
            clearInterval(regenJobIntervalRef.current!);
            regenJobIntervalRef.current = null;
            setRegenJobId(null);
            setRegenModError('Tiempo de espera agotado. Recarga la página para ver si se aplicaron los cambios.');
          }
        } catch { /* network hiccup — keep polling */ }
      }, 3000);
    } catch {
      setRegenModError('No se pudo iniciar la regeneración.');
    } finally {
      setRegeneratingMod(false);
    }
  };

  const handleSaveMod = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try { await api.admin.modules.update(mod.id, form); setEditingMod(false); onRefresh(); }
    finally { setSaving(false); }
  };

  const handleDeleteMod = async () => {
    setDeleting(true);
    try { await api.admin.modules.delete(mod.id); onRefresh(); }
    finally { setDeleting(false); setConfirmDel(false); }
  };

  const handleAddLesson = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingLesson(true);
    try {
      await api.admin.lessons.create(mod.id, { ...lessonForm, points: lessonForm.points.filter((p) => p.trim()) });
      setLessonModal(false); onRefresh();
    } finally { setSavingLesson(false); }
  };

  const handleAddQuestion = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingQuestion(true);
    try { await api.admin.questions.create(mod.id, questionForm); setQuestionModal(false); onRefresh(); }
    finally { setSavingQuestion(false); }
  };

  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      {/* Module header */}
      <div className="flex items-center gap-3 p-4 bg-white">
        <div className="flex flex-col shrink-0">
          <button onClick={onMoveUp} disabled={isFirst || !onMoveUp} title="Mover módulo arriba"
            className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors">
            <ChevronUp className="w-3 h-3" />
          </button>
          <GripVertical className="w-4 h-4 text-gray-300" />
          <button onClick={onMoveDown} disabled={isLast || !onMoveDown} title="Mover módulo abajo"
            className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors">
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          {expanded ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-400 shrink-0">MÓD. {mod.order}</span>
              <p className="font-semibold text-charcoal truncate">{mod.title}</p>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatCourseDuration(mod.duration)} • Nota mínima: {mod.passingScore}% •{' '}
              <span className="font-medium">{mod.lessons?.length ?? 0} lecciones</span> •{' '}
              <span className="font-medium">{mod.questions?.length ?? 0} preguntas</span>
            </p>
            {(hasQuizPlanned || hasClassPlanned || hasReflectionPlanned || hasInterviewPlanned) && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {hasQuizPlanned && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                    <ClipboardCheck className="w-2.5 h-2.5" />Quiz planificado
                  </span>
                )}
                {hasClassPlanned && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                    <PlayCircle className="w-2.5 h-2.5" />Clase Lux Mentor
                  </span>
                )}
                {hasReflectionPlanned && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
                    <FileText className="w-2.5 h-2.5" />Reflexión planificada
                  </span>
                )}
                {hasInterviewPlanned && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                    <ClipboardCheck className="w-2.5 h-2.5" />Entrevista con Lux Mentor
                  </span>
                )}
              </div>
            )}
          </div>
        </button>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => setModPreviewOpen(true)} title="Vista previa del módulo" className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-teal-50 transition-colors">
            <Eye className="w-4 h-4" />
          </button>
          <button onClick={handleRegenerateMod} disabled={regeneratingMod} title="Regenerar módulo con IA" className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors disabled:opacity-50">
            {regeneratingMod ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <button onClick={() => setEditingMod(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-charcoal hover:bg-surface transition-colors"><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setConfirmDel(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>
        </div>
        {regenJobId && (
          <div className="ml-2 flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">
            <Loader2 className="w-3 h-3 animate-spin" />
            Regenerando... (jobId: {regenJobId.slice(-6)})
          </div>
        )}
        {regenModError && (
          <div className="ml-2 flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-lg">
            {regenModError}
            <button onClick={() => setRegenModError(null)} className="ml-1 font-bold hover:opacity-70">×</button>
          </div>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border bg-surface p-4 space-y-5">

          {/* Lessons section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-charcoal flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-cta-from" />
                Lecciones ({mod.lessons?.length ?? 0})
              </h4>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="secondary" leftIcon={<Sparkles className="w-3.5 h-3.5 text-purple-500" />}
                  onClick={() => { setAiLessonTopic(''); setAiLessonError(''); setAiLessonOpen(true); }}>
                  IA
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setCarouselWizardOpen(true)}>
                  🎠 Carrousel
                </Button>
                <Button size="sm" variant="secondary" leftIcon={<Plus className="w-3.5 h-3.5" />}
                  onClick={() => { setLessonForm(newLessonForm((mod.lessons?.length ?? 0) + 1)); setLessonModal(true); }}>
                  Agregar
                </Button>
              </div>
            </div>
            {(mod.lessons?.length ?? 0) === 0 && (
              <p className="text-xs text-gray-400 text-center py-4 bg-white rounded-xl border border-dashed border-border">
                Sin lecciones. Agrega la primera con el botón de arriba.
              </p>
            )}
            {mod.lessons?.map((lesson: any, li: number) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                onRefresh={onRefresh}
                isFirst={li === 0}
                isLast={li === (mod.lessons.length - 1)}
                onMoveUp={async () => {
                  const prev = mod.lessons[li - 1];
                  if (!prev) return;
                  await Promise.all([
                    api.admin.lessons.update(lesson.id, { order: prev.order }),
                    api.admin.lessons.update(prev.id, { order: lesson.order }),
                  ]);
                  onRefresh();
                }}
                onMoveDown={async () => {
                  const next = mod.lessons[li + 1];
                  if (!next) return;
                  await Promise.all([
                    api.admin.lessons.update(lesson.id, { order: next.order }),
                    api.admin.lessons.update(next.id, { order: lesson.order }),
                  ]);
                  onRefresh();
                }}
              />
            ))}
          </div>

          {/* Questions section — only rendered when a quiz was actually planned for this
              module (or it already has questions, e.g. added manually before this fix).
              Never created/shown for modules with no quiz in the plan (Trello DmPpbrff
              comment 6a91f73f) — collapsed by default when planned but still empty. */}
          {(hasQuizPlanned || (mod.questions?.length ?? 0) > 0) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <button
                className="flex items-center gap-1.5 text-sm font-semibold text-charcoal hover:text-cta-from transition-colors"
                onClick={() => setQuizExpanded((v) => !v)}
              >
                <ClipboardCheck className="w-4 h-4 text-amber-500" />
                Preguntas del quiz ({mod.questions?.length ?? 0})
                {quizExpanded
                  ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                  : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
              </button>
              {quizExpanded && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" leftIcon={<Sparkles className="w-3.5 h-3.5 text-purple-500" />}
                    onClick={() => {
                      const preloaded = (mod.lessons ?? []).map((l: any, i: number) => {
                        const parts = [`Lección ${i + 1}: ${l.title}`];
                        if (l.content) parts.push(l.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
                        if (Array.isArray(l.points) && l.points.filter(Boolean).length > 0) parts.push('Puntos clave: ' + l.points.filter(Boolean).join('. '));
                        if (l.tip) parts.push('Consejo: ' + l.tip);
                        return parts.join('\n');
                      }).join('\n\n');
                      setAiQuestionsContent(preloaded);
                      setAiQuestionsError('');
                      setAiQuestionsOpen(true);
                    }}>
                    IA
                  </Button>
                  <Button size="sm" variant="secondary" leftIcon={<Plus className="w-3.5 h-3.5" />}
                    onClick={() => { setQuestionForm(newQuestionForm((mod.questions?.length ?? 0) + 1)); setQuestionModal(true); }}>
                    Agregar pregunta
                  </Button>
                </div>
              )}
            </div>
            {quizExpanded && (
              <>
                {(mod.questions?.length ?? 0) === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4 bg-white dark:bg-gray-900/20 rounded-xl border border-dashed border-border">
                    {hasQuizPlanned
                      ? 'Cuestionario planificado pero aún sin generar. Usa "IA" o "Agregar pregunta" arriba.'
                      : 'Sin preguntas. Agrega la primera con el botón de arriba.'}
                  </p>
                )}
                {mod.questions?.map((q: any) => (
                  <QuestionRow key={q.id} question={q} onRefresh={onRefresh} />
                ))}
              </>
            )}
          </div>
          )}
        </div>
      )}

      {/* Edit module modal */}
      <Modal open={editingMod} onClose={() => setEditingMod(false)} title="Editar módulo" size="lg">
        <form onSubmit={handleSaveMod} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Input label="Título" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
            <Input label="Duración" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="ej. 45 min" required />
            <Input label="Nota mínima (%)" type="number" value={form.passingScore} onChange={(e) => setForm({ ...form, passingScore: Number(e.target.value) })} min={1} max={100} required />
            <Input label="Orden" type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Descripción</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input-field resize-y min-h-[80px]" required />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditingMod(false)}>Cancelar</Button>
            <Button type="submit" loading={saving}>Guardar cambios</Button>
          </div>
        </form>
      </Modal>

      {/* AI lesson generation modal */}
      <Modal open={aiLessonOpen} onClose={() => setAiLessonOpen(false)} title="Crear lección con IA" size="sm">
        <form onSubmit={handleAiLesson} className="space-y-4">
          <p className="text-sm text-gray-500">La IA generará una lección completa (contenido HTML, puntos clave, consejo) sobre el tema que indiques.</p>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Tema de la lección</label>
            <input
              autoFocus
              value={aiLessonTopic}
              onChange={(e) => setAiLessonTopic(e.target.value)}
              placeholder="ej. Gestión del tiempo en proyectos"
              className="input-field text-sm w-full"
              required
            />
          </div>
          {aiLessonError && <p className="text-xs text-red-500">{aiLessonError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => setAiLessonOpen(false)}>Cancelar</Button>
            <Button type="submit" size="sm" loading={aiLessonLoading} leftIcon={<Sparkles className="w-3.5 h-3.5" />}>
              Generar lección
            </Button>
          </div>
        </form>
      </Modal>

      {/* Lux Carrousel Mini Wizard (Trello N1bbWdz0) */}
      <LuxCarrouselWizard
        moduleId={mod.id}
        open={carouselWizardOpen}
        onClose={() => setCarouselWizardOpen(false)}
        onDone={onRefresh}
      />

      {/* AI quiz questions generation modal */}
      <Modal open={aiQuestionsOpen} onClose={() => setAiQuestionsOpen(false)} title="Generar preguntas con IA" size="md">
        <form onSubmit={handleAiQuestions} className="space-y-4">
          <p className="text-sm text-gray-500">
            El contenido de las lecciones fue precargado automáticamente. Puedes editarlo antes de generar.
          </p>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Contenido del módulo</label>
            <textarea
              autoFocus
              value={aiQuestionsContent}
              onChange={(e) => setAiQuestionsContent(e.target.value)}
              placeholder="Pega aquí el contenido de las lecciones o describe los conceptos clave del módulo..."
              className="input-field resize-none min-h-[140px] text-sm w-full"
              required
              minLength={20}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Cantidad de preguntas</label>
            <select
              value={aiQuestionsCount}
              onChange={(e) => setAiQuestionsCount(Number(e.target.value))}
              className="input-field text-sm"
            >
              {[3, 5, 7, 10].map((n) => (
                <option key={n} value={n}>{n} preguntas</option>
              ))}
            </select>
          </div>
          {aiQuestionsError && <p className="text-xs text-red-500">{aiQuestionsError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => setAiQuestionsOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={aiQuestionsLoading} leftIcon={<Sparkles className="w-3.5 h-3.5" />}>
              Generar preguntas
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add lesson modal */}
      <Modal open={lessonModal} onClose={() => setLessonModal(false)} title="Nueva lección" size="xl">
        <form onSubmit={handleAddLesson} className="space-y-4">
          <LessonFields form={lessonForm} setForm={setLessonForm} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setLessonModal(false)}>Cancelar</Button>
            <Button type="submit" loading={savingLesson}>Crear lección</Button>
          </div>
        </form>
      </Modal>

      {/* Add question modal */}
      <Modal open={questionModal} onClose={() => setQuestionModal(false)} title="Nueva pregunta" size="lg">
        <form onSubmit={handleAddQuestion} className="space-y-4">
          <QuestionFields form={questionForm} setForm={setQuestionForm} uid="new-question" />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setQuestionModal(false)}>Cancelar</Button>
            <Button type="submit" loading={savingQuestion}>Crear pregunta</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDelete open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={handleDeleteMod} loading={deleting} label="módulo" />

      {/* Module preview modal */}
      <Modal open={modPreviewOpen} onClose={() => setModPreviewOpen(false)} title={`Vista previa — ${mod.title}`} size="lg">
        <div className="space-y-4 overflow-y-auto max-h-[65vh] pr-1">
          {mod.description && (
            <p className="text-sm text-gray-600">{mod.description}</p>
          )}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {mod.lessons?.length ?? 0} lecciones
            </p>
            {(mod.lessons ?? []).map((l: any, i: number) => (
              <div key={l.id} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-border bg-surface text-sm">
                <PlayCircle className="w-4 h-4 text-cta-from shrink-0" />
                <span className="text-gray-400 text-xs font-bold w-5 shrink-0">{i + 1}.</span>
                <span className="text-charcoal flex-1 truncate">{l.title}</span>
                {l.duration && <span className="text-xs text-gray-400 shrink-0">{formatCourseDuration(l.duration)}</span>}
              </div>
            ))}
            {(!mod.lessons || mod.lessons.length === 0) && (
              <p className="text-sm text-gray-400 py-4 text-center">Este módulo aún no tiene lecciones.</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
