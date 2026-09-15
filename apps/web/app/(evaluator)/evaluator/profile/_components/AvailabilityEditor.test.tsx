import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AvailabilityEditor } from './AvailabilityEditor';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15, revertido el mismo día): la
// regla dura "6pm en punto, entre semana" se quitó horas después de
// implementarse — "vamos a hacerlo más general: vamos a hacer que la
// persona elija. Sin embargo, se hace una mención directa en el perfil, un
// aviso diciendo que es la hora sugerida." 6pm queda como default/sugerencia
// visual, ya no bloquea el guardado.

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

describe('AvailabilityEditor — 6pm es sugerencia, no obligatoria', () => {
  it('un bloque nuevo arranca en 6pm por defecto (sugerido)', async () => {
    render(<AvailabilityEditor username="eval-1" />);
    await waitFor(() => expect(screen.getByText('Agregar bloque')).toBeTruthy());
    fireEvent.click(screen.getByText('Agregar bloque'));
    const startInput = screen.getAllByDisplayValue('18:00')[0] as HTMLInputElement;
    expect(startInput).toBeTruthy();
  });

  it('permite guardar un bloque de semana antes de las 6pm sin bloquear', async () => {
    render(<AvailabilityEditor username="eval-1" />);
    await waitFor(() => expect(screen.getByText('Agregar bloque')).toBeTruthy());
    fireEvent.click(screen.getByText('Agregar bloque'));

    const startInput = screen.getAllByDisplayValue('18:00')[0] as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '14:00' } });
    fireEvent.click(screen.getByText('Guardar disponibilidad'));

    await waitFor(() => expect(setAvailabilityMock).toHaveBeenCalledWith('eval-1', {
      blocks: [{ dayOfWeek: 1, startTime: '14:00', endTime: '16:00' }],
      maxCoursesPerWeek: 5,
    }));
  });

  it('no sube automáticamente la hora al cambiar de sábado a un día de semana', async () => {
    render(<AvailabilityEditor username="eval-1" />);
    await waitFor(() => expect(screen.getByText('Agregar bloque')).toBeTruthy());
    fireEvent.click(screen.getByText('Agregar bloque'));

    fireEvent.change(screen.getByDisplayValue('Lunes'), { target: { value: '6' } });
    const startInput = screen.getAllByDisplayValue('18:00')[0] as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '08:00' } });
    fireEvent.change(screen.getByDisplayValue('Sábado'), { target: { value: '2' } });

    fireEvent.click(screen.getByText('Guardar disponibilidad'));
    await waitFor(() => expect(setAvailabilityMock).toHaveBeenCalledWith('eval-1', {
      blocks: [{ dayOfWeek: 2, startTime: '08:00', endTime: '10:00' }], // se mantiene la hora elegida, sin forzar 18:00
      maxCoursesPerWeek: 5,
    }));
  });

  it('muestra la hora sugerida como aviso, no como regla obligatoria', async () => {
    render(<AvailabilityEditor username="eval-1" />);
    await waitFor(() => expect(document.body.textContent).toContain('sugerido'));
    expect(document.body.textContent).not.toContain('obligatoria');
  });
});
