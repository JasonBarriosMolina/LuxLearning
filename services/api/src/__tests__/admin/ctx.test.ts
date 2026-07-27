import { describe, it, expect } from 'vitest';
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
