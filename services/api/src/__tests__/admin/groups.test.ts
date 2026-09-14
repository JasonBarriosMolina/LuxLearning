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

// Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "no me está cargando los períodos
// que se mencionan directamente desde los cursos... ese período debe
// automáticamente estar disponible" — the registry only ever gets a name from
// an explicit upsert; a course/group whose academicPeriod was set any other way
// never showed up. GET now unions the registry with actual distinct values.
describe('GET /admin/periods — union with actual Course/StudentGroup values', () => {
  it('includes a period only present on a Course, not yet in the registry', async () => {
    const prisma = makePrisma({
      academicPeriod: { findMany: vi.fn().mockResolvedValue([{ id: 'p1', name: '2026-1' }]) },
      course: { findMany: vi.fn().mockResolvedValue([{ academicPeriod: '2026-1' }, { academicPeriod: 'Segundo Semestre 2026' }]) },
      studentGroup: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const ctx = makeAdminCtx({ event: makeEvent('ADMIN', 'GET', '/admin/periods'), method: 'GET', path: '/admin/periods', prisma });
    const res = await handleGroups(ctx);
    const body = await bodyOf(res);
    const names = body.data.map((p: any) => p.name);
    expect(names).toContain('2026-1');
    expect(names).toContain('Segundo Semestre 2026'); // was missing before the fix
    expect(names).toHaveLength(2); // no duplicate for '2026-1'
  });

  it('dedupes a period that appears on both a Course and a StudentGroup', async () => {
    const prisma = makePrisma({
      academicPeriod: { findMany: vi.fn().mockResolvedValue([]) },
      course: { findMany: vi.fn().mockResolvedValue([{ academicPeriod: 'Verano 2026' }]) },
      studentGroup: { findMany: vi.fn().mockResolvedValue([{ academicPeriod: 'Verano 2026' }]) },
    });
    const ctx = makeAdminCtx({ event: makeEvent('ADMIN', 'GET', '/admin/periods'), method: 'GET', path: '/admin/periods', prisma });
    const res = await handleGroups(ctx);
    const body = await bodyOf(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('Verano 2026');
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
