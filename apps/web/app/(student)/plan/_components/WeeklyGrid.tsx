'use client';

import { useState } from 'react';
import { Plus, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import { PlanCard } from './PlanCard';
import { groupItemsByCourse } from './WeeklyGrid.helpers';
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

const MAX_VISIBLE = 4;

function DayColumn({
  day, plan, locked, onTogglePin, onToggleDone, onRemove, onAddItem, isToday, ts,
}: {
  day: StudyPlan['days'][number];
  plan: StudyPlan;
  locked: boolean;
  onTogglePin: Props['onTogglePin'];
  onToggleDone: Props['onToggleDone'];
  onRemove: Props['onRemove'];
  onAddItem: Props['onAddItem'];
  isToday: boolean;
  ts: any;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isWeekend = day.dayIndex >= 5;
  const visibleItems = isExpanded ? day.items : day.items.slice(0, MAX_VISIBLE);
  const overflow = day.items.length - MAX_VISIBLE;
  const shortDate = new Date(day.date + 'T00:00:00Z').toLocaleDateString('es-ES', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
  const label = ts.days[day.dayIndex] ?? `Día ${day.dayIndex + 1}`;

  return (
    <div
      className={[
        'rounded-xl border p-3 flex flex-col gap-2',
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
            {isToday && (
              <span className="ml-1.5 text-[10px] bg-[#17527E] text-white rounded px-1 py-0.5 normal-case font-medium tracking-normal">
                hoy
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">{shortDate}</p>
        </div>
        {!locked && !isWeekend && (
          <button
            onClick={() => onAddItem(plan.weekOf, day.dayIndex)}
            className="p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-white/10 text-gray-400 hover:text-[#17527E] dark:hover:text-blue-300 transition-colors"
            title={ts.addItem}
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Items */}
      <div className="flex flex-col gap-2 flex-1">
        {day.items.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-600 italic text-center mt-2">
            {isWeekend ? ts.emptyDay : ts.noItems}
          </p>
        ) : (
          <>
            {/* Course grouping (Trello Nk0XDBvJ, 2026-08-18 — Mack: "resolver la
                ambigüedad ... donde las lecciones ... se muestran mezcladas sin
                identificar a qué curso corresponden"). Grouped AFTER the existing
                MAX_VISIBLE slice, not before — keeps the "+N más" pagination exactly
                as it worked before; a course header is purely a visual wrapper around
                whichever items were already going to render. */}
            {groupItemsByCourse(visibleItems).map((group, gi) => (
              <div key={group.courseId ?? `ungrouped-${gi}`} className="flex flex-col gap-2">
                {group.courseTitle && (
                  <div className={`flex items-center gap-1.5 pt-1 ${gi > 0 ? 'border-t border-gray-200 dark:border-white/10 -mx-3 px-3' : ''}`}>
                    <BookOpen className="w-3 h-3 text-gray-400 shrink-0" />
                    <p className="text-xs font-semibold text-[#17527E] dark:text-blue-300 truncate flex-1" title={group.courseTitle}>
                      {group.courseTitle}
                    </p>
                    <span className="text-[10px] text-gray-400 shrink-0">{group.items.length}</span>
                  </div>
                )}
                {group.items.map((item) => (
                  <PlanCard
                    key={item.id}
                    item={item}
                    locked={locked}
                    onTogglePin={(id, pinned) => onTogglePin(plan.weekOf, id, pinned)}
                    onToggleDone={(id, done) => onToggleDone(plan.weekOf, id, done)}
                    onRemove={(id) => onRemove(plan.weekOf, id)}
                  />
                ))}
              </div>
            ))}
            {overflow > 0 && !isExpanded && (
              <button
                onClick={() => setIsExpanded(true)}
                className="text-xs text-[#17527E] dark:text-blue-300 hover:underline transition-colors text-center py-1 font-medium"
              >
                +{overflow} más
              </button>
            )}
            {isExpanded && overflow > 0 && (
              <button
                onClick={() => setIsExpanded(false)}
                className="text-xs text-gray-400 hover:text-[#17527E] dark:hover:text-blue-300 transition-colors text-center py-1"
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
}

export function WeeklyGrid({ plan, locked, onTogglePin, onToggleDone, onRemove, onAddItem }: Props) {
  const { t } = useLanguage();
  const ts = t.studyPlan;

  const todayDayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const [mobileDayIdx, setMobileDayIdx] = useState(() => {
    // Default to today if it's a weekday, else Monday
    return todayDayIdx >= 0 && todayDayIdx <= 4 ? todayDayIdx : 0;
  });

  const mobileDay = plan.days[mobileDayIdx];
  const daysShort = ts.daysShort ?? ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  return (
    <>
      {/* ── Mobile: day tabs + single column ─────────────────────────────────── */}
      <div className="sm:hidden">
        {/* Day tab strip */}
        <div className="flex items-center gap-1 mb-3">
          <button
            onClick={() => setMobileDayIdx((i) => Math.max(0, i - 1))}
            disabled={mobileDayIdx === 0}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-white/10 disabled:opacity-30 shrink-0"
          >
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>

          <div className="flex flex-1 gap-1 overflow-x-auto justify-center" style={{ scrollbarWidth: 'none' }}>
            {plan.days.map((day, i) => {
              const isToday = i === todayDayIdx;
              const hasItems = day.items.length > 0;
              const isActive = i === mobileDayIdx;
              return (
                <button
                  key={i}
                  onClick={() => setMobileDayIdx(i)}
                  className={[
                    'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all',
                    isActive
                      ? 'bg-[#17527E] text-white shadow-sm'
                      : isToday
                        ? 'text-[#17527E] dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10',
                  ].join(' ')}
                >
                  <span>{daysShort[i]}</span>
                  {hasItems && (
                    <span className={[
                      'w-1 h-1 rounded-full',
                      isActive ? 'bg-white/60' : 'bg-[#17527E]/40 dark:bg-blue-400/50',
                    ].join(' ')} />
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setMobileDayIdx((i) => Math.min(plan.days.length - 1, i + 1))}
            disabled={mobileDayIdx === plan.days.length - 1}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-white/10 disabled:opacity-30 shrink-0"
          >
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Single day content */}
        {mobileDay && (
          <DayColumn
            day={mobileDay}
            plan={plan}
            locked={locked}
            onTogglePin={onTogglePin}
            onToggleDone={onToggleDone}
            onRemove={onRemove}
            onAddItem={onAddItem}
            isToday={mobileDayIdx === todayDayIdx}
            ts={ts}
          />
        )}
      </div>

      {/* ── Desktop: horizontal scroll ────────────────────────────────────────── */}
      <div className="hidden sm:block overflow-x-auto pb-3 -mx-1 px-1">
        <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
          {plan.days.map((day) => (
            <div key={day.dayIndex} className="w-56 flex-shrink-0">
              <DayColumn
                day={day}
                plan={plan}
                locked={locked}
                onTogglePin={onTogglePin}
                onToggleDone={onToggleDone}
                onRemove={onRemove}
                onAddItem={onAddItem}
                isToday={day.dayIndex === todayDayIdx}
                ts={ts}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
