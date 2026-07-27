'use client';

import { Sparkles, Loader2, Info, CheckCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Step1Data, Step4Data } from './constants';
import { SectionLabel } from './StepBar';

interface StepLuxPlannerProps {
  step4: Step4Data;
  setStep4: React.Dispatch<React.SetStateAction<Step4Data>>;
  effectiveWeeks: number;
  exceptionWeekIndices: number[];
  step2TotalWeeks: number;
  expandedWeeks: Set<number>;
  setExpandedWeeks: React.Dispatch<React.SetStateAction<Set<number>>>;
  planEN: boolean;
  runCopilot: () => Promise<void>;
  updateWeekTopics: (weekNum: number, text: string) => void;
  isEN: boolean;
}

export function StepLuxPlanner({
  step4, setStep4,
  effectiveWeeks, exceptionWeekIndices, step2TotalWeeks,
  expandedWeeks, setExpandedWeeks,
  planEN, runCopilot, updateWeekTopics,
  isEN,
}: StepLuxPlannerProps) {
  const s = (es: string, en: string) => isEN ? en : es;

  return (
    <div className="space-y-6">
      <div className="p-4 bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-100 flex gap-3">
        <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-purple-800 dark:text-purple-200">{s('Lux Planner — Chrono-Planning', 'Lux Planner — Chrono-Planning')}</p>
          <p className="text-xs text-purple-600 dark:text-purple-300 mt-0.5">
            {s(`${effectiveWeeks} semanas lectivas (${step2TotalWeeks} - ${exceptionWeekIndices.length} excepciones). Pega el temario y Lux Planner distribuirá el contenido semana a semana.`,
              `${effectiveWeeks} teaching weeks (${step2TotalWeeks} - ${exceptionWeekIndices.length} exceptions). Paste the syllabus and Lux Planner will distribute content week by week.`)}
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-400">{s('Este paso es opcional. Puedes ir directo a Planeamiento sin generar el plan IA.', 'This step is optional. You can go straight to Planning without generating an AI plan.')}</p>

      <div className="space-y-2">
        <label className="text-sm font-medium text-charcoal">{s('Temario / Syllabus', 'Syllabus')}</label>
        <textarea
          value={step4.syllabusInput}
          onChange={(e) => setStep4((p) => ({ ...p, syllabusInput: e.target.value }))}
          placeholder={s(
            'Unidad 1: Introducción\n- Concepto de programación\n- Variables y tipos de datos\n\nUnidad 2: Control de flujo\n- Condicionales\n- Ciclos',
            'Unit 1: Introduction\n- Programming concepts\n- Variables and data types\n\nUnit 2: Control Flow\n- Conditionals\n- Loops'
          )}
          className="input-field w-full min-h-[180px] resize-y text-sm font-mono"
        />
        <p className="text-xs text-gray-400">{step4.syllabusInput.length}/2500 {s('caracteres', 'characters')}</p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={runCopilot}
          disabled={!step4.syllabusInput.trim() || step4.status === 'loading'}
          leftIcon={step4.status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        >
          {step4.status === 'loading'
            ? s('Generando plan...', 'Generating plan...')
            : step4.status === 'done'
            ? s('Regenerar', 'Regenerate')
            : s('Generar Plan con Lux Planner', 'Generate Plan with Lux Planner')}
        </Button>
        {step4.status === 'done' && (
          <button onClick={runCopilot} disabled={step4.status === 'loading'} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-charcoal transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />{s('Regenerar', 'Regenerate')}
          </button>
        )}
      </div>

      {step4.status === 'error' && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{step4.error}
        </div>
      )}

      {step4.modules.length > 0 && (
        <div className="space-y-3">
          <SectionLabel>{s('Módulos sugeridos', 'Suggested modules')}</SectionLabel>
          <div className="grid gap-2 sm:grid-cols-2">
            {step4.modules.map((mod, i) => (
              <div key={i} className="p-3 rounded-xl border border-border bg-surface">
                <p className="text-sm font-semibold text-charcoal">{planEN ? mod.nameEN : mod.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{planEN ? mod.descriptionEN : mod.description}</p>
                {mod.weeks?.length > 0 && <p className="text-[10px] text-cta-from mt-1.5 font-medium">{s('Semanas:', 'Weeks:')} {mod.weeks.join(', ')}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {step4.weeklyPlan.length > 0 && (
        <div className="space-y-3">
          <SectionLabel>{s('Plan semanal — haz clic en una celda para editar', 'Weekly plan — click to edit any cell')}</SectionLabel>
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface border-b border-border">
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 w-12">{s('Sem.', 'Wk.')}</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">{s('Contenido', 'Content')}</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 hidden sm:table-cell w-28">{s('Módulo', 'Module')}</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 w-28">{s('Evaluación', 'Evaluation')}</th>
                </tr>
              </thead>
              <tbody>
                {step4.weeklyPlan.map((wk) => {
                  const isEx = exceptionWeekIndices.includes(wk.weekNum);
                  const expanded = expandedWeeks.has(wk.weekNum);
                  return (
                    <tr key={wk.weekNum} className={`border-b border-border last:border-0 ${isEx ? 'bg-amber-50/60 dark:bg-amber-900/10 opacity-70' : 'hover:bg-surface/50'}`}>
                      <td className="px-3 py-2 font-semibold text-gray-500 whitespace-nowrap">{s('S', 'W')}{wk.weekNum}</td>
                      <td className="px-3 py-2">
                        {expanded ? (
                          <textarea value={wk.topics.join('\n')} onChange={(e) => updateWeekTopics(wk.weekNum, e.target.value)}
                            className="input-field w-full text-xs py-1 min-h-[56px] resize-y"
                            onBlur={() => setExpandedWeeks((p) => { const ns = new Set(p); ns.delete(wk.weekNum); return ns; })} autoFocus />
                        ) : (
                          <button className="text-left w-full text-charcoal hover:text-cta-from transition-colors line-clamp-2"
                            onClick={() => setExpandedWeeks((p) => { const ns = new Set(p); ns.add(wk.weekNum); return ns; })}>
                            {wk.topics.join(' · ')}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-400 hidden sm:table-cell"><span className="truncate block max-w-[100px]">{wk.module}</span></td>
                      <td className="px-3 py-2">
                        {wk.evalEvent && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">{wk.evalEvent.name}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step4.status === 'done' && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex gap-2">
          <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {s('Plan generado. Puedes editar cualquier celda antes de continuar.', 'Plan generated. You can edit any cell before continuing.')}
        </div>
      )}
    </div>
  );
}
