import { describe, it, expect } from 'vitest';
import { getWeekNumberForDate, isClassDay, suggestNextDueDate, parseLocalDate, toLocalDateStr } from './WeekAwareDatePicker.helpers';

// Trello DmPpbrff, 2026-09-01 14:30 (Mack): week-aware date picker for
// evaluations/tasks/interviews — "S3"/"W3" week labels + colored class days.

describe('getWeekNumberForDate', () => {
  it('returns 1 for the start date itself', () => {
    expect(getWeekNumberForDate('2026-09-07', '2026-09-07')).toBe(1);
  });

  it('returns 1 for the last day of week 1', () => {
    expect(getWeekNumberForDate('2026-09-13', '2026-09-07')).toBe(1);
  });

  it('returns 2 for the first day of week 2', () => {
    expect(getWeekNumberForDate('2026-09-14', '2026-09-07')).toBe(2);
  });

  it('returns null when the date is before the course start date', () => {
    expect(getWeekNumberForDate('2026-09-01', '2026-09-07')).toBeNull();
  });

  it('returns null when either date is missing', () => {
    expect(getWeekNumberForDate(null, '2026-09-07')).toBeNull();
    expect(getWeekNumberForDate('2026-09-07', null)).toBeNull();
    expect(getWeekNumberForDate('2026-09-07', undefined)).toBeNull();
  });

  it('returns null for a malformed date string', () => {
    expect(getWeekNumberForDate('not-a-date', '2026-09-07')).toBeNull();
  });
});

describe('isClassDay', () => {
  it('matches a Monday against ["Lunes"]', () => {
    // 2026-09-07 is a Monday
    expect(isClassDay(new Date(2026, 8, 7), ['Lunes'])).toBe(true);
  });

  it('does not match a day not in classDays', () => {
    expect(isClassDay(new Date(2026, 8, 7), ['Martes', 'Jueves'])).toBe(false);
  });

  it('matches Sunday against ["Domingo"]', () => {
    // 2026-09-13 is a Sunday
    expect(isClassDay(new Date(2026, 8, 13), ['Domingo'])).toBe(true);
  });

  it('returns false when classDays is empty', () => {
    expect(isClassDay(new Date(2026, 8, 7), [])).toBe(false);
  });
});

describe('parseLocalDate / toLocalDateStr round-trip', () => {
  it('round-trips a date string without a timezone shift', () => {
    expect(toLocalDateStr(parseLocalDate('2026-09-07')!)).toBe('2026-09-07');
  });

  it('returns null for an empty/undefined input', () => {
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate(undefined)).toBeNull();
  });
});

describe('suggestNextDueDate — auto-position (Mack: "se posicione... en la semana 3")', () => {
  it('returns empty string when there is no course start date', () => {
    expect(suggestNextDueDate([], null, ['Lunes'])).toBe('');
  });

  it('suggests the first configured class day on/after the course start date when no due dates exist yet', () => {
    // Start date is a Monday (2026-09-07); classDays = Wednesday — first Wed after Monday is 2026-09-09
    const result = suggestNextDueDate([], '2026-09-07', ['Miércoles']);
    expect(result).toBe('2026-09-09');
  });

  it('suggests the next configured class day after the latest existing due date', () => {
    const result = suggestNextDueDate(['2026-09-09'], '2026-09-07', ['Miércoles']);
    expect(result).toBe('2026-09-16'); // next Wednesday, one week later
  });

  it('ignores unparseable existing dates and falls back to the course start date', () => {
    const result = suggestNextDueDate(['', 'not-a-date'], '2026-09-07', ['Miércoles']);
    expect(result).toBe('2026-09-09');
  });

  it('falls back to +7 days from the anchor when no class days are configured (walks forward but any day matches)', () => {
    // With an empty classDays list, isClassDay always returns false in isClassDay itself,
    // but suggestNextDueDate treats "no configured days" as "any day is fine" — so it
    // should land on the very next day, not wait a full week.
    const result = suggestNextDueDate([], '2026-09-07', []);
    expect(result).toBe('2026-09-08');
  });
});
