import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MyScheduleModal } from './MyScheduleModal';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "como evaluador, debe existir...
// un botón de 'Ver mi horario'... deben verse incluidas las clases y cursos
// ya asignados. Si el curso aún no se ha creado, debería verse el espacio
// como 'bloqueado'... 'Pendiente de asignar curso a esta franja horaria'."

const myScheduleMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { evaluator: { calendar: { mySchedule: (...a: any[]) => myScheduleMock(...a) } } },
}));

describe('MyScheduleModal', () => {
  beforeEach(() => myScheduleMock.mockClear());

  it('muestra una clase asignada y un bloque pendiente de asignar', async () => {
    myScheduleMock.mockResolvedValue({
      data: {
        hasAvailability: true,
        items: [
          { dayOfWeek: 2, dayLabel: 'Martes', blockStart: '18:00', blockEnd: '21:00', classes: [
            { courseId: 'c1', courseTitle: 'Curso Martes', startTime: '18:00', endTime: '18:55', academicPeriod: '2026-2', modality: 'VIRTUAL', classType: 'INDIVIDUAL', studentCount: 1 },
          ] },
          { dayOfWeek: 4, dayLabel: 'Jueves', blockStart: '19:00', blockEnd: '22:00', classes: [] },
        ],
      },
    });
    render(<MyScheduleModal open={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Curso Martes')).toBeTruthy());
    expect(screen.getByText(/Pendiente de asignar curso a esta franja horaria/)).toBeTruthy();
  });

  it('muestra aviso cuando no hay disponibilidad declarada', async () => {
    myScheduleMock.mockResolvedValue({ data: { hasAvailability: false, items: [] } });
    render(<MyScheduleModal open={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No has declarado disponibilidad/)).toBeTruthy());
  });

  it('no llama a la API si el modal está cerrado', () => {
    render(<MyScheduleModal open={false} onClose={vi.fn()} />);
    expect(myScheduleMock).not.toHaveBeenCalled();
  });
});
