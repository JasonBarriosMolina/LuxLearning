'use client';

// ─── InterviewEvalConfig.tsx ──────────────────────────────────────────────────
// Extracted from StepEvaluacion.tsx (over the 400-line component limit). Renders
// the INTERVIEW-type config block: topic selector (weekly-plan checkboxes or
// free text), date/time fields, Vapi prompt + objectives.
import { Mic, Sparkles, Loader2, X } from 'lucide-react';
import { EvalItem, Step4Data, TIME_SLOTS } from './constants';
import { WeekAwareDatePicker } from './WeekAwareDatePicker';

interface Props {
  item: EvalItem;
  step4: Step4Data;
  s: (es: string, en: string) => string;
  hasWeeklyPlan: boolean;
  courseStartDate: string | null | undefined;
  classDays: string[];
  isEN: boolean;
  selectedWeeks: number[];
  topicText: string;
  fillingId: string | null;
  canFillInterview: boolean;
  toggleWeek: (itemId: string, weekNum: number) => void;
  setFillTopicText: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setFillSelectedWeeks: React.Dispatch<React.SetStateAction<Record<string, number[]>>>;
  autoFillInterview: (itemId: string) => void;
  updateItem: (id: string, patch: Partial<EvalItem>) => void;
}

export function InterviewEvalConfig({
  item, step4, s, hasWeeklyPlan, selectedWeeks, topicText, fillingId, canFillInterview,
  toggleWeek, setFillTopicText, setFillSelectedWeeks, autoFillInterview, updateItem,
  courseStartDate, classDays, isEN,
}: Props) {
  return (
    <div className="space-y-2 text-xs border-t border-border pt-3 mt-1">
      <div className="flex items-center gap-1.5 text-rose-600 mb-2">
        <Mic className="w-3 h-3" />
        <span className="font-semibold">{s('Configuración del Lux Mentor para la entrevista', 'Lux Mentor configuration for the interview')}</span>
      </div>

      {/* Topic selector */}
      <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/10 border border-rose-100 space-y-2">
        <p className="text-[10px] font-semibold text-rose-700 uppercase tracking-wide">
          {s('Tema(s) a evaluar', 'Topic(s) to evaluate')}
        </p>
        {hasWeeklyPlan ? (
          <div className="space-y-1.5">
            <p className="text-[10px] text-rose-600">{s('Selecciona las semanas que cubre esta entrevista:', 'Select the weeks this interview covers:')}</p>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
              {step4.weeklyPlan.map((w) => {
                const checked = selectedWeeks.includes(w.weekNum);
                return (
                  <button
                    key={w.weekNum}
                    type="button"
                    onClick={() => toggleWeek(item.id, w.weekNum)}
                    className={`flex items-start gap-1.5 px-2 py-1 rounded-lg border text-[10px] transition-colors text-left ${checked ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-gray-600 border-rose-200 hover:border-rose-400'}`}
                  >
                    <span className="font-bold shrink-0">S{w.weekNum}</span>
                    <span className="line-clamp-1">{w.topics[0] ?? ''}</span>
                  </button>
                );
              })}
            </div>
            {selectedWeeks.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] text-rose-600 font-medium">{s('Semanas seleccionadas:', 'Selected weeks:')} {selectedWeeks.sort((a, b) => a - b).join(', ')}</span>
                <button type="button" onClick={() => setFillSelectedWeeks((p) => ({ ...p, [item.id]: [] }))} className="text-rose-400 hover:text-rose-700"><X className="w-3 h-3" /></button>
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="text-[10px] text-rose-600 mb-1">{s('Ingresa el tema específico a evaluar:', 'Enter the specific topic to evaluate:')}</p>
            <input
              type="text"
              value={topicText}
              onChange={(e) => setFillTopicText((p) => ({ ...p, [item.id]: e.target.value }))}
              placeholder={s('Ej. Variables y tipos de datos, Condicionales...', 'E.g. Variables and data types, Conditionals...')}
              className="input-field w-full text-xs py-1"
            />
          </div>
        )}
        {/* Always show free-text as supplement if weeklyPlan exists */}
        {hasWeeklyPlan && (
          <div>
            <p className="text-[10px] text-rose-500 mb-0.5">{s('O añade un tema adicional:', 'Or add an additional topic:')}</p>
            <input
              type="text"
              value={topicText}
              onChange={(e) => setFillTopicText((p) => ({ ...p, [item.id]: e.target.value }))}
              placeholder={s('Tema adicional (opcional)...', 'Additional topic (optional)...')}
              className="input-field w-full text-xs py-1"
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => autoFillInterview(item.id)}
          disabled={fillingId === item.id || !canFillInterview}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {fillingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {s('Llenar instrucciones con temario', 'Fill instructions from syllabus')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-gray-500 mb-1">{s('Fecha inicio entrevistas', 'Interview start date')}</label>
          <WeekAwareDatePicker
            value={item.interviewStartDate ?? ''} onChange={(val) => updateItem(item.id, { interviewStartDate: val })}
            courseStartDate={courseStartDate} classDays={classDays} isEN={isEN}
          />
        </div>
        <div>
          <label className="block text-gray-500 mb-1">{s('Fecha fin entrevistas', 'Interview end date')}</label>
          <WeekAwareDatePicker
            value={item.interviewEndDate ?? ''} onChange={(val) => updateItem(item.id, { interviewEndDate: val })}
            courseStartDate={courseStartDate} classDays={classDays} isEN={isEN}
          />
        </div>
      </div>
      <div>
        <label className="block text-gray-500 mb-1">{s('Hora máxima de entrega', 'Submission deadline time')}</label>
        <datalist id={`interview-slots-${item.id}`}>{TIME_SLOTS.map((t) => <option key={t} value={t} />)}</datalist>
        <input type="text" list={`interview-slots-${item.id}`} value={item.interviewTimeSlot ?? ''} onChange={(e) => updateItem(item.id, { interviewTimeSlot: e.target.value })} placeholder="11:59 PM" className="input-field w-full text-xs py-1" />
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
  );
}
