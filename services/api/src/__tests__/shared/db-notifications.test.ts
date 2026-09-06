import { describe, it, expect, vi } from 'vitest';

const mockDdbSend = vi.fn();
vi.mock('../../shared/db-core', () => ({
  ddb: { send: (...args: any[]) => mockDdbSend(...args) },
  TABLES: { NOTIFS: 'Notifications' },
}));

import { getNotifications } from '../../shared/db-notifications';

// Trello DmPpbrff, 2026-09-06 (Mack): "la notificación... tiene que venir en orden
// cronológico." getNotifications relied on ScanIndexForward:false, which orders by the
// DynamoDB sort key (notifId) — but notifId formats are inconsistent across the codebase
// (bare createId() cuids with no time ordering, `prefix-${Date.now()}`, `prefix-${createId()}`),
// so query-order was frequently NOT chronological. Fix: sort explicitly by createdAt.
describe('getNotifications', () => {
  it('returns notifications newest-first by createdAt, regardless of DynamoDB item order', () => {
    // Deliberately returned out of chronological order, as DynamoDB would if sorted by
    // a non-time-ordered notifId sort key.
    mockDdbSend.mockResolvedValue({
      Items: [
        { userId: 'u1', sk: 'a', notifId: 'a', createdAt: '2026-09-06T10:00:00.000Z', message: 'middle' },
        { userId: 'u1', sk: 'zzz-later', notifId: 'zzz-later', createdAt: '2026-09-06T12:00:00.000Z', message: 'newest' },
        { userId: 'u1', sk: 'aaa-earlier', notifId: 'aaa-earlier', createdAt: '2026-09-06T08:00:00.000Z', message: 'oldest' },
      ],
    });

    return getNotifications('u1').then((result) => {
      expect(result.map((n) => n.message)).toEqual(['newest', 'middle', 'oldest']);
    });
  });

  it('returns an empty array when the query has no items', async () => {
    mockDdbSend.mockResolvedValue({ Items: undefined });
    expect(await getNotifications('u1')).toEqual([]);
  });

  it('does not throw when an item is missing createdAt (defensive — treated as oldest)', async () => {
    mockDdbSend.mockResolvedValue({
      Items: [
        { userId: 'u1', sk: 'a', notifId: 'a', createdAt: '2026-09-06T10:00:00.000Z', message: 'has-date' },
        { userId: 'u1', sk: 'b', notifId: 'b', message: 'no-date' },
      ],
    });
    const result = await getNotifications('u1');
    expect(result.map((n) => n.message)).toEqual(['has-date', 'no-date']);
  });
});
