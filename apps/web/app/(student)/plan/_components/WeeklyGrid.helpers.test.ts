import { describe, it, expect } from 'vitest';
import { groupItemsByCourse } from './WeeklyGrid.helpers';
import type { PlanItem } from '../types';

function item(over: Partial<PlanItem>): PlanItem {
  return { id: 'x', type: 'lesson', title: 'T', pinned: false, completed: false, source: 'auto', ...over };
}

describe('groupItemsByCourse', () => {
  it('returns an empty array for no items', () => {
    expect(groupItemsByCourse([])).toEqual([]);
  });

  it('groups items with the same courseId together', () => {
    const items = [
      item({ id: '1', courseId: 'c1', courseTitle: 'Curso A' }),
      item({ id: '2', courseId: 'c1', courseTitle: 'Curso A' }),
    ];
    const groups = groupItemsByCourse(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.courseTitle).toBe('Curso A');
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('preserves first-appearance order of courses, not alphabetical', () => {
    const items = [
      item({ id: '1', courseId: 'zzz', courseTitle: 'Curso Z' }),
      item({ id: '2', courseId: 'aaa', courseTitle: 'Curso A' }),
    ];
    const groups = groupItemsByCourse(items);
    expect(groups.map((g) => g.courseTitle)).toEqual(['Curso Z', 'Curso A']);
  });

  it('interleaves back into the correct existing group even if items are not contiguous', () => {
    const items = [
      item({ id: '1', courseId: 'c1', courseTitle: 'Curso A' }),
      item({ id: '2', courseId: 'c2', courseTitle: 'Curso B' }),
      item({ id: '3', courseId: 'c1', courseTitle: 'Curso A' }),
    ];
    const groups = groupItemsByCourse(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['1', '3']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['2']);
  });

  it('puts items with no courseId/courseTitle in one trailing null-key group', () => {
    const items = [
      item({ id: '1', courseId: 'c1', courseTitle: 'Curso A' }),
      item({ id: '2', type: 'custom' }),
      item({ id: '3', type: 'custom' }),
    ];
    const groups = groupItemsByCourse(items);
    expect(groups).toHaveLength(2);
    expect(groups[1]!.courseId).toBeNull();
    expect(groups[1]!.courseTitle).toBeNull();
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['2', '3']);
  });

  it('treats an item with courseId but no courseTitle (legacy plan, generated before this field existed) as ungrouped', () => {
    const items = [item({ id: '1', courseId: 'c1' })];
    const groups = groupItemsByCourse(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.courseId).toBeNull();
  });

  it('omits the trailing null group entirely when every item has a course', () => {
    const items = [item({ id: '1', courseId: 'c1', courseTitle: 'Curso A' })];
    const groups = groupItemsByCourse(items);
    expect(groups.every((g) => g.courseId !== null)).toBe(true);
  });
});
