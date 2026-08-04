'use client';

import { GripVertical, Info, Plus, Trash2, Mic, Sparkles, Loader2 } from 'lucide-react';
import { useState } from 'react';
import {
  Step1Data, Step2Data, Step3Data, Step4Data, EvalItem, EvalType, CourseTypeId,
  COURSE_TYPES, EVAL_TYPE_META, fmtDisplay, TIME_SLOTS,
} from './constants';

interface OutOfRangeItem { itemName: string; date: string; }

interface StepEvaluacionProps {
  step1: Step1Data;
  step2: Step2Data;
  step3: Step3Data;
  step4: Step4Data;
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
  saveCourse: () => Promise<void>;
  step5Status: 'idle' | 'saving' | 'done' | 'error';
  step5Error: string;
  editingCourseId: string | null;
}

export function StepEvaluacion({
  step1, step2, step3, step4,
  totalWeight, weightOk,
  outOfRangeItems, dateWarningDismissed, setDateWarningDismissed,
  updateItem, updateDueDate, setCount, addEvalItem, removeItem,
  isEN, onPilotoToggle,
  saveCourse, step5Status, step5Error, editingCourseId,
}: StepEvaluacionProps) {
  const s = (es: string, en: string) => isEN ? en : es;
  const planEN = step1.planLanguage === 'EN';
  const ct = COURSE_TYPES.find((c) => c.id === step1.courseType);
  const [fillingId, setFillingId] = useState<string | null>(null);

  const autoFillInterview = (itemId: string) => {
    if (!step4.modules.length && !step4.weeklyPlan.length) return;
    setFillingId(itemId);
    const moduleList = step4.modules.map((m, i) =>
      `${i + 1}. ${planEN ? (m.nameEN || m.name) : m.name}: ${planEN ? (m.descriptionEN || m.description) : m.description}`
    ).join('\n');
    const topicSample = step4.weeklyPlan.slice(0, 4).map((w) => `Sem ${w.weekNum}: ${w.topics.join(', ')}`).join('\n');
    const prompt = `Eres Mentor, un evaluador oral amigable y profesional para el curso "${step1.title}". Realiza exactamente 3 preguntas orales al estudiante sobre los temas del módulo. Sé conversacional, claro y alentador. Saluda al estudiante por nombre si es posible.\n\nMódulos del curso:\n${moduleList}\n\nTemas por semana (muestra):\n${topicSample}`;
    const objectives = step4.modules.slice(0, 3).map((m) =>
      planEN ? (m.nameEN || m.name) : m.name
    ).join('\n');
    updateItem(itemId, { vapiPrompt: prompt, vapiObjectives: objectives });
    setFillingId(null);
  };

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
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 text-rose-600">
                        <Mic className="w-3 h-3" />
                        <span className="font-semibold">{s('Configuración de Mentor (Vapi)', 'Mentor Configuration (Vapi)')}</span>
                      </div>
                      {(step4.modules.length > 0 || step4.weeklyPlan.length > 0) && (
                        <button
                          type="button"
                          onClick={() => autoFillInterview(item.id)}
                          disabled={fillingId === item.id}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 transition-colors"
                        >
                          {fillingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          {s('Llenar con temario', 'Fill from syllabus')}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-gray-500 mb-1">{s('Fecha inicio entrevistas', 'Interview start date')}</label>
                        <input type="date" value={item.interviewStartDate ?? ''} onChange={(e) => updateItem(item.id, { interviewStartDate: e.target.value })} className="input-field w-full text-xs py-1" />
                      </div>
                      <div>
                        <label className="block text-gray-500 mb-1">{s('Fecha fin entrevistas', 'Interview end date')}</label>
                        <input type="date" value={item.interviewEndDate ?? ''} onChange={(e) => updateItem(item.id, { interviewEndDate: e.target.value })} className="input-field w-full text-xs py-1" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-gray-500 mb-1">{s('Horario de presentación', 'Presentation time slot')}</label>
                      <datalist id={`interview-slots-${item.id}`}>{TIME_SLOTS.map((t) => <option key={t} value={t} />)}</datalist>
                      <input type="text" list={`interview-slots-${item.id}`} value={item.interviewTimeSlot ?? ''} onChange={(e) => updateItem(item.id, { interviewTimeSlot: e.target.value })} placeholder={s('Ej. 8:00 AM – 10:00 AM', 'E.g. 8:00 AM – 10:00 AM')} className="input-field w-full text-xs py-1" />
                    </div>
                    <div>
                      <label className="block text-gray-500 mb-1">{s('Instrucciones de Mentor', 'Mentor instructions')}</label>
                      <textarea
                        value={item.vapiPrompt ?? ''}
                        onChange={(e) => updateItem(item.id, { vapiPrompt: e.target.value })}
                        placeholder={s('Eres Mentor, un evaluador oral amigable. Conversa con el estudiante y hazle exactamente 3 preguntas sobre el tema del módulo.', 'You are Mentor, a friendly oral evaluator. Converse with the student and ask exactly 3 questions about the module topic.')}
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
                      <p className="text-gray-400 mt-1">{s('Mentor generará exactamente 3 preguntas basadas en estos objetivos.', 'Mentor will generate exactly 3 questions based on these objectives.')}</p>
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

      {step5Error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{step5Error}
        </div>
      )}

      <div className="space-y-2 pt-2">
        <button
          onClick={saveCourse}
          disabled={step5Status === 'saving' || !weightOk}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-cta-from to-cta-to text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {step5Status === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {step5Status === 'saving' ? s('Creando curso...', 'Creating course...') : editingCourseId ? s('Actualizar Curso', 'Update Course') : s('Crear Curso con Lux Planner', 'Create Course with Lux Planner')}
        </button>
        {!editingCourseId && step5Status !== 'saving' && (
          <p className="text-xs text-center text-gray-400">
            {s('El curso se alojará en Borradores y estará disponible para publicar cuando esté listo.', 'The course will be saved as a Draft and will be available to publish when ready.')}
          </p>
        )}
      </div>
    </div>
  );
}
