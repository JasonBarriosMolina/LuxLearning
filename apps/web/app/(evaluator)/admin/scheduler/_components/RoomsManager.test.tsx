import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoomsManager } from './RoomsManager';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "la institución puede
// agregar aulas, puede agregar edificios y edificios que contengan aulas...
// divididas por piso... nombre preferencial... aforo... descripción de qué
// tipo de cursos se pueden dar."

const buildingsListMock = vi.fn().mockResolvedValue({ data: [] });
const buildingsCreateMock = vi.fn();
const buildingsDeleteMock = vi.fn().mockResolvedValue({});
const roomsListMock = vi.fn().mockResolvedValue({ data: [] });
const roomsCreateMock = vi.fn();
const roomsDeleteMock = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      scheduler: {
        buildings: {
          list: (...a: any[]) => buildingsListMock(...a),
          create: (...a: any[]) => buildingsCreateMock(...a),
          delete: (...a: any[]) => buildingsDeleteMock(...a),
        },
        rooms: {
          list: (...a: any[]) => roomsListMock(...a),
          create: (...a: any[]) => roomsCreateMock(...a),
          delete: (...a: any[]) => roomsDeleteMock(...a),
        },
      },
    },
  },
}));

beforeEach(() => {
  buildingsListMock.mockClear(); buildingsCreateMock.mockReset(); buildingsDeleteMock.mockClear();
  roomsListMock.mockClear(); roomsCreateMock.mockReset(); roomsDeleteMock.mockClear();
  buildingsListMock.mockResolvedValue({ data: [] });
  roomsListMock.mockResolvedValue({ data: [] });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('RoomsManager', () => {
  it('crea un edificio', async () => {
    buildingsCreateMock.mockResolvedValue({ data: { id: 'b1', name: 'Edificio A' } });
    render(<RoomsManager />);
    await waitFor(() => expect(buildingsListMock).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText('Edificio A'), { target: { value: 'Edificio A' } });
    fireEvent.click(screen.getByPlaceholderText('Edificio A').parentElement!.querySelector('button')!);

    await waitFor(() => expect(buildingsCreateMock).toHaveBeenCalledWith('Edificio A'));
    expect(await screen.findByText('Edificio A')).toBeTruthy();
  });

  it('crea un aula con edificio, piso, nombre preferencial y tags', async () => {
    buildingsListMock.mockResolvedValue({ data: [{ id: 'b1', name: 'Edificio A' }] });
    roomsCreateMock.mockResolvedValue({ data: { id: 'r1', name: '101', capacity: 10, buildingId: 'b1', floor: 1, preferredName: 'Salón de ensayos', courseTypeTags: ['TEORICO'] } });
    render(<RoomsManager />);
    await waitFor(() => expect(screen.getByText('Edificio A')).toBeTruthy());

    fireEvent.click(screen.getByText('Agregar aula'));
    fireEvent.change(screen.getByPlaceholderText('Nombre (ej. 101)'), { target: { value: '101' } });
    fireEvent.change(screen.getByPlaceholderText('Aforo'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('Nombre preferencial (opcional)'), { target: { value: 'Salón de ensayos' } });
    fireEvent.click(screen.getByText('Teórico'));
    fireEvent.click(screen.getByText('Crear aula'));

    await waitFor(() => expect(roomsCreateMock).toHaveBeenCalledWith({
      name: '101', capacity: 10, buildingId: undefined, floor: undefined, preferredName: 'Salón de ensayos', courseTypeTags: ['TEORICO'],
    }));
    expect(await screen.findByText(/Salón de ensayos/)).toBeTruthy();
  });

  it('elimina un aula tras confirmar', async () => {
    roomsListMock.mockResolvedValue({ data: [{ id: 'r1', name: '101', capacity: 10, buildingId: null, floor: null, preferredName: null, courseTypeTags: [] }] });
    render(<RoomsManager />);
    await waitFor(() => expect(screen.getByText('101')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-trash2'))!);

    await waitFor(() => expect(roomsDeleteMock).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.queryByText('101')).toBeNull());
  });

  it('eliminar un edificio deja sus aulas sin edificio en la vista, no las borra', async () => {
    buildingsListMock.mockResolvedValue({ data: [{ id: 'b1', name: 'Edificio A' }] });
    roomsListMock.mockResolvedValue({ data: [{ id: 'r1', name: '101', capacity: 10, buildingId: 'b1', floor: 1, preferredName: null, courseTypeTags: [] }] });
    render(<RoomsManager />);
    await waitFor(() => expect(screen.getByText('Edificio A')).toBeTruthy());

    const buildingChip = screen.getByText('Edificio A').closest('span')!;
    fireEvent.click(buildingChip.querySelector('button')!);

    await waitFor(() => expect(buildingsDeleteMock).toHaveBeenCalledWith('b1'));
    expect(screen.getByText('101')).toBeTruthy(); // el aula sigue en la lista
  });
});
