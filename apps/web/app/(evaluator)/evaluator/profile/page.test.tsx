import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProfilePage from './page';

// Trello *LUX SCHEDULER* (Mack, 2026-09-10): "debería existir la opción de
// subir un archivo PNG que funcione como firma, y también la opción de
// escribirla ... en cursiva" — antes la firma solo se podía dibujar a mano.
// These tests cover the two new signature input modes end-to-end through the
// real page (draw mode already existed and isn't retested here).

vi.mock('react-signature-canvas', () => ({
  default: () => <div data-testid="sig-canvas-stub" />,
}));

vi.mock('./_components/AvailabilityEditor', () => ({
  AvailabilityEditor: () => <div data-testid="availability-stub" />,
}));

const signatureSaveMock = vi.fn().mockResolvedValue({});
vi.mock('@/lib/api', () => ({
  api: {
    profile: {
      get: vi.fn().mockResolvedValue({ data: { username: 'eval-1', name: 'Prof Test', email: 'e@test.com', phone: '', bio: '', picture: '', title: '', specialty: '', experience: '', socialLinks: [] } }),
      update: vi.fn().mockResolvedValue({}),
    },
    evaluator: { signature: { get: vi.fn().mockResolvedValue({ data: {} }), save: (...a: any[]) => signatureSaveMock(...a) } },
    admin: { files: { presign: vi.fn() } },
    user: { setLang: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({ changePassword: vi.fn() }));

// jsdom's canvas has no real 2D rendering backend — stub the two calls the
// typed-signature feature needs instead of pulling in the `canvas` npm package.
beforeEach(() => {
  signatureSaveMock.mockClear();
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(), fillText: vi.fn(), measureText: vi.fn().mockReturnValue({ width: 100 }),
  }) as any;
  HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,typed-signature');
});

async function openSignatureEditor() {
  render(<ProfilePage />);
  await waitFor(() => expect(screen.getByText('Firma digital')).toBeTruthy());
  fireEvent.click(screen.getByText('Crear firma'));
}

describe('ProfilePage — firma digital: subir PNG', () => {
  it('sube un PNG y lo guarda como firma', async () => {
    await openSignatureEditor();
    fireEvent.click(screen.getByText('Subir imagen'));

    const file = new File(['fake-png-bytes'], 'firma.png', { type: 'image/png' });
    const fileInput = screen.getByTestId('signature-file-input') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(signatureSaveMock).toHaveBeenCalledTimes(1));
    expect(signatureSaveMock.mock.calls[0][0]).toMatch(/^data:/);
  });
});

describe('ProfilePage — firma digital: escribir en cursiva', () => {
  it('escribe un nombre, muestra preview en cursiva y lo guarda', async () => {
    await openSignatureEditor();
    fireEvent.click(screen.getByText('Escribir'));

    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), { target: { value: 'Ana Pérez' } });
    expect(screen.getByText('Ana Pérez')).toBeTruthy(); // live cursive preview

    fireEvent.click(screen.getByText('Guardar firma'));
    await waitFor(() => expect(signatureSaveMock).toHaveBeenCalledWith('data:image/png;base64,typed-signature'));
  });

  it('no permite guardar con el nombre vacío', async () => {
    await openSignatureEditor();
    fireEvent.click(screen.getByText('Escribir'));
    const saveBtn = screen.getByText('Guardar firma').closest('button')!;
    expect(saveBtn).toBeDisabled();
  });
});
