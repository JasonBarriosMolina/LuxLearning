import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CourseCard } from './CourseCard';

// Trello *LUX SCHEDULER* (Mack, 2026-09-10): "es importante que yo tenga la
// opción, en Gestión de contenido... de agregarles tags... como a qué
// semestre pertenece" — tag rápido de período sin abrir Lux Planner.

const baseProps = {
  regeneratingCourse: null,
  onEdit: vi.fn(), onRegenerate: vi.fn(), onEvalModal: vi.fn(), onPublish: vi.fn(),
  onRestore: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), onStatusChange: vi.fn(),
  t: { admin: { modulesCount: (n: number) => `${n} módulos` }, studentCourses: {} },
};

describe('CourseCard — tag rápido de período', () => {
  it('no muestra el selector de período cuando el padre no pasa onPeriodChange', () => {
    render(<CourseCard {...baseProps} course={{ id: 'c1', title: 'Curso 1', tags: [] }} />);
    expect(screen.queryByTitle('Período académico')).toBeNull();
  });

  it('muestra el período actual y llama a onPeriodChange al elegir otro', () => {
    const onPeriodChange = vi.fn();
    render(
      <CourseCard
        {...baseProps}
        course={{ id: 'c1', title: 'Curso 1', tags: [], academicPeriod: 'I Semestre 2026' }}
        periods={[{ id: 'p1', name: 'I Semestre 2026' }, { id: 'p2', name: 'II Semestre 2026' }]}
        onPeriodChange={onPeriodChange}
      />
    );
    const select = screen.getByTitle('Período académico') as HTMLSelectElement;
    expect(select.value).toBe('I Semestre 2026');

    fireEvent.change(select, { target: { value: 'II Semestre 2026' } });
    expect(onPeriodChange).toHaveBeenCalledWith('c1', 'II Semestre 2026');
  });

  it('incluye el período actual del curso como opción aunque no esté en la lista de periodos conocidos', () => {
    render(
      <CourseCard
        {...baseProps}
        course={{ id: 'c1', title: 'Curso 1', tags: [], academicPeriod: 'Periodo Legacy' }}
        periods={[{ id: 'p1', name: 'I Semestre 2026' }]}
        onPeriodChange={vi.fn()}
      />
    );
    const select = screen.getByTitle('Período académico') as HTMLSelectElement;
    expect(select.value).toBe('Periodo Legacy');
    expect(screen.getByText('Periodo Legacy')).toBeTruthy();
  });
});
