import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepReview } from './StepReview';
import type { GenerateResult } from './types';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "solo se ve una lista de cosas
// del sábado... no se entiende bien" — las sesiones ahora se agrupan por día
// en vez de una sola tabla plana mezclando todos los días.

vi.mock('@/lib/api', () => ({
  api: { admin: { scheduler: { validate: vi.fn(), approve: vi.fn() } } },
}));

const result: GenerateResult = {
  proposals: [{
    label: 'Opción 1',
    strategy: 'balanced',
    sessions: [
      { courseId: 'c1', evaluatorId: 'e1', dayOfWeek: 6, startTime: '08:00', endTime: '09:15', studentIds: ['s1'], modality: 'PRESENCIAL', classType: 'GRUPAL' },
      { courseId: 'c2', evaluatorId: 'e1', dayOfWeek: 2, startTime: '18:00', endTime: '18:55', studentIds: [], modality: 'VIRTUAL', classType: 'INDIVIDUAL' },
      { courseId: 'c3', evaluatorId: 'e2', dayOfWeek: 6, startTime: '10:00', endTime: '11:15', studentIds: ['s2', 's3'], modality: 'PRESENCIAL', classType: 'GRUPAL' },
    ],
    unscheduledCourseIds: [],
  }],
  courseTitles: { c1: 'Curso Sábado 1', c2: 'Curso Martes', c3: 'Curso Sábado 2' },
  teacherNames: { e1: 'Profe Uno', e2: 'Profe Dos' },
  academicPeriod: '2026-2',
  skippedAsyncCourseIds: [],
};

describe('StepReview — agrupación por día', () => {
  it('agrupa las sesiones bajo un encabezado por día, en vez de una tabla plana', () => {
    render(<StepReview result={result} academicPeriod="2026-2" lunchBreak={{ startTime: '12:00', endTime: '13:00' }} onApproved={vi.fn()} />);

    expect(screen.getByText('Sábado · 2 clases')).toBeTruthy();
    expect(screen.getByText('Martes · 1 clase')).toBeTruthy();
    // Aparece dos veces: en la tabla agrupada por día y en el calendario visual.
    expect(screen.getAllByText('Curso Sábado 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Curso Martes').length).toBeGreaterThan(0);
  });

  it('no muestra un encabezado para días sin clases', () => {
    render(<StepReview result={result} academicPeriod="2026-2" lunchBreak={{ startTime: '12:00', endTime: '13:00' }} onApproved={vi.fn()} />);
    expect(screen.queryByText(/Domingo ·/)).toBeNull();
    expect(screen.queryByText(/Lunes ·/)).toBeNull();
  });
});
