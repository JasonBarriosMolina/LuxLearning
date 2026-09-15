import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepCourses } from './StepCourses';

// Trello *LUX SCHEDULER* (Mack, 2026-09-10): "para los cursos que ya creé,
// también tengo que tener la opción de editar o eliminar... si me equivoqué
// en algo, yo pueda eliminar cosas" — reasignar profesor + eliminar curso
// directamente desde el catálogo del wizard, sin salir a Gestión de Contenido.

const assignEvaluatorMock = vi.fn().mockResolvedValue({});
const deleteMock = vi.fn().mockResolvedValue({});
const updateMock = vi.fn().mockResolvedValue({});
const createCourseMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      scheduler: { courses: vi.fn().mockResolvedValue({ data: [] }), createCourse: (...a: any[]) => createCourseMock(...a) },
      users: { list: vi.fn().mockResolvedValue({ data: [
        { username: 'eval-1', role: 'EVALUATOR', name: 'Profe Uno' },
        { username: 'eval-2', role: 'EVALUATOR', name: 'Profe Dos' },
      ] }) },
      courses: {
        assignEvaluator: (...a: any[]) => assignEvaluatorMock(...a),
        delete: (...a: any[]) => deleteMock(...a),
        update: (...a: any[]) => updateMock(...a),
      },
    },
  },
}));

const course = { id: 'c1', title: 'Curso 1', evaluatorId: 'eval-1', teacherName: 'Profe Uno', modality: 'VIRTUAL', engineModality: 'VIRTUAL' as const, courseType: null, studentIds: ['s1', 's2', 's3'], studentCount: 3 };

beforeEach(() => {
  assignEvaluatorMock.mockClear(); deleteMock.mockClear(); updateMock.mockClear(); createCourseMock.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

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

  it('renombra el curso vía titleOnly', async () => {
    const onLoaded = vi.fn();
    render(<StepCourses academicPeriod="2026-2" courses={[course]} overrides={{}} onLoaded={onLoaded} onOverrideChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Curso 1')).toBeTruthy());

    fireEvent.click(screen.getByTitle('Renombrar curso'));
    const input = screen.getByDisplayValue('Curso 1');
    fireEvent.change(input, { target: { value: 'Curso Renombrado' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('c1', { titleOnly: true, title: 'Curso Renombrado' }));
    expect(onLoaded).toHaveBeenCalledWith([{ ...course, title: 'Curso Renombrado' }]);
  });

  it('un curso nuevo se crea con override classType GRUPAL por defecto', async () => {
    createCourseMock.mockResolvedValue({ data: { id: 'c2', title: 'Curso Nuevo', evaluatorId: 'eval-1', teacherName: 'Profe Uno', modality: null, engineModality: 'VIRTUAL', studentCount: 0 } });
    const onLoaded = vi.fn();
    const onOverrideChange = vi.fn();
    render(<StepCourses academicPeriod="2026-2" courses={[]} overrides={{}} onLoaded={onLoaded} onOverrideChange={onOverrideChange} />);
    await waitFor(() => expect(screen.getByText('Curso aún no creado en Lux Learning')).toBeTruthy());

    fireEvent.click(screen.getByText('Curso aún no creado en Lux Learning'));
    fireEvent.change(screen.getByPlaceholderText('Nombre del curso'), { target: { value: 'Curso Nuevo' } });
    fireEvent.change(screen.getByDisplayValue('— Seleccionar profesor —'), { target: { value: 'eval-1' } });
    fireEvent.click(screen.getByText('Crear curso'));

    await waitFor(() => expect(onOverrideChange).toHaveBeenCalledWith('c2', { classType: 'GRUPAL' }));
  });

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "no quiero que esa sección...
  // aparezca siempre... quiero que sea un botón que se desprenda del tipo de
  // clase" — la excepción de duración es un popover, no una columna fija.
  it('la excepción de duración es un popover que se abre desde un botón, no una columna siempre visible', async () => {
    const onOverrideChange = vi.fn();
    render(<StepCourses academicPeriod="2026-2" courses={[course]} overrides={{}} onLoaded={vi.fn()} onOverrideChange={onOverrideChange} />);
    await waitFor(() => expect(screen.getByText('Curso 1')).toBeTruthy());

    expect(screen.queryByPlaceholderText('min')).toBeNull(); // cerrado por defecto
    fireEvent.click(screen.getByTitle('Excepción de duración para este curso'));
    const input = screen.getByPlaceholderText('min');
    fireEvent.change(input, { target: { value: '90' } });
    expect(onOverrideChange).toHaveBeenCalledWith('c1', { durationOverrideMin: 90 });
  });

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "es importante que aparezcan
  // los tags del tipo de curso... y la modalidad... eso se jala desde la
  // sección número 3 de cursos."
  it('muestra tags de tipo de curso y modalidad tomados de Lux Planner', async () => {
    const tagged = { ...course, courseType: 'TEORICO_PRACTICO', modality: 'HIBRIDA' };
    render(<StepCourses academicPeriod="2026-2" courses={[tagged]} overrides={{}} onLoaded={vi.fn()} onOverrideChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Teórico-Práctico')).toBeTruthy());
    expect(screen.getByText('Híbrida')).toBeTruthy();
  });
});
