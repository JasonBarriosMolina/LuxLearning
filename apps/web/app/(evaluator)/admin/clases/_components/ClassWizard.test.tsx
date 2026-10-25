import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ClassWizard, type ClassDef } from './ClassWizard';

const createMock = vi.fn();
const updateMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { admin: { classes: { create: (...a: any[]) => createMock(...a), update: (...a: any[]) => updateMock(...a) } } },
}));

const courses = [{ id: 'c1', title: 'Curso 1', isActive: true, modules: [{ id: 'm1', title: 'Módulo 1', order: 1 }] }];

const existingClass: ClassDef = {
  id: 'class-1', courseId: 'c1', moduleId: 'm1', name: 'Clase existente',
  dueDate: '2026-09-10T00:00:00.000Z', weight: 15, instructions: 'Lee esto antes',
  vapiPrompt: 'Sé un mentor amable', vapiObjectives: JSON.stringify(['Obj 1', 'Obj 2']),
  lessonVideoUrl: 'https://example.com/video.mp4', lessonScript: 'Guión de prueba',
  targetStudentIds: [],
};

const next = () => fireEvent.click(screen.getByText('Siguiente'));

// Trello DmPpbrff, 2026-09-06 (Mack): "LuxMentor Clases" had no way to reopen a
// class's rich fields (prompt, objectives, script, video) — ClassList.tsx's old
// mini-editor only touched name/date/weight. ClassWizard now doubles as the editor.
// El wizard es un modal de 3 pasos: 1 datos, 2 contenido, 3 confirmar (y guardar).
describe('ClassWizard — edit mode', () => {
  beforeEach(() => { createMock.mockReset(); updateMock.mockReset(); updateMock.mockResolvedValue({}); createMock.mockResolvedValue({}); });

  it('pre-fills every field from editingClass', () => {
    render(<ClassWizard courses={courses} onCreated={() => {}} onClose={() => {}} editingClass={existingClass} />);
    // Paso 1
    expect(screen.getByText('Editar clase')).toBeTruthy();
    expect(screen.getByDisplayValue('Clase existente')).toBeTruthy();
    expect(screen.getByDisplayValue('2026-09-10')).toBeTruthy();
    expect(screen.getByDisplayValue('15')).toBeTruthy();

    // Paso 2
    next();
    expect(screen.getByDisplayValue('https://example.com/video.mp4')).toBeTruthy();
    expect(screen.getByDisplayValue('Sé un mentor amable')).toBeTruthy();
    expect(screen.getByDisplayValue('Guión de prueba')).toBeTruthy();
    expect(screen.getByDisplayValue('Lee esto antes')).toBeTruthy();
    expect(screen.getByDisplayValue('Obj 1')).toBeTruthy();
    expect(screen.getByDisplayValue('Obj 2')).toBeTruthy();
  });

  it('calls update (not create) with the class id when saving an edit', async () => {
    render(<ClassWizard courses={courses} onCreated={() => {}} onClose={() => {}} editingClass={existingClass} />);
    next(); next();
    fireEvent.click(screen.getByText('Guardar cambios'));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('class-1', expect.objectContaining({ name: 'Clase existente' })));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('shows "Crear clase" and calls create (not update) when there is no editingClass', async () => {
    render(<ClassWizard courses={courses} onCreated={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Nueva clase')).toBeTruthy();

    // El paso 1 exige curso y nombre antes de poder avanzar.
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'c1' } });
    fireEvent.change(screen.getByPlaceholderText('Ej: Introducción al subjuntivo'), { target: { value: 'Clase nueva' } });
    next(); next();

    expect(screen.queryByText('Guardar cambios')).toBeNull();
    fireEvent.click(screen.getByText('Crear clase'));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Clase nueva', courseId: 'c1' })));
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('starts with blank fields for a new class', () => {
    render(<ClassWizard courses={courses} onCreated={() => {}} onClose={() => {}} editingClass={null} />);
    expect(screen.getByPlaceholderText('Ej: Introducción al subjuntivo')).toHaveProperty('value', '');
    expect(screen.queryByDisplayValue('Clase existente')).toBeNull();
  });

  it('renders a Cancelar button on the first step and calls onClose', () => {
    const onClose = vi.fn();
    render(<ClassWizard courses={courses} onCreated={() => {}} onClose={onClose} editingClass={existingClass} />);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalled();
  });
});
