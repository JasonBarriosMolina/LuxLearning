'use client';

import { GripVertical, Info, Plus, Trash2, Mic, BookOpen } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import {
  Step1Data, Step2Data, Step3Data, Step4Data, EvalItem, EvalType, CourseTypeId,
  COURSE_TYPES, EVAL_TYPE_META, SELECTABLE_EVAL_TYPES, fmtDisplay,
} from './constants';
import { EvidenceInstructionsEditor } from './EvidenceInstructionsEditor';
import { InterviewEvalConfig } from './InterviewEvalConfig';
import { WeekAwareDatePicker } from './WeekAwareDatePicker';
import { getWeekNumberForDate } from './WeekAwareDatePicker.helpers';

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
  updateInstructionAt: (id: string, idx: number, val: string) => void;
  setCount: (id: string, count: number) => void;
  addEvalItem: () => void;
  removeItem: (id: string) => void;
  updateModuleQuizWeek: (moduleIdx: number, quizWeek: number | null) => void;
  updateModuleReflexWeek: (moduleIdx: number, reflexWeek: number | null) => void;
  updateModuleInterviewWeek: (moduleIdx: number, interviewWeek: number | null) => void;
  isEN: boolean;
  onPilotoToggle?: (val: boolean) => void;
  step5Error: string;
  editingCourseId: string | null;
}

export function StepEvaluacion({
  step1, step2, step3, step4,
  totalWeight, weightOk,
  outOfRangeItems, dateWarningDismissed, setDateWarningDismissed,
  updateItem, updateDueDate, updateInstructionAt, setCount, addEvalItem, removeItem,
  updateModuleQuizWeek, updateModuleReflexWeek, updateModuleInterviewWeek,
  isEN, onPilotoToggle,
  step5Error, editingCourseId,
}: StepEvaluacionProps) {
  const s = (es: string, en: string) => isEN ? en : es;
  const planEN = step1.planLanguage === 'EN';
  const ct = COURSE_TYPES.find((c) => c.id === step1.courseType);

  // Per-item interview topic state
  const [fillSelectedWeeks, setFillSelectedWeeks] = useState<Record<string, number[]>>({});
  const [fillTopicText, setFillTopicText] = useState<Record<string, string>>({});
  const [fillingId, setFillingId] = useState<string | null>(null);

  // Per-item evidence instruction generation state
  const [genInstrId, setGenInstrId] = useState<string | null>(null);

  const hasWeeklyPlan = step4.weeklyPlan.length > 0;

  // Build interview prompt from selected weeks or free-text topic
  const autoFillInterview = (itemId: string) => {
    const selectedWeeks = fillSelectedWeeks[itemId] ?? [];
    const topicText = fillTopicText[itemId] ?? '';

    let weekTopicsLines: string;
    let topicLabel: string;

    if (selectedWeeks.length > 0 && hasWeeklyPlan) {
      const filtered = step4.weeklyPlan.filter((w) => selectedWeeks.includes(w.weekNum));
      weekTopicsLines = filtered.map((w) => `Sem ${w.weekNum}: ${w.topics.join(', ')}`).join('\n');
      topicLabel = filtered.flatMap((w) => w.topics).join(', ');
    } else if (topicText.trim()) {
      weekTopicsLines = topicText.trim();
      topicLabel = topicText.trim();
    } else {
      return;
    }

    setFillingId(itemId);
    const prompt = `Eres Mentor, un evaluador oral amigable y profesional para el curso "${step1.title}".\n\nIMPORTANTE: Haz preguntas ÚNICAMENTE sobre los temas indicados a continuación. NO hagas preguntas sobre ningún tema externo, general, o que no esté en esta lista.\n\nTemas específicos a evaluar:\n${weekTopicsLines}\n\nRealiza exactamente 3 preguntas orales al estudiante sobre los temas indicados. Sé conversacional, claro y alentador. Saluda al estudiante al inicio.`;
    const objectives = `Verificar comprensión de: ${topicLabel}\nEvaluar capacidad de aplicar: ${topicLabel}\nComprobar pensamiento crítico sobre: ${topicLabel}`;
    updateItem(itemId, { vapiPrompt: prompt, vapiObjectives: objectives });
    setFillingId(null);
  };

  // Generate EVIDENCE instruction with AI. `idx` set only when count > 1 — writes
  // to instructionsByIndex[idx] instead of the shared `instructions` field
  // (Trello DmPpbrff, 2026-09-01 14:30 — one instruction box per deliverable).
  // `dueDateStr` (Trello DmPpbrff, 2026-09-02 21:43/21:48 — Mack: "genera una
  // entrega muy parecida... abarca los temas de cada semana") is used to look up
  // that specific deliverable's week in the syllabus plan, so each one's
  // instruction is grounded in different content instead of the same generic ask.
  const generateInstruction = async (itemId: string, evalName: string, idx?: number, dueDateStr?: string, evalType?: EvalItem['type']) => {
    const genKey = idx == null ? itemId : `${itemId}#${idx}`;
    setGenInstrId(genKey);
    try {
      // PROYECTO (Trello DmPpbrff, 2026-09-02 21:48 — Mack): the final/capstone
      // deliverable spans the WHOLE course, not one week — and its nature must
      // match the course type (theoretical → essay/report/analysis; practical →
      // a demonstrable practical activity). No week-grounding for this type.
      const isProject = evalType === 'PROYECTO';
      const weekNum = !isProject && dueDateStr ? getWeekNumberForDate(dueDateStr, step1.startDate) : null;
      const week = weekNum != null ? step4.weeklyPlan.find((w) => w.weekNum === weekNum) : null;
      const weekTopics = week ? week.topics.join(', ') : undefined;
      // Multi-session PROYECTO (Trello DmPpbrff, 2026-09-04 — Mack: "4 semanas... 4
      // entregables lógicos... cada uno debe ser un paso a paso secuencial y lógico
      // lograble"): when count > 1, tell the model which session this is and how many
      // total, so it plans a coherent step-by-step arc instead of N unrelated prompts.
      const item = step3.items.find((it) => it.id === itemId);
      const sessionIndex = isProject && idx != null ? idx + 1 : undefined;
      const sessionCount = isProject && item && item.count > 1 ? item.count : undefined;
      const res = await api.admin.courses.generateInstruction({
        courseTitle: step1.title,
        evalName,
        syllabusInput: step4.syllabusInput,
        weekTopics,
        isProject,
        courseType: isProject ? (step1.courseType || undefined) : undefined,
        sessionIndex,
        sessionCount,
      }) as any;
      const instruction = res?.data?.instruction ?? res?.instruction ?? '';
      if (instruction) {
        if (idx == null) updateItem(itemId, { instructions: instruction });
        else updateInstructionAt(itemId, idx, instruction);
      }
    } catch { /* silent — user can retry */ }
    setGenInstrId(null);
  };

  const toggleWeek = (itemId: string, weekNum: number) =>
    setFillSelectedWeeks((p) => {
      const cur = p[itemId] ?? [];
      return { ...p, [itemId]: cur.includes(weekNum) ? cur.filter((w) => w !== weekNum) : [...cur, weekNum] };
    });

  return (
    <div className="space-y-6">
      {/* ── Sticky weight bar ───────────────────────────────────────────────────── */}
      <div className="sticky top-[57px] z-10 bg-white/95 dark:bg-gray-950/95 backdrop-blur -mx-6 px-6 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-cta-from text-white text-xs">{ct?.icon}</div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-charcoal">{planEN ? ct?.labelEN : ct?.label} — {s('Total debe ser 100%', 'Total must be 100%')}</p>
              <div className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${weightOk ? 'bg-emerald-100 text-emerald-700' : totalWeight > 100 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>{totalWeight.toFixed(0)}%</div>
            </div>
            <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-300 ${weightOk ? 'bg-emerald-500' : totalWeight > 100 ? 'bg-red-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, totalWeight)}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {step3.items.map((item) => {
          const meta = EVAL_TYPE_META[item.type];
          const selectedWeeks = fillSelectedWeeks[item.id] ?? [];
          const topicText = fillTopicText[item.id] ?? '';
          const canFillInterview = selectedWeeks.length > 0 || topicText.trim().length > 0;

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
                      {SELECTABLE_EVAL_TYPES.map((t) => {
                        const m = EVAL_TYPE_META[t];
                        return (
                          <button key={t} onClick={() => {
                            // Trello DmPpbrff, 2026-09-04 (Mack): sessions "según lo que
                            // dure el curso... el evaluador puede poner un máximo" — default
                            // the count to the course's total weeks when switching TO
                            // PROYECTO (one session per week), only if still at the
                            // untouched default of 1; the existing +/- stepper is the "max"
                            // the evaluator adjusts from there, no separate cap needed.
                            const patch: Partial<EvalItem> = { type: t };
                            if (t === 'PROYECTO' && item.count === 1 && step2.totalWeeks > 1) {
                              patch.count = step2.totalWeeks;
                              patch.dueDates = Array(step2.totalWeeks).fill('');
                            }
                            updateItem(item.id, patch);
                          }}
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
                          <WeekAwareDatePicker
                            value={d} onChange={(val) => updateDueDate(item.id, i, val)}
                            courseStartDate={step1.startDate} classDays={step1.classDays} isEN={isEN}
                            className="w-40"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* EVIDENCE / PROYECTO — instructions with AI generate button (extracted
                    component). One box when count===1 (unchanged); one box PER due-date
                    instance when count > 1 — Trello DmPpbrff, 2026-09-01 14:30 (Mack).
                    PROYECTO (2026-09-02 21:48) reuses the same editor — same shape
                    (weight/count/dueDates/instructions) — but generateInstruction below
                    grounds it in the whole course + course type instead of a single week. */}
                {(item.type === 'EVIDENCE' || item.type === 'PROYECTO') && (
                  <EvidenceInstructionsEditor
                    item={item} evalName={planEN ? item.nameEN : item.name}
                    s={s} genInstrId={genInstrId} onGenerate={generateInstruction}
                    updateItem={updateItem} updateInstructionAt={updateInstructionAt}
                  />
                )}

                {/* INTERVIEW — topic selector + prompt config (extracted component) */}
                {item.type === 'INTERVIEW' && (
                  <InterviewEvalConfig
                    item={item} step4={step4} s={s} hasWeeklyPlan={hasWeeklyPlan}
                    selectedWeeks={selectedWeeks} topicText={topicText} fillingId={fillingId}
                    canFillInterview={canFillInterview} toggleWeek={toggleWeek}
                    setFillTopicText={setFillTopicText} setFillSelectedWeeks={setFillSelectedWeeks}
                    autoFillInterview={autoFillInterview} updateItem={updateItem}
                    courseStartDate={step1.startDate} classDays={step1.classDays} isEN={isEN}
                  />
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
          <button onClick={() => setDateWarningDismissed(true)} className="text-xs font-semibold text-amber-700 underline hover:text-amber-900 transition-colors">
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

      {/* ── Módulos — Quiz y Reflexión ──────────────────────────────────────────── */}
      {step4.modules.length > 0 && (
        <div className="space-y-3 border-t border-border pt-6">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-cta-from" />
            <p className="text-sm font-semibold text-charcoal">{s('Módulos — Quiz, Reflexión y Entrevista', 'Modules — Quiz, Reflection & Interview')}</p>
          </div>
          <p className="text-xs text-gray-400">{s('Asigna en qué semana se realizará el quiz, la reflexión y/o la entrevista de cada módulo (todo opcional). Si no se asigna, el estudiante no verá esa sección en ese módulo.', 'Assign which week the quiz, reflection and/or interview for each module will take place (all optional). If not assigned, the student won\'t see that section for that module.')}</p>
          <div className="space-y-2">
            {step4.modules.map((mod, i) => {
              const allWeekNums = step4.weeklyPlan.map((w) => w.weekNum);
              return (
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
                    <span className="text-[11px] text-gray-400 flex items-center gap-0.5"><Mic className="w-2.5 h-2.5" />{s('Entrevista', 'Interview')}</span>
                    <select
                      value={mod.interviewWeek ?? ''}
                      onChange={(e) => updateModuleInterviewWeek(i, e.target.value ? parseInt(e.target.value) : null)}
                      className="input-field py-0.5 text-xs w-16"
                    >
                      <option value="">—</option>
                      {allWeekNums.map((n) => <option key={n} value={n}>{s('S', 'W')}{n}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!editingCourseId && (
        <p className="text-xs text-center text-gray-400 pt-2">
          {s('El curso se alojará en Borradores y estará disponible para publicar cuando esté listo.', 'The course will be saved as a Draft and will be available to publish when ready.')}
        </p>
      )}
    </div>
  );
}
