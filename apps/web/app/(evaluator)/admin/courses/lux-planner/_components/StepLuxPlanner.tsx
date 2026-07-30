'use client';

import { useState } from 'react';
import { Sparkles, Loader2, Info, CheckCircle, RefreshCw, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Step4Data, CalendarWeek } from './constants';
import { SectionLabel } from './StepBar';

interface StepLuxPlannerProps {
  step4: Step4Data;
  setStep4: React.Dispatch<React.SetStateAction<Step4Data>>;
  effectiveWeeks: number;
  exceptionWeekIndices: number[];
  step2TotalWeeks: number;
  planEN: boolean;
  runCopilot: () => Promise<void>;
  updateWeekTopics: (weekNum: number, text: string) => void;
  updateWeekProcedure: (weekNum: number, text: string) => void;
  updateWeekNotes: (weekNum: number, text: string) => void;
  updateModuleQuizWeek: (moduleIdx: number, quizWeek: number | null) => void;
  updateModuleReflexWeek: (moduleIdx: number, reflexWeek: number | null) => void;
  weeks: CalendarWeek[];
  isEN: boolean;
}

function EditableCell({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <td className="px-2 py-1.5 max-w-[140px]">
      {editing ? (
        <textarea
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          className="input-field w-full text-xs py-0.5 min-h-[48px] resize-y"
        />
      ) : (
        <button
          className="text-left w-full text-charcoal hover:text-cta-from transition-colors line-clamp-3 text-[11px] leading-snug"
          onClick={() => setEditing(true)}
        >
          {value || <span className="text-gray-300 italic">{placeholder}</span>}
        </button>
      )}
    </td>
  );
}

export function StepLuxPlanner({
  step4, setStep4,
  effectiveWeeks, exceptionWeekIndices, step2TotalWeeks,
  planEN, runCopilot, updateWeekTopics, updateWeekProcedure, updateWeekNotes,
  updateModuleQuizWeek, updateModuleReflexWeek,
  weeks, isEN,
}: StepLuxPlannerProps) {
  const s = (es: string, en: string) => isEN ? en : es;

  const weekDates = (weekNum: number): string => {
    const wk = weeks.find((w) => w.weekNum === weekNum);
    if (!wk || wk.days.length === 0) return '';
    return wk.days.map((d) => {
      const parts = d.date.split('-');
      return `${parts[2]}/${parts[1]}`;
    }).join(', ');
  };

  const allWeekNums = step4.weeklyPlan.map((w) => w.weekNum);

  return (
    <div className="space-y-6">
      <div className="p-4 bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-100 flex gap-3">
        <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-purple-800 dark:text-purple-200">Lux Planner — Chrono-Planning</p>
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

      {/* ── 6-column weekly plan table ─────────────────────────────────────────── */}
      {step4.weeklyPlan.length > 0 && (
        <div className="space-y-3">
          <SectionLabel>{s('Plan semanal — haz clic en una celda para editar', 'Weekly plan — click to edit any cell')}</SectionLabel>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="bg-surface border-b border-border">
                  <th className="text-left px-2 py-2 font-semibold text-gray-500 w-10">{s('Sem.', 'Wk.')}</th>
                  <th className="text-left px-2 py-2 font-semibold text-gray-500 w-[90px]">{s('Fecha clases', 'Class dates')}</th>
                  <th className="text-left px-2 py-2 font-semibold text-gray-500">{s('Habilidades / Tópicos', 'Skills / Topics')}</th>
                  <th className="text-left px-2 py-2 font-semibold text-gray-500 w-24">{s('Módulo', 'Module')}</th>
                  <th className="text-left px-2 py-2 font-semibold text-gray-500 w-36">{s('Procedimiento', 'Procedure')}</th>
                  <th className="text-left px-2 py-2 font-semibold text-gray-500 w-28">{s('Observaciones', 'Notes')}</th>
                </tr>
              </thead>
              <tbody>
                {step4.weeklyPlan.map((wk) => {
                  const isEx = exceptionWeekIndices.includes(wk.weekNum);
                  return (
                    <tr key={wk.weekNum} className={`border-b border-border last:border-0 ${isEx ? 'bg-amber-50/60 dark:bg-amber-900/10 opacity-70' : 'hover:bg-surface/40'}`}>
                      <td className="px-2 py-1.5 font-semibold text-gray-500 whitespace-nowrap">{s('S', 'W')}{wk.weekNum}</td>
                      <td className="px-2 py-1.5 text-gray-400 text-[11px]">{weekDates(wk.weekNum)}</td>
                      <EditableCell value={wk.topics.join('\n')} onChange={(v) => updateWeekTopics(wk.weekNum, v)} placeholder={s('Tópicos...', 'Topics...')} />
                      <td className="px-2 py-1.5 text-gray-500">
                        <span className="block truncate text-[11px]">{wk.module}</span>
                      </td>
                      <EditableCell value={wk.procedure ?? ''} onChange={(v) => updateWeekProcedure(wk.weekNum, v)} placeholder={s('Cómo se abordará...', 'How to address...')} />
                      <EditableCell
                        value={wk.notes ?? (wk.evalEvent ? `${s('Entrega', 'Delivery')}: ${wk.evalEvent.name}` : '')}
                        onChange={(v) => updateWeekNotes(wk.weekNum, v)}
                        placeholder={wk.evalEvent ? `${s('Entrega', 'Delivery')}: ${wk.evalEvent.name}` : s('Observaciones...', 'Notes...')}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400">{s('Haz clic en cualquier celda de texto para editar.', 'Click any text cell to edit.')}</p>
        </div>
      )}

      {/* ── Module quiz/reflexión assignment ──────────────────────────────────── */}
      {step4.modules.length > 0 && (
        <div className="space-y-3">
          <SectionLabel>{s('Módulos — Quiz y Reflexión', 'Modules — Quiz & Reflection')}</SectionLabel>
          <p className="text-xs text-gray-400">{s('Asigna en qué semana se realizará el quiz y la reflexión de cada módulo (opcional).', 'Assign which week the quiz and reflection for each module will take place (optional).')}</p>
          <div className="space-y-2">
            {step4.modules.map((mod, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-surface flex-wrap">
                <BookOpen className="w-3.5 h-3.5 text-cta-from shrink-0" />
                <p className="text-sm font-medium text-charcoal flex-1 min-w-[120px] truncate">{planEN ? mod.nameEN : mod.name}</p>
                {mod.weeks?.length > 0 && (
                  <span className="text-[10px] text-gray-400 shrink-0">{s('Sem.', 'Wk.')} {mod.weeks.join(', ')}</span>
                )}
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <span className="text-[11px] text-gray-400">Quiz</span>
                  <select
                    value={mod.quizWeek ?? ''}
                    onChange={(e) => updateModuleQuizWeek(i, e.target.value ? parseInt(e.target.value) : null)}
                    className="input-field py-0.5 text-xs w-16"
                  >
                    <option value="">—</option>
                    {allWeekNums.map((n) => <option key={n} value={n}>{s('S', 'W')}{n}</option>)}
                  </select>
                  <span className="text-[11px] text-gray-400">{s('Reflexión', 'Reflection')}</span>
                  <select
                    value={mod.reflexWeek ?? ''}
                    onChange={(e) => updateModuleReflexWeek(i, e.target.value ? parseInt(e.target.value) : null)}
                    className="input-field py-0.5 text-xs w-16"
                  >
                    <option value="">—</option>
                    {allWeekNums.map((n) => <option key={n} value={n}>{s('S', 'W')}{n}</option>)}
                  </select>
                </div>
              </div>
            ))}
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
