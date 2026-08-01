'use client';

import { useState, useCallback } from 'react';
import { Mic, Sparkles, Loader2, ChevronDown, X, Users, Calendar, BarChart2, BookOpen, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Module { id: string; title: string; order: number; }
interface Course { id: string; title: string; isActive: boolean; modules: Module[]; }

interface FormState {
  courseId: string;
  moduleId: string;
  name: string;
  topic: string;
  dueDate: string;
  weight: string;
  instructions: string;
  vapiPrompt: string;
  vapiObjectives: string;
  targetAll: boolean;
  targetStudentIds: string;
}

const BLANK: FormState = {
  courseId: '', moduleId: '', name: '', topic: '', dueDate: '',
  weight: '0', instructions: '', vapiPrompt: '', vapiObjectives: '',
  targetAll: true, targetStudentIds: '',
};

interface Props {
  courses: Course[];
  onCreated: () => void;
}

export function InterviewWizard({ courses, onCreated }: Props) {
  const [form, setForm] = useState<FormState>(BLANK);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [aiSection, setAiSection] = useState(true);

  const set = (k: keyof FormState, v: string | boolean) =>
    setForm((p) => ({ ...p, [k]: v }));

  const selectedCourse = courses.find((c) => c.id === form.courseId);
  const selectedModule = selectedCourse?.modules.find((m) => m.id === form.moduleId);

  const handleGenerate = useCallback(async () => {
    if (!form.name && !form.topic) {
      setError('Ingresa un nombre o tema para generar la configuración IA');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const res = await api.admin.interviews.generate({
        title: form.name || undefined,
        topic: form.topic || undefined,
        courseTitle: selectedCourse?.title,
        moduleTitle: selectedModule?.title,
        language: 'ES',
      });
      const data = (res as any).data ?? res;
      set('vapiPrompt', data.vapiPrompt ?? '');
      set('vapiObjectives', Array.isArray(data.vapiObjectives)
        ? data.vapiObjectives.join('\n')
        : String(data.vapiObjectives ?? ''));
    } catch (e: any) {
      setError(e?.message ?? 'Error al generar con IA');
    } finally {
      setGenerating(false);
    }
  }, [form.name, form.topic, selectedCourse, selectedModule]);

  const handleSave = async () => {
    if (!form.courseId) { setError('Selecciona un curso'); return; }
    if (!form.name.trim()) { setError('El nombre es requerido'); return; }
    setSaving(true);
    setError('');
    try {
      const studentIds = form.targetAll
        ? []
        : form.targetStudentIds.split('\n').map((s) => s.trim()).filter(Boolean);

      await api.admin.interviews.create({
        courseId: form.courseId,
        moduleId: form.moduleId || undefined,
        name: form.name.trim(),
        dueDate: form.dueDate || undefined,
        weight: parseFloat(form.weight) || 0,
        instructions: form.instructions || undefined,
        vapiPrompt: form.vapiPrompt || undefined,
        vapiObjectives: form.vapiPrompt ? form.vapiObjectives || undefined : undefined,
        targetStudentIds: studentIds,
      });
      setForm(BLANK);
      onCreated();
    } catch (e: any) {
      setError(e?.message ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Course + Module */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Curso *</label>
          <div className="relative">
            <select
              value={form.courseId}
              onChange={(e) => { set('courseId', e.target.value); set('moduleId', ''); }}
              className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">— Selecciona un curso —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}{!c.isActive ? ' (borrador)' : ''}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Módulo (opcional)</label>
          <div className="relative">
            <select
              value={form.moduleId}
              onChange={(e) => set('moduleId', e.target.value)}
              disabled={!form.courseId}
              className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-40"
            >
              <option value="">— Nivel de curso —</option>
              {(selectedCourse?.modules ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.order}. {m.title}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Name + Topic */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Nombre de la entrevista *</label>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="ej. Entrevista Final — Módulo 3"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Tema (para generar con IA)</label>
          <input
            value={form.topic}
            onChange={(e) => set('topic', e.target.value)}
            placeholder="ej. Fundamentos de Python y estructuras de datos"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </div>

      {/* Due date + Weight */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> Fecha límite
          </label>
          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => set('dueDate', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
            <BarChart2 className="w-3.5 h-3.5" /> Peso en nota (%)
          </label>
          <input
            type="number" min={0} max={100} step={5}
            value={form.weight}
            onChange={(e) => set('weight', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </div>

      {/* Target students */}
      <div className="border border-gray-100 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-500" />
          <span className="text-xs font-semibold text-gray-600">Asignación de estudiantes</span>
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="radio" checked={form.targetAll} onChange={() => set('targetAll', true)} />
            Todo el curso
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="radio" checked={!form.targetAll} onChange={() => set('targetAll', false)} />
            Estudiantes específicos
          </label>
        </div>
        {!form.targetAll && (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Usernames de Cognito (uno por línea)</label>
            <textarea
              rows={3}
              value={form.targetStudentIds}
              onChange={(e) => set('targetStudentIds', e.target.value)}
              placeholder={'estudiante1\nestudiante2\nestudiante3'}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        )}
      </div>

      {/* AI Configuration */}
      <div className="border border-rose-100 rounded-xl overflow-hidden">
        <button
          onClick={() => setAiSection((p) => !p)}
          className="w-full flex items-center gap-2 px-4 py-3 bg-rose-50 text-left"
        >
          <Mic className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="text-sm font-semibold text-rose-700">Configuración IA (Vapi)</span>
          <ChevronDown className={`w-4 h-4 text-rose-400 ml-auto transition-transform ${aiSection ? 'rotate-180' : ''}`} />
        </button>

        {aiSection && (
          <div className="p-4 space-y-4">
            <button
              onClick={handleGenerate}
              disabled={generating || (!form.name && !form.topic)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition"
            >
              {generating
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Wand2 className="w-4 h-4" />}
              {generating ? 'Generando…' : 'Generar con IA'}
            </button>
            {!form.name && !form.topic && (
              <p className="text-xs text-gray-400">Ingresa nombre o tema arriba para activar la generación IA.</p>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5" /> Instrucciones del entrevistador IA
              </label>
              <textarea
                rows={5}
                value={form.vapiPrompt}
                onChange={(e) => set('vapiPrompt', e.target.value)}
                placeholder="Eres un evaluador oral de una institución educativa. Evalúa al estudiante con exactamente 3 preguntas sobre el tema del módulo…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs resize-y focus:outline-none focus:ring-2 focus:ring-rose-200"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">
                Objetivos de las 3 preguntas (uno por línea)
              </label>
              <textarea
                rows={3}
                value={form.vapiObjectives}
                onChange={(e) => set('vapiObjectives', e.target.value)}
                placeholder={'Comprensión conceptual del tema\nAplicación práctica a un caso real\nAnálisis crítico y reflexión'}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs resize-y focus:outline-none focus:ring-2 focus:ring-rose-200"
              />
              <p className="text-[10px] text-gray-400 mt-1">La IA generará exactamente 3 preguntas basadas en estos objetivos.</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Instrucciones adicionales (opcional)</label>
              <textarea
                rows={2}
                value={form.instructions}
                onChange={(e) => set('instructions', e.target.value)}
                placeholder="Indicaciones visibles para el estudiante antes de iniciar…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs resize-y focus:outline-none focus:ring-2 focus:ring-rose-200"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl">
          <X className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !form.courseId || !form.name.trim()}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 transition"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
        {saving ? 'Guardando…' : 'Crear entrevista'}
      </button>
    </div>
  );
}
