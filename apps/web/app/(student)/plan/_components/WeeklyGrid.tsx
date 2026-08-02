'use client';

import { Plus } from 'lucide-react';
import { PlanCard } from './PlanCard';
import type { StudyPlan, PlanItem } from '../types';
import { useLanguage } from '@/lib/i18n';

interface Props {
  plan: StudyPlan;
  locked: boolean;
  onTogglePin: (weekOf: string, itemId: string, pinned: boolean) => void;
  onToggleDone: (weekOf: string, itemId: string, done: boolean) => void;
  onRemove: (weekOf: string, itemId: string) => void;
  onAddItem: (weekOf: string, dayIndex: number) => void;
}

const DAY_BG = [
  'bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/40',   // Mon
  'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-100 dark:border-indigo-900/40',
  'bg-violet-50 dark:bg-violet-950/20 border-violet-100 dark:border-violet-900/40',
  'bg-purple-50 dark:bg-purple-950/20 border-purple-100 dark:border-purple-900/40',
  'bg-fuchsia-50 dark:bg-fuchsia-950/20 border-fuchsia-100 dark:border-fuchsia-900/40',
  'bg-gray-50 dark:bg-gray-900/20 border-gray-100 dark:border-gray-800',       // Sat
  'bg-gray-50 dark:bg-gray-900/20 border-gray-100 dark:border-gray-800',       // Sun
];

export function WeeklyGrid({ plan, locked, onTogglePin, onToggleDone, onRemove, onAddItem }: Props) {
  const { t } = useLanguage();
  const ts = t.studyPlan;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
      {plan.days.map((day) => {
        const label = ts.days[day.dayIndex] ?? `Día ${day.dayIndex + 1}`;
        const shortDate = new Date(day.date + 'T00:00:00Z').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        const isWeekend = day.dayIndex >= 5;

        return (
          <div
            key={day.dayIndex}
            className={`rounded-xl border p-3 flex flex-col gap-2 min-h-[140px] ${DAY_BG[day.dayIndex]}`}
          >
            {/* Day header */}
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-500">{shortDate}</p>
              </div>
              {!locked && !isWeekend && (
                <button
                  onClick={() => onAddItem(plan.weekOf, day.dayIndex)}
                  className="p-1 rounded-lg hover:bg-white/60 dark:hover:bg-white/10 text-gray-400 hover:text-[#17527E] dark:hover:text-blue-300 transition-colors"
                  title={ts.addItem}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Items */}
            <div className="flex flex-col gap-1.5 flex-1">
              {day.items.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-600 italic mt-auto">{isWeekend ? ts.emptyDay : ts.noItems}</p>
              ) : (
                day.items.map((item) => (
                  <PlanCard
                    key={item.id}
                    item={item}
                    locked={locked}
                    onTogglePin={(id, pinned) => onTogglePin(plan.weekOf, id, pinned)}
                    onToggleDone={(id, done) => onToggleDone(plan.weekOf, id, done)}
                    onRemove={(id) => onRemove(plan.weekOf, id)}
                  />
                ))
              )}
            </div>

            {/* Weekend add button */}
            {!locked && isWeekend && (
              <button
                onClick={() => onAddItem(plan.weekOf, day.dayIndex)}
                className="text-xs text-gray-400 hover:text-[#17527E] dark:hover:text-blue-300 transition-colors flex items-center gap-1 mt-1"
              >
                <Plus className="w-3 h-3" /> {ts.addItem}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
