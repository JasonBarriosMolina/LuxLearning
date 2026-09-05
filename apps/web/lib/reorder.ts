// ─── reorder.ts ────────────────────────────────────────────────────────────────
// Trello DmPpbrff, 2026-09-05 (Mack): "Los botones de subir y bajar ... no
// funcionan." Root cause: swapping two siblings' `order` via two PARALLEL PUT
// requests (Promise.all) always loses the race against Prisma's
// @@unique([moduleId, order]) / @@unique([courseId, order]) constraint on
// Module/Lesson — whichever of the two UPDATEs commits first finds the other
// row still holding the order value it's trying to claim, and gets rejected
// with a unique-constraint violation. A genuine two-item swap has no ordering
// of two independent UPDATEs that avoids this; it needs a third, sequential
// step through a temporary value neither sibling can naturally hold.

export interface OrderedItem { id: string; order: number; }
export interface OrderSwapStep { id: string; order: number; }

/** The 3-step sequential plan to exchange `a` and `b`'s order values without ever
 *  having both hold the same order at once. `tempOrder` just needs to be a value
 *  no real sibling ever has — real `order` columns in this codebase start at 1,
 *  so a negative number is always safe. */
export function buildOrderSwapSteps(a: OrderedItem, b: OrderedItem, tempOrder = -1): OrderSwapStep[] {
  return [
    { id: a.id, order: tempOrder },
    { id: b.id, order: a.order },
    { id: a.id, order: b.order },
  ];
}

/** Runs the swap steps one at a time (never Promise.all — see the module doc
 *  comment above for why concurrent execution is exactly the bug). */
export async function swapOrderSequential(
  updateFn: (id: string, order: number) => Promise<unknown>,
  a: OrderedItem,
  b: OrderedItem,
): Promise<void> {
  for (const step of buildOrderSwapSteps(a, b)) {
    await updateFn(step.id, step.order);
  }
}
