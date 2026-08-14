'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, ListTodo, Lock, Unlock, RefreshCw, Info, ChevronRight, ChevronLeft } from 'lucide-react';
import { api } from '@/lib/api';

interface WizardParams {
  hoursPerDay: 1 | 2 | 3;
  modulePriority: 'sequential' | 'parallel';
  pace: 'normal' | 'catchup';
}

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

// ── Wizard step component ─────────────────────────────────────────────────────
function WizardStep({
  step, label, options, value, onChange,
}: {
  step: number;
  label: string;
  options: { value: string; label: string; hint: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        Paso {step} de 3 · {label}
      </p>
      <div className="grid gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
              value === opt.value
                ? 'border-purple-400 bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200'
                : 'border-gray-200 dark:border-white/10 hover:border-purple-200 dark:hover:border-purple-700/40 text-gray-700 dark:text-gray-300'
            }`}
          >
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{opt.hint}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export function StudyPlanModal({ student, onClose, onSuccess }: Props) {
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2 | 3>(0); // 0-2 = wizard, 3 = confirm
  const [wizardParams, setWizardParams] = useState<WizardParams>({
    hoursPerDay: 2,
    modulePriority: 'sequential',
    pace: 'normal',
  });
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
        wizardParams,
      });
      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (e: any) {
      setError(e?.body?.error ?? 'Error al generar el plan');
    } finally {
      setGenerating(false);
    }
  };

  // ── Wizard steps 0-2 ─────────────────────────────────────────────────────────
  const wizardScreens = [
    {
      label: 'Horas disponibles por día',
      field: 'hoursPerDay' as const,
      options: [
        { value: '1', label: '1 hora/día', hint: 'Ritmo ligero — solo lo esencial' },
        { value: '2', label: '2 horas/día', hint: 'Ritmo normal — avance constante (recomendado)' },
        { value: '3', label: '3+ horas/día', hint: 'Ritmo intensivo — maximizar avance' },
      ],
    },
    {
      label: 'Prioridad de módulos',
      field: 'modulePriority' as const,
      options: [
        { value: 'sequential', label: 'Un módulo a la vez', hint: 'Terminar todas las lecciones del módulo antes de avanzar al siguiente' },
        { value: 'parallel', label: 'Avanzar en paralelo', hint: 'Distribuir lecciones de distintos módulos en la semana' },
      ],
    },
    {
      label: 'Estado del estudiante',
      field: 'pace' as const,
      options: [
        { value: 'normal', label: 'Al día', hint: 'Plan normal — solo días hábiles (L-V)' },
        { value: 'catchup', label: 'Necesita ponerse al día', hint: 'Plan intensivo — incluye fin de semana para recuperar rezago' },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#1A1A2E] rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListTodo className="w-5 h-5 text-purple-600" />
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {wizardStep < 3 ? 'Configurar plan de estudio' : 'Mentor\'s Learning Path'}
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Wizard steps 0-2 ── */}
        {wizardStep < 3 ? (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Para <strong className="text-gray-900 dark:text-white">{student.studentName ?? 'este estudiante'}</strong>
            </p>
            <WizardStep
              step={wizardStep + 1}
              label={wizardScreens[wizardStep]!.label}
              options={wizardScreens[wizardStep]!.options}
              value={String(wizardParams[wizardScreens[wizardStep]!.field])}
              onChange={(v) => setWizardParams((prev) => ({
                ...prev,
                [wizardScreens[wizardStep]!.field]: wizardScreens[wizardStep]!.field === 'hoursPerDay' ? Number(v) : v,
              } as WizardParams))}
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => wizardStep === 0 ? onClose() : setWizardStep((s) => (s - 1) as typeof s)}
                className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" /> {wizardStep === 0 ? 'Cancelar' : 'Atrás'}
              </button>
              <button
                onClick={() => setWizardStep((s) => (s + 1) as typeof s)}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#7B2FBE] to-[#00B4D8] text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1 transition-opacity"
              >
                {wizardStep === 2 ? 'Revisar y generar' : 'Siguiente'} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : (
          /* ── Confirm screen (step 3) ── */
          <>
            {/* Student name */}
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Plan semanal para{' '}
              <strong className="text-gray-900 dark:text-white">{student.studentName ?? 'este estudiante'}</strong>.
            </p>

            {/* Wizard summary */}
            <div className="rounded-xl bg-purple-50 dark:bg-purple-900/15 border border-purple-100 dark:border-purple-800/30 px-4 py-3 space-y-1 text-xs text-purple-800 dark:text-purple-300">
              <p><strong>Horas/día:</strong> {wizardParams.hoursPerDay}h · <strong>Prioridad:</strong> {wizardParams.modulePriority === 'sequential' ? 'Un módulo a la vez' : 'Paralelo'} · <strong>Pace:</strong> {wizardParams.pace === 'catchup' ? 'Catchup (finde incluido)' : 'Normal (L-V)'}</p>
              <button onClick={() => setWizardStep(0)} className="text-purple-600 dark:text-purple-400 hover:underline font-medium">Cambiar parámetros</button>
            </div>

            {/* Existing plan info */}
            {loadingPlan ? (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando plan actual…
              </div>
            ) : existingPlan ? (
              <div className="rounded-xl border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <RefreshCw className="w-3.5 h-3.5" /> Plan existente ({totalItems} actividades) — se reemplazará
                </div>
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
                Nota de Mentor (opcional)
              </label>
              <textarea
                rows={2}
                value={mentorNote}
                onChange={(e) => setMentorNote(e.target.value)}
                maxLength={500}
                placeholder="Ej: Enfócate en los primeros 3 módulos, el examen es el viernes…"
                className="w-full border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 bg-white dark:bg-white/5 text-sm text-gray-900 dark:text-white outline-none resize-none focus:ring-2 focus:ring-purple-400/30 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            {success ? (
              <div className="flex items-center gap-2 text-green-600 font-medium text-sm">
                <Unlock className="w-4 h-4" /> Plan generado y enviado al estudiante
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setWizardStep(2)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Atrás
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
          </>
        )}
      </div>
    </div>
  );
}
