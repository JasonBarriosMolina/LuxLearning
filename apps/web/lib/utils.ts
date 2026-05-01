type ClassValue = string | undefined | null | false;

export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

export function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Formats a course/module/lesson duration string.
 * If the value is a plain number (e.g. "45"), appends the right unit:
 *   < 60  → "45 min"
 *   >= 60 → "1 h 30 min"
 * If it already has text (e.g. "45 min", "2h"), returns as-is.
 */
export function formatCourseDuration(value: string | number | undefined | null): string {
  if (value == null) return '';
  const str = String(value).trim();
  if (!str) return '';
  // If it's a plain integer, apply unit logic
  if (/^\d+$/.test(str)) {
    const n = parseInt(str, 10);
    if (n < 60) return `${n} min`;
    const h = Math.floor(n / 60);
    const m = n % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  return str;
}
