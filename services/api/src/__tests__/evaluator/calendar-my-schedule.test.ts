/**
 * Tests for GET /evaluator/my-schedule in evaluator/calendar.ts.
 * Trello *LUX SCHEDULER* (Mack, 2026-09-15): "como evaluador, debe existir...
 * un botón de 'Ver mi horario'... deben verse incluidas las clases y cursos
 * ya asignados. Si el curso aún no se ha creado, debería verse el espacio
 * como 'bloqueado'... 'Pendiente de asignar curso a esta franja horaria'."
 */
import { describe, it, expect } from 'vitest';
import { makeEvalCtx, makePrisma, makeEvent } from '../helpers/ctx';
import { handleCalendar } from '../../evaluator/calendar';

describe('GET /evaluator/my-schedule', () => {
  it('cruza disponibilidad declarada contra clases ya publicadas', async () => {
    const prisma = makePrisma({
      teacherAvailability: { findMany: async () => [
        { evaluatorId: 'eval-uuid', dayOfWeek: 2, startTime: '18:00', endTime: '21:00' },
        { evaluatorId: 'eval-uuid', dayOfWeek: 4, startTime: '19:00', endTime: '22:00' },
      ] },
      scheduledClass: { findMany: async () => [
        { evaluatorId: 'eval-uuid', courseId: 'c1', dayOfWeek: 2, startTime: '18:00', endTime: '18:55', academicPeriod: '2026-2', modality: 'VIRTUAL', classType: 'INDIVIDUAL', studentIds: ['s1'] },
      ] },
      course: { findMany: async () => [{ id: 'c1', title: 'Curso Martes' }] },
    });
    const ctx = makeEvalCtx({ event: makeEvent('EVALUATOR', 'GET', '/evaluator/my-schedule'), method: 'GET', path: '/evaluator/my-schedule', prisma });

    const res = await handleCalendar(ctx as any);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    const tuesday = body.data.items.find((i: any) => i.dayOfWeek === 2);
    expect(tuesday.classes).toHaveLength(1);
    expect(tuesday.classes[0].courseTitle).toBe('Curso Martes');

    // Jueves tiene disponibilidad declarada pero ninguna clase asignada
    // todavía — ese es el "pendiente de asignar curso a esta franja horaria".
    const thursday = body.data.items.find((i: any) => i.dayOfWeek === 4);
    expect(thursday.classes).toHaveLength(0);
  });

  it('hasAvailability es false cuando el evaluador no declaró ningún bloque', async () => {
    const prisma = makePrisma({
      teacherAvailability: { findMany: async () => [] },
      scheduledClass: { findMany: async () => [] },
      course: { findMany: async () => [] },
    });
    const ctx = makeEvalCtx({ event: makeEvent('EVALUATOR', 'GET', '/evaluator/my-schedule'), method: 'GET', path: '/evaluator/my-schedule', prisma });

    const res = await handleCalendar(ctx as any);
    const body = JSON.parse(res.body);
    expect(body.data.hasAvailability).toBe(false);
    expect(body.data.items).toEqual([]);
  });
});
