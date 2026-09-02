import { describe, it, expect, vi, beforeEach } from 'vitest';

// Trello DmPpbrff, 2026-09-01 01:48 (Mack) — Lux Planner weekly-pacing toggle.

const mockGetReflection = vi.fn();
vi.mock('../../shared/db-reflections', () => ({
  getReflection: (...args: any[]) => mockGetReflection(...args),
}));

import { isModuleUnlocked, isWithinPacingWindow } from '../../shared/db-progress';

describe('isWithinPacingWindow', () => {
  const now = new Date('2026-09-15T12:00:00Z'); // 2 weeks + 1 day after startDate below
  const startDate = new Date('2026-09-01T00:00:00Z');

  it('is always within window when pacing is disabled', () => {
    expect(isWithinPacingWindow({ moduleOrder: 99, weeklyPacingEnabled: false, courseStartDate: startDate, now })).toBe(true);
  });

  it('is always within window when there is no startDate', () => {
    expect(isWithinPacingWindow({ moduleOrder: 99, weeklyPacingEnabled: true, courseStartDate: null, now })).toBe(true);
  });

  it('is always within window when startDate is malformed', () => {
    expect(isWithinPacingWindow({ moduleOrder: 99, weeklyPacingEnabled: true, courseStartDate: 'not-a-date', now })).toBe(true);
  });

  it('allows module 1 on the start date itself (week 1)', () => {
    expect(isWithinPacingWindow({ moduleOrder: 1, weeklyPacingEnabled: true, courseStartDate: startDate, now: startDate })).toBe(true);
  });

  it('blocks module 2 on the start date (still week 1)', () => {
    expect(isWithinPacingWindow({ moduleOrder: 2, weeklyPacingEnabled: true, courseStartDate: startDate, now: startDate })).toBe(false);
  });

  it('allows a module whose order matches the current week', () => {
    // now is 14 days after startDate → currentWeek = 3
    expect(isWithinPacingWindow({ moduleOrder: 3, weeklyPacingEnabled: true, courseStartDate: startDate, now })).toBe(true);
  });

  it('blocks a module whose order is ahead of the current week', () => {
    expect(isWithinPacingWindow({ moduleOrder: 4, weeklyPacingEnabled: true, courseStartDate: startDate, now })).toBe(false);
  });

  it('allows any module whose order is behind the current week (catching up)', () => {
    expect(isWithinPacingWindow({ moduleOrder: 1, weeklyPacingEnabled: true, courseStartDate: startDate, now })).toBe(true);
  });
});

describe('isModuleUnlocked', () => {
  const modules = [
    { id: 'mod-1', order: 1 },
    { id: 'mod-2', order: 2 },
    { id: 'mod-3', order: 3 },
  ];

  beforeEach(() => {
    mockGetReflection.mockReset();
  });

  it('unlocks module 1 without checking reflections', async () => {
    const unlocked = await isModuleUnlocked('user-1', 1, modules);
    expect(unlocked).toBe(true);
    expect(mockGetReflection).not.toHaveBeenCalled();
  });

  it('locks module 2 when module 1 has no approved reflection', async () => {
    mockGetReflection.mockResolvedValue(null);
    const unlocked = await isModuleUnlocked('user-1', 2, modules);
    expect(unlocked).toBe(false);
  });

  it('unlocks module 2 when module 1 is approved and pacing is off', async () => {
    mockGetReflection.mockResolvedValue({ status: 'APPROVED' });
    const unlocked = await isModuleUnlocked('user-1', 2, modules);
    expect(unlocked).toBe(true);
  });

  it('still locks module 2 on pacing grounds even with an approved reflection, if the week has not arrived', async () => {
    mockGetReflection.mockResolvedValue({ status: 'APPROVED' });
    const farFutureModuleOrder = 2;
    const unlocked = await isModuleUnlocked('user-1', farFutureModuleOrder, modules, {
      weeklyPacingEnabled: true,
      courseStartDate: new Date(), // week 1 right now — module 2 needs week 2
    });
    expect(unlocked).toBe(false);
  });

  it('unlocks module 2 with pacing on once both the reflection is approved and the week has arrived', async () => {
    mockGetReflection.mockResolvedValue({ status: 'APPROVED' });
    const twoWeeksAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const unlocked = await isModuleUnlocked('user-1', 2, modules, {
      weeklyPacingEnabled: true,
      courseStartDate: twoWeeksAgo,
    });
    expect(unlocked).toBe(true);
  });

  it('locks module 2 when both the reflection gate and the pacing gate fail', async () => {
    mockGetReflection.mockResolvedValue(null);
    const unlocked = await isModuleUnlocked('user-1', 2, modules, { weeklyPacingEnabled: true, courseStartDate: new Date() });
    expect(unlocked).toBe(false);
  });

  // Trello DmPpbrff, 2026-09-02 (Mack, real repro course): a module whose PREVIOUS
  // module never had a reflection planned was permanently locked forever, because a
  // reflection that can never be submitted can also never become APPROVED.
  describe('reflectionPlannedModuleIds (permanent-lock fix)', () => {
    it('unlocks module 2 without checking getReflection when module 1 never had a reflection planned', async () => {
      const unlocked = await isModuleUnlocked('user-1', 2, modules, {
        reflectionPlannedModuleIds: new Set(['mod-3']), // only module 3 has a reflection planned
      });
      expect(unlocked).toBe(true);
      expect(mockGetReflection).not.toHaveBeenCalled();
    });

    it('still requires an approved reflection when the previous module DOES have one planned', async () => {
      mockGetReflection.mockResolvedValue(null);
      const unlocked = await isModuleUnlocked('user-1', 2, modules, {
        reflectionPlannedModuleIds: new Set(['mod-1']),
      });
      expect(unlocked).toBe(false);
      expect(mockGetReflection).toHaveBeenCalledWith('user-1', 'mod-1');
    });

    it('unlocks once the planned reflection is approved', async () => {
      mockGetReflection.mockResolvedValue({ status: 'APPROVED' });
      const unlocked = await isModuleUnlocked('user-1', 2, modules, {
        reflectionPlannedModuleIds: new Set(['mod-1']),
      });
      expect(unlocked).toBe(true);
    });

    it('accepts a plain string array (not just a Set)', async () => {
      const unlocked = await isModuleUnlocked('user-1', 2, modules, {
        reflectionPlannedModuleIds: ['mod-3'],
      });
      expect(unlocked).toBe(true);
      expect(mockGetReflection).not.toHaveBeenCalled();
    });

    it('falls back to the old conservative behavior (always required) when the option is omitted entirely', async () => {
      mockGetReflection.mockResolvedValue(null);
      const unlocked = await isModuleUnlocked('user-1', 2, modules);
      expect(unlocked).toBe(false);
      expect(mockGetReflection).toHaveBeenCalledWith('user-1', 'mod-1');
    });
  });
});
