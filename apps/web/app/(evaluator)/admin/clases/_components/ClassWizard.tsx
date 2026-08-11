'use client';

import { useState, useRef } from 'react';
import { Sparkles, Loader2, Upload, X, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';

interface Module { id: string; title: string; order: number; }
interface Course { id: string; title: string; isActive: boolean; modules: Module[]; }

interface Props {
  courses: Course[];
  onCreated: () => void;
}

export function ClassWizard({ courses, onCreated }: Props) {
  const [courseId, setCourseId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [weight, setWeight] = useState('0');
  const [instructions, setInstructions] = useState('');
  const [vapiPrompt, setVapiPrompt] = useState('');
  const [vapiObjectives, setVapiObjectives] = useState<string[]>(['', '', '']);
  const [lessonVideoUrl, setLessonVideoUrl] = useState('');
  const [lessonScript, setLessonScript] = useState('');
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedCourse = courses.find((c) => c.id === courseId);
  const modules = selectedCourse?.modules ?? [];

  const handleGenerate = async () => {
    if (!name.trim()) { setError('Ingresa un nombre antes de generar'); return; }
    setGenerating(true);
    setError('');
    try {
      const courseTitle = selectedCourse?.title;
      const moduleTitle = modules.find((m) => m.id === moduleId)?.title;
      const res = await api.admin.classes.generate({ title: name, courseTitle, moduleTitle });
      const data = (res as any).data;
      if (data?.vapiPrompt) setVapiPrompt(data.vapiPrompt);
      if (Array.isArray(data?.vapiObjectives)) setVapiObjectives(data.vapiObjectives.slice(0, 3).concat(['', '', '']).slice(0, 3));
      if (data?.lessonScript) setLessonScript(data.lessonScript);
      setShowAdvanced(true);
    } catch {
      setError('Error al generar con IA. Intenta de nuevo.');
    } finally {
      setGenerating(false);
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const presignRes = await api.admin.classes.presignVideo({ fileName: file.name, fileType: file.type });
      const { uploadUrl, publicUrl } = (presignRes as any).data;
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      setLessonVideoUrl(publicUrl);
    } catch {
      setError('Error al subir el video. Intenta de nuevo.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!courseId) { setError('Selecciona un curso'); return; }
    if (!name.trim()) { setError('El nombre es requerido'); return; }
    setSaving(true);
    setError('');
    try {
      const objectivesJson = JSON.stringify(vapiObjectives.filter((o) => o.trim()));
      await api.admin.classes.create({
        courseId,
        moduleId: moduleId || undefined,
        name: name.trim(),
        dueDate: dueDate || undefined,
        weight: parseFloat(weight) || 0,
        instructions: instructions || undefined,
        vapiPrompt: vapiPrompt || undefined,
        vapiObjectives: objectivesJson,
        lessonVideoUrl: lessonVideoUrl || undefined,
        lessonScript: lessonScript || undefined,
      });
      onCreated();
    } catch {
      setError('Error al guardar. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Basic info */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Curso *</label>
          <select value={courseId} onChange={(e) => { setCourseId(e.target.value); setModuleId(''); }} className="input w-full">
            <option value="">Selecciona un curso</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Módulo (opcional)</label>
          <select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="input w-full" disabled={!courseId}>
            <option value="">Nivel de curso</option>
            {modules.map((m) => <option key={m.id} value={m.id}>{m.order}. {m.title}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre de la clase *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Clase 1 — Introducción al módulo" className="input w-full" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha límite</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input w-full" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Peso (%)</label>
          <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} min="0" max="100" className="input w-full" />
        </div>
      </div>

      {/* AI generate button */}
      <button
        onClick={handleGenerate}
        disabled={generating || !name.trim()}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm font-semibold hover:bg-indigo-100 transition-colors disabled:opacity-50"
      >
        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {generating ? 'Generando con IA…' : 'Generar contenido con IA'}
      </button>

      {/* Video content */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-2">Contenido Fase 1 — Video / URL</label>
        <div className="flex gap-2">
          <input
            value={lessonVideoUrl}
            onChange={(e) => setLessonVideoUrl(e.target.value)}
            placeholder="URL de YouTube o S3 (https://...)"
            className="input flex-1"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploading ? 'Subiendo…' : 'Subir'}
          </button>
          <input ref={fileRef} type="file" accept="video/*,audio/*" className="hidden" onChange={handleVideoUpload} />
        </div>
        {lessonVideoUrl && (
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-emerald-600 flex-1 truncate">✓ {lessonVideoUrl}</p>
            <button onClick={() => setLessonVideoUrl('')}><X className="w-3.5 h-3.5 text-gray-400" /></button>
          </div>
        )}
      </div>

      {/* Advanced section */}
      <button
        onClick={() => setShowAdvanced((p) => !p)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
      >
        {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showAdvanced ? 'Ocultar configuración avanzada' : 'Ver configuración de Mentor y guión'}
      </button>

      {showAdvanced && (
        <div className="space-y-3 border-t border-border pt-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Guión de lección (texto-a-voz)</label>
            <textarea
              value={lessonScript}
              onChange={(e) => setLessonScript(e.target.value)}
              rows={4}
              placeholder="Texto que Mentor leerá en voz alta si no hay video…"
              className="input w-full resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Prompt de Lux Mentor (Fase 2)</label>
            <textarea
              value={vapiPrompt}
              onChange={(e) => setVapiPrompt(e.target.value)}
              rows={4}
              placeholder="Instrucciones para Lux Mentor durante la conversación…"
              className="input w-full resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Objetivos de preguntas (3)</label>
            <div className="space-y-2">
              {vapiObjectives.map((obj, i) => (
                <input
                  key={i}
                  value={obj}
                  onChange={(e) => setVapiObjectives((prev) => prev.map((o, j) => j === i ? e.target.value : o))}
                  placeholder={`Objetivo ${i + 1}…`}
                  className="input w-full"
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Instrucciones para el estudiante</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              placeholder="Instrucciones visibles al estudiante antes de la clase…"
              className="input w-full resize-none"
            />
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-60">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'Guardando…' : 'Crear clase'}
        </button>
      </div>
    </div>
  );
}
