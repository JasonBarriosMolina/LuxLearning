import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepEvaluacion } from './StepEvaluacion';
import type { Step1Data, Step2Data, Step3Data, Step4Data } from './constants';

vi.mock('lucide-react', () => ({
  GripVertical: () => null, Info: () => null, Plus: () => null, Trash2: () => null,
  Mic: () => null, Sparkles: () => null, Loader2: () => null, X: () => null, BookOpen: () => null,
  FlaskConical: () => null, FolderKanban: () => null, Clock: () => null, AlignLeft: () => null,
  ClipboardList: () => null, FileUp: () => null, CheckCircle: () => null,
}));

vi.mock('@/lib/api', () => ({ api: { admin: { courses: { get: vi.fn() } } } }));

const step1: Step1Data = {
  title: 'Curso Test', academicPeriod: '', classDays: [], classSchedule: '', classSchedules: {},
  modality: '', startDate: '', planLanguage: 'ES', courseType: 'TEORICO', description: '',
  imageUrl: '', cardColor: '', cardBorderColor: '', cardLabels: [],
};
const step2: Step2Data = { totalWeeks: 8, exceptions: [] };
const step3: Step3Data = {
  luxMentorWeeks: [],
  items: [{ id: 'i1', type: 'INTERVIEW', name: 'Entrevista', nameEN: 'Interview', weight: 10, count: 1, dueDates: [''], instructions: '' }],
};
const step4: Step4Data = { syllabusInput: '', weeklyPlan: [], modules: [], status: 'idle', error: '' };

const baseProps = {
  step1, step2, step3, step4,
  totalWeight: 10, weightOk: false,
  outOfRangeItems: [], dateWarningDismissed: false, setDateWarningDismissed: vi.fn(),
  updateItem: vi.fn(), updateDueDate: vi.fn(), setCount: vi.fn(), addEvalItem: vi.fn(), removeItem: vi.fn(),
  updateModuleQuizWeek: vi.fn(), updateModuleReflexWeek: vi.fn(),
  isEN: false, step5Error: '', editingCourseId: null,
};

describe('StepEvaluacion — sección INTERVIEW', () => {
  it('no muestra "Vapi" ni nombre técnico interno — dice Lux Mentor (bug: exponía "Configuración de Mentor (Vapi)")', () => {
    render(<StepEvaluacion {...baseProps} />);
    expect(screen.getByText('Configuración del Lux Mentor para la entrevista')).toBeInTheDocument();
    expect(screen.queryByText(/Vapi/i)).not.toBeInTheDocument();
  });
});
