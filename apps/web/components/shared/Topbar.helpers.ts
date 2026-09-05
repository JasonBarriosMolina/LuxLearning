// ─── Topbar.helpers.ts ─────────────────────────────────────────────────────────
// Trello DmPpbrff, 2026-09-05 (Mack): "Usa este audio como notificación push and
// pop up ... para la plataforma de lux learning." Web Push notifications can't
// carry a custom sound — every major browser/OS plays its own system sound for
// the Notification API, with no way for a web app to override it (a real
// platform limitation, not something fixable in this codebase). What IS
// buildable: play the sound in-app when a genuinely NEW notification arrives
// while the student/evaluator already has the tab open — this is that logic,
// pure so it's unit-testable without needing a live poll loop or Audio element.

export interface NotifLike { notifId: string; }

/** Notifications in `current` not present in `previousIds` — the ones that
 *  arrived since the last check. Order-independent; a notifId present in both
 *  is never "new" even if its other fields changed (e.g. read status). */
export function findNewNotifIds(previousIds: Set<string>, current: NotifLike[]): string[] {
  return current.filter((n) => !previousIds.has(n.notifId)).map((n) => n.notifId);
}
