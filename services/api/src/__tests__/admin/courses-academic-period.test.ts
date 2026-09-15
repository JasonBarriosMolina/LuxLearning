/**
 * Tests for PUT /admin/courses/:courseId — quick academicPeriod tag update
 * (Trello *LUX SCHEDULER*, Mack 2026-09-10): "es importante que yo tenga la
 * opción, en Gestión de contenido y en cada uno de los cursos creados, de
 * agregarles tags... como a qué semestre pertenece... no necesariamente tengo
 * que ir a editar con Lux Planner y meterme a hacer todos los pasos."
 */
import { describe, it, expect, vi } from 'vitest';
import { makeAdminCtx, makePrisma, makeEvent, bodyOf } from '../helpers/ctx';

vi.mock('../../shared/translate', () => ({
  batchTranslate: vi.fn().mockResolvedValue(new Map()),
  invalidateTranslation: vi.fn().mockResolvedValue(undefined),
}));

import { handleCourses } from '../../admin/courses';

describe('PUT /admin/courses/:courseId — academicPeriod', () => {
  it('updates only academicPeriod without requiring title/slug/description', async () => {
    const updateMock = vi.fn().mockResolvedValue({ id: 'course-1', academicPeriod: 'II Semestre 2026' });
    const upsertMock = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({
      course: { update: updateMock },
      academicPeriod: { upsert: upsertMock },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/courses/course-1'),
      method: 'PUT', path: '/admin/courses/course-1', prisma,
      body: { academicPeriod: 'II Semestre 2026' },
    });

    const res = await handleCourses(ctx as any);
    const body = await bodyOf(res);

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ where: { id: 'course-1' }, data: { academicPeriod: 'II Semestre 2026' } });
    expect(upsertMock).toHaveBeenCalledWith({ where: { name: 'II Semestre 2026' }, update: {}, create: { name: 'II Semestre 2026' } });
    expect(body.data.academicPeriod).toBe('II Semestre 2026');
  });

  it('renames a course via titleOnly without requiring slug/description', async () => {
    const updateMock = vi.fn().mockResolvedValue({ id: 'course-1', title: 'Nuevo Nombre' });
    const prisma = makePrisma({ course: { update: updateMock } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/courses/course-1'),
      method: 'PUT', path: '/admin/courses/course-1', prisma,
      body: { titleOnly: true, title: 'Nuevo Nombre' },
    });

    const res = await handleCourses(ctx as any);
    const body = await bodyOf(res);

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ where: { id: 'course-1' }, data: { title: 'Nuevo Nombre' } });
    expect(body.data.title).toBe('Nuevo Nombre');
  });

  it('rejects titleOnly with an empty title', async () => {
    const prisma = makePrisma({ course: { update: vi.fn() } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/courses/course-1'),
      method: 'PUT', path: '/admin/courses/course-1', prisma,
      body: { titleOnly: true, title: '  ' },
    });
    const res = await handleCourses(ctx as any);
    expect(res.statusCode).toBe(400);
  });

  it('clears academicPeriod when sent as an empty string, without upserting a registry row', async () => {
    const updateMock = vi.fn().mockResolvedValue({ id: 'course-1', academicPeriod: null });
    const upsertMock = vi.fn();
    const prisma = makePrisma({
      course: { update: updateMock },
      academicPeriod: { upsert: upsertMock },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/courses/course-1'),
      method: 'PUT', path: '/admin/courses/course-1', prisma,
      body: { academicPeriod: '' },
    });

    const res = await handleCourses(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ where: { id: 'course-1' }, data: { academicPeriod: null } });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
