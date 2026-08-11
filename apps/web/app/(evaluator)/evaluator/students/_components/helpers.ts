import type { ModuleStat, SP } from './types';

export function formatReminderAge(sentAt: string | Date): string {
  const ms = typeof sentAt === 'string' ? new Date(sentAt).getTime() : sentAt.getTime();
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

export function getCurrentModule(modules: ModuleStat[]): ModuleStat | null {
  const sorted = [...modules].sort((a, b) => a.order - b.order);
  for (const mod of sorted) {
    if (mod.completedLessons < mod.totalLessons) return mod;
    if (!mod.quizPassed) return mod;
    if (mod.reflectionStatus === null) return mod;
  }
  return null;
}

export function riskLevel(presenceStatus?: string, overallPct?: number): 'critical' | 'high' | 'medium' | 'low' {
  // Disabled students: no risk classification (managed separately)
  if (presenceStatus === 'disabled') return 'low';
  const inactive = presenceStatus === 'inactive' || presenceStatus === 'never_active';
  const pct = overallPct ?? 0;
  if (inactive && pct < 20) return 'critical';
  if (inactive || pct < 25) return 'high';
  if (pct < 50) return 'medium';
  return 'low';
}

export function formatLastSeen(lastSeen: string | null | undefined, ts: SP): string {
  if (!lastSeen) return ts.lastSeenNever;
  const diff = Date.now() - new Date(lastSeen).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return ts.lastSeenMoment;
  if (mins < 60) return ts.lastSeenMins(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return ts.lastSeenHours(hours);
  const days = Math.floor(hours / 24);
  return ts.lastSeenDays(days);
}
