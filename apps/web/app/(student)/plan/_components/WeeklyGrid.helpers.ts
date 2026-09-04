// ─── WeeklyGrid.helpers.ts ─────────────────────────────────────────────────────
// Pure logic for grouping a day's plan items by course, extracted for unit testing.
// Trello Nk0XDBvJ, 2026-08-18 (Mack): "resolver la ambigüedad ... donde las
// lecciones, tareas y responsabilidades diarias del estudiante se muestran
// mezcladas sin identificar a qué curso corresponden."
import type { PlanItem } from '../types';

export interface CourseGroup {
  courseId: string | null;
  courseTitle: string | null;
  items: PlanItem[];
}

/** Groups items by courseId, preserving each course's first-appearance order (not
 *  alphabetical — items already arrive pre-sorted by priority/module order, and
 *  re-sorting by course name would scramble that). Items with no courseId/courseTitle
 *  (student-added "custom" items, mainly) land in one trailing group with a null key —
 *  the caller renders that group WITHOUT a course header/divider, since there's no
 *  course to label it with. */
export function groupItemsByCourse(items: PlanItem[]): CourseGroup[] {
  const groups: CourseGroup[] = [];
  const indexByCourse = new Map<string, number>();
  const ungrouped: PlanItem[] = [];

  for (const item of items) {
    if (!item.courseId || !item.courseTitle) {
      ungrouped.push(item);
      continue;
    }
    let idx = indexByCourse.get(item.courseId);
    if (idx === undefined) {
      idx = groups.length;
      indexByCourse.set(item.courseId, idx);
      groups.push({ courseId: item.courseId, courseTitle: item.courseTitle, items: [] });
    }
    groups[idx]!.items.push(item);
  }

  if (ungrouped.length > 0) groups.push({ courseId: null, courseTitle: null, items: ungrouped });
  return groups;
}
