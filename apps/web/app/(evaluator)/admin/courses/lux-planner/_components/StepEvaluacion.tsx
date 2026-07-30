'use client';

import { GripVertical, Info, Plus, Trash2, Mic } from 'lucide-react';
import {
  Step1Data, Step2Data, Step3Data, EvalItem, EvalType, CourseTypeId,
  COURSE_TYPES, EVAL_TYPE_META, fmtDisplay,
} from './constants';

interface OutOfRangeItem { itemName: string; date: string; }

interface StepEvaluacionProps {
  step1: Step1Data;
  step2: Step2Data;
  step3: Step3Data;
  totalWeight: number;
  weightOk: boolean;
  outOfRangeItems: OutOfRangeItem[];
  dateWarningDismissed: boolean;
  setDateWarningDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  updateItem: (id: string, patch: Partial<EvalItem>) => void;
  updateDueDate: (id: string, idx: number, val: string) => void;
  setCount: (id: string, count: number) => void;
  addEvalItem: () => void;
  removeItem: (id: string) => void;
  isEN: boolean;
  onPilotoToggle?: (val: boolean) => void;
}

export function StepEvaluacion({
  step1, step2, step3,
  totalWeight, weightOk,
  outOfRangeItems, dateWarningDismissed, setDateWarningDismissed,
  updateItem, updateDueDate, setCount, addEvalItem, removeItem,
  isEN, onPilotoToggle,
}: StepEvaluacionProps) {
  const s = (es: string, en: string) => isEN ? en : es;
  const planEN = step1.planLanguage === 'EN';
  const ct = COURSE_TYPES.find((c) => c.id === step1.courseType);

  return (
    <div className="space-y-6">
      <div className="p-4 bg-surface rounded-xl border border-border flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-cta-from text-white">{ct?.icon}</div>
        <div>
          <p className="font-semibold text-charcoal text-sm">{planEN ? ct?.labelEN : ct?.label}</p>
          <p className="text-xs text-gray-400 mt-0.5">{s('Total debe sumar exactamente 100%.', 'Total must equal exactly 100%.')}</p>
        </div>
        <div className="ml-auto shrink-0">
          <div className={`text-sm font-bold px-3 py-1 rounded-full ${weightOk ? 'bg-emerald-100 text-emerald-700' : totalWeight > 100 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>{totalWeight.toFixed(0)}%</div>
        </div>
      </div>

      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${weightOk ? 'bg-emerald-500' : totalWeight > 100 ? 'bg-red-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, totalWeight)}%` }} />
      </div>

      <div className="space-y-3">
        {step3.items.map((item) => {
          const meta = EVAL_TYPE_META[item.type];
          return (
            <div key={item.id} className="border border-border rounded-xl overflow-hidden">
              <div className="bg-surface px-4 py-3 flex items-center gap-3">
                <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>{meta.icon}{planEN ? meta.labelEN : meta.label}</span>
                <input value={planEN ? item.nameEN : item.name} onChange={(e) => updateItem(item.id, planEN ? { nameEN: e.target.value } : { name: e.target.value })}
                  className="flex-1 bg-transparent text-sm font-semibold text-charcoal border-0 outline-none focus:bg-white focus:px-2 focus:rounded focus:border focus:border-border transition-all" />
                <div className="flex items-center gap-2 shrink-0">
                  <input type="number" min={0} max={100} step={5} value={item.weight} onChange={(e) => updateItem(item.id, { weight: parseFloat(e.target.value) || 0 })} className="w-16 text-center input-field py-1 text-sm font-bold" />
                  <span className="text-xs text-gray-400">%</span>
                  {!item.locked && <button onClick={() => removeItem(item.id)} className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
              <div className="px-4 py-3 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">{s('Tipo:', 'Type:')}</span>
                    <div className="flex gap-1">
                      {(Object.keys(EVAL_TYPE_META) as EvalType[]).filter((t) => t !== 'ATTENDANCE').map((t) => {
                        const m = EVAL_TYPE_META[t];
                        return (
                          <button key={t} onClick={() => updateItem(item.id, { type: t })}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${item.type === t ? m.color + ' border-current' : 'border-border text-gray-400 hover:border-gray-300'}`}>
                            {m.icon}{planEN ? m.labelEN : m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {item.type !== 'ATTENDANCE' && (
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span className="text-xs text-gray-400">{s('Cantidad:', 'Count:')}</span>
                      <button onClick={() => setCount(item.id, item.count - 1)} className="w-6 h-6 rounded border border-border hover:bg-surface text-xs font-bold">−</button>
                      <span className="text-sm font-semibold w-5 text-center">{item.count}</span>
                      <button onClick={() => setCount(item.id, item.count + 1)} className="w-6 h-6 rounded border border-border hover:bg-surface text-xs font-bold">+</button>
                    </div>
                  )}
                </div>
                {item.type !== 'ATTENDANCE' && item.count > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-400">{s('Fecha(s) de entrega:', 'Due date(s):')}</p>
                    <div className="flex flex-wrap gap-2">
                      {item.dueDates.map((d, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          {item.count > 1 && <span className="text-[10px] text-gray-400 w-4">{i + 1}.</span>}
                          <input type="date" value={d} onChange={(e) => updateDueDate(item.id, i, e.target.value)} className="input-field py-1 text-xs w-36" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {item.type === 'EVIDENCE' && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-400 hover:text-charcoal">{s('Instrucciones (opcional)', 'Instructions (optional)')}</summary>
                    <textarea value={item.instructions} onChange={(e) => updateItem(item.id, { instructions: e.target.value })} className="input-field w-full mt-2 min-h-[60px] text-xs resize-y" />
                  </details>
                )}
                {item.type === 'INTERVIEW' && (
                  <div className="space-y-2 text-xs border-t border-border pt-3 mt-1">
                    <div className="flex items-center gap-1.5 mb-1 text-rose-600">
                      <Mic className="w-3 h-3" />
                      <span className="font-semibold">{s('Configuración de IA (Vapi)', 'AI Configuration (Vapi)')}</span>
                    </div>
                    <div>
                      <label className="block text-gray-500 mb-1">{s('Instrucciones del entrevistador IA', 'AI interviewer instructions')}</label>
                      <textarea
                        value={item.vapiPrompt ?? ''}
                        onChange={(e) => updateItem(item.id, { vapiPrompt: e.target.value })}
                        placeholder={s('Eres un evaluador oral. Evalúa al estudiante con exactamente 3 preguntas sobre el tema del módulo. Sé conciso y profesional.', 'You are an oral evaluator. Assess the student with exactly 3 questions about the module topic. Be concise and professional.')}
                        className="input-field w-full min-h-[70px] text-xs resize-y"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-500 mb-1">{s('Objetivos de las 3 preguntas (uno por línea)', 'Objectives for the 3 questions (one per line)')}</label>
                      <textarea
                        value={item.vapiObjectives ?? ''}
                        onChange={(e) => updateItem(item.id, { vapiObjectives: e.target.value })}
                        placeholder={s('Comprender el concepto principal\nAplicar el conocimiento a un caso\nEvaluar la comprensión crítica', 'Understand the main concept\nApply knowledge to a case\nAssess critical understanding')}
                        className="input-field w-full min-h-[60px] text-xs resize-y"
                        rows={3}
                      />
                      <p className="text-gray-400 mt-1">{s('La IA generará exactamente 3 preguntas basadas en estos objetivos.', 'The AI will generate exactly 3 questions based on these objectives.')}</p>
                    </div>
                  </div>
                )}
                {item.locked && item.type === 'ATTENDANCE' && (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-charcoal">{s('Piloto automático de asistencia', 'Automatic attendance pilot')}</p>
                      <p className="text-[10px] text-gray-400">{s('Envía notificaciones y alertas de riesgo automáticamente', 'Sends notifications and risk alerts automatically')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onPilotoToggle?.(!step1.pilotoAutomatico)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${step1.pilotoAutomatico ? 'bg-blue-500' : 'bg-gray-300'}`}
                      aria-label="Piloto automático"
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${step1.pilotoAutomatico ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={addEvalItem} className="flex items-center gap-2 w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-cta-from hover:text-cta-from transition-colors">
        <Plus className="w-4 h-4" />{s('Agregar evaluación personalizada', 'Add custom evaluation')}
      </button>

      {outOfRangeItems.length > 0 && !dateWarningDismissed && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">{s('Fechas fuera del rango del curso', 'Dates outside course range')}</p>
              <p className="text-xs text-amber-700 mt-0.5">
                {s(`El curso va del ${fmtDisplay(step1.startDate)} y tiene ${step2.totalWeeks} semanas. Las siguientes fechas están fuera de ese rango:`,
                   `The course starts ${fmtDisplay(step1.startDate)} and runs ${step2.totalWeeks} weeks. These dates fall outside that range:`)}
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {outOfRangeItems.map((it, i) => (
                  <li key={i} className="text-xs text-amber-700 font-medium">· {it.itemName} — {fmtDisplay(it.date)}</li>
                ))}
              </ul>
            </div>
          </div>
          <button
            onClick={() => setDateWarningDismissed(true)}
            className="text-xs font-semibold text-amber-700 underline hover:text-amber-900 transition-colors"
          >
            {s('Continuar de todas maneras', 'Continue anyway')}
          </button>
        </div>
      )}

      {!weightOk && step3.items.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 flex gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {totalWeight > 100 ? s(`Excede 100% por ${(totalWeight - 100).toFixed(0)}%`, `Exceeds 100% by ${(totalWeight - 100).toFixed(0)}%`) : s(`Faltan ${(100 - totalWeight).toFixed(0)}%`, `${(100 - totalWeight).toFixed(0)}% remaining`)}
        </div>
      )}
    </div>
  );
}
