'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Pencil, Trash2, ChevronDown, ChevronRight,
  BookOpen, ClipboardCheck, PlayCircle, GripVertical, X, RefreshCw, Loader2, Volume2,
  ShieldCheck, CheckCircle2, AlertCircle, ExternalLink, Eye, GraduationCap, Sparkles,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
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
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenType, setRegenType] = useState<'text' | 'image' | 'infographic'>('text');
  const [regenLevel, setRegenLevel] = useState<'basic' | 'intermediate' | 'advanced'>('intermediate');
  const [regenStyle, setRegenStyle] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState('');
  const [regenPhase, setRegenPhase] = useState<'config' | 'preview'>('config');
  const [regenPreviewData, setRegenPreviewData] = useState<any>(null);
  const [lessonPreviewOpen, setLessonPreviewOpen] = useState(false);
  const [regenExtraContext, setRegenExtraContext] = useState('');
  const [audioOpen, setAudioOpen] = useState(false);
  const [audioVoice, setAudioVoice] = useState('Mia');
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState('');

  // Phase 1: generate preview without saving
  const handlePreview = async () => {
    setRegenLoading(true);
    setRegenError('');
    try {
      const res = await api.admin.lessons.regenerateFormat(lesson.id, {
        type: regenType,
        ...(regenType === 'text' ? { level: regenLevel } : {}),
        ...(regenStyle ? { style: regenStyle } : {}),
        ...(regenExtraContext.trim() ? { extraContext: regenExtraContext.trim() } : {}),
        preview: true,
      });
      setRegenPreviewData((res as any).data ?? res);
      setRegenPhase('preview');
    } catch (err: any) {
      setRegenError(err.message ?? 'Error al generar previsualización');
    } finally {
      setRegenLoading(false);
    }
  };

  // Phase 2: apply confirmed previewData
  const handleConfirmRegen = async (combineMode = false) => {
    setRegenLoading(true);
    setRegenError('');
    try {
      await api.admin.lessons.regenerateFormat(lesson.id, {
        type: regenType,
        previewData: regenPreviewData,
        combineMode,
      });
      setRegenOpen(false);
      setRegenPhase('config');
      setRegenPreviewData(null);
      onRefresh();
    } catch (err: any) {
      setRegenError(err.message ?? 'Error al guardar');
    } finally {
      setRegenLoading(false);
    }
  };

  const handleCloseRegen = () => {
    setRegenOpen(false);
    setRegenPhase('config');
    setRegenPreviewData(null);
    setRegenError('');
    setRegenExtraContext('');
  };

  const handleGenerateAudio = async () => {
    setAudioLoading(true);
    setAudioError('');
    try {
      await api.admin.lessons.generateAudio(lesson.id, audioVoice);
      setAudioOpen(false);
      onRefresh();
    } catch (err: any) {
      setAudioError(err.message ?? 'Error al generar audio');
    } finally {
      setAudioLoading(false);
    }
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
        <div className="flex gap-1 shrink-0 items-center">
          <button onClick={() => setLessonPreviewOpen(true)} title="Vista previa de la lección" className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-teal-50 transition-colors">
            <Eye className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setAudioOpen(true); setAudioError(''); }}
            title={lesson.audioUrl ? 'Regenerar audio Polly' : 'Generar audio Polly'}
            className="relative p-1.5 rounded-lg text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 transition-colors"
          >
            <Volume2 className="w-3.5 h-3.5" />
            {lesson.audioUrl && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-white" />
            )}
          </button>
          <button onClick={() => { setRegenOpen(true); setRegenPhase('config'); setRegenPreviewData(null); setRegenError(''); }} title="Regenerar con IA" className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-charcoal hover:bg-white transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={() => setConfirmDel(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        <ConfirmDelete open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={handleDelete} loading={deleting} label="lección" />

        {/* Lesson preview modal */}
        <Modal open={lessonPreviewOpen} onClose={() => setLessonPreviewOpen(false)} title={`Vista previa — ${lesson.title}`} size="xl">
          <div className="space-y-5 overflow-y-auto max-h-[70vh] pr-1">
            {lesson.youtubeId && (
              <div className="aspect-video rounded-xl overflow-hidden bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${lesson.youtubeId}`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}
            {lesson.content && (
              <div
                className="prose prose-sm max-w-none text-charcoal"
                dangerouslySetInnerHTML={{ __html: lesson.content }}
              />
            )}
            {lesson.points?.filter((p: string) => p).length > 0 && (
              <div className="bg-blue-50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Puntos clave</p>
                <ul className="space-y-1.5">
                  {lesson.points.filter((p: string) => p).map((p: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-charcoal">
                      <span className="w-5 h-5 rounded-full bg-blue-200 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {lesson.tip && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Consejo</p>
                <p className="text-sm text-amber-800">{lesson.tip}</p>
              </div>
            )}
            {!lesson.youtubeId && !lesson.content && !lesson.tip && lesson.points?.filter((p: string) => p).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">Esta lección aún no tiene contenido.</p>
            )}
          </div>
        </Modal>

        {/* Audio Modal */}
        <Modal open={audioOpen} onClose={() => setAudioOpen(false)} title={`Audio Polly — ${lesson.title}`} size="sm">
          <div className="space-y-4">
            {lesson.audioUrl && (
              <div className="flex items-center gap-2 p-2.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                <p className="text-xs text-emerald-700 dark:text-emerald-400 flex-1">Audio generado. Generar de nuevo reemplazará el existente.</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Voz</p>
              <div className="grid grid-cols-1 gap-1.5">
                {[
                  { id: 'Mia',    label: 'Mia ♀',    desc: 'Mexicana (es-MX)' },
                  { id: 'Lupe',   label: 'Lupe ♀',   desc: 'Latina US (es-US)' },
                  { id: 'Lucia',  label: 'Lucia ♀',  desc: 'Española (es-ES)' },
                  { id: 'Sergio', label: 'Sergio ♂', desc: 'Español (es-ES)' },
                  { id: 'Pedro',  label: 'Pedro ♂',  desc: 'Latino US (es-US)' },
                ].map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setAudioVoice(v.id)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      audioVoice === v.id
                        ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                        : 'border-border text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span>{v.label}</span>
                    <span className="text-gray-400 font-normal">{v.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            {audioError && <p className="text-xs text-red-500">{audioError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setAudioOpen(false)}>Cancelar</Button>
              <Button size="sm" loading={audioLoading} onClick={handleGenerateAudio}>
                {lesson.audioUrl ? 'Regenerar' : 'Generar'}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Regenerate Modal */}
        <Modal open={regenOpen} onClose={handleCloseRegen} title={`Regenerar — ${lesson.title}`} size="sm">
          <div className="space-y-4">
            {regenPhase === 'config' ? (
              <>
                {/* Type tabs */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Tipo</p>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    {(['text', 'image', 'infographic'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => { setRegenType(t); setRegenStyle(''); }}
                        className={`flex-1 py-1.5 text-xs font-medium transition-colors ${regenType === t ? 'bg-indigo-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                      >
                        {t === 'text' ? '📝 Texto' : t === 'image' ? '🖼 Imagen' : '📊 Infografía'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Level (text only) */}
                {regenType === 'text' && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Nivel</p>
                    <div className="flex rounded-lg border border-border overflow-hidden">
                      {([['basic', 'Básico'], ['intermediate', 'Intermedio'], ['advanced', 'Avanzado']] as const).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setRegenLevel(val)}
                          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${regenLevel === val ? 'bg-indigo-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">
                      {regenLevel === 'basic' ? 'Vocabulario simple, ejemplos cotidianos, sin tecnicismos.' :
                       regenLevel === 'advanced' ? 'Profundidad técnica, terminología especializada.' :
                       'Lenguaje claro, ejemplos prácticos, estructura definida.'}
                    </p>
                  </div>
                )}

                {/* Style (image/infographic) */}
                {(regenType === 'image' || regenType === 'infographic') && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Estilo</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(regenType === 'image'
                        ? [['realistic', '📷 Realista'], ['illustration', '🎨 Ilustración'], ['diagram', '📐 Diagrama'], ['comic', '💥 Cómic']]
                        : [['minimal', '⬜ Minimal'], ['colorful', '🌈 Colorida'], ['corporate', '🏢 Corporativa']]
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setRegenStyle(regenStyle === val ? '' : val)}
                          className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors ${regenStyle === val ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-border text-gray-500 hover:bg-gray-50'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">Opcional — deja vacío para estilo automático.</p>
                  </div>
                )}

                {/* Extra context for instructor (text only) */}
                {regenType === 'text' && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Contexto adicional <span className="font-normal text-gray-400">(opcional)</span>
                    </label>
                    <textarea
                      value={regenExtraContext}
                      onChange={(e) => setRegenExtraContext(e.target.value.slice(0, 500))}
                      placeholder="Ej. Enfócate en ejemplos prácticos para pequeñas empresas…"
                      className="input-field text-xs min-h-[60px] resize-none w-full"
                      maxLength={500}
                    />
                    <p className="text-xs text-gray-400 text-right">{regenExtraContext.length}/500</p>
                  </div>
                )}

                {regenError && <p className="text-xs text-red-500">{regenError}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="secondary" size="sm" onClick={handleCloseRegen}>Cancelar</Button>
                  <Button size="sm" loading={regenLoading} onClick={handlePreview}>
                    Previsualizar
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Preview phase — two-column comparison for text */}
                {regenType === 'text' && regenPreviewData ? (
                  <div className="grid grid-cols-2 gap-3">
                    {/* Left: current (gray) */}
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Actual</p>
                      {lesson.title && <p className="text-xs"><span className="font-semibold text-gray-500">Título:</span> {lesson.title}</p>}
                      {lesson.points?.filter((p: string) => p).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500">Puntos:</p>
                          <ul className="text-xs text-gray-600 pl-3 space-y-0.5">
                            {lesson.points.filter((p: string) => p).map((p: string, i: number) => (
                              <li key={i} className="list-disc">{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {lesson.tip && <p className="text-xs"><span className="font-semibold text-gray-500">Consejo:</span> {lesson.tip}</p>}
                    </div>
                    {/* Right: generated (blue) */}
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-1.5">
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Generado</p>
                      {regenPreviewData.title && <p className="text-xs"><span className="font-semibold text-gray-500">Título:</span> {regenPreviewData.title}</p>}
                      {Array.isArray(regenPreviewData.points) && regenPreviewData.points.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500">Puntos:</p>
                          <ul className="text-xs text-gray-700 pl-3 space-y-0.5">
                            {regenPreviewData.points.map((p: string, i: number) => (
                              <li key={i} className="list-disc">{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {regenPreviewData.tip && <p className="text-xs"><span className="font-semibold text-gray-500">Consejo:</span> {regenPreviewData.tip}</p>}
                    </div>
                  </div>
                ) : (regenType === 'image' || regenType === 'infographic') && regenPreviewData?.imageUrl ? (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-indigo-600 uppercase">Vista previa del contenido generado</p>
                    <img src={regenPreviewData.imageUrl} alt="Vista previa" className="w-full rounded-lg object-cover max-h-48" />
                  </div>
                ) : null}

                {regenError && <p className="text-xs text-red-500">{regenError}</p>}

                <div className="space-y-2 pt-1">
                  {regenType === 'text' ? (
                    <>
                      <Button size="sm" className="w-full" loading={regenLoading} onClick={() => handleConfirmRegen(false)}>
                        Sí, reemplaza todo
                      </Button>
                      <Button size="sm" variant="secondary" className="w-full" loading={regenLoading} onClick={() => handleConfirmRegen(true)}>
                        Combina los materiales nuevos con los existentes
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" className="w-full" loading={regenLoading} onClick={() => handleConfirmRegen(false)}>
                      Usar esta imagen
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="w-full" onClick={() => { setRegenPhase('config'); setRegenPreviewData(null); setRegenError(''); }}>
                    No, generar otra opción
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
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
  const [regenModError, setRegenModError] = useState<string | null>(null);
  const regenJobIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [modPreviewOpen, setModPreviewOpen] = useState(false);
  const [aiLessonOpen, setAiLessonOpen] = useState(false);
  const [aiLessonTopic, setAiLessonTopic] = useState('');
  const [aiLessonLoading, setAiLessonLoading] = useState(false);
  const [aiLessonError, setAiLessonError] = useState('');

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => { if (regenJobIntervalRef.current) clearInterval(regenJobIntervalRef.current); };
  }, []);

  const handleAiLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiLessonTopic.trim()) return;
    setAiLessonLoading(true); setAiLessonError('');
    try {
      await api.admin.lessons.aiGenerate(mod.id, { topic: aiLessonTopic.trim() });
      setAiLessonOpen(false); setAiLessonTopic(''); onRefresh();
    } catch (err: any) {
      setAiLessonError(err.message ?? 'Error al generar lección');
    } finally { setAiLessonLoading(false); }
  };

  const handleRegenerateMod = async () => {
    setRegeneratingMod(true);
    setRegenModError(null);
    try {
      const res = await api.admin.modules.regenerate(mod.id);
      const jobId = res?.data?.jobId;
      if (!jobId) return;
      setRegenJobId(jobId);
      // Poll every 3 s, give up after 90 s
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
            setRegenModError('Error al regenerar el módulo. Intenta de nuevo.');
          } else if (elapsed >= 90) {
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminCourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [moduleModal, setModuleModal] = useState(false);
  const [moduleForm, setModuleForm] = useState<ModuleForm>(EMPTY_MODULE);
  const [savingModule, setSavingModule] = useState(false);
  const [moduleError, setModuleError] = useState('');

  // ── AI module generation ─────────────────────────────────────────────────────
  const [aiModuleOpen, setAiModuleOpen] = useState(false);
  const [aiModuleTopic, setAiModuleTopic] = useState('');
  const [aiModuleLoading, setAiModuleLoading] = useState(false);
  const [aiModuleError, setAiModuleError] = useState('');
  const aiModuleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleAiModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiModuleTopic.trim()) return;
    setAiModuleLoading(true); setAiModuleError('');
    try {
      const res = await api.admin.modules.aiGenerate(courseId, { topic: aiModuleTopic.trim() });
      const jobId = (res as any)?.data?.jobId ?? (res as any)?.jobId;
      if (!jobId) { setAiModuleOpen(false); setAiModuleTopic(''); await load(); return; }
      // Poll every 3 s, give up after 120 s
      let elapsed = 0;
      aiModuleIntervalRef.current = setInterval(async () => {
        elapsed += 3;
        try {
          const poll = await api.admin.courses.aiJob(jobId);
          const status = (poll as any)?.data?.status ?? (poll as any)?.status;
          if (status === 'done') {
            clearInterval(aiModuleIntervalRef.current!); aiModuleIntervalRef.current = null;
            setAiModuleLoading(false); setAiModuleOpen(false); setAiModuleTopic(''); await load();
          } else if (status === 'error') {
            clearInterval(aiModuleIntervalRef.current!); aiModuleIntervalRef.current = null;
            setAiModuleLoading(false);
            setAiModuleError('Error al generar módulo. Intenta de nuevo.');
          } else if (elapsed >= 120) {
            clearInterval(aiModuleIntervalRef.current!); aiModuleIntervalRef.current = null;
            setAiModuleLoading(false);
            setAiModuleError('Tiempo de espera agotado. Recarga la página para ver si el módulo fue creado.');
          }
        } catch { /* network hiccup — keep polling */ }
      }, 3000);
    } catch (err: any) {
      setAiModuleError(err.message ?? 'Error al generar módulo');
      setAiModuleLoading(false);
    }
  };

  // ── Validate videos ──────────────────────────────────────────────────────────
  const [validateOpen, setValidateOpen] = useState(false);
  const [validateLoading, setValidateLoading] = useState(false);
  const [validateResult, setValidateResult] = useState<{ videos: any[]; broken: number; total: number } | null>(null);

  const handleValidateVideos = async (force = false) => {
    setValidateOpen(true);
    if (validateResult && !force) return; // use cache unless forced
    setValidateLoading(true);
    setValidateResult(null);
    try {
      const res = await api.admin.courses.validateVideos(courseId);
      setValidateResult((res as any).data);
    } catch {
      setValidateResult({ videos: [], broken: 0, total: 0 });
    } finally {
      setValidateLoading(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await api.admin.courses.get(courseId);
      setCourse((res as any).data);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { return () => { if (aiModuleIntervalRef.current) clearInterval(aiModuleIntervalRef.current); }; }, []);

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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
            variant="secondary"
            leftIcon={<GraduationCap className="w-4 h-4" />}
            onClick={() => router.push(`/admin/courses/${courseId}/preview`)}
          >
            Ver como Estudiante
          </Button>
          <Button
            variant="secondary"
            leftIcon={<ShieldCheck className="w-4 h-4" />}
            onClick={handleValidateVideos}
          >
            Validar videos
          </Button>
          <Button
            variant="secondary"
            leftIcon={<Sparkles className="w-4 h-4 text-purple-500" />}
            onClick={() => { setAiModuleTopic(''); setAiModuleError(''); setAiModuleOpen(true); }}
          >
            Módulo con IA
          </Button>
          <Button
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => { setModuleForm({ ...EMPTY_MODULE, order: (course.modules?.length ?? 0) + 1 }); setModuleModal(true); }}
          >
            Nuevo módulo
          </Button>
        </div>
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

      {/* Validate videos modal */}
      <Modal open={validateOpen} onClose={() => setValidateOpen(false)} title="Validar videos del curso" size="md">
        {validateLoading ? (
          <div className="flex flex-col items-center py-10 gap-3 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-sm">Verificando enlaces de YouTube…</span>
          </div>
        ) : validateResult ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
              <span>{validateResult.total} videos •</span>
              {validateResult.broken === 0
                ? <span className="text-green-600 font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Todos disponibles</span>
                : <span className="text-red-600 font-semibold flex items-center gap-1"><AlertCircle className="w-4 h-4" /> {validateResult.broken} roto{validateResult.broken !== 1 ? 's' : ''}</span>
              }
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {validateResult.videos.map((v: any) => (
                <div key={v.lessonId} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${v.ok ? 'bg-green-50 dark:bg-green-900/10' : 'bg-red-50 dark:bg-red-900/10'}`}>
                  {v.ok
                    ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                    : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  }
                  <span className={`flex-1 truncate ${v.ok ? 'text-gray-700 dark:text-gray-200' : 'text-red-700 dark:text-red-300 font-medium'}`}>{v.title}</span>
                  <a href={`https://www.youtube.com/watch?v=${v.youtubeId}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:text-cta-from flex items-center gap-0.5 shrink-0">
                    {v.youtubeId} <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
              {validateResult.total === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Este curso no tiene lecciones con youtubeId.</p>
              )}
            </div>
            <div className="flex justify-end pt-2 gap-2">
              <Button variant="secondary" size="sm" onClick={() => handleValidateVideos(true)}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Verificar de nuevo
              </Button>
              <Button size="sm" onClick={() => setValidateOpen(false)}>Cerrar</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* AI module generation modal */}
      <Modal open={aiModuleOpen} onClose={() => setAiModuleOpen(false)} title="Crear módulo con IA" size="sm">
        <form onSubmit={handleAiModule} className="space-y-4">
          <p className="text-sm text-gray-500">La IA generará un módulo completo (10 lecciones + 10 preguntas de quiz) sobre el tema que indiques.</p>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Tema del módulo</label>
            <input
              autoFocus
              value={aiModuleTopic}
              onChange={(e) => setAiModuleTopic(e.target.value)}
              placeholder="ej. Estrategias de comunicación efectiva"
              className="input-field text-sm w-full"
              required
            />
          </div>
          {aiModuleError && <p className="text-xs text-red-500">{aiModuleError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => setAiModuleOpen(false)}>Cancelar</Button>
            <Button type="submit" size="sm" loading={aiModuleLoading} leftIcon={<Sparkles className="w-3.5 h-3.5" />}>
              Generar módulo
            </Button>
          </div>
        </form>
      </Modal>

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
