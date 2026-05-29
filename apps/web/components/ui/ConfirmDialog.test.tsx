import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

// Mock lucide-react icons used inside Modal — use null renderers to avoid JSX in vi.mock hoisting
vi.mock('lucide-react', () => ({
  X: () => null,
  Loader2: () => null,
}));

const defaultProps = {
  open: true,
  title: '¿Confirmar acción?',
  message: 'Esta acción no se puede deshacer.',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('ConfirmDialog', () => {
  it('renders title and message when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('¿Confirmar acción?')).toBeInTheDocument();
    expect(screen.getByText('Esta acción no se puede deshacer.')).toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('¿Confirmar acción?')).not.toBeInTheDocument();
  });

  it('renders default button labels', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Sí, continuar')).toBeInTheDocument();
    expect(screen.getByText('Cancelar')).toBeInTheDocument();
  });

  it('renders custom button labels', () => {
    render(
      <ConfirmDialog
        {...defaultProps}
        confirmLabel="Sí, eliminar"
        cancelLabel="No, volver"
      />
    );
    expect(screen.getByText('Sí, eliminar')).toBeInTheDocument();
    expect(screen.getByText('No, volver')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Sí, continuar'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the modal X button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText('Cerrar'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('applies danger styling when variant=danger', () => {
    render(<ConfirmDialog {...defaultProps} variant="danger" confirmLabel="Eliminar" />);
    const confirmBtn = screen.getByText('Eliminar');
    // The danger Button uses bg-red-600 class
    expect(confirmBtn.className).toMatch(/bg-red/);
  });

  it('does not apply danger styling when variant=default', () => {
    render(<ConfirmDialog {...defaultProps} variant="default" confirmLabel="Confirmar" />);
    const confirmBtn = screen.getByText('Confirmar');
    expect(confirmBtn.className).not.toMatch(/bg-red/);
  });
});
