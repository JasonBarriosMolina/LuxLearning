import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepStudents } from './StepStudents';

// Trello *LUX SCHEDULER* (Mack, 2026-09-10, 2026-09-15): agregar estudiantes
// individuales o grupos base por curso; "me gustaría que visualmente esta
// sección fuera como cuando yo elijo en 'asignar los cursos': en un lado
// están los estudiantes, y en la otra columna están los estudiantes que se
// acaban de agregar" — layout de dos columnas, click para mover en vez de
// checkbox; quitar un estudiante ya matriculado; nunca reinscribir al mismo
// estudiante dos veces en el mismo curso.

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
const baseCourse = { id: 'c1', title: 'Curso 1', evaluatorId: 'eval-1', teacherName: 'Profe Uno', modality: 'VIRTUAL', engineModality: 'VIRTUAL' as const, courseType: null };

beforeEach(() => { addEnrollmentMock.mockClear(); removeEnrollmentMock.mockClear(); groupsMembersMock.mockClear(); });

describe('StepStudents — matrícula por curso (dos columnas)', () => {
  it('mover un estudiante de Disponibles a Seleccionados y agregarlo', async () => {
    const course = { ...baseCourse, studentIds: [], studentCount: 0 };
    const onCourseUpdated = vi.fn();
    render(<StepStudents courses={[course]} studentNames={studentNames} onCourseUpdated={onCourseUpdated} />);
    fireEvent.click(screen.getByTitle('Agregar estudiantes'));
    await waitFor(() => expect(screen.getByText('Estudiante Uno')).toBeTruthy());

    fireEvent.click(screen.getByText('Estudiante Uno')); // Disponibles -> Seleccionados
    await waitFor(() => expect(screen.getByText('Seleccionados (1)')).toBeTruthy());

    fireEvent.click(screen.getByText(/^Agregar 1$/));
    await waitFor(() => expect(addEnrollmentMock).toHaveBeenCalledWith('s1', 'c1'));
    expect(onCourseUpdated).toHaveBeenCalledWith('c1', { studentIds: ['s1'], studentCount: 1 });
  });

  it('mover un estudiante de vuelta a Disponibles al hacer click en Seleccionados', async () => {
    const course = { ...baseCourse, studentIds: [], studentCount: 0 };
    render(<StepStudents courses={[course]} studentNames={studentNames} onCourseUpdated={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Agregar estudiantes'));
    await waitFor(() => expect(screen.getByText('Estudiante Uno')).toBeTruthy());

    fireEvent.click(screen.getByText('Estudiante Uno'));
    await waitFor(() => expect(screen.getByText('Seleccionados (1)')).toBeTruthy());
    fireEvent.click(screen.getByText('Estudiante Uno')); // ahora está en Seleccionados, click lo regresa
    await waitFor(() => expect(screen.getByText('Nada seleccionado')).toBeTruthy());
  });

  it('marcar un grupo base pre-selecciona a todos sus miembros en Seleccionados', async () => {
    const course = { ...baseCourse, studentIds: [], studentCount: 0 };
    render(<StepStudents courses={[course]} studentNames={studentNames} onCourseUpdated={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Agregar estudiantes'));
    await waitFor(() => expect(screen.getByText('Grupo A (2)')).toBeTruthy());

    fireEvent.change(screen.getByDisplayValue('— Marcar todo un grupo base —'), { target: { value: 'g1' } });
    await waitFor(() => expect(groupsMembersMock).toHaveBeenCalledWith('g1'));
    await waitFor(() => expect(screen.getByText('Seleccionados (2)')).toBeTruthy());
  });

  it('un estudiante ya inscrito no aparece en Disponibles (evita duplicados)', async () => {
    const course = { ...baseCourse, studentIds: ['s1'], studentCount: 1 };
    render(<StepStudents courses={[course]} studentNames={studentNames} onCourseUpdated={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Agregar estudiantes'));
    await waitFor(() => expect(screen.getByText('Estudiante Dos')).toBeTruthy());

    // "Estudiante Uno" solo aparece en el roster de arriba (ya inscrito), no
    // en la columna Disponibles del panel.
    expect(screen.getAllByText('Estudiante Uno')).toHaveLength(1);
  });

  it('el buscador filtra la columna Disponibles', async () => {
    const course = { ...baseCourse, studentIds: [], studentCount: 0 };
    render(<StepStudents courses={[course]} studentNames={studentNames} onCourseUpdated={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Agregar estudiantes'));
    await waitFor(() => expect(screen.getByText('Estudiante Tres')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('Disponibles…'), { target: { value: 'Tres' } });
    expect(screen.queryByText('Estudiante Uno')).toBeNull();
    expect(screen.getByText('Estudiante Tres')).toBeTruthy();
  });

  it('muestra el roster con nombres y permite quitar a un estudiante', async () => {
    const course = { ...baseCourse, studentIds: ['s1'], studentCount: 1 };
    const onCourseUpdated = vi.fn();
    render(<StepStudents courses={[course]} studentNames={studentNames} onCourseUpdated={onCourseUpdated} />);
    await waitFor(() => expect(screen.getAllByText('Estudiante Uno').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByTitle('Quitar del curso'));
    await waitFor(() => expect(removeEnrollmentMock).toHaveBeenCalledWith('s1', 'c1'));
    expect(onCourseUpdated).toHaveBeenCalledWith('c1', { studentIds: [], studentCount: 0 });
  });
});
