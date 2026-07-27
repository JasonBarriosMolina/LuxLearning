'use client';

import { Info, CalendarX, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  Step1Data, Step2Data, ExceptionItem, PendingException, CalendarWeek,
  DAYS_ES, DAY_ABBR_ES, DAY_ABBR_EN, fmtDisplay,
} from './constants';
import { SectionLabel } from './StepBar';

interface StepCalendarioProps {
  step1: Step1Data;
  step2: Step2Data;
  setStep2: React.Dispatch<React.SetStateAction<Step2Data>>;
  weeks: CalendarWeek[];
  exceptionSet: Set<string>;
  pendingEx: PendingException | null;
  setPendingEx: React.Dispatch<React.SetStateAction<PendingException | null>>;
  exLabelInput: string;
  setExLabelInput: React.Dispatch<React.SetStateAction<string>>;
  toggleWeekEx: (weekIdx: number) => void;
  toggleDayEx: (weekIdx: number, date: string) => void;
  confirmException: () => void;
  removeException: (id: string) => void;
  activeDays: string[];
  isEN: boolean;
}

export function StepCalendario({
  step1, step2, setStep2,
  weeks, exceptionSet,
  pendingEx, setPendingEx,
  exLabelInput, setExLabelInput,
  toggleWeekEx, toggleDayEx,
  confirmException, removeException,
  activeDays, isEN,
}: StepCalendarioProps) {
  const s = (es: string, en: string) => isEN ? en : es;
  const planEN = step1.planLanguage === 'EN';

  const isWeekEx = (idx: number) => exceptionSet.has(`w-${idx}`);
  const isDayEx = (date: string) => exceptionSet.has(`d-${date}`);

  return (
    <div className="space-y-6">
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 flex gap-3">
        <Info className="w-4 h-4 text-cta-from shrink-0 mt-0.5" />
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {s('Inicia el', 'Starts')} <strong>{step1.startDate ? fmtDisplay(step1.startDate) : '—'}</strong>.{' '}
          {s('Haz clic en una semana o día para marcar excepciones.', 'Click a week or day to mark exceptions.')}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-charcoal">{s('Total de semanas lectivas', 'Total teaching weeks')}</label>
          <div className="flex items-center gap-2">
            <button onClick={() => setStep2((p) => ({ ...p, totalWeeks: Math.max(1, p.totalWeeks - 1) }))} className="w-8 h-8 rounded-lg border border-border hover:bg-surface font-bold">−</button>
            <input type="number" min={1} max={52} value={step2.totalWeeks} onChange={(e) => setStep2((p) => ({ ...p, totalWeeks: Math.max(1, Math.min(52, parseInt(e.target.value) || 1)) }))} className="input-field w-16 text-center font-semibold" />
            <button onClick={() => setStep2((p) => ({ ...p, totalWeeks: Math.min(52, p.totalWeeks + 1) }))} className="w-8 h-8 rounded-lg border border-border hover:bg-surface font-bold">+</button>
            <span className="text-sm text-gray-400">{s('semanas', 'weeks')}</span>
          </div>
        </div>
        {step2.exceptions.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
            <CalendarX className="w-3.5 h-3.5" />{step2.exceptions.length} {s('excepción(es)', 'exception(s)')}
          </div>
        )}
      </div>

      {pendingEx && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl space-y-3">
          <p className="text-sm font-semibold text-amber-800">
            {pendingEx.type === 'week' ? s(`Semana ${pendingEx.weekIndex + 1}`, `Week ${pendingEx.weekIndex + 1}`) : fmtDisplay(pendingEx.date ?? '')} — {s('Etiqueta:', 'Label:')}
          </p>
          <div className="flex gap-2">
            <input type="text" value={exLabelInput} onChange={(e) => setExLabelInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmException(); if (e.key === 'Escape') setPendingEx(null); }}
              placeholder={s('Ej. Semana Santa…', 'E.g. Easter Week…')} className="input-field flex-1 text-sm py-2" autoFocus />
            <Button onClick={confirmException} variant="secondary">OK</Button>
            <Button onClick={() => setPendingEx(null)} variant="secondary"><X className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {!step1.startDate ? (
        <p className="text-sm text-gray-400 text-center py-8">{s('Define la fecha de inicio en el Paso 1.', 'Set the start date in Step 1.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-surface">
                <th className="text-left px-3 py-2 font-semibold text-gray-500 w-20 border border-border">{s('Semana', 'Week')}</th>
                {activeDays.map((d) => (
                  <th key={d} className="px-2 py-2 font-semibold text-gray-500 border border-border text-center">
                    {planEN ? DAY_ABBR_EN[DAYS_ES.indexOf(d)] : DAY_ABBR_ES[DAYS_ES.indexOf(d)]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((wk) => {
                const wEx = isWeekEx(wk.index);
                return (
                  <tr key={wk.index} className={wEx ? 'bg-amber-50 dark:bg-amber-900/10' : 'hover:bg-surface/50'}>
                    <td className="px-3 py-1.5 border border-border">
                      <button onClick={() => toggleWeekEx(wk.index)} className={`flex items-center gap-1.5 w-full text-left ${wEx ? 'text-amber-700 font-semibold' : 'text-gray-600 hover:text-amber-600'}`}>
                        {wEx ? <CalendarX className="w-3 h-3 text-amber-500" /> : <span className="w-3 h-3" />}
                        <span>{s('S', 'W')}{wk.weekNum}</span>
                      </button>
                      {wEx && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[10px] text-amber-600 truncate max-w-[80px]">{step2.exceptions.find((e) => e.type === 'week' && e.weekIndex === wk.index)?.label}</span>
                          <button onClick={() => { const ex = step2.exceptions.find((e) => e.type === 'week' && e.weekIndex === wk.index); if (ex) removeException(ex.id); }} className="text-amber-400 hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                        </div>
                      )}
                    </td>
                    {wk.days.map(({ day, date }) => {
                      const dEx = isDayEx(date);
                      return (
                        <td key={day} className={`px-2 py-1.5 border border-border text-center ${wEx ? 'opacity-40' : ''} ${dEx ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                          <button disabled={wEx} onClick={() => toggleDayEx(wk.index, date)} className={`text-center w-full rounded transition-colors ${dEx ? 'text-red-600 font-semibold' : 'text-gray-500 hover:text-red-500'}`}>
                            {date.slice(8)}/{date.slice(5, 7)}
                            {dEx && <span className="block text-[9px] text-red-500 truncate">{step2.exceptions.find((e) => e.date === date)?.label ?? ''}</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {step2.exceptions.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>{s('Excepciones marcadas', 'Marked exceptions')}</SectionLabel>
          {step2.exceptions.map((ex) => (
            <div key={ex.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border">
              <CalendarX className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-charcoal">{ex.label}</span>
                <span className="text-xs text-gray-400 ml-2">{ex.type === 'week' ? `${s('Semana','Week')} ${ex.weekIndex + 1}` : fmtDisplay(ex.date ?? '')}</span>
              </div>
              <button onClick={() => removeException(ex.id)} className="text-gray-300 hover:text-red-500 transition-colors"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
