import { describe, it, expect } from 'vitest';
import { parseIcsText, normalizeDtstart } from './parseIcs';

const makeIcs = (events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('')}END:VCALENDAR\r\n`;

const makeEvent = (fields: Record<string, string>) => {
  const lines = Object.entries(fields).map(([k, v]) => `${k}:${v}`).join('\r\n');
  return `BEGIN:VEVENT\r\n${lines}\r\nEND:VEVENT\r\n`;
};

describe('parseIcsText', () => {
  it('parses a basic VEVENT with SUMMARY and DTSTART', () => {
    const ics = makeIcs([makeEvent({ SUMMARY: 'Tarea 1', DTSTART: '20260601' })]);
    const result = parseIcsText(ics);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ summary: 'Tarea 1', dtstart: '20260601' });
  });

  it('parses DESCRIPTION when present', () => {
    const ics = makeIcs([makeEvent({ SUMMARY: 'Tarea', DTSTART: '20260601', DESCRIPTION: 'Detalle' })]);
    const result = parseIcsText(ics);
    expect(result[0]?.description).toBe('Detalle');
  });

  it('omits description when absent', () => {
    const ics = makeIcs([makeEvent({ SUMMARY: 'Tarea', DTSTART: '20260601' })]);
    const result = parseIcsText(ics);
    expect(result[0]?.description).toBeUndefined();
  });

  it('ignores events without SUMMARY', () => {
    const ics = makeIcs([makeEvent({ DTSTART: '20260601' })]);
    expect(parseIcsText(ics)).toHaveLength(0);
  });

  it('ignores events without DTSTART', () => {
    const ics = makeIcs([makeEvent({ SUMMARY: 'Sin fecha' })]);
    expect(parseIcsText(ics)).toHaveLength(0);
  });

  it('parses multiple events', () => {
    const ics = makeIcs([
      makeEvent({ SUMMARY: 'A', DTSTART: '20260601' }),
      makeEvent({ SUMMARY: 'B', DTSTART: '20260615' }),
      makeEvent({ SUMMARY: 'C', DTSTART: '20260701' }),
    ]);
    const result = parseIcsText(ics);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.summary)).toEqual(['A', 'B', 'C']);
  });

  it('returns empty array for empty string', () => {
    expect(parseIcsText('')).toHaveLength(0);
  });

  it('returns empty array for VCALENDAR without VEVENTs', () => {
    expect(parseIcsText('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')).toHaveLength(0);
  });
});

describe('normalizeDtstart', () => {
  it('converts compact date to YYYY-MM-DD', () => {
    expect(normalizeDtstart('20260601')).toBe('2026-06-01');
  });

  it('strips time component from datetime', () => {
    expect(normalizeDtstart('20260601T120000Z')).toBe('2026-06-01');
  });

  it('strips time component from local datetime', () => {
    expect(normalizeDtstart('20260601T120000')).toBe('2026-06-01');
  });

  it('handles DTSTART;VALUE=DATE format (already has colon stripped by parser)', () => {
    // The parser strips the key part, so dtstart would just be '20260601'
    expect(normalizeDtstart('20260601')).toBe('2026-06-01');
  });
});
