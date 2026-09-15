import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SchedulerPage from './page';

// Trello *LUX SCHEDULER* (Mack, 2026-09-10): "debería haber siempre una opción
// disponible para guardar como borrador... por si le doy atrás sin querer".
// These tests isolate the draft save/restore logic in page.tsx by stubbing
// out every Step child — the wizard's own state machine is what's under test.

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ role: 'ADMIN' }),
}));

const getApprovalMock = vi.fn().mockResolvedValue({ data: null });
vi.mock('@/lib/api', () => ({
  api: { admin: { scheduler: { generate: vi.fn(), getApproval: (...a: any[]) => getApprovalMock(...a) } } },
}));

vi.mock('./_components/WizardShell', () => ({
  WizardShell: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('./_components/StepPeriod', () => ({
  StepPeriod: ({ academicPeriod, onChange }: any) => (
    <input aria-label="periodo" value={academicPeriod} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('./_components/StepParams', () => ({ StepParams: () => <div>params</div> }));
vi.mock('./_components/StepCourses', () => ({ StepCourses: () => <div>courses</div> }));
vi.mock('./_components/StepAvailability', () => ({ StepAvailability: () => <div>availability</div> }));
vi.mock('./_components/StepStudents', () => ({ StepStudents: () => <div>students</div> }));
vi.mock('./_components/StepGenerate', () => ({ StepGenerate: () => <div>generate</div> }));
vi.mock('./_components/StepReview', () => ({ StepReview: () => <div>review</div> }));
vi.mock('./_components/StepReports', () => ({ StepReports: () => <div>reports</div> }));

const DRAFT_KEY = 'lux-scheduler-draft-v1';

describe('SchedulerPage — borrador local', () => {
  beforeEach(() => { localStorage.clear(); getApprovalMock.mockClear(); getApprovalMock.mockResolvedValue({ data: null }); });
  afterEach(() => localStorage.clear());

  it('guarda un borrador en localStorage cuando se define el período académico', async () => {
    render(<SchedulerPage />);
    fireEvent.change(screen.getByLabelText('periodo'), { target: { value: 'Segundo Semestre 2026' } });
    const raw = localStorage.getItem(DRAFT_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).academicPeriod).toBe('Segundo Semestre 2026');
  });

  it('restaura el borrador guardado al montar y muestra el aviso', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      step: 2, academicPeriod: 'Primer Semestre 2027', lunchStart: '12:00', lunchEnd: '13:00',
      gapMinutes: 5, individualMinutes: 55, groupMinutes: 75, courses: [], overrides: {},
    }));
    render(<SchedulerPage />);
    expect(screen.getByText('Se restauró tu borrador guardado.')).toBeTruthy();
    expect(screen.getByText('params')).toBeTruthy(); // paso 2 restaurado
  });

  it('"Empezar de nuevo" borra el borrador y vuelve al paso 1', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      step: 3, academicPeriod: 'Primer Semestre 2027', lunchStart: '12:00', lunchEnd: '13:00',
      gapMinutes: 5, individualMinutes: 55, groupMinutes: 75, courses: [], overrides: {},
    }));
    render(<SchedulerPage />);
    fireEvent.click(screen.getByText('Empezar de nuevo'));
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(screen.getByLabelText('periodo')).toHaveValue('');
  });
});

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "cuando yo vuelva a Lux
// Scheduler, yo tengo que tener la opción de volver a previsualizar cómo
// quedó eso final."
describe('SchedulerPage — resume de horario ya aprobado/publicado', () => {
  beforeEach(() => { localStorage.clear(); getApprovalMock.mockClear(); });
  afterEach(() => localStorage.clear());

  it('muestra el banner de resume cuando el período ya tiene una aprobación', async () => {
    getApprovalMock.mockResolvedValue({ data: { status: 'APPROVED', proposalJson: { proposal: { sessions: [] }, courseTitles: {}, teacherNames: {} } } });
    render(<SchedulerPage />);
    fireEvent.change(screen.getByLabelText('periodo'), { target: { value: 'II Semestre 2026' } });
    await waitFor(() => expect(screen.getByText(/aprobado \(sin publicar\)/)).toBeTruthy());
  });

  it('"Ver / continuar" salta al paso de revisión con el candidato guardado', async () => {
    getApprovalMock.mockResolvedValue({ data: { status: 'APPROVED', proposalJson: { proposal: { label: 'A', sessions: [] }, courseTitles: {}, teacherNames: {} } } });
    render(<SchedulerPage />);
    fireEvent.change(screen.getByLabelText('periodo'), { target: { value: 'II Semestre 2026' } });
    await waitFor(() => expect(screen.getByText('Ver / continuar')).toBeTruthy());
    fireEvent.click(screen.getByText('Ver / continuar'));
    await waitFor(() => expect(screen.getByText('review')).toBeTruthy());
  });

  it('no muestra el banner cuando no hay nada aprobado para ese período', async () => {
    getApprovalMock.mockResolvedValue({ data: null });
    render(<SchedulerPage />);
    fireEvent.change(screen.getByLabelText('periodo'), { target: { value: 'Nunca Usado 2099' } });
    await waitFor(() => expect(getApprovalMock).toHaveBeenCalled());
    expect(screen.queryByText('Ver / continuar')).toBeNull();
  });
});
