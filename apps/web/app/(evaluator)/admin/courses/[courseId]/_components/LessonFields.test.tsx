import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LessonFields } from './LessonFields';

// Trello DmPpbrff, 2026-09-07 (Mack): "como profesor, debo tener también la
// opción de poder agregar imágenes en el editor de curso, en la sección de
// carruseles... reemplacen las que se crearon automáticamente... [y] una
// opción en donde yo pueda agregar imágenes de algún proveedor." RichTextEditor
// pulls in tiptap (heavy, unrelated to this feature) — mocked out so these
// tests isolate the new image-picker behavior.
vi.mock('@/components/shared/RichTextEditor', () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor" />,
  ImageModal: ({ onInsert, onClose, title, confirmLabel, stockProvider, uploadFolder }: any) => (
    <div data-testid="image-modal">
      <span>{title}</span>
      <button onClick={() => onInsert('https://images.pexels.com/photos/123/pic.jpg')}>
        {confirmLabel} ({stockProvider}/{uploadFolder})
      </button>
      <button onClick={onClose}>cerrar</button>
    </div>
  ),
}));

function makeForm(overrides: Partial<any> = {}) {
  return {
    title: 'Lección 1', duration: '10 min', youtubeId: '', imageUrl: '',
    content: '', points: [''], tip: '', order: 1,
    ...overrides,
  };
}

describe('LessonFields — lesson cover image picker', () => {
  it('shows "Elegir imagen" (no preview) when the lesson has no cover yet', () => {
    render(<LessonFields form={makeForm()} setForm={() => {}} />);
    expect(screen.getByText('Elegir imagen')).toBeTruthy();
    expect(screen.queryByAltText('Portada de la lección')).toBeNull();
  });

  it('shows a preview and "Cambiar imagen" when the lesson already has a cover', () => {
    render(<LessonFields form={makeForm({ imageUrl: 'https://x.test/cover.jpg' })} setForm={() => {}} />);
    expect(screen.getByText('Cambiar imagen')).toBeTruthy();
    expect(screen.getByAltText('Portada de la lección')).toBeTruthy();
  });

  it('opens the picker configured for Pexels stock search + the covers upload folder', () => {
    render(<LessonFields form={makeForm()} setForm={() => {}} />);
    fireEvent.click(screen.getByText('Elegir imagen'));
    expect(screen.getByText('Imagen de portada de la lección')).toBeTruthy();
    expect(screen.getByText(/Usar como portada \(pexels\/covers\)/)).toBeTruthy();
  });

  it('replaces the auto-generated image when a picker option is confirmed', () => {
    const setForm = vi.fn();
    render(<LessonFields form={makeForm({ imageUrl: 'https://x.test/auto-generated.jpg' })} setForm={setForm} />);
    fireEvent.click(screen.getByText('Cambiar imagen'));
    fireEvent.click(screen.getByText(/Usar como portada/));
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: 'https://images.pexels.com/photos/123/pic.jpg' }));
  });

  it('closing the picker without a selection leaves the current image untouched', () => {
    const setForm = vi.fn();
    render(<LessonFields form={makeForm({ imageUrl: 'https://x.test/auto-generated.jpg' })} setForm={setForm} />);
    fireEvent.click(screen.getByText('Cambiar imagen'));
    fireEvent.click(screen.getByText('cerrar'));
    expect(setForm).not.toHaveBeenCalled();
    expect(screen.queryByTestId('image-modal')).toBeNull();
  });

  it('reveals a manual-URL fallback input on demand, for pasting an existing link', () => {
    const setForm = vi.fn();
    render(<LessonFields form={makeForm()} setForm={setForm} />);
    expect(screen.queryByLabelText('URL imagen (opcional)')).toBeNull();
    fireEvent.click(screen.getByText('Pegar URL manual'));
    const input = screen.getByLabelText('URL imagen (opcional)');
    fireEvent.change(input, { target: { value: 'https://cdn.test/manual.png' } });
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: 'https://cdn.test/manual.png' }));
  });
});
