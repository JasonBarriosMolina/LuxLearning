import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AvailabilityEditor } from './AvailabilityEditor';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "si el profesor pone una lección
// antes de las 6 de la tarde [entre semana], el sistema le debe indicar que
// está incorrecto, que esa disponibilidad no existe" — regla dura, solo
// lunes-viernes (sábado sigue el horario institucional 8am-4pm).

const setAvailabilityMock = vi.fn().mockResolvedValue({});
vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      teachers: {
        getAvailability: vi.fn().mockResolvedValue({ data: { blocks: [], maxCoursesPerWeek: 5 } }),
        setAvailability: (...a: any[]) => setAvailabilityMock(...a),
      },
    },
  },
}));

beforeEach(() => setAvailabilityMock.mockClear());

describe('AvailabilityEditor — regla de las 6pm entre semana', () => {
  it('un bloque nuevo arranca en 6pm por defecto', async () => {
    render(<AvailabilityEditor username="eval-1" />);
    await waitFor(() => expect(screen.getByText('Agregar bloque')).toBeTruthy());
    fireEvent.click(screen.getByText('Agregar bloque'));
    const startInput = screen.getAllByDisplayValue('18:00')[0] as HTMLInputElement;
    expect(startInput).toBeTruthy();
  });

  it('rechaza guardar un bloque de semana antes de las 6pm', async () => {
    render(<AvailabilityEditor username="eval-1" />);
    await waitFor(() => expect(screen.getByText('Agregar bloque')).toBeTruthy());
    fireEvent.click(screen.getByText('Agregar bloque'));

    const startInput = screen.getAllByDisplayValue('18:00')[0] as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '14:00' } });
    fireEvent.click(screen.getByText('Guardar disponibilidad'));

    await waitFor(() => expect(document.body.textContent).toContain('6:00 p.m.'));
    expect(setAvailabilityMock).not.toHaveBeenCalled();
  });

  it('sube automáticamente la hora a 6pm al cambiar de sábado a un día de semana', async () => {
    render(<AvailabilityEditor username="eval-1" />);
    await waitFor(() => expect(screen.getByText('Agregar bloque')).toBeTruthy());
    fireEvent.click(screen.getByText('Agregar bloque'));

    // Mover a sábado con una hora temprana (válida ahí) y luego de vuelta a un
    // día de semana — no debería quedarse pegada la hora temprana.
    const daySelect = screen.getByDisplayValue('Lunes') as HTMLSelectElement;
    fireEvent.change(daySelect, { target: { value: '6' } });
    const startInput = screen.getAllByDisplayValue('18:00')[0] as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '08:00' } });
    fireEvent.change(screen.getByDisplayValue('Sábado'), { target: { value: '2' } });

    fireEvent.click(screen.getByText('Guardar disponibilidad'));
    await waitFor(() => expect(setAvailabilityMock).toHaveBeenCalledWith('eval-1', {
      blocks: [{ dayOfWeek: 2, startTime: '18:00', endTime: '20:00' }],
      maxCoursesPerWeek: 5,
    }));
  });

  it('permite guardar un bloque de sábado antes de las 6pm sin problema', async () => {
    render(<AvailabilityEditor username="eval-1" />);
    await waitFor(() => expect(screen.getByText('Agregar bloque')).toBeTruthy());
    fireEvent.click(screen.getByText('Agregar bloque'));
    fireEvent.change(screen.getByDisplayValue('Lunes'), { target: { value: '6' } });
    const startInput = screen.getAllByDisplayValue('18:00')[0] as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '08:00' } });

    fireEvent.click(screen.getByText('Guardar disponibilidad'));
    await waitFor(() => expect(setAvailabilityMock).toHaveBeenCalled());
  });
});
