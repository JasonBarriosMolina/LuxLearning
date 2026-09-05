import { describe, it, expect, vi } from 'vitest';
import { buildOrderSwapSteps, swapOrderSequential } from './reorder';

// Trello DmPpbrff, 2026-09-05 (Mack): "Los botones de subir y bajar ... no
// funcionan" — the old Promise.all 2-way swap always collided with Prisma's
// @@unique([moduleId, order]) constraint.
describe('buildOrderSwapSteps', () => {
  it('produces a 3-step plan: a to temp, b to a\'s old order, a to b\'s old order', () => {
    const steps = buildOrderSwapSteps({ id: 'a', order: 1 }, { id: 'b', order: 2 });
    expect(steps).toEqual([
      { id: 'a', order: -1 },
      { id: 'b', order: 1 },
      { id: 'a', order: 2 },
    ]);
  });

  it('never has both ids at the same order value across the whole sequence', () => {
    const a = { id: 'a', order: 5 };
    const b = { id: 'b', order: 6 };
    const steps = buildOrderSwapSteps(a, b);
    const state: Record<string, number> = { a: a.order, b: b.order };
    for (const step of steps) {
      state[step.id] = step.order;
      const values = Object.values(state);
      expect(new Set(values).size).toBe(values.length); // no two ids share an order
    }
  });

  it('accepts a custom temp order', () => {
    const steps = buildOrderSwapSteps({ id: 'a', order: 1 }, { id: 'b', order: 2 }, -999);
    expect(steps[0]).toEqual({ id: 'a', order: -999 });
  });
});

describe('swapOrderSequential', () => {
  it('calls updateFn once per step, in order, awaiting each before the next', async () => {
    const calls: Array<[string, number]> = [];
    const updateFn = vi.fn(async (id: string, order: number) => {
      calls.push([id, order]);
    });
    await swapOrderSequential(updateFn, { id: 'a', order: 1 }, { id: 'b', order: 2 });
    expect(updateFn).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([['a', -1], ['b', 1], ['a', 2]]);
  });

  it('propagates a rejection instead of silently swallowing it', async () => {
    const updateFn = vi.fn().mockRejectedValueOnce(new Error('boom'));
    await expect(swapOrderSequential(updateFn, { id: 'a', order: 1 }, { id: 'b', order: 2 }))
      .rejects.toThrow('boom');
  });
});
