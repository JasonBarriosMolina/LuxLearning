import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeeklyGrid } from './WeeklyGrid';
import { studyPlanEs } from '@/lib/i18n/sections/study-plan';
import type { StudyPlan } from '../types';

// Trello Nk0XDBvJ, 2026-08-18 (Mack): "resolver la ambigüedad en Mentor's Learning
// Path donde las lecciones ... se muestran mezcladas sin identificar a qué curso
// corresponden" — cards grouped under a course header, keeping the existing
// MAX_VISIBLE/expand pagination untouched (grouping wraps the already-sliced list).

vi.mock('lucide-react', () => ({
  Plus: () => null, ChevronLeft: () => null, ChevronRight: () => null, BookOpen: () => null,
  Pin: () => null, CheckCircle2: () => null, Circle: () => null, Trash2: () => null,
  ChevronDown: () => null, ChevronUp: () => null,
}));
vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ t: studyPlanEs, lang: 'es' }) }));

function makePlan(itemsByDay0: StudyPlan['days'][number]['items']): StudyPlan {
  const days = Array.from({ length: 7 }, (_, i) => ({
    dayIndex: i, date: `2026-09-0${i + 1}`, items: i === 0 ? itemsByDay0 : [],
  }));
  return {
    userId: 'u1', weekOf: '2026-09-01', planId: 'p1', days,
    generatedBy: 'auto', createdAt: '', updatedAt: '',
  };
}

const noop = vi.fn();
const baseHandlers = { onTogglePin: noop, onToggleDone: noop, onRemove: noop, onAddItem: noop };

describe('WeeklyGrid — course grouping', () => {
  it('renders a course header with item count above cards from the same course', () => {
    const plan = makePlan([
      { id: '1', type: 'lesson', title: 'Lección 1', courseId: 'c1', courseTitle: 'Curso A', pinned: false, completed: false, source: 'auto' },
      { id: '2', type: 'lesson', title: 'Lección 2', courseId: 'c1', courseTitle: 'Curso A', pinned: false, completed: false, source: 'auto' },
    ]);
    render(<WeeklyGrid plan={plan} locked={false} {...baseHandlers} />);
    expect(screen.getAllByText('Curso A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0); // item count badge
  });

  it('renders separate headers for two different courses on the same day', () => {
    const plan = makePlan([
      { id: '1', type: 'lesson', title: 'Lección 1', courseId: 'c1', courseTitle: 'Curso A', pinned: false, completed: false, source: 'auto' },
      { id: '2', type: 'quiz', title: 'Quiz', courseId: 'c2', courseTitle: 'Curso B', pinned: false, completed: false, source: 'auto' },
    ]);
    render(<WeeklyGrid plan={plan} locked={false} {...baseHandlers} />);
    expect(screen.getAllByText('Curso A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Curso B').length).toBeGreaterThan(0);
  });

  it('renders items with no courseTitle (custom items) without a course header', () => {
    const plan = makePlan([
      { id: '1', type: 'custom', title: 'Nota personal', pinned: false, completed: false, source: 'student' },
    ]);
    render(<WeeklyGrid plan={plan} locked={false} {...baseHandlers} />);
    expect(screen.getAllByText('Nota personal').length).toBeGreaterThan(0);
  });

  it('still shows every item for a normal-sized day (grouping does not change the MAX_VISIBLE pagination)', () => {
    const plan = makePlan([
      { id: '1', type: 'lesson', title: 'Lección 1', courseId: 'c1', courseTitle: 'Curso A', pinned: false, completed: false, source: 'auto' },
      { id: '2', type: 'lesson', title: 'Lección 2', courseId: 'c1', courseTitle: 'Curso A', pinned: false, completed: false, source: 'auto' },
      { id: '3', type: 'lesson', title: 'Lección 3', courseId: 'c1', courseTitle: 'Curso A', pinned: false, completed: false, source: 'auto' },
    ]);
    render(<WeeklyGrid plan={plan} locked={false} {...baseHandlers} />);
    expect(screen.getAllByText('Lección 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lección 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lección 3').length).toBeGreaterThan(0);
  });
});
