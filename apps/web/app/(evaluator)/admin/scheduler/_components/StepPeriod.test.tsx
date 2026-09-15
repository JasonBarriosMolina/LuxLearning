import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StepPeriod } from './StepPeriod';

// Trello *LUX SCHEDULER* (Mack, 2026-09-10): "deben de estar disponibles
// también horarios anteriores de otros periodos... no es el foco principal
// visualmente, pero sí es importante que estén. También se le pueden asignar
// colores." — periodos con createdAt se agrupan en "Recientes" (los primeros
// 4) y el resto (incluidos los derivados sin createdAt) en "Anteriores".

const periodsListMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { admin: { periods: { list: (...a: any[]) => periodsListMock(...a), create: vi.fn() } } },
}));

describe('StepPeriod — historial con grupos', () => {
  it('agrupa los primeros 4 periodos con fecha como "Recientes" y el resto como "Anteriores"', async () => {
    periodsListMock.mockResolvedValue({
      data: [
        { id: '1', name: 'II Semestre 2026', createdAt: '2026-09-01T00:00:00Z' },
        { id: '2', name: 'I Semestre 2026', createdAt: '2026-03-01T00:00:00Z' },
        { id: '3', name: 'II Semestre 2025', createdAt: '2025-09-01T00:00:00Z' },
        { id: '4', name: 'I Semestre 2025', createdAt: '2025-03-01T00:00:00Z' },
        { id: '5', name: 'II Semestre 2024', createdAt: '2024-09-01T00:00:00Z' },
        { id: 'derived:I Semestre 2024', name: 'I Semestre 2024', createdAt: null },
      ],
    });
    render(<StepPeriod academicPeriod="" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('II Semestre 2026')).toBeTruthy());

    const recentGroup = document.querySelector('optgroup[label="Recientes"]') as HTMLOptGroupElement;
    const olderGroup = document.querySelector('optgroup[label="Anteriores"]') as HTMLOptGroupElement;
    expect(recentGroup.children.length).toBe(4);
    expect(olderGroup.children.length).toBe(2); // II Semestre 2024 (5th dated) + I Semestre 2024 (derived)
  });

  it('muestra el badge "Reciente" o "Anterior" según el periodo seleccionado', async () => {
    periodsListMock.mockResolvedValue({
      data: [
        { id: '1', name: 'II Semestre 2026', createdAt: '2026-09-01T00:00:00Z' },
        { id: '2', name: 'I Semestre 2026', createdAt: '2026-03-01T00:00:00Z' },
        { id: '3', name: 'II Semestre 2025', createdAt: '2025-09-01T00:00:00Z' },
        { id: '4', name: 'I Semestre 2025', createdAt: '2025-03-01T00:00:00Z' },
        { id: '5', name: 'I Semestre 2020', createdAt: '2020-03-01T00:00:00Z' },
      ],
    });
    const { rerender } = render(<StepPeriod academicPeriod="II Semestre 2026" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('Reciente')).toBeTruthy());

    rerender(<StepPeriod academicPeriod="I Semestre 2020" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('Anterior')).toBeTruthy());
  });
});
