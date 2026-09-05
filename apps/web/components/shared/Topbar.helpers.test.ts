import { describe, it, expect } from 'vitest';
import { findNewNotifIds } from './Topbar.helpers';

describe('findNewNotifIds', () => {
  it('returns nothing when every current id was already seen', () => {
    const seen = new Set(['a', 'b']);
    expect(findNewNotifIds(seen, [{ notifId: 'a' }, { notifId: 'b' }])).toEqual([]);
  });

  it('returns ids not present in the previously-seen set', () => {
    const seen = new Set(['a']);
    expect(findNewNotifIds(seen, [{ notifId: 'a' }, { notifId: 'b' }, { notifId: 'c' }])).toEqual(['b', 'c']);
  });

  it('returns everything when the seen set is empty', () => {
    expect(findNewNotifIds(new Set(), [{ notifId: 'x' }])).toEqual(['x']);
  });

  it('returns nothing for an empty current list', () => {
    expect(findNewNotifIds(new Set(['a']), [])).toEqual([]);
  });

  it('does not consider a notif "new" just because other fields on it would differ (only notifId matters)', () => {
    const seen = new Set(['a']);
    expect(findNewNotifIds(seen, [{ notifId: 'a' }])).toEqual([]);
  });
});
