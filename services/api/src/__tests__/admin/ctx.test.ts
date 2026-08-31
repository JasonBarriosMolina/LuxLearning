import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isAdmin, isAuthorized } from '../../admin/ctx';

// Pure functions — no AWS calls, no mocking needed.

function makeEvent(role: string) {
  return { requestContext: { authorizer: { lambda: { role } } } } as any;
}

describe('isAdmin', () => {
  it('ADMIN → true',       () => expect(isAdmin(makeEvent('ADMIN'))).toBe(true));
  it('SUPER_ADMIN → true', () => expect(isAdmin(makeEvent('SUPER_ADMIN'))).toBe(true));
  it('EVALUATOR → false',  () => expect(isAdmin(makeEvent('EVALUATOR'))).toBe(false));
  it('STUDENT → false',    () => expect(isAdmin(makeEvent('STUDENT'))).toBe(false));
  it('undefined → false',  () => expect(isAdmin(makeEvent(undefined as any))).toBe(false));
});

describe('isAuthorized', () => {
  it('ADMIN → true',       () => expect(isAuthorized(makeEvent('ADMIN'))).toBe(true));
  it('SUPER_ADMIN → true', () => expect(isAuthorized(makeEvent('SUPER_ADMIN'))).toBe(true));
  it('EVALUATOR → true',   () => expect(isAuthorized(makeEvent('EVALUATOR'))).toBe(true));
  it('STUDENT → false',    () => expect(isAuthorized(makeEvent('STUDENT'))).toBe(false));
  it('undefined → false',  () => expect(isAuthorized(makeEvent(undefined as any))).toBe(false));
});

// sanitizeUserPromptForImage / generateLessonInfographic tests moved to
// ai-image-helpers.test.ts (Trello DmPpbrff item 4: those functions moved out of
// ctx.ts into ai-image-helpers.ts to keep ctx.ts under the size limit).
