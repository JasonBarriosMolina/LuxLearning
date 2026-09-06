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

// Trello DmPpbrff, 2026-09-06 (Mack): "LuxMentor Clases" had no way to reopen a
// class's rich fields (prompt, objectives, script, video) — ClassList.tsx's old
// mini-editor only touched name/date/weight. ClassWizard now doubles as the editor.
describe('ClassWizard — edit mode', () => {
  beforeEach(() => { createMock.mockReset(); updateMock.mockReset(); updateMock.mockResolvedValue({}); createMock.mockResolvedValue({}); });

  it('pre-fills every field from editingClass', () => {
    render(<ClassWizard courses={courses} onCreated={() => {}} editingClass={existingClass} />);
    expect(screen.getByDisplayValue('Clase existente')).toBeTruthy();
    expect(screen.getByDisplayValue('2026-09-10')).toBeTruthy();
    expect(screen.getByDisplayValue('15')).toBeTruthy();
    expect(screen.getByDisplayValue('https://example.com/video.mp4')).toBeTruthy();
    // Advanced section auto-opens because vapiPrompt/lessonScript are present
    expect(screen.getByDisplayValue('Sé un mentor amable')).toBeTruthy();
    expect(screen.getByDisplayValue('Guión de prueba')).toBeTruthy();
    expect(screen.getByDisplayValue('Obj 1')).toBeTruthy();
    expect(screen.getByDisplayValue('Obj 2')).toBeTruthy();
  });

  it('calls update (not create) with the class id when saving an edit', async () => {
    render(<ClassWizard courses={courses} onCreated={() => {}} editingClass={existingClass} />);
    fireEvent.click(screen.getByText('Guardar cambios'));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('class-1', expect.objectContaining({ name: 'Clase existente' })));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('shows "Crear clase" and calls create (not update) when there is no editingClass', () => {
    render(<ClassWizard courses={courses} onCreated={() => {}} />);
    expect(screen.getByText('Crear clase')).toBeTruthy();
    expect(screen.queryByText('Guardar cambios')).toBeNull();
  });

  it('resets to blank fields when switching from editing back to a new class', () => {
    const { rerender } = render(<ClassWizard courses={courses} onCreated={() => {}} editingClass={existingClass} />);
    expect(screen.getByDisplayValue('Clase existente')).toBeTruthy();
    rerender(<ClassWizard courses={courses} onCreated={() => {}} editingClass={null} />);
    expect(screen.queryByDisplayValue('Clase existente')).toBeNull();
  });

  it('renders a Cancelar button in edit mode when onCancelEdit is given, and calls it', () => {
    const onCancelEdit = vi.fn();
    render(<ClassWizard courses={courses} onCreated={() => {}} editingClass={existingClass} onCancelEdit={onCancelEdit} />);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onCancelEdit).toHaveBeenCalled();
  });
});
