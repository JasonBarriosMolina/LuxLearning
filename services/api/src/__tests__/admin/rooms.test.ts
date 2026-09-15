/**
 * Tests for admin/rooms.ts — aulas y edificios (Trello *LUX SCHEDULER*, Mack
 * 2026-09-15, 15:36): "la institución puede agregar aulas, puede agregar
 * edificios... aulas divididas por piso... nombre preferencial... aforo...
 * descripción de qué tipo de cursos se pueden dar."
 */
import { describe, it, expect, vi } from 'vitest';
import { makeAdminCtx, makePrisma, makeEvent, bodyOf } from '../helpers/ctx';
import { handleRooms } from '../../admin/rooms';

describe('GET /admin/scheduler/buildings', () => {
  it('lists buildings ordered by name', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'b1', name: 'Edificio A' }]);
    const prisma = makePrisma({ building: { findMany } });
    const ctx = makeAdminCtx({ event: makeEvent('ADMIN', 'GET', '/admin/scheduler/buildings'), method: 'GET', path: '/admin/scheduler/buildings', prisma });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });
});

describe('POST /admin/scheduler/buildings', () => {
  it('creates a building', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'b1', name: 'Edificio A' });
    const prisma = makePrisma({ building: { create } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/buildings'),
      method: 'POST', path: '/admin/scheduler/buildings', prisma, body: { name: 'Edificio A' },
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith({ data: { name: 'Edificio A' } });
  });

  it('rejects an empty name', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/buildings'),
      method: 'POST', path: '/admin/scheduler/buildings', body: { name: '  ' },
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(400);
  });

  it('403 for EVALUATOR', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR', 'POST', '/admin/scheduler/buildings'),
      method: 'POST', path: '/admin/scheduler/buildings', body: { name: 'Edificio A' },
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(403);
  });

  it('400 on duplicate building name', async () => {
    const create = vi.fn().mockRejectedValue(new Error('unique constraint'));
    const prisma = makePrisma({ building: { create } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/buildings'),
      method: 'POST', path: '/admin/scheduler/buildings', prisma, body: { name: 'Edificio A' },
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /admin/scheduler/buildings/:id', () => {
  it('un-links rooms from the building instead of cascading delete', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const del = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({ classRoom: { updateMany }, building: { delete: del } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'DELETE', '/admin/scheduler/buildings/b1'),
      method: 'DELETE', path: '/admin/scheduler/buildings/b1', prisma,
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({ where: { buildingId: 'b1' }, data: { buildingId: null } });
    expect(del).toHaveBeenCalledWith({ where: { id: 'b1' } });
  });
});

describe('POST /admin/scheduler/rooms', () => {
  it('creates a room with building/floor/preferredName/courseTypeTags', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'r1' });
    const prisma = makePrisma({ classRoom: { create } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/rooms'),
      method: 'POST', path: '/admin/scheduler/rooms', prisma,
      body: { name: '101', capacity: 10, buildingId: 'b1', floor: 1, preferredName: 'Salón de ensayos', courseTypeTags: ['TEORICO', 'INVENTADO'] },
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith({
      data: { name: '101', capacity: 10, buildingId: 'b1', floor: 1, preferredName: 'Salón de ensayos', courseTypeTags: ['TEORICO'] },
    });
  });

  it('rejects capacity <= 0', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/rooms'),
      method: 'POST', path: '/admin/scheduler/rooms', body: { name: '101', capacity: 0 },
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty name', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/rooms'),
      method: 'POST', path: '/admin/scheduler/rooms', body: { name: '  ', capacity: 5 },
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /admin/scheduler/rooms/:id', () => {
  it('updates only the fields sent', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'r1', preferredName: 'Salón de ensayos' });
    const prisma = makePrisma({ classRoom: { update } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/scheduler/rooms/r1'),
      method: 'PUT', path: '/admin/scheduler/rooms/r1', prisma, body: { preferredName: 'Salón de ensayos' },
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { preferredName: 'Salón de ensayos' } });
  });

  it('404 when the room does not exist', async () => {
    const update = vi.fn().mockRejectedValue(new Error('not found'));
    const prisma = makePrisma({ classRoom: { update } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/scheduler/rooms/ghost'),
      method: 'PUT', path: '/admin/scheduler/rooms/ghost', prisma, body: { capacity: 10 },
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /admin/scheduler/rooms/:id', () => {
  it('refuses to delete a room in use by a published class', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const prisma = makePrisma({ scheduledClass: { count } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'DELETE', '/admin/scheduler/rooms/r1'),
      method: 'DELETE', path: '/admin/scheduler/rooms/r1', prisma,
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(400);
  });

  it('deletes a room not in use', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const del = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({ scheduledClass: { count }, classRoom: { delete: del } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'DELETE', '/admin/scheduler/rooms/r1'),
      method: 'DELETE', path: '/admin/scheduler/rooms/r1', prisma,
    });
    const res = await handleRooms(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(del).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });
});

describe('handleRooms — unrelated routes', () => {
  it('returns null', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/courses' });
    const res = await handleRooms(ctx as any);
    expect(res).toBeNull();
  });
});
