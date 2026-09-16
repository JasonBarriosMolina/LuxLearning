import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModalityField } from './ModalityField';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "en el perfil de los
// estudiantes, que se diga si es un estudiante virtual, un estudiante
// presencial, o un estudiante híbrido."

const updateMock = vi.fn().mockResolvedValue({});
vi.mock('@/lib/api', () => ({
  api: { profile: { update: (...a: any[]) => updateMock(...a) } },
}));

beforeEach(() => updateMock.mockClear());

describe('ModalityField', () => {
  it('muestra "Sin definir" cuando no hay valor', () => {
    render(<ModalityField value={null} onSaved={vi.fn()} />);
    expect(screen.getByText('Sin definir')).toBeTruthy();
  });

  it('muestra la etiqueta correspondiente al valor guardado', () => {
    render(<ModalityField value="HIBRIDA" onSaved={vi.fn()} />);
    expect(screen.getByText('Híbrido')).toBeTruthy();
  });

  it('edita y guarda un nuevo valor', async () => {
    const onSaved = vi.fn();
    render(<ModalityField value={null} onSaved={onSaved} />);
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'VIRTUAL' } });
    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ studentModality: 'VIRTUAL' }));
    expect(onSaved).toHaveBeenCalledWith('VIRTUAL');
  });

  it('muestra un error si falla el guardado', async () => {
    updateMock.mockRejectedValueOnce(new Error('boom'));
    render(<ModalityField value={null} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'PRESENCIAL' } });
    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
  });
});
