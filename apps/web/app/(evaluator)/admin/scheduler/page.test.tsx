import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SchedulerPage from './page';

// Trello *LUX SCHEDULER* (Mack, 2026-09-10): "debería haber siempre una opción
// disponible para guardar como borrador... por si le doy atrás sin querer".
// These tests isolate the draft save/restore logic in page.tsx by stubbing
// out every Step child — the wizard's own state machine is what's under test.

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ role: 'ADMIN' }),
}));

vi.mock('@/lib/api', () => ({
  api: { admin: { scheduler: { generate: vi.fn() } } },
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
  beforeEach(() => localStorage.clear());
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
