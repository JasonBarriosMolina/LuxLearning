import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepCourses } from './StepCourses';

// Trello *LUX SCHEDULER* (Mack, 2026-09-10): "para los cursos que ya creé,
// también tengo que tener la opción de editar o eliminar... si me equivoqué
// en algo, yo pueda eliminar cosas" — reasignar profesor + eliminar curso
// directamente desde el catálogo del wizard, sin salir a Gestión de Contenido.

const assignEvaluatorMock = vi.fn().mockResolvedValue({});
const deleteMock = vi.fn().mockResolvedValue({});
vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      scheduler: { courses: vi.fn().mockResolvedValue({ data: [] }), createCourse: vi.fn() },
      users: { list: vi.fn().mockResolvedValue({ data: [
        { username: 'eval-1', role: 'EVALUATOR', name: 'Profe Uno' },
        { username: 'eval-2', role: 'EVALUATOR', name: 'Profe Dos' },
      ] }) },
      courses: {
        assignEvaluator: (...a: any[]) => assignEvaluatorMock(...a),
        delete: (...a: any[]) => deleteMock(...a),
      },
    },
  },
}));

const course = { id: 'c1', title: 'Curso 1', evaluatorId: 'eval-1', teacherName: 'Profe Uno', modality: 'VIRTUAL', engineModality: 'VIRTUAL' as const, studentCount: 3 };

beforeEach(() => { assignEvaluatorMock.mockClear(); deleteMock.mockClear(); vi.spyOn(window, 'confirm').mockReturnValue(true); });

describe('StepCourses — editar/eliminar curso', () => {
  it('reasigna el profesor y actualiza la fila localmente', async () => {
    const onLoaded = vi.fn();
    render(<StepCourses academicPeriod="2026-2" courses={[course]} overrides={{}} onLoaded={onLoaded} onOverrideChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Curso 1')).toBeTruthy());

    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement; // profesor es el primer select de la fila
    fireEvent.change(select, { target: { value: 'eval-2' } });

    await waitFor(() => expect(assignEvaluatorMock).toHaveBeenCalledWith('c1', { evaluatorId: 'eval-2', evaluatorName: 'Profe Dos' }));
    expect(onLoaded).toHaveBeenCalledWith([{ ...course, evaluatorId: 'eval-2', teacherName: 'Profe Dos' }]);
  });

  it('pide confirmación y elimina el curso por completo', async () => {
    const onLoaded = vi.fn();
    render(<StepCourses academicPeriod="2026-2" courses={[course]} overrides={{}} onLoaded={onLoaded} onOverrideChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Curso 1')).toBeTruthy());

    fireEvent.click(screen.getByTitle('Eliminar curso de Lux Learning por completo'));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('c1'));
    expect(onLoaded).toHaveBeenCalledWith([]);
  });

  it('no elimina si se cancela la confirmación', async () => {
    (window.confirm as any).mockReturnValue(false);
    const onLoaded = vi.fn();
    render(<StepCourses academicPeriod="2026-2" courses={[course]} overrides={{}} onLoaded={onLoaded} onOverrideChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Curso 1')).toBeTruthy());

    fireEvent.click(screen.getByTitle('Eliminar curso de Lux Learning por completo'));

    expect(deleteMock).not.toHaveBeenCalled();
  });
});
