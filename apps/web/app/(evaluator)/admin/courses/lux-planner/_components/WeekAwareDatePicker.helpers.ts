// ─── WeekAwareDatePicker.helpers.ts ───────────────────────────────────────────
// Pure logic for the week-aware date picker, extracted for unit testing.
// Trello DmPpbrff, 2026-09-01 14:30 (Mack): "el calendario plano no me funciona
// tanto porque no puedo ver cuándo son las lecciones ni en qué semana estamos...
// se pueda verificar a la izquierda cuál semana es, con la letra S y el número
// de semana (en inglés con W y el número de semana), y que además aparezca en
// colores las fechas o los días de la semana que ese curso se brinda."

const DAYS_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** Parses a 'YYYY-MM-DD' string as a local date (no timezone shift), or null. */
export function parseLocalDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 1-indexed week number for `date`, anchored to `courseStartDate` (week 1 =
 *  the 7 days starting on the start date). Returns null when either date is
 *  missing/invalid, or `date` falls before the start date. */
export function getWeekNumberForDate(dateStr: string | null | undefined, courseStartDateStr: string | null | undefined): number | null {
  const date = parseLocalDate(dateStr);
  const start = parseLocalDate(courseStartDateStr);
  if (!date || !start) return null;
  const diffDays = Math.floor((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return null;
  return Math.floor(diffDays / 7) + 1;
}

/** True when `date` falls on one of the course's configured class days
 *  (Spanish day names, e.g. ['Lunes','Miércoles']). JS getDay() is 0=Sunday. */
export function isClassDay(date: Date, classDays: string[]): boolean {
  if (!classDays || classDays.length === 0) return false;
  const idx = (date.getDay() + 6) % 7; // 0=Monday .. 6=Sunday, matches DAYS_ES order
  const name = DAYS_ES[idx];
  return classDays.includes(name!);
}

/** Auto-position (Trello DmPpbrff, 2026-09-01 14:30 — Mack): a newly-added
 *  due-date slot should default to a sensible date instead of blank — the next
 *  configured class day after the last already-set due date (or after the
 *  course start date if none are set yet). Returns '' when there's not enough
 *  info to compute one (no course start date). */
export function suggestNextDueDate(existingDates: string[], courseStartDateStr: string | null | undefined, classDays: string[]): string {
  const start = parseLocalDate(courseStartDateStr);
  if (!start) return '';

  const validExisting = existingDates.map(parseLocalDate).filter((d): d is Date => d !== null);
  const anchor = validExisting.length > 0
    ? new Date(Math.max(...validExisting.map((d) => d.getTime())))
    : start;

  // Walk forward from the day after the anchor, up to 14 days, looking for a
  // configured class day. Falls back to anchor+7 (one week later) if none of
  // the configured days match within that window (e.g. classDays empty).
  const cursor = new Date(anchor);
  for (let i = 0; i < 14; i++) {
    cursor.setDate(cursor.getDate() + 1);
    if (classDays.length === 0 || isClassDay(cursor, classDays)) {
      return toLocalDateStr(cursor);
    }
  }
  const fallback = new Date(anchor);
  fallback.setDate(fallback.getDate() + 7);
  return toLocalDateStr(fallback);
}
