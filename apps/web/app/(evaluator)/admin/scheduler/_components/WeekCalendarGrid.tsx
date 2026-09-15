'use client';

import { useState } from 'react';
import { Users, X } from 'lucide-react';
import type { ScheduledSession } from './types';

const DAY_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAYS = [1, 2, 3, 4, 5, 6]; // Monday-Saturday, matches the engine (never Sunday)

// Consistent color per evaluator — same evaluator always gets the same tag
// color across days/proposals, cycling through a small accessible palette.
const EVALUATOR_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
  { bg: 'bg-pink-100', text: 'text-pink-800', border: 'border-pink-300' },
  { bg: 'bg-teal-100', text: 'text-teal-800', border: 'border-teal-300' },
  { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
  { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-300' },
];
function colorFor(evaluatorId: string) {
  let hash = 0;
  for (let i = 0; i < evaluatorId.length; i++) hash = (hash * 31 + evaluatorId.charCodeAt(i)) | 0;
  return EVALUATOR_COLORS[Math.abs(hash) % EVALUATOR_COLORS.length]!;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

interface PackedSession { s: ScheduledSession; col: number; cols: number }

// Greedy column-packing (same idea calendar apps use) so overlapping sessions
// on the same day sit side by side instead of stacking on top of each other.
function packDay(sessions: ScheduledSession[]): PackedSession[] {
  const sorted = [...sessions].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const columnEnds: number[] = []; // end time (minutes) of the last session in each column
  const placed: { s: ScheduledSession; col: number }[] = [];
  for (const s of sorted) {
    const start = toMinutes(s.startTime);
    let col = columnEnds.findIndex((end) => end <= start);
    if (col === -1) { col = columnEnds.length; columnEnds.push(0); }
    columnEnds[col] = toMinutes(s.endTime);
    placed.push({ s, col });
  }
  // Sessions that overlap in time all share the max column count seen among them —
  // simplification: use the day's total column count for every block's width so
  // the grid stays regular instead of computing per-cluster overlap counts.
  const cols = Math.max(1, columnEnds.length);
  return placed.map((p) => ({ ...p, cols }));
}

interface Props {
  sessions: ScheduledSession[];
  courseTitles: Record<string, string>;
  teacherNames: Record<string, string>;
  studentNames?: Record<string, string>;
}

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "es importantísimo que exista un
// apoyo visual... que se vea visualmente como un calendario, pero de una
// única semana, ya que las semanas se repiten... con tags de colores por los
// evaluadores... y en un dropdown yo pueda ver los estudiantes matriculados."
export function WeekCalendarGrid({ sessions, courseTitles, teacherNames, studentNames }: Props) {
  const [openId, setOpenId] = useState<number | null>(null);

  if (sessions.length === 0) return null;

  const starts = sessions.map((s) => toMinutes(s.startTime));
  const ends = sessions.map((s) => toMinutes(s.endTime));
  const boundStart = Math.floor(Math.min(...starts) / 60) * 60;
  const boundEnd = Math.ceil(Math.max(...ends) / 60) * 60;
  const totalMinutes = Math.max(60, boundEnd - boundStart);
  const PX_PER_MIN = 1.1;
  const heightPx = totalMinutes * PX_PER_MIN;
  const hourMarks = Array.from({ length: Math.floor(totalMinutes / 60) + 1 }, (_, i) => boundStart + i * 60);

  const byDay = DAYS.map((day) => ({
    day,
    packed: packDay(sessions.filter((s) => s.dayOfWeek === day)),
  }));

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-gray-400" />
        <h2 className="font-heading font-semibold text-charcoal">Calendario semanal</h2>
        <span className="text-xs text-gray-400">— se repite cada semana del período</span>
      </div>
      <div className="flex overflow-x-auto">
        {/* Time gutter */}
        <div className="shrink-0 w-12 relative" style={{ height: heightPx }}>
          {hourMarks.map((m) => (
            <div key={m} className="absolute right-1 -translate-y-1/2 text-[10px] text-gray-400" style={{ top: (m - boundStart) * PX_PER_MIN }}>
              {String(Math.floor(m / 60)).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {byDay.map(({ day, packed }) => (
          <div key={day} className="flex-1 min-w-[110px] border-l border-border relative" style={{ height: heightPx }}>
            <p className="text-[11px] font-semibold text-gray-500 text-center sticky top-0 bg-white/90 py-0.5">{DAY_LABEL[day]}</p>
            {hourMarks.map((m) => (
              <div key={m} className="absolute left-0 right-0 border-t border-border/60" style={{ top: (m - boundStart) * PX_PER_MIN }} />
            ))}
            {packed.map(({ s, col, cols }, idx) => {
              const globalId = sessions.indexOf(s);
              const color = colorFor(s.evaluatorId);
              const top = (toMinutes(s.startTime) - boundStart) * PX_PER_MIN;
              const height = Math.max(18, (toMinutes(s.endTime) - toMinutes(s.startTime)) * PX_PER_MIN);
              return (
                <button
                  key={idx} type="button" onClick={() => setOpenId(openId === globalId ? null : globalId)}
                  className={`absolute rounded-md border px-1 py-0.5 text-left text-[10px] leading-tight overflow-hidden ${color.bg} ${color.text} ${color.border} hover:z-10 hover:shadow-md transition-shadow`}
                  style={{ top, height, left: `${(col / cols) * 100}%`, width: `${(1 / cols) * 100}%` }}
                  title={`${courseTitles[s.courseId] ?? s.courseId} — ${teacherNames[s.evaluatorId] ?? s.evaluatorId}`}
                >
                  <p className="font-semibold truncate">{courseTitles[s.courseId] ?? s.courseId}</p>
                  <p className="truncate">{teacherNames[s.evaluatorId] ?? s.evaluatorId}</p>
                  {openId === globalId && (
                    <div className="absolute z-20 top-full left-0 mt-1 w-52 bg-white border border-border rounded-lg shadow-lg p-2 text-charcoal normal-case">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-xs">{s.startTime}–{s.endTime}</p>
                        <X className="w-3 h-3 text-gray-400" />
                      </div>
                      <p className="text-[11px] text-gray-500 mb-1">{s.studentIds.length} estudiante{s.studentIds.length !== 1 ? 's' : ''}</p>
                      {s.studentIds.length > 0 && (
                        <ul className="text-[11px] space-y-0.5 max-h-24 overflow-y-auto">
                          {s.studentIds.map((sid) => <li key={sid} className="truncate">{studentNames?.[sid] ?? sid}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
