/**
 * Tests for admin/profile.ts — GET/PUT /user/profile, en particular el flag
 * studentModality (Trello *LUX SCHEDULER*, Mack 2026-09-15): "en el perfil de
 * los estudiantes, que se diga si es un estudiante virtual, un estudiante
 * presencial, o un estudiante híbrido."
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEvent, bodyOf } from '../helpers/ctx';

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return { send: vi.fn() }; },
  AdminGetUserCommand: function (x: any) { return x; },
  AdminUpdateUserAttributesCommand: function (x: any) { return x; },
}));

vi.mock('../../shared/db-dynamo', () => ({
  getUserProfile: vi.fn().mockResolvedValue(null),
  saveUserProfile: vi.fn().mockResolvedValue(undefined),
}));

import { handleProfile } from '../../admin/profile';
import { cognito } from '../../admin/ctx';
import { getUserProfile, saveUserProfile } from '../../shared/db-dynamo';

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    event: makeEvent('STUDENT', 'GET', '/user/profile'),
    method: 'GET', path: '/user/profile', prisma: {} as any, body: {}, action: undefined, userId: 'user-uuid',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (cognito.send as any).mockResolvedValue({ UserAttributes: [{ Name: 'name', Value: 'Ana' }, { Name: 'email', Value: 'ana@test.com' }] });
  (getUserProfile as any).mockResolvedValue(null);
});

describe('GET /user/profile', () => {
  it('includes studentModality from the extended DDB profile', async () => {
    (getUserProfile as any).mockResolvedValue({ userId: 'user-uuid', studentModality: 'HIBRIDA' });
    const ctx = makeCtx();
    const res = await handleProfile(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(body.data.studentModality).toBe('HIBRIDA');
  });

  it('returns null studentModality when no extended profile exists yet', async () => {
    const ctx = makeCtx();
    const res = await handleProfile(ctx as any);
    const body = await bodyOf(res);
    expect(body.data.studentModality).toBeNull();
  });

  it('403 when unauthenticated', async () => {
    const ctx = makeCtx({ event: { requestContext: {} } });
    const res = await handleProfile(ctx as any);
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /user/profile — studentModality', () => {
  it('saves a valid studentModality via the DDB helper', async () => {
    const ctx = makeCtx({ event: makeEvent('STUDENT', 'PUT', '/user/profile'), method: 'PUT', body: { studentModality: 'VIRTUAL' } });
    const res = await handleProfile(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(saveUserProfile).toHaveBeenCalledWith('user-uuid', { studentModality: 'VIRTUAL' });
  });

  it('a studentModality-only update does not require any Cognito field', async () => {
    const ctx = makeCtx({ event: makeEvent('STUDENT', 'PUT', '/user/profile'), method: 'PUT', body: { studentModality: 'PRESENCIAL' } });
    const res = await handleProfile(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(cognito.send).not.toHaveBeenCalled();
  });

  it('clears studentModality when sent as an empty string', async () => {
    const ctx = makeCtx({ event: makeEvent('STUDENT', 'PUT', '/user/profile'), method: 'PUT', body: { studentModality: '' } });
    const res = await handleProfile(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(saveUserProfile).toHaveBeenCalledWith('user-uuid', { studentModality: undefined });
  });

  it('rejects an invalid studentModality value', async () => {
    const ctx = makeCtx({ event: makeEvent('STUDENT', 'PUT', '/user/profile'), method: 'PUT', body: { studentModality: 'TELETRANSPORTE' } });
    const res = await handleProfile(ctx as any);
    expect(res.statusCode).toBe(400);
    expect(saveUserProfile).not.toHaveBeenCalled();
  });

  it('still updates Cognito fields normally when studentModality is absent', async () => {
    const ctx = makeCtx({ event: makeEvent('STUDENT', 'PUT', '/user/profile'), method: 'PUT', body: { name: 'Nuevo Nombre' } });
    const res = await handleProfile(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(cognito.send).toHaveBeenCalled();
    expect(saveUserProfile).not.toHaveBeenCalled();
  });
});
