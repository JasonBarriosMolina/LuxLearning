/**
 * Tests for admin/users.ts — specifically the bulk-import route added in refactor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAdminCtx, makePrisma, makeEvent, bodyOf } from '../helpers/ctx';

// ── Mock external deps ────────────────────────────────────────────────────────

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient:  function() { return { send: vi.fn() }; },
  ListUsersCommand:               function(x: any) { return x; },
  ListUsersInGroupCommand:        function(x: any) { return x; },
  AdminCreateUserCommand:         function(x: any) { return x; },
  AdminAddUserToGroupCommand:     function(x: any) { return x; },
  AdminRemoveUserFromGroupCommand: function(x: any) { return x; },
  AdminDisableUserCommand:        function(x: any) { return x; },
  AdminEnableUserCommand:         function(x: any) { return x; },
  AdminDeleteUserCommand:         function(x: any) { return x; },
  AdminGetUserCommand:            function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient:        function() { return { send: vi.fn().mockResolvedValue({}) }; },
  SendEmailCommand: function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: function() { return { send: vi.fn() }; },
}));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function() { return { send: vi.fn() }; },
  InvokeModelCommand:   function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient:             function() { return { send: vi.fn() }; },
  SynthesizeSpeechCommand: function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient:  function() { return { send: vi.fn() }; },
  InvokeCommand: function(x: any) { return x; },
}));

vi.mock('../../shared/db-dynamo', () => ({
  createEnrollment:   vi.fn().mockResolvedValue(undefined),
  getEnrollments:     vi.fn().mockResolvedValue([]),
  deleteEnrollment:   vi.fn().mockResolvedValue(undefined),
  createTask:         vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/db-messages', () => ({
  upsertChat:       vi.fn().mockResolvedValue(undefined),
  upsertMembership: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/email', () => ({
  sendTemplatedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { handleUsers } from '../../admin/users';

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/users/bulk-import', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for EVALUATOR (admin only)', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR'),
      method: 'POST', path: '/admin/users/bulk-import',
      body: { csv: 'email\nalice@test.com' },
    });
    const res = await handleUsers(ctx);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 400 when csv is missing', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/users/bulk-import', body: {} });
    const res = await handleUsers(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 for invalid role', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/users/bulk-import',
      body: { csv: 'alice@test.com', role: 'HACKER' },
    });
    const res = await handleUsers(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when csv has no data rows (header only)', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/users/bulk-import',
      body: { csv: 'email,name' },
    });
    const res = await handleUsers(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when csv has > 100 rows', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => `user${i}@test.com`).join('\n');
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/users/bulk-import',
      body: { csv: rows },
    });
    const res = await handleUsers(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('creates users from valid CSV and returns summary', async () => {
    // Mock Cognito to return a created user
    const prisma = makePrisma({ course: { findMany: vi.fn().mockResolvedValue([]) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/users/bulk-import',
      prisma,
      body: { csv: 'email,name\nalice@test.com,Alice' },
    });
    const res = await handleUsers(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('total');
    expect(body.data).toHaveProperty('created');
    expect(body.data).toHaveProperty('errors');
  });

  it('flags invalid email rows as error, does not throw', async () => {
    const prisma = makePrisma({ course: { findMany: vi.fn().mockResolvedValue([]) } });
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/users/bulk-import',
      prisma,
      body: { csv: 'not-an-email' },
    });
    const res = await handleUsers(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.errors.length).toBe(1);
    expect(body.data.created).toBe(0);
  });

  it('SUPER_ADMIN can also bulk-import', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('SUPER_ADMIN'),
      method: 'POST', path: '/admin/users/bulk-import',
      body: { csv: 'not-an-email' }, // minimal valid call — just checking auth
    });
    const res = await handleUsers(ctx);
    expect(res?.statusCode).not.toBe(403);
  });

  it('returns null for unrelated routes', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/courses' });
    const res = await handleUsers(ctx);
    expect(res).toBeNull();
  });
});
