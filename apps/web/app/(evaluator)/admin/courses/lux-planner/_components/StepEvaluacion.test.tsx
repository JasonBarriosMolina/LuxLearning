import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepEvaluacion } from './StepEvaluacion';
import type { Step1Data, Step2Data, Step3Data, Step4Data } from './constants';

vi.mock('lucide-react', () => ({
  GripVertical: () => null, Info: () => null, Plus: () => null, Trash2: () => null,
  Mic: () => null, Sparkles: () => null, Loader2: () => null, X: () => null, BookOpen: () => null,
  FlaskConical: () => null, FolderKanban: () => null, Clock: () => null, AlignLeft: () => null,
  ClipboardList: () => null, FileUp: () => null, CheckCircle: () => null,
  Calendar: () => null, ChevronLeft: () => null, ChevronRight: () => null,
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
  updateItem: vi.fn(), updateDueDate: vi.fn(), updateInstructionAt: vi.fn(), setCount: vi.fn(), addEvalItem: vi.fn(), removeItem: vi.fn(),
  updateModuleQuizWeek: vi.fn(), updateModuleReflexWeek: vi.fn(), updateModuleInterviewWeek: vi.fn(),
  isEN: false, step5Error: '', editingCourseId: null,
};

describe('StepEvaluacion — sección INTERVIEW', () => {
  it('no muestra "Vapi" ni nombre técnico interno — dice Lux Mentor (bug: exponía "Configuración de Mentor (Vapi)")', () => {
    render(<StepEvaluacion {...baseProps} />);
    expect(screen.getByText('Configuración del Lux Mentor para la entrevista')).toBeInTheDocument();
    expect(screen.queryByText(/Vapi/i)).not.toBeInTheDocument();
  });
});

// Trello DmPpbrff comment 6a9269e2 — interview should be an optional per-module selector
// in Lux Planner, same UX pattern as the quiz/reflection week dropdowns (not tied to the
// Lux Mentor CLASS mechanism).
describe('StepEvaluacion — selector de Entrevista por módulo', () => {
  const step4WithModule: Step4Data = {
    ...step4,
    weeklyPlan: [{ weekNum: 1, topics: ['Tema 1'] } as any],
    modules: [{ name: 'Módulo 1', nameEN: 'Module 1', description: '', descriptionEN: '', weeks: [1] }],
  };

  it('muestra el selector de semana de Entrevista junto a Quiz y Reflexión, por módulo', () => {
    render(<StepEvaluacion {...baseProps} step4={step4WithModule} />);
    expect(screen.getByText('Módulos — Quiz, Reflexión y Entrevista')).toBeInTheDocument();
    expect(screen.getByText('Entrevista')).toBeInTheDocument();
  });
});

// Trello DmPpbrff, 2026-09-04 (Mack): sessions "según lo que dure el curso... el
// evaluador puede poner un máximo" — default the count to the course's total weeks
// when switching an item TO PROYECTO, so the evaluator gets one session per week
// out of the box and can still adjust it with the existing +/- stepper.
describe('StepEvaluacion — PROYECTO defaults the session count to the course length', () => {
  it('sets count and dueDates to totalWeeks when switching an untouched (count=1) item to PROYECTO', () => {
    const updateItem = vi.fn();
    const stepWithEvidence: Step3Data = {
      luxMentorWeeks: [],
      items: [{ id: 'i1', type: 'EVIDENCE', name: 'Entrega', nameEN: 'Submission', weight: 40, count: 1, dueDates: [''], instructions: '' }],
    };
    render(<StepEvaluacion {...baseProps} step2={{ totalWeeks: 6, exceptions: [] }} step3={stepWithEvidence} updateItem={updateItem} />);

    fireEvent.click(screen.getByText('Proyecto'));

    expect(updateItem).toHaveBeenCalledWith('i1', { type: 'PROYECTO', count: 6, dueDates: ['', '', '', '', '', ''] });
  });

  it('does not override an already-customized count when switching to PROYECTO', () => {
    const updateItem = vi.fn();
    const stepWithEvidence: Step3Data = {
      luxMentorWeeks: [],
      items: [{ id: 'i1', type: 'EVIDENCE', name: 'Entrega', nameEN: 'Submission', weight: 40, count: 3, dueDates: ['', '', ''], instructions: '' }],
    };
    render(<StepEvaluacion {...baseProps} step2={{ totalWeeks: 6, exceptions: [] }} step3={stepWithEvidence} updateItem={updateItem} />);

    fireEvent.click(screen.getByText('Proyecto'));

    expect(updateItem).toHaveBeenCalledWith('i1', { type: 'PROYECTO' });
  });
});
