'use client';

import { useState, useRef } from 'react';
import { X, Sparkles, Loader2, ChevronRight, ChevronLeft, Upload, BookOpen, GraduationCap, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface Module { id: string; title: string; order: number; }
interface Course { id: string; title: string; isActive: boolean; modules: Module[]; }
interface ClassDef {
  id: string; courseId: string; moduleId: string | null; name: string;
  dueDate: string | null; weight: number; vapiPrompt: string | null;
  vapiObjectives: string | null; lessonVideoUrl: string | null; lessonScript: string | null;
  instructions?: string | null; targetStudentIds: string[];
  isDraft?: boolean; isArchived?: boolean; moduleTitle?: string | null;
}

interface Props {
  courses: Course[];
  onCreated: () => void;
  editingClass?: ClassDef | null;
  onClose: () => void;
}

export function ClassWizard({ courses, onCreated, editingClass, onClose }: Props) {
  const isEdit = !!editingClass;
  const [step, setStep] = useState(1);

  // Step 1
  const [courseId, setCourseId] = useState(editingClass?.courseId ?? '');
  const [moduleId, setModuleId] = useState(editingClass?.moduleId ?? '');
  const [name, setName] = useState(editingClass?.name ?? '');
  const [dueDate, setDueDate] = useState(editingClass?.dueDate ? editingClass.dueDate.slice(0, 10) : '');
  const [weight, setWeight] = useState(String(editingClass?.weight ?? 10));

  // Step 2
  const [contentMode, setContentMode] = useState<'ai' | 'manual'>('ai');
  const [generating, setGenerating] = useState(false);
  const [lessonScript, setLessonScript] = useState(editingClass?.lessonScript ?? '');
  const [vapiPrompt, setVapiPrompt] = useState(editingClass?.vapiPrompt ?? '');
  const [vapiObjectives, setVapiObjectives] = useState<string[]>(() => {
    try { return [...JSON.parse(editingClass?.vapiObjectives ?? '[]'), '', '', ''].slice(0, 3); }
    catch { return ['', '', '']; }
  });
  const [lessonVideoUrl, setLessonVideoUrl] = useState(editingClass?.lessonVideoUrl ?? '');
  const [instructions, setInstructions] = useState(editingClass?.instructions ?? '');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedCourse = courses.find((c) => c.id === courseId);
  const modules = selectedCourse?.modules ?? [];
  const step1Valid = name.trim() && courseId;

  const handleGenerate = async () => {
    if (!name || !courseId) return;
    setGenerating(true);
    setError('');
    try {
      const course = courses.find((c) => c.id === courseId);
      const mod = modules.find((m) => m.id === moduleId);
      const res = await api.admin.classes.generate({
        title: name,
        courseTitle: course?.title ?? '',
        moduleTitle: mod?.title ?? '',
      });
      const d = (res as any).data ?? res;
      if (d.lessonScript) setLessonScript(d.lessonScript);
      if (d.vapiPrompt) setVapiPrompt(d.vapiPrompt);
      if (Array.isArray(d.vapiObjectives)) setVapiObjectives([...d.vapiObjectives, '', '', ''].slice(0, 3));
    } catch {
      setError('Error generando contenido con IA. Intenta de nuevo.');
    } finally {
      setGenerating(false);
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.admin.files.uploadVideo(file);
      setLessonVideoUrl((res as any).data?.url ?? (res as any).url ?? '');
    } catch {
      setError('Error subiendo video.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name || !courseId) { setError('Nombre y curso son obligatorios.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: any = {
        courseId,
        moduleId: moduleId || null,
        name,
        dueDate: dueDate || null,
        weight: Number(weight) || 10,
        vapiPrompt: vapiPrompt || null,
        vapiObjectives: JSON.stringify(vapiObjectives.filter(Boolean)),
        lessonScript: lessonScript || null,
        lessonVideoUrl: lessonVideoUrl || null,
        instructions: instructions || null,
      };
      if (isEdit) await api.admin.classes.update(editingClass!.id, payload);
      else await api.admin.classes.create(payload);
      onCreated();
    } catch {
      setError('Error guardando clase. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900 text-base">{isEdit ? 'Editar clase' : 'Nueva clase'}</h2>
              <p className="text-xs text-gray-400">Paso {step} de 3</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress */}
        <div className="px-6 py-3 shrink-0">
          <div className="flex gap-1.5">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${s <= step ? 'bg-indigo-500' : 'bg-gray-100'}`} />
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            {['Información', 'Contenido', 'Confirmar'].map((label, i) => (
              <span key={i} className={`text-xs transition-colors ${i + 1 === step ? 'text-indigo-600 font-semibold' : 'text-gray-400'}`}>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Step 1 — Información */}
          {step === 1 && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Curso *</label>
                <select value={courseId} onChange={(e) => { setCourseId(e.target.value); setModuleId(''); }} className="input w-full">
                  <option value="">Selecciona un curso</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              {modules.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Módulo (opcional)</label>
                  <select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="input w-full">
                    <option value="">Nivel de curso</option>
                    {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nombre de la clase *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Introducción al subjuntivo" className="input w-full" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Fecha límite</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input w-full" />
                </div>
                <div className="w-28">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Peso (%)</label>
                  <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} min="0" max="100" className="input w-full" />
                </div>
              </div>
            </>
          )}

          {/* Step 2 — Contenido */}
          {step === 2 && (
            <>
              <div className="flex gap-3">
                <button
                  onClick={() => setContentMode('ai')}
                  className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${contentMode === 'ai' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <span className={`text-sm font-semibold ${contentMode === 'ai' ? 'text-indigo-700' : 'text-gray-600'}`}>Lux Mentor IA</span>
                  <span className="text-xs text-gray-400 text-center">Genera guión y prompt automáticamente</span>
                </button>
                <button
                  onClick={() => setContentMode('manual')}
                  className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${contentMode === 'manual' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
                    <GraduationCap className="w-5 h-5 text-gray-600" />
                  </div>
                  <span className={`text-sm font-semibold ${contentMode === 'manual' ? 'text-indigo-700' : 'text-gray-600'}`}>Manual</span>
                  <span className="text-xs text-gray-400 text-center">Escribe tú el contenido</span>
                </button>
              </div>

              {contentMode === 'ai' && (
                <button
                  onClick={handleGenerate}
                  disabled={generating || !name}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition-all"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {generating ? 'Generando con Lux Mentor…' : 'Generar contenido con IA'}
                </button>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Guión de lección (texto-a-voz)</label>
                  <textarea value={lessonScript} onChange={(e) => setLessonScript(e.target.value)} rows={4} placeholder="Texto que Mentor leerá en voz alta…" className="input w-full resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Prompt de Lux Mentor (Fase 2)</label>
                  <textarea value={vapiPrompt} onChange={(e) => setVapiPrompt(e.target.value)} rows={3} placeholder="Instrucciones para Mentor durante la conversación…" className="input w-full resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Objetivos de evaluación (hasta 3)</label>
                  <div className="space-y-2">
                    {vapiObjectives.map((obj, i) => (
                      <input key={i} value={obj} onChange={(e) => setVapiObjectives((prev) => prev.map((o, j) => j === i ? e.target.value : o))} placeholder={`Objetivo ${i + 1}…`} className="input w-full" />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Instrucciones para el estudiante</label>
                  <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} placeholder="Instrucciones visibles al estudiante antes de la clase…" className="input w-full resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Video / URL (opcional)</label>
                  <div className="flex gap-2">
                    <input value={lessonVideoUrl} onChange={(e) => setLessonVideoUrl(e.target.value)} placeholder="URL de YouTube o S3…" className="input flex-1" />
                    <button onClick={() => fileRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
                      {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {uploading ? 'Subiendo…' : 'Subir'}
                    </button>
                    <input ref={fileRef} type="file" accept="video/*,audio/*" className="hidden" onChange={handleVideoUpload} />
                  </div>
                  {lessonVideoUrl && (
                    <p className="text-xs text-emerald-600 mt-1 truncate">✓ {lessonVideoUrl}</p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Step 3 — Confirmar */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-5 space-y-3 border border-indigo-100">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="w-5 h-5 text-indigo-500" />
                  <span className="font-bold text-gray-900">Resumen</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Curso</span>
                    <span className="font-medium text-gray-800 text-right max-w-[60%]">{selectedCourse?.title ?? '—'}</span>
                  </div>
                  {moduleId && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Módulo</span>
                      <span className="font-medium text-gray-800">{modules.find((m) => m.id === moduleId)?.title}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Nombre</span>
                    <span className="font-medium text-gray-800 text-right max-w-[60%]">{name}</span>
                  </div>
                  {dueDate && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Fecha límite</span>
                      <span className="font-medium text-gray-800">{new Date(dueDate + 'T12:00:00').toLocaleDateString('es-MX')}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Peso</span>
                    <span className="font-medium text-gray-800">{weight}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Contenido</span>
                    <span className="font-medium text-gray-800 text-right">
                      {vapiPrompt ? '✓ Prompt' : 'Sin prompt'} · {lessonScript ? '✓ Guión' : 'Sin guión'}
                    </span>
                  </div>
                  {lessonVideoUrl && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Video</span>
                      <span className="font-medium text-emerald-600">✓ Cargado</span>
                    </div>
                  )}
                </div>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
          )}

          {error && step !== 3 && <p className="text-xs text-red-500">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
          <button
            onClick={step === 1 ? onClose : () => setStep((s) => (s - 1) as 1 | 2 | 3)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {step === 1 ? 'Cancelar' : <><ChevronLeft className="w-4 h-4" /> Atrás</>}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              disabled={step === 1 && !step1Valid}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-all"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear clase'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
