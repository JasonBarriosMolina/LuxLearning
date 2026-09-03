import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GradesTable } from './GradesTable';

// Trello DmPpbrff, 2026-09-03 (Mack): "los quizzes... que tienen 0% o cualquier
// evaluación en 0% no deberían aparecer... más bien como no sumativa, hacer una
// sección especial, dropdown aparte."
function makeCourse(evaluationEvents: any[]) {
  return { modules: [], isCourseLocked: false, evaluationEvents };
}

describe('GradesTable — summative / non-summative split', () => {
  it('renders nothing when there are no evaluation events', () => {
    const { container } = render(<GradesTable course={makeCourse([])} courseId="c1" />);
    expect(container.firstChild).toBeNull();
  });

  it('puts weight > 0 items straight in the visible table', () => {
    render(<GradesTable course={makeCourse([{ id: 'e1', type: 'EXAM', name: 'Examen 1', weight: 40 }])} courseId="c1" />);
    expect(screen.getByText('Examen 1')).toBeTruthy();
    expect(screen.queryByText(/no sumativas/i)).toBeNull();
  });

  it('moves weight === 0 items out of the visible table into a collapsed non-summative section', () => {
    render(<GradesTable course={makeCourse([{ id: 'e1', type: 'QUIZ', name: 'Quiz de práctica', weight: 0 }])} courseId="c1" />);
    expect(screen.queryByText('Quiz de práctica')).toBeNull(); // collapsed by default
    expect(screen.getByText(/Actividades no sumativas \(1\)/i)).toBeTruthy();
  });

  it('treats a missing/undefined weight the same as 0 — also non-summative', () => {
    render(<GradesTable course={makeCourse([{ id: 'e1', type: 'ATTENDANCE', name: 'Asistencia' }])} courseId="c1" />);
    expect(screen.getByText(/Actividades no sumativas \(1\)/i)).toBeTruthy();
  });

  it('reveals the non-summative rows after clicking the toggle', () => {
    render(<GradesTable course={makeCourse([{ id: 'e1', type: 'QUIZ', name: 'Quiz de práctica', weight: 0 }])} courseId="c1" />);
    expect(screen.queryByText('Quiz de práctica')).toBeNull();
    fireEvent.click(screen.getByText(/Actividades no sumativas \(1\)/i));
    expect(screen.getByText('Quiz de práctica')).toBeTruthy();
  });

  it('renders both sections when there is a mix of summative and non-summative items', () => {
    render(<GradesTable course={makeCourse([
      { id: 'e1', type: 'EXAM', name: 'Examen Final', weight: 60 },
      { id: 'e2', type: 'QUIZ', name: 'Quiz Extra', weight: 0 },
    ])} courseId="c1" />);
    expect(screen.getByText('Examen Final')).toBeTruthy();
    expect(screen.getByText(/Actividades no sumativas \(1\)/i)).toBeTruthy();
    expect(screen.queryByText('Quiz Extra')).toBeNull();
  });
});
