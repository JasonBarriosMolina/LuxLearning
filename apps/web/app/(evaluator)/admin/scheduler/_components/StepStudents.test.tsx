import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepStudents } from './StepStudents';

// Trello *LUX SCHEDULER* (Mack, 2026-09-10 y 2026-09-15): agregar estudiantes
// individuales o grupos base por curso; multi-selección en vez de uno a uno;
// quitar un estudiante ya matriculado; nunca reinscribir al mismo estudiante
// dos veces en el mismo curso.

const addEnrollmentMock = vi.fn().mockResolvedValue({});
const removeEnrollmentMock = vi.fn().mockResolvedValue({});
const groupsMembersMock = vi.fn().mockResolvedValue({ data: [{ userId: 's1', name: 'Estudiante Uno' }, { userId: 's2', name: 'Estudiante Dos' }] });
vi.mock('@/lib/api', () => ({
  api: {
    admin: { users: { addEnrollment: (...a: any[]) => addEnrollmentMock(...a), removeEnrollment: (...a: any[]) => removeEnrollmentMock(...a) } },
    evaluator: {
      groups: {
        studentPool: vi.fn().mockResolvedValue({ data: [
          { userId: 's1', name: 'Estudiante Uno' }, { userId: 's2', name: 'Estudiante Dos' }, { userId: 's3', name: 'Estudiante Tres' },
        ] }),
        list: vi.fn().mockResolvedValue({ data: [{ id: 'g1', name: 'Grupo A', memberCount: 2 }] }),
        members: (...a: any[]) => groupsMembersMock(...a),
      },
    },
  },
}));

const studentNames = { s1: 'Estudiante Uno', s2: 'Estudiante Dos', s3: 'Estudiante Tres' };

beforeEach(() => { addEnrollmentMock.mockClear(); removeEnrollmentMock.mockClear(); groupsMembersMock.mockClear(); });

describe('StepStudents — matrícula por curso', () => {
  it('agrega varios estudiantes seleccionados a la vez (multi-selección)', async () => {
    const course = { id: 'c1', title: 'Curso 1', evaluatorId: 'eval-1', teacherName: 'Profe Uno', modality: 'VIRTUAL', engineModality: 'VIRTUAL' as const, studentIds: [], studentCount: 0 };
    const onCourseUpdated = vi.fn();
    render(<StepStudents courses={[course]} studentNames={studentNames} onCourseUpdated={onCourseUpdated} />);
    fireEvent.click(screen.getByTitle('Agregar estudiantes'));
    await waitFor(() => expect(screen.getByText('Estudiante Uno')).toBeTruthy());

    fireEvent.click(screen.getByText('Estudiante Uno'));
    fireEvent.click(screen.getByText('Estudiante Dos'));
    fireEvent.click(screen.getByText(/^Agregar 2$/));

    await waitFor(() => expect(addEnrollmentMock).toHaveBeenCalledWith('s1', 'c1'));
    expect(addEnrollmentMock).toHaveBeenCalledWith('s2', 'c1');
    expect(onCourseUpdated).toHaveBeenCalledWith('c1', { studentIds: ['s1', 's2'], studentCount: 2 });
  });

  it('marcar un grupo base pre-selecciona a todos sus miembros', async () => {
    const course = { id: 'c1', title: 'Curso 1', evaluatorId: 'eval-1', teacherName: 'Profe Uno', modality: 'VIRTUAL', engineModality: 'VIRTUAL' as const, studentIds: [], studentCount: 0 };
    render(<StepStudents courses={[course]} studentNames={studentNames} onCourseUpdated={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Agregar estudiantes'));
    await waitFor(() => expect(screen.getByText('Grupo A (2)')).toBeTruthy());

    fireEvent.change(screen.getByDisplayValue('— Marcar todo un grupo base —'), { target: { value: 'g1' } });
    await waitFor(() => expect(groupsMembersMock).toHaveBeenCalledWith('g1'));
    await waitFor(() => expect((screen.getByText('Estudiante Uno').closest('label')?.querySelector('input') as HTMLInputElement).checked).toBe(true));
  });

  it('no deja seleccionar a un estudiante que ya está inscrito (evita duplicados)', async () => {
    const course = { id: 'c1', title: 'Curso 1', evaluatorId: 'eval-1', teacherName: 'Profe Uno', modality: 'VIRTUAL', engineModality: 'VIRTUAL' as const, studentIds: ['s1'], studentCount: 1 };
    render(<StepStudents courses={[course]} studentNames={studentNames} onCourseUpdated={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Agregar estudiantes'));
    await waitFor(() => expect(screen.getByText(/ya inscrito/)).toBeTruthy());

    const checkbox = screen.getByText(/ya inscrito/).closest('label')?.querySelector('input') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('muestra el roster con nombres y permite quitar a un estudiante', async () => {
    const course = { id: 'c1', title: 'Curso 1', evaluatorId: 'eval-1', teacherName: 'Profe Uno', modality: 'VIRTUAL', engineModality: 'VIRTUAL' as const, studentIds: ['s1'], studentCount: 1 };
    const onCourseUpdated = vi.fn();
    render(<StepStudents courses={[course]} studentNames={studentNames} onCourseUpdated={onCourseUpdated} />);
    await waitFor(() => expect(screen.getAllByText('Estudiante Uno').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByTitle('Quitar del curso'));
    await waitFor(() => expect(removeEnrollmentMock).toHaveBeenCalledWith('s1', 'c1'));
    expect(onCourseUpdated).toHaveBeenCalledWith('c1', { studentIds: [], studentCount: 0 });
  });
});
