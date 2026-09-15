import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepReports } from './StepReports';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "probar los horarios no significa
// que deban publicarse; deben aprobarse... las opciones que tengo que tener
// son: enviar notificación a estudiantes / a evaluadores... el botón de
// publicar debe existir... después de enviar las notificaciones."

const getApprovalMock = vi.fn();
const notifyMock = vi.fn().mockResolvedValue({ data: { recipientCount: 3 } });
const publishMock = vi.fn().mockResolvedValue({});
const exportMock = vi.fn().mockResolvedValue({ data: { url: 'https://s3.example.com/f.docx' } });
const unpublishMock = vi.fn().mockResolvedValue({});
vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      scheduler: {
        getApproval: (...a: any[]) => getApprovalMock(...a),
        notify: (...a: any[]) => notifyMock(...a),
        publish: (...a: any[]) => publishMock(...a),
        export: (...a: any[]) => exportMock(...a),
        unpublish: (...a: any[]) => unpublishMock(...a),
      },
    },
  },
}));

const originalOpen = window.open;
beforeEach(() => {
  getApprovalMock.mockReset(); notifyMock.mockClear(); publishMock.mockClear(); exportMock.mockClear(); unpublishMock.mockClear();
  window.open = vi.fn();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { window.open = originalOpen; });

describe('StepReports — aprobar/notificar/publicar', () => {
  it('no deja publicar antes de enviar al menos una notificación', async () => {
    getApprovalMock.mockResolvedValue({ data: { status: 'APPROVED', notifiedStudents: false, notifiedEvaluators: false } });
    render(<StepReports academicPeriod="2026-2" onBackToReview={vi.fn()} onUnpublish={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Publicar').closest('button')).toBeDisabled());
  });

  it('notificar a estudiantes habilita publicar', async () => {
    getApprovalMock
      .mockResolvedValueOnce({ data: { status: 'APPROVED', notifiedStudents: false, notifiedEvaluators: false } })
      .mockResolvedValueOnce({ data: { status: 'APPROVED', notifiedStudents: true, notifiedEvaluators: false } });
    render(<StepReports academicPeriod="2026-2" onBackToReview={vi.fn()} onUnpublish={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Notificar a estudiantes')).toBeTruthy());

    fireEvent.click(screen.getByText('Notificar a estudiantes'));
    await waitFor(() => expect(notifyMock).toHaveBeenCalledWith({ academicPeriod: '2026-2', audience: 'students' }));
    await waitFor(() => expect(screen.getByText('Publicar').closest('button')).not.toBeDisabled());
  });

  it('publica y luego muestra el botón de exportar en vez de las notificaciones', async () => {
    getApprovalMock
      .mockResolvedValueOnce({ data: { status: 'APPROVED', notifiedStudents: true, notifiedEvaluators: false } })
      .mockResolvedValueOnce({ data: { status: 'PUBLISHED', notifiedStudents: true, notifiedEvaluators: false } });
    render(<StepReports academicPeriod="2026-2" onBackToReview={vi.fn()} onUnpublish={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Publicar')).toBeTruthy());

    fireEvent.click(screen.getByText('Publicar'));
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith('2026-2'));
    await waitFor(() => expect(screen.getByText('Exportar horario: documento editable')).toBeTruthy());
    expect(screen.queryByText('Notificar a estudiantes')).toBeNull();
  });

  it('"Volver a revisar / editar" llama a onBackToReview', async () => {
    getApprovalMock.mockResolvedValue({ data: { status: 'APPROVED', notifiedStudents: false, notifiedEvaluators: false } });
    const onBackToReview = vi.fn();
    render(<StepReports academicPeriod="2026-2" onBackToReview={onBackToReview} onUnpublish={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Volver a revisar / editar')).toBeTruthy());
    fireEvent.click(screen.getByText('Volver a revisar / editar'));
    expect(onBackToReview).toHaveBeenCalled();
  });

  it('"Quitar horario" pide confirmación y llama a onUnpublish', async () => {
    getApprovalMock.mockResolvedValue({ data: { status: 'APPROVED', notifiedStudents: false, notifiedEvaluators: false } });
    const onUnpublish = vi.fn();
    render(<StepReports academicPeriod="2026-2" onBackToReview={vi.fn()} onUnpublish={onUnpublish} />);
    await waitFor(() => expect(screen.getByText('Quitar horario')).toBeTruthy());
    fireEvent.click(screen.getByText('Quitar horario'));
    await waitFor(() => expect(unpublishMock).toHaveBeenCalledWith('2026-2'));
    await waitFor(() => expect(onUnpublish).toHaveBeenCalled());
  });
});
