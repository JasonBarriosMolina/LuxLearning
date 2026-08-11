'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, ListTodo, Lock, Unlock, Calendar, RefreshCw, Info } from 'lucide-react';
import { api } from '@/lib/api';

interface PlanItem {
  type: string;
  title: string;
  description?: string;
  moduleId?: string;
}

interface ExistingPlan {
  generatedBy: 'auto' | 'evaluator' | 'student';
  createdAt: string;
  updatedAt: string;
  lockedByName?: string;
  mentorNote?: string;
  days?: Array<{ items: PlanItem[] }>;
}

interface Props {
  student: { userId: string; studentName?: string };
  onClose: () => void;
  onSuccess: () => void;
}

const GENERATED_BY_LABEL: Record<string, string> = {
  auto:      'Automático',
  evaluator: 'Por evaluador',
  student:   'Por estudiante',
};

export function StudyPlanModal({ student, onClose, onSuccess }: Props) {
  const [generating, setGenerating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [mentorNote, setMentorNote] = useState('');
  const [existingPlan, setExistingPlan] = useState<ExistingPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);

  // Load existing plan info on open
  useEffect(() => {
    (api.evaluator.studyPlan.get(student.userId, 1) as Promise<any>)
      .then((res: any) => {
        const plans: ExistingPlan[] = Array.isArray(res) ? res : (res?.data ?? []);
        if (plans.length > 0) setExistingPlan(plans[0]!);
      })
      .catch(() => {})
      .finally(() => setLoadingPlan(false));
  }, [student.userId]);

  const totalItems = existingPlan?.days?.reduce((s, d) => s + d.items.length, 0) ?? 0;
  const lastDate = existingPlan
    ? new Date(existingPlan.updatedAt).toLocaleDateString('es-ES', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  // Build a grouped path summary: { "Módulo X — Curso Y": ["Lección A", "Lección B"], ... }
  const pathGroups: Record<string, { type: string; title: string }[]> = {};
  if (existingPlan?.days) {
    for (const day of existingPlan.days) {
      for (const item of day.items) {
        const key = item.description ?? item.type;
        if (!pathGroups[key]) pathGroups[key] = [];
        pathGroups[key]!.push({ type: item.type, title: item.title });
      }
    }
  }
  const pathEntries = Object.entries(pathGroups).slice(0, 6); // max 6 groups

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      await api.evaluator.studyPlan.generate(student.userId, {
        ...(mentorNote.trim() ? { note: mentorNote.trim() } : {}),
      });
      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (e: any) {
      setError(e?.body?.error ?? 'Error al generar el plan');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#1A1A2E] rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListTodo className="w-5 h-5 text-purple-600" />
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Mentor's Learning Path
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Student name */}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Plan semanal para{' '}
          <strong className="text-gray-900 dark:text-white">{student.studentName ?? 'este estudiante'}</strong>.
          Se generará automáticamente desde su progreso. El estudiante solo puede ver el plan (no editarlo sin solicitar cambio).
        </p>

        {/* Existing plan info */}
        {loadingPlan ? (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando plan actual…
          </div>
        ) : existingPlan ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <RefreshCw className="w-3.5 h-3.5" />
              Plan existente — se reemplazará
            </div>
            <div className="grid grid-cols-3 gap-3 text-center pt-1">
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-200">{totalItems}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Actividades</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-200">
                  {GENERATED_BY_LABEL[existingPlan.generatedBy] ?? existingPlan.generatedBy}
                </p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Origen</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 leading-tight">{lastDate}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Actualizado</p>
              </div>
            </div>

            {/* Path preview — grouped by module/description */}
            {pathEntries.length > 0 && (
              <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-700/30 space-y-1">
                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                  Contenido del plan actual
                </p>
                {pathEntries.map(([group, items]) => (
                  <div key={group} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 dark:text-gray-300 truncate flex-1 pr-2">{group}</span>
                    <span className="text-gray-400 shrink-0">{items.length} act.</span>
                  </div>
                ))}
                {Object.keys(pathGroups).length > 6 && (
                  <p className="text-[10px] text-gray-400">…y {Object.keys(pathGroups).length - 6} grupos más</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 shrink-0" />
            Este estudiante aún no tiene un plan. Se creará uno nuevo.
          </div>
        )}

        {/* Lock notice */}
        <div className="flex items-center gap-2 text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          El estudiante recibirá notificación y podrá solicitar cambios si lo necesita.
        </div>

        {/* Mentor note */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
            Nota del mentor (opcional)
          </label>
          <textarea
            rows={3}
            value={mentorNote}
            onChange={(e) => setMentorNote(e.target.value)}
            maxLength={500}
            placeholder="Ej: Enfócate en los primeros 3 módulos, el examen es el viernes. Dedica 1h diaria para ponerte al día…"
            className="w-full border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 bg-white dark:bg-white/5 text-sm text-gray-900 dark:text-white outline-none resize-none focus:ring-2 focus:ring-purple-400/30 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
          <p className="text-[10px] text-gray-400 text-right mt-0.5">{mentorNote.length}/500</p>
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {success ? (
          <div className="flex items-center gap-2 text-green-600 font-medium text-sm">
            <Unlock className="w-4 h-4" /> Plan generado y enviado al estudiante
          </div>
        ) : (
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={generate}
              disabled={generating}
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#7B2FBE] to-[#00B4D8] text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
            >
              {generating && <Loader2 className="w-4 h-4 animate-spin" />}
              {existingPlan ? 'Regenerar plan' : 'Generar plan'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
