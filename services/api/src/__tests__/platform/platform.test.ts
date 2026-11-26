import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../platform/emails', () => ({
  sendSalesNotification: vi.fn().mockResolvedValue(undefined),
  sendRequesterConfirmation: vi.fn().mockResolvedValue(undefined),
}));

import { parseDemoRequest, handleDemoRequests } from '../../platform/demo-requests';
import { handleLeads } from '../../platform/leads';
import { parseGroups, hasGroup, type PlatformCtx, type Staff } from '../../platform/ctx';
import { sendSalesNotification } from '../../platform/emails';

const VALID = {
  name: 'Ana Morales',
  email: 'Ana@Example.com',
  organization: 'Colegio Central',
  orgType: 'Universidad',
  size: '50 a 200',
};

function makeCtx(over: Partial<PlatformCtx> & { sqlResults?: unknown[][] } = {}): PlatformCtx & { sqlCalls: unknown[] } {
  const results = [...(over.sqlResults ?? [])];
  const sqlCalls: unknown[] = [];
  const sql: any = vi.fn((...args: unknown[]) => {
    sqlCalls.push(args);
    return Promise.resolve(results.shift() ?? []);
  });
  return {
    event: { requestContext: { http: { method: 'POST', sourceIp: '1.2.3.4' } }, headers: {} } as any,
    method: 'POST',
    path: '/public/demo-requests',
    body: {},
    getSql: async () => sql,
    staff: null,
    ...over,
    sqlCalls,
  };
}

const status = (res: any) => res?.statusCode;

describe('parseDemoRequest', () => {
  it('accepts a valid request and normalizes the email', () => {
    const r = parseDemoRequest({ ...VALID, phone: '  ', message: '' });
    expect(r).toEqual({
      ok: true,
      value: { ...VALID, email: 'ana@example.com', phone: null, message: null, source: 'landing' },
    });
  });

  it.each([
    [{ name: 'A' }, 'nombre'],
    [{ email: 'no-es-correo' }, 'correo'],
    [{ organization: '' }, 'institución'],
    [{ orgType: 'Club' }, 'tipo'],
    [{ size: '1 millón' }, 'número'],
    [{ message: 'x'.repeat(2001) }, '2,000'],
  ])('rejects %o', (patch, fragment) => {
    const r = parseDemoRequest({ ...VALID, ...patch });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(fragment);
  });
});

describe('handleDemoRequests', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ignores other routes', async () => {
    expect(await handleDemoRequests(makeCtx({ path: '/hq/leads' }))).toBeNull();
  });

  it('pretends success for honeypot submissions without touching the DB', async () => {
    const ctx = makeCtx({ body: { ...VALID, website: 'http://spam' } });
    expect(status(await handleDemoRequests(ctx))).toBe(201);
    expect(ctx.sqlCalls).toHaveLength(0);
  });

  it('rejects invalid bodies with 400', async () => {
    expect(status(await handleDemoRequests(makeCtx({ body: { ...VALID, email: 'x' } })))).toBe(400);
  });

  it('rate-limits repeated submissions', async () => {
    const ctx = makeCtx({ body: VALID, sqlResults: [[{ by_ip: 5, by_email: 0 }]] });
    expect(status(await handleDemoRequests(ctx))).toBe(400);
    expect(ctx.sqlCalls).toHaveLength(1);
  });

  it('stores the lead and notifies sales', async () => {
    const ctx = makeCtx({ body: VALID, sqlResults: [[{ by_ip: 0, by_email: 0 }], [{ id: 'lead-1' }]] });
    expect(status(await handleDemoRequests(ctx))).toBe(201);
    expect(ctx.sqlCalls).toHaveLength(2);
    expect(sendSalesNotification).toHaveBeenCalledWith(expect.objectContaining({ id: 'lead-1', email: 'ana@example.com' }));
  });

  it('still answers 201 when the notification email fails', async () => {
    vi.mocked(sendSalesNotification).mockRejectedValueOnce(new Error('SES down'));
    const ctx = makeCtx({ body: VALID, sqlResults: [[{ by_ip: 0, by_email: 0 }], [{ id: 'lead-2' }]] });
    expect(status(await handleDemoRequests(ctx))).toBe(201);
  });
});

describe('staff groups', () => {
  it('parses the HTTP API string form of cognito:groups', () => {
    expect(parseGroups('[OWNER MARKETING]')).toEqual(['OWNER', 'MARKETING']);
    expect(parseGroups(['DEV'])).toEqual(['DEV']);
    expect(parseGroups(undefined)).toEqual([]);
  });

  it('lets OWNER through any group check', () => {
    const owner: Staff = { sub: '1', email: 'o@x.com', groups: ['OWNER'] };
    const dev: Staff = { sub: '2', email: 'd@x.com', groups: ['DEV'] };
    expect(hasGroup(owner, 'MARKETING')).toBe(true);
    expect(hasGroup(dev, 'MARKETING')).toBe(false);
    expect(hasGroup(null, 'MARKETING')).toBe(false);
  });
});

describe('handleLeads', () => {
  const dev: Staff = { sub: '2', email: 'd@x.com', groups: ['DEV'] };
  const marketing: Staff = { sub: '3', email: 'm@x.com', groups: ['MARKETING'] };

  it('forbids staff without a sales role', async () => {
    const ctx = makeCtx({ method: 'GET', path: '/hq/leads', staff: dev });
    expect(status(await handleLeads(ctx))).toBe(403);
  });

  it('returns 404 for a malformed lead id without querying', async () => {
    const ctx = makeCtx({ method: 'GET', path: '/hq/leads/not-a-uuid', staff: marketing });
    expect(status(await handleLeads(ctx))).toBe(404);
    expect(ctx.sqlCalls).toHaveLength(0);
  });

  it('rejects an unknown status', async () => {
    const ctx = makeCtx({
      method: 'PATCH',
      path: '/hq/leads/7f2c1b9e-4a3d-4c5e-9f10-123456789abc',
      staff: marketing,
      body: { status: 'MAYBE' },
    });
    expect(status(await handleLeads(ctx))).toBe(400);
  });
});
