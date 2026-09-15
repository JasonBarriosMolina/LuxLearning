import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepStudents } from './StepStudents';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "en la sección de estudiantes...
// tengo que tener la capacidad de agregar, en cada uno de los cursos,
// estudiantes individuales [o] grupos base" — antes era solo lectura.

const addEnrollmentMock = vi.fn().mockResolvedValue({});
const groupsEnrollMock = vi.fn().mockResolvedValue({});
const groupsMembersMock = vi.fn().mockResolvedValue({ data: [{ userId: 's1' }, { userId: 's2' }] });
vi.mock('@/lib/api', () => ({
  api: {
    admin: { users: { addEnrollment: (...a: any[]) => addEnrollmentMock(...a) } },
    evaluator: {
      groups: {
        studentPool: vi.fn().mockResolvedValue({ data: [{ userId: 's1', name: 'Estudiante Uno' }, { userId: 's2', name: 'Estudiante Dos' }] }),
        list: vi.fn().mockResolvedValue({ data: [{ id: 'g1', name: 'Grupo A', memberCount: 2 }] }),
        members: (...a: any[]) => groupsMembersMock(...a),
        enroll: (...a: any[]) => groupsEnrollMock(...a),
      },
    },
  },
}));

const course = { id: 'c1', title: 'Curso 1', evaluatorId: 'eval-1', teacherName: 'Profe Uno', modality: 'VIRTUAL', engineModality: 'VIRTUAL' as const, studentCount: 0 };

beforeEach(() => { addEnrollmentMock.mockClear(); groupsEnrollMock.mockClear(); groupsMembersMock.mockClear(); });

describe('StepStudents — agregar estudiantes por curso', () => {
  it('agrega un estudiante individual y actualiza el conteo', async () => {
    const onCourseUpdated = vi.fn();
    render(<StepStudents courses={[course]} onCourseUpdated={onCourseUpdated} />);
    fireEvent.click(screen.getByTitle('Agregar estudiantes'));
    await waitFor(() => expect(screen.getByText('Estudiante Uno')).toBeTruthy());

    fireEvent.change(screen.getByDisplayValue('— Seleccionar estudiante —'), { target: { value: 's1' } });
    fireEvent.click(screen.getByText('Agregar'));

    await waitFor(() => expect(addEnrollmentMock).toHaveBeenCalledWith('s1', 'c1'));
    expect(onCourseUpdated).toHaveBeenCalledWith('c1', { studentCount: 1 });
  });

  it('inscribe un grupo base completo y suma sus miembros al conteo', async () => {
    const onCourseUpdated = vi.fn();
    render(<StepStudents courses={[course]} onCourseUpdated={onCourseUpdated} />);
    fireEvent.click(screen.getByTitle('Agregar estudiantes'));
    await waitFor(() => expect(screen.getByText('Grupo base')).toBeTruthy());
    fireEvent.click(screen.getByText('Grupo base'));

    await waitFor(() => expect(screen.getByText('Grupo A (2)')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('— Seleccionar grupo —'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByText('Inscribir grupo'));

    await waitFor(() => expect(groupsMembersMock).toHaveBeenCalledWith('g1'));
    expect(groupsEnrollMock).toHaveBeenCalledWith('g1', { userIds: ['s1', 's2'], courseId: 'c1' });
    expect(onCourseUpdated).toHaveBeenCalledWith('c1', { studentCount: 2 });
  });
});
