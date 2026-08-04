'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PlanCard } from './PlanCard';
import type { StudyPlan } from '../types';
import { useLanguage } from '@/lib/i18n';

interface Props {
  plan: StudyPlan;
  locked: boolean;
  onTogglePin: (weekOf: string, itemId: string, pinned: boolean) => void;
  onToggleDone: (weekOf: string, itemId: string, done: boolean) => void;
  onRemove: (weekOf: string, itemId: string) => void;
  onAddItem: (weekOf: string, dayIndex: number) => void;
}

const DAY_BG: Record<number, string> = {
  0: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40',
  1: 'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900/40',
  2: 'bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-900/40',
  3: 'bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900/40',
  4: 'bg-fuchsia-50 dark:bg-fuchsia-950/20 border-fuchsia-200 dark:border-fuchsia-900/40',
  5: 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800',
  6: 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800',
};

const MAX_VISIBLE = 3;

export function WeeklyGrid({ plan, locked, onTogglePin, onToggleDone, onRemove, onAddItem }: Props) {
  const { t } = useLanguage();
  const ts = t.studyPlan;

  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());
  const todayDayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

  const toggleExpand = (dayIndex: number) =>
    setExpandedDays((prev) => {
      const next = new Set(prev);
      next.has(dayIndex) ? next.delete(dayIndex) : next.add(dayIndex);
      return next;
    });

  return (
    <div className="overflow-x-auto pb-3 -mx-1 px-1">
      <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
        {plan.days.map((day) => {
          const label = ts.days[day.dayIndex] ?? `Día ${day.dayIndex + 1}`;
          const shortDate = new Date(day.date + 'T00:00:00Z').toLocaleDateString('es-ES', {
            day: 'numeric', month: 'short', timeZone: 'UTC',
          });
          const isWeekend = day.dayIndex >= 5;
          const isToday = day.dayIndex === todayDayIdx;
          const isExpanded = expandedDays.has(day.dayIndex);
          const visibleItems = isExpanded ? day.items : day.items.slice(0, MAX_VISIBLE);
          const overflow = day.items.length - MAX_VISIBLE;

          return (
            <div
              key={day.dayIndex}
              className={[
                'w-52 flex-shrink-0 rounded-xl border p-3 flex flex-col gap-2',
                DAY_BG[day.dayIndex] ?? DAY_BG[6],
                isToday ? 'ring-2 ring-[#17527E] dark:ring-blue-400 shadow-md' : '',
                isWeekend ? 'opacity-70' : '',
              ].join(' ')}
            >
              {/* Day header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-xs font-bold uppercase tracking-wide ${isToday ? 'text-[#17527E] dark:text-blue-300' : 'text-gray-600 dark:text-gray-400'}`}>
                    {label}
                    {isToday && <span className="ml-1.5 text-[10px] bg-[#17527E] text-white rounded px-1 py-0.5 normal-case font-medium tracking-normal">hoy</span>}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{shortDate}</p>
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
                  <p className="text-xs text-gray-400 dark:text-gray-600 italic text-center mt-2">
                    {isWeekend ? ts.emptyDay : ts.noItems}
                  </p>
                ) : (
                  <>
                    {visibleItems.map((item) => (
                      <PlanCard
                        key={item.id}
                        item={item}
                        locked={locked}
                        onTogglePin={(id, pinned) => onTogglePin(plan.weekOf, id, pinned)}
                        onToggleDone={(id, done) => onToggleDone(plan.weekOf, id, done)}
                        onRemove={(id) => onRemove(plan.weekOf, id)}
                      />
                    ))}
                    {overflow > 0 && !isExpanded && (
                      <button
                        onClick={() => toggleExpand(day.dayIndex)}
                        className="text-xs text-gray-400 hover:text-[#17527E] dark:hover:text-blue-300 transition-colors text-center py-0.5"
                      >
                        +{overflow} {overflow === 1 ? 'más' : 'más'}
                      </button>
                    )}
                    {isExpanded && overflow > 0 && (
                      <button
                        onClick={() => toggleExpand(day.dayIndex)}
                        className="text-xs text-gray-400 hover:text-[#17527E] dark:hover:text-blue-300 transition-colors text-center py-0.5"
                      >
                        Ver menos ↑
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Weekend add */}
              {!locked && isWeekend && (
                <button
                  onClick={() => onAddItem(plan.weekOf, day.dayIndex)}
                  className="text-xs text-gray-400 hover:text-[#17527E] dark:hover:text-blue-300 transition-colors flex items-center gap-1 justify-center"
                >
                  <Plus className="w-3 h-3" /> {ts.addItem}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
