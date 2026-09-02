'use client';

// ─── WeekAwareDatePicker.tsx ───────────────────────────────────────────────────
// Trello DmPpbrff, 2026-09-01 14:30 (Mack): replaces the plain `<input
// type="date">` popup used for evaluation/task/interview due dates with a
// custom month-grid that shows the week number ("S3" / "W3") on the left of
// each row and highlights the course's configured class days in color — so
// the evaluator can see at a glance which week/day a due date lands on
// relative to the actual lesson schedule.
//
// Trello DmPpbrff, 2026-09-02 21:37/21:43 (Mack, screenshots): "el botón es muy
// grande" and "no puedo ver bien el calendario porque se corta" — the toggle
// button inherited the full-size `.input-field` padding (px-4 py-3) instead of
// the compact py-1/text-xs style every other date field in this form uses, and
// the popover was position:absolute inside a `overflow-hidden` card, which
// clipped it. Fixed by shrinking the button and rendering the popover through
// a portal positioned with `position: fixed` from the button's live bounding
// rect, so it escapes any ancestor's overflow clipping entirely.
import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { getWeekNumberForDate, isClassDay, parseLocalDate, toLocalDateStr } from './WeekAwareDatePicker.helpers';

interface Props {
  value: string; // 'YYYY-MM-DD' or ''
  onChange: (val: string) => void;
  courseStartDate: string | null | undefined;
  classDays: string[];
  isEN: boolean;
  className?: string;
}

const MONTH_NAMES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_HEADERS_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAY_HEADERS_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const POPOVER_WIDTH = 300;

export function WeekAwareDatePicker({ value, onChange, courseStartDate, classDays, isEN, className }: Props) {
  const [open, setOpen] = useState(false);
  const selected = parseLocalDate(value);
  const [viewDate, setViewDate] = useState(() => selected ?? parseLocalDate(courseStartDate) ?? new Date());
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const recomputePosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Flip to the left of the button if it would overflow the right edge of
    // the viewport; clamp so it never renders off-screen either side.
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - POPOVER_WIDTH - 8);
    setPos({ top: rect.bottom + 4, left });
  };

  useEffect(() => {
    if (!open) return;
    recomputePosition();
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      const popoverEl = document.getElementById('week-aware-date-popover');
      if (popoverEl?.contains(target)) return;
      setOpen(false);
    }
    // Reposition (rather than close) on scroll/resize — cards inside the
    // wizard often live in scrollable panels.
    window.addEventListener('scroll', recomputePosition, true);
    window.addEventListener('resize', recomputePosition);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('scroll', recomputePosition, true);
      window.removeEventListener('resize', recomputePosition);
      document.removeEventListener('mousedown', onClickOutside);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const weekLetter = isEN ? 'W' : 'S';
  const monthNames = isEN ? MONTH_NAMES_EN : MONTH_NAMES_ES;
  const dayHeaders = isEN ? DAY_HEADERS_EN : DAY_HEADERS_ES;

  // Build a Monday-first month grid, in whole weeks, including lead/trail days
  // from the adjacent months (so every row is a complete calendar week).
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // days back to the Monday on/before the 1st
  const gridStart = new Date(year, month, 1 - startOffset);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7 + d));
    }
    weeks.push(row);
    if (row[6]!.getMonth() !== month && w >= 3) break; // stop once we've fully left the month
  }

  const selectedStr = value || null;
  const todayStr = toLocalDateStr(new Date());

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input-field w-full flex items-center justify-between gap-1.5 text-left py-1 px-2 text-xs"
      >
        <span className={value ? '' : 'text-gray-400'}>{value || (isEN ? 'Select date' : 'Seleccionar fecha')}</span>
        <span className="flex items-center gap-1 shrink-0">
          {value && getWeekNumberForDate(value, courseStartDate) != null && (
            <span className="text-[9px] font-bold text-cta-from bg-blue-50 rounded px-1 py-0.5">
              {weekLetter}{getWeekNumberForDate(value, courseStartDate)}
            </span>
          )}
          <Calendar className="w-3 h-3 text-gray-400" />
        </span>
      </button>

      {open && pos && createPortal(
        <div
          id="week-aware-date-popover"
          className="fixed z-50 bg-white dark:bg-gray-900 border border-border rounded-xl shadow-lg p-3"
          style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
        >
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setViewDate(new Date(year, month - 1, 1))} className="p-1 rounded hover:bg-surface text-gray-400 hover:text-charcoal">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="text-xs font-semibold text-charcoal">{monthNames[month]} {year}</p>
            <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))} className="p-1 rounded hover:bg-surface text-gray-400 hover:text-charcoal">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-[24px_repeat(7,1fr)] gap-1 text-center">
            <span />
            {dayHeaders.map((h, i) => <span key={i} className="text-[10px] text-gray-400 font-semibold">{h}</span>)}

            {weeks.map((row, wi) => {
              const mondayStr = toLocalDateStr(row[0]!);
              const weekNum = getWeekNumberForDate(mondayStr, courseStartDate);
              return (
                <Fragment key={wi}>
                  <span className="text-[9px] text-gray-400 font-bold self-center">
                    {weekNum != null ? `${weekLetter}${weekNum}` : ''}
                  </span>
                  {row.map((d, di) => {
                    const dStr = toLocalDateStr(d);
                    const inMonth = d.getMonth() === month;
                    const isSelected = selectedStr === dStr;
                    const isToday = todayStr === dStr;
                    const classDay = isClassDay(d, classDays);
                    return (
                      <button
                        key={`${wi}-${di}`}
                        type="button"
                        onClick={() => { onChange(dStr); setOpen(false); }}
                        className={[
                          'text-[11px] rounded-md py-1 transition-colors',
                          !inMonth ? 'text-gray-300 dark:text-gray-700' : 'text-charcoal dark:text-gray-200',
                          isSelected ? 'bg-cta-from text-white font-bold' : classDay && inMonth ? 'bg-blue-100 dark:bg-blue-900/30 font-medium hover:bg-blue-200' : 'hover:bg-surface',
                          isToday && !isSelected ? 'ring-1 ring-cta-from' : '',
                        ].join(' ')}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>

          {classDays.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
              <span className="w-2.5 h-2.5 rounded bg-blue-100 dark:bg-blue-900/30 shrink-0" />
              <span className="text-[10px] text-gray-400">{isEN ? 'Course class day' : 'Día de clase del curso'}</span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
