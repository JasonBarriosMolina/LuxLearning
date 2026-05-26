export interface IcsEvent {
  summary: string;
  dtstart: string;
  description?: string;
}

/**
 * Parse ICS/iCalendar text and extract VEVENT blocks.
 * Returns normalized events with dtstart as YYYY-MM-DD.
 */
export function parseIcsText(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  const blocks = text.split('BEGIN:VEVENT');
  for (const block of blocks.slice(1)) {
    const get = (key: string) => {
      const m = block.match(new RegExp(`${key}[^:]*:([^\\r\\n]+)`));
      return m?.[1]?.trim() ?? '';
    };
    const summary = get('SUMMARY');
    const dtstart = get('DTSTART');
    const description = get('DESCRIPTION');
    if (summary && dtstart) {
      events.push({ summary, dtstart, description: description || undefined });
    }
  }
  return events;
}

/**
 * Normalize a DTSTART value (e.g. "20260601T120000Z" or "20260601") to "YYYY-MM-DD".
 */
export function normalizeDtstart(dtstart: string): string {
  return dtstart.replace(/T.*$/, '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
}
