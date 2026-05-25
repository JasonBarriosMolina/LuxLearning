'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Pencil, Trash2, ChevronDown, ChevronRight,
  BookOpen, ClipboardCheck, PlayCircle, GripVertical, X, RefreshCw, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCourseDuration } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModuleForm {
  title: string; description: string; duration: string; passingScore: number; order: number;
}
interface LessonForm {
  title: string; duration: string; youtubeId: string; imageUrl: string;
  points: string[]; tip: string; order: number;
}
interface QuestionForm {
  text: string; options: string[]; correctIndex: number; order: number;
}

const EMPTY_MODULE: ModuleForm = { title: '', description: '', duration: '', passingScore: 70, order: 1 };
const newLessonForm = (order = 1): LessonForm => ({ title: '', duration: '', youtubeId: '', imageUrl: '', points: [''], tip: '', order });
const newQuestionForm = (order = 1): QuestionForm => ({ text: '', options: ['', '', '', ''], correctIndex: 0, order });

// ─── Confirm delete ───────────────────────────────────────────────────────────

function ConfirmDelete({ open, onClose, onConfirm, loading, label }: {
  open: boolean; onClose: () => void; onConfirm: () => void; loading: boolean; label: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={`Eliminar ${label}`} size="sm">
      <p className="text-gray-600 text-sm mb-6">
        ¿Seguro que quieres eliminar este elemento? Esta acción no se puede deshacer.
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" loading={loading} onClick={onConfirm}>Eliminar</Button>
      </div>
    </Modal>
  );
}

// ─── Dynamic points list ──────────────────────────────────────────────────────

function PointsList({ points, onChange }: { points: string[]; onChange: (pts: string[]) => void }) {
  const update = (i: number, val: string) => {
    const next = [...points]; next[i] = val; onChange(next);
  };
  const add = () => onChange([...points, '']);
  const remove = (i: number) => onChange(points.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-charcoal">Puntos clave</label>
      {points.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{i + 1}.</span>
          <input
            value={p}
            onChange={(e) => update(i, e.target.value)}
            placeholder={`Punto clave ${i + 1}`}
            className="input-field flex-1 text-sm py-2"
          />
          {points.length > 1 && (
            <button type="button" onClick={() => remove(i)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-xs font-semibold text-cta-from hover:opacity-80 transition-opacity mt-1"
      >
        <Plus className="w-3.5 h-3.5" /> Agregar punto
      </button>
    </div>
  );
}

// ─── Dynamic options list (quiz) ──────────────────────────────────────────────

function OptionsList({ options, correctIndex, onOptionsChange, onCorrectChange, questionId }: {
  options: string[]; correctIndex: number;
  onOptionsChange: (opts: string[]) => void;
  onCorrectChange: (i: number) => void;
  questionId: string; // unique name for radio group
}) {
  const update = (i: number, val: string) => {
    const next = [...options]; next[i] = val; onOptionsChange(next);
  };
  const add = () => onOptionsChange([...options, '']);
  const remove = (i: number) => {
    if (options.length <= 2) return;
    const next = options.filter((_, idx) => idx !== i);
    onOptionsChange(next);
    // Adjust correctIndex if needed
    if (correctIndex >= next.length) onCorrectChange(next.length - 1);
    else if (correctIndex > i) onCorrectChange(correctIndex - 1);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-charcoal">
        Opciones <span className="text-gray-400 font-normal">(selecciona la correcta)</span>
      </label>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="radio"
            name={questionId}
            checked={correctIndex === i}
            onChange={() => onCorrectChange(i)}
            className="accent-cta-from shrink-0"
          />
          <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{String.fromCharCode(65 + i)}.</span>
          <input
            value={opt}
            onChange={(e) => update(i, e.target.value)}
            placeholder={`Opción ${String.fromCharCode(65 + i)}`}
            className="input-field flex-1 text-sm py-2"
            required
          />
          {options.length > 2 && (
            <button type="button" onClick={() => remove(i)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-xs font-semibold text-cta-from hover:opacity-80 transition-opacity mt-1"
      >
        <Plus className="w-3.5 h-3.5" /> Agregar opción
      </button>
      <p className="text-xs text-gray-400">El radio marcado es la respuesta correcta. Mínimo 2 opciones.</p>
    </div>
  );
}

// ─── Lesson form fields (shared between create and edit) ──────────────────────

function LessonFields({ form, setForm }: { form: LessonForm; setForm: (f: LessonForm) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Input label="Título" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <Input label="Duración" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="ej. 12 min" required />
        <Input label="YouTube ID" value={form.youtubeId} onChange={(e) => setForm({ ...form, youtubeId: e.target.value })} placeholder="dQw4w9WgXcQ" required />
        <Input label="Orden" type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} required />
        <div className="col-span-1">
          <Input label="URL imagen (opcional)" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
        </div>
      </div>
      <PointsList points={form.points} onChange={(pts) => setForm({ ...form, points: pts })} />
      <Input label="Consejo (tip)" value={form.tip} onChange={(e) => setForm({ ...form, tip: e.target.value })} placeholder="Consejo práctico para el estudiante..." />
    </div>
  );
}

// ─── Question form fields (shared) ───────────────────────────────────────────

function QuestionFields({ form, setForm, uid }: { form: QuestionForm; setForm: (f: QuestionForm) => void; uid: string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium text-charcoal">Pregunta</label>
        <textarea
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          placeholder="¿Cuál de las siguientes afirmaciones es correcta?"
          className="input-field resize-none min-h-[80px]"
          required
        />
      </div>
      <OptionsList
        options={form.options}
        correctIndex={form.correctIndex}
        onOptionsChange={(opts) => setForm({ ...form, options: opts })}
        onCorrectChange={(i) => setForm({ ...form, correctIndex: i })}
        questionId={uid}
      />
      <Input label="Orden" type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} required />
    </div>
  );
}

// ─── Question row (inline view + edit) ───────────────────────────────────────

function QuestionRow({ question, onRefresh }: { question: any; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<QuestionForm>({
    text: question.text, options: [...question.options],
    correctIndex: question.correctIndex, order: question.order,
  });
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try { await api.admin.questions.update(question.id, form); setEditing(false); onRefresh(); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await api.admin.questions.delete(question.id); onRefresh(); }
    finally { setDeleting(false); setConfirmDel(false); }
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-3 p-3 bg-surface rounded-xl border border-border">
        <span className="text-xs font-bold text-gray-400 mt-0.5 w-5 shrink-0">{question.order}.</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-charcoal mb-1">{question.text}</p>
          <div className="space-y-0.5">
            {question.options.map((opt: string, i: number) => (
              <span key={i} className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded ${i === question.correctIndex ? 'bg-emerald-100 text-emerald-700 font-semibold' : 'text-gray-500'}`}>
                <span className="font-bold">{String.fromCharCode(65 + i)}.</span> {opt}
                {i === question.correctIndex && <span className="ml-1 text-emerald-600">✓</span>}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">{question.options.length} opciones • Selección única</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-charcoal hover:bg-white transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={() => setConfirmDel(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        <ConfirmDelete open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={handleDelete} loading={deleting} label="pregunta" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="p-4 bg-white rounded-xl border-2 border-cta-from space-y-4">
      <QuestionFields form={form} setForm={setForm} uid={`edit-${question.id}`} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
        <Button type="submit" size="sm" loading={saving}>Guardar</Button>
      </div>
    </form>
  );
}

// ─── Lesson row (inline view + edit) ─────────────────────────────────────────

function LessonRow({ lesson, onRefresh }: { lesson: any; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<LessonForm>({
    title: lesson.title, duration: lesson.duration, youtubeId: lesson.youtubeId,
    imageUrl: lesson.imageUrl ?? '',
    points: lesson.points?.length > 0 ? lesson.points : [''],
    tip: lesson.tip ?? '', order: lesson.order,
  });
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try { await api.admin.lessons.regenerate(lesson.id); onRefresh(); }
    catch { /* ignore */ } finally { setRegenerating(false); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.admin.lessons.update(lesson.id, { ...form, points: form.points.filter((p) => p.trim()) });
      setEditing(false); onRefresh();
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await api.admin.lessons.delete(lesson.id); onRefresh(); }
    finally { setDeleting(false); setConfirmDel(false); }
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-3 p-3 bg-surface rounded-xl border border-border">
        <PlayCircle className="w-4 h-4 text-cta-from shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-charcoal">{lesson.order}. {lesson.title}</p>
          <p className="text-xs text-gray-400 mt-0.5">{formatCourseDuration(lesson.duration)}</p>
          {lesson.points?.filter((p: string) => p).length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">{lesson.points.filter((p: string) => p).length} puntos clave</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={handleRegenerate} disabled={regenerating} title="Regenerar con IA" className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors disabled:opacity-50">
            {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-charcoal hover:bg-white transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={() => setConfirmDel(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        <ConfirmDelete open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={handleDelete} loading={deleting} label="lección" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="p-4 bg-white rounded-xl border-2 border-cta-from space-y-4">
      <LessonFields form={form} setForm={setForm} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
        <Button type="submit" size="sm" loading={saving}>Guardar</Button>
      </div>
    </form>
  );
}

// ─── Module card ──────────────────────────────────────────────────────────────

function ModuleCard({ mod, courseId, onRefresh }: { mod: any; courseId: string; onRefresh: () => void }) {
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

  const handleRegenerateMod = async () => {
    setRegeneratingMod(true);
    try {
      const res = await api.admin.modules.regenerate(mod.id);
      if (res?.data?.jobId) setRegenJobId(res.data.jobId);
    } catch { /* ignore */ } finally { setRegeneratingMod(false); }
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
        <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
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
          </div>
        </button>
        <div className="flex gap-1 shrink-0">
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
              <Button size="sm" variant="secondary" leftIcon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => { setLessonForm(newLessonForm((mod.lessons?.length ?? 0) + 1)); setLessonModal(true); }}>
                Agregar lección
              </Button>
            </div>
            {(mod.lessons?.length ?? 0) === 0 && (
              <p className="text-xs text-gray-400 text-center py-4 bg-white rounded-xl border border-dashed border-border">
                Sin lecciones. Agrega la primera con el botón de arriba.
              </p>
            )}
            {mod.lessons?.map((lesson: any) => (
              <LessonRow key={lesson.id} lesson={lesson} onRefresh={onRefresh} />
            ))}
          </div>

          {/* Questions section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-charcoal flex items-center gap-1.5">
                <ClipboardCheck className="w-4 h-4 text-amber-500" />
                Preguntas del quiz ({mod.questions?.length ?? 0}) — Selección única
              </h4>
              <Button size="sm" variant="secondary" leftIcon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => { setQuestionForm(newQuestionForm((mod.questions?.length ?? 0) + 1)); setQuestionModal(true); }}>
                Agregar pregunta
              </Button>
            </div>
            {(mod.questions?.length ?? 0) === 0 && (
              <p className="text-xs text-gray-400 text-center py-4 bg-white rounded-xl border border-dashed border-border">
                Sin preguntas. Agrega la primera con el botón de arriba.
              </p>
            )}
            {mod.questions?.map((q: any) => (
              <QuestionRow key={q.id} question={q} onRefresh={onRefresh} />
            ))}
          </div>
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
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminCourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [moduleModal, setModuleModal] = useState(false);
  const [moduleForm, setModuleForm] = useState<ModuleForm>(EMPTY_MODULE);
  const [savingModule, setSavingModule] = useState(false);
  const [moduleError, setModuleError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.admin.courses.get(courseId);
      setCourse((res as any).data);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const handleAddModule = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingModule(true); setModuleError('');
    try {
      await api.admin.modules.create(courseId, moduleForm);
      setModuleModal(false); setModuleForm(EMPTY_MODULE); await load();
    } catch (err: any) {
      setModuleError(err.message ?? 'Error al crear módulo');
    } finally { setSavingModule(false); }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        {[1, 2, 3].map((n) => <div key={n} className="h-20 bg-gray-100 rounded-2xl" />)}
      </div>
    );
  }
  if (!course) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/admin/courses" className="p-2 rounded-lg hover:bg-surface mt-1">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="font-heading font-bold text-2xl text-charcoal truncate">{course.title}</h1>
            <Badge variant={course.isActive ? 'success' : 'default'}>{course.isActive ? 'Activo' : 'Inactivo'}</Badge>
            {course.isPilot && <Badge variant="info">Piloto</Badge>}
          </div>
          <p className="text-sm text-gray-500">{course.description}</p>
          <p className="text-xs text-gray-400 mt-1">{course.modules?.length ?? 0} módulos • {course.modules?.reduce((s: number, m: any) => s + (m.lessons?.length ?? 0), 0) ?? 0} lecciones • {course.modules?.reduce((s: number, m: any) => s + (m.questions?.length ?? 0), 0) ?? 0} preguntas totales</p>
        </div>
        <Button
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={() => { setModuleForm({ ...EMPTY_MODULE, order: (course.modules?.length ?? 0) + 1 }); setModuleModal(true); }}
        >
          Nuevo módulo
        </Button>
      </div>

      {/* Modules */}
      {(course.modules?.length ?? 0) === 0 ? (
        <div className="card text-center py-16">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">Sin módulos todavía</p>
          <p className="text-gray-500 text-sm mt-1">Agrega el primer módulo con el botón de arriba.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {course.modules?.map((mod: any) => (
            <ModuleCard key={mod.id} mod={mod} courseId={courseId} onRefresh={load} />
          ))}
        </div>
      )}

      {/* Add module modal */}
      <Modal open={moduleModal} onClose={() => setModuleModal(false)} title="Nuevo módulo" size="lg">
        <form onSubmit={handleAddModule} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Input label="Título" value={moduleForm.title} onChange={(e) => setModuleForm({ ...moduleForm, title: e.target.value })} placeholder="ej. Introducción a StaffPad" required />
            </div>
            <Input label="Duración" value={moduleForm.duration} onChange={(e) => setModuleForm({ ...moduleForm, duration: e.target.value })} placeholder="ej. 45 min" required />
            <Input label="Nota mínima (%)" type="number" value={moduleForm.passingScore} onChange={(e) => setModuleForm({ ...moduleForm, passingScore: Number(e.target.value) })} min={1} max={100} required />
            <Input label="Orden" type="number" value={moduleForm.order} onChange={(e) => setModuleForm({ ...moduleForm, order: Number(e.target.value) })} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Descripción</label>
            <textarea value={moduleForm.description} onChange={(e) => setModuleForm({ ...moduleForm, description: e.target.value })} className="input-field resize-y min-h-[80px]" placeholder="Descripción del módulo..." required />
          </div>
          {moduleError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{moduleError}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModuleModal(false)}>Cancelar</Button>
            <Button type="submit" loading={savingModule}>Crear módulo</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
