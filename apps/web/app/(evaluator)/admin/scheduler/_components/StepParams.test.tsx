import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepParams } from './StepParams';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "vamos a pensar en diferentes
// centros educativos... que se puedan elegir los días de la semana que son
// cursos presenciales [y] los días que son cursos virtuales... así
// funcionaría con cualquier centro educativo."

const baseProps = {
  lunchStart: '12:00', lunchEnd: '13:00', gapMinutes: 5, individualMinutes: 55, groupMinutes: 75,
  presencialDays: [6], virtualDays: [1, 2, 3, 4, 5], institutionalOpen: '08:00', institutionalClose: '16:00',
};

describe('StepParams — reglas de día configurables', () => {
  it('togglear un día en "Cursos presenciales" lo agrega/quita de la selección', () => {
    const onChange = vi.fn();
    render(<StepParams {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getAllByText('Mié')[0]); // agregar miércoles a presenciales
    expect(onChange).toHaveBeenCalledWith({ presencialDays: [3, 6] });
  });

  it('quitar un día ya seleccionado de "Cursos virtuales"', () => {
    const onChange = vi.fn();
    render(<StepParams {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getAllByText('Vie')[1]); // segundo picker = virtuales, viernes ya estaba seleccionado
    expect(onChange).toHaveBeenCalledWith({ virtualDays: [1, 2, 3, 4] });
  });

  it('cambia el horario institucional de los días presenciales', () => {
    const onChange = vi.fn();
    render(<StepParams {...baseProps} onChange={onChange} />);
    const [openInput] = screen.getAllByDisplayValue('08:00');
    fireEvent.change(openInput, { target: { value: '09:00' } });
    expect(onChange).toHaveBeenCalledWith({ institutionalOpen: '09:00' });
  });

  it('la etiqueta de almuerzo ya no dice "sabatino"', () => {
    render(<StepParams {...baseProps} onChange={vi.fn()} />);
    expect(screen.getByText('Hora de almuerzo (bloqueo obligatorio)')).toBeTruthy();
    expect(screen.queryByText(/sabatino/i)).toBeNull();
  });
});
