import { describe, it, expect, vi } from 'vitest';
import { makeAdminCtx, makePrisma, makeEvent, bodyOf } from '../helpers/ctx';
import { handleGroups } from '../../admin/groups';

// Trello DmPpbrff, 2026-09-07 (Mack): "se puedan crear grupos base donde estén
// asignados a semestres específicos, que estos estén interconectados a cuando
// Lux Planner crea cursos" — academicPeriod reuses the same AcademicPeriod
// reusable-dropdown model LuxPlanner's Step1 upserts into (ai-wizard.ts).
describe('POST /admin/groups — academicPeriod', () => {
  it('creates a group with the given academicPeriod and upserts it into the shared dropdown', async () => {
    const upsert = vi.fn().mockResolvedValue({ name: '2026-1' });
    const create = vi.fn().mockResolvedValue({ id: 'g1', name: 'IIS 2026', academicPeriod: '2026-1' });
    const prisma = makePrisma({ studentGroup: { create }, academicPeriod: { upsert } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/groups'),
      method: 'POST', path: '/admin/groups', prisma,
      body: { name: 'IIS 2026', academicPeriod: '2026-1' },
    });
    const res = await handleGroups(ctx);
    expect(res?.statusCode).toBe(200);
    expect(upsert).toHaveBeenCalledWith({ where: { name: '2026-1' }, update: {}, create: { name: '2026-1' } });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'IIS 2026', academicPeriod: '2026-1' }) });
  });

  it('creates a group with no academicPeriod (optional field) — stored as null, no dropdown upsert', async () => {
    const upsert = vi.fn();
    const create = vi.fn().mockResolvedValue({ id: 'g2', name: 'Sin período' });
    const prisma = makePrisma({ studentGroup: { create }, academicPeriod: { upsert } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/groups'),
      method: 'POST', path: '/admin/groups', prisma,
      body: { name: 'Sin período' },
    });
    const res = await handleGroups(ctx);
    expect(res?.statusCode).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ academicPeriod: null }) });
  });
});

describe('PUT /admin/groups/:id — academicPeriod', () => {
  it('updates academicPeriod when provided', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'g1', academicPeriod: '2026-2' });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({ studentGroup: { update }, academicPeriod: { upsert } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/groups/g1'),
      method: 'PUT', path: '/admin/groups/g1', prisma,
      body: { name: 'IIS 2026', academicPeriod: '2026-2' },
    });
    const res = await handleGroups(ctx);
    expect(res?.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: expect.objectContaining({ academicPeriod: '2026-2' }) });
  });

  it('leaves academicPeriod untouched when the field is omitted entirely from the request', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'g1' });
    const prisma = makePrisma({ studentGroup: { update } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/groups/g1'),
      method: 'PUT', path: '/admin/groups/g1', prisma,
      body: { name: 'IIS 2026' }, // no academicPeriod key at all
    });
    const res = await handleGroups(ctx);
    expect(res?.statusCode).toBe(200);
    const dataArg = update.mock.calls[0][0].data;
    expect('academicPeriod' in dataArg).toBe(false);
  });
});
