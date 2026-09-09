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

// Trello DmPpbrff, 2026-09-04 (Mack): "en sistema de evaluación, debe poder verse el
// número de semana correspondiente a la fecha del entregable."
describe('GradesTable — week number next to the due date', () => {
  function makeCourseWithDates(startDate: string, evaluationEvents: any[]) {
    return { modules: [], isCourseLocked: false, startDate, evaluationEvents };
  }

  it('shows the week number derived from the course startDate', () => {
    render(<GradesTable
      course={makeCourseWithDates('2026-01-05', [{ id: 'e1', type: 'EXAM', name: 'Examen 1', weight: 40, dueDate: '2026-01-19' }])}
      courseId="c1"
    />);
    // 2026-01-19 is 14 days after 2026-01-05 -> week 3
    expect(screen.getByText(/S3/)).toBeTruthy();
  });

  it('renders no week marker when the course has no startDate', () => {
    render(<GradesTable
      course={{ modules: [], isCourseLocked: false, evaluationEvents: [{ id: 'e1', type: 'EXAM', name: 'Examen 1', weight: 40, dueDate: '2026-01-19' }] }}
      courseId="c1"
    />);
    expect(screen.queryByText(/S\d/)).toBeNull();
  });

  it('renders no week marker when the event has no dueDate', () => {
    render(<GradesTable
      course={makeCourseWithDates('2026-01-05', [{ id: 'e1', type: 'EXAM', name: 'Examen 1', weight: 40 }])}
      courseId="c1"
    />);
    expect(screen.queryByText(/S\d/)).toBeNull();
  });
});

// Trello DmPpbrff, 2026-09-07 (Mack): "el estudiante debe poder ver todo
// categorizado... trabajo cotidiano todo junto, las tareas todas juntas..."
describe('GradesTable — categorized (Trabajo Cotidiano / Tareas / Pruebas)', () => {
  it('groups same-name EVIDENCE instances ("Tareas 1", "Tareas 2") under one "Tareas" category header', () => {
    render(<GradesTable course={makeCourse([
      { id: 'e1', type: 'EVIDENCE', name: 'Tareas 1', weight: 10, dueDate: null },
      { id: 'e2', type: 'EVIDENCE', name: 'Tareas 2', weight: 10, dueDate: null },
    ])} courseId="c1" />);
    expect(screen.getByText('Tareas')).toBeTruthy(); // category header, count "(2)" is a separate nested node
    expect(screen.getByText('(2)')).toBeTruthy();
    expect(screen.getByText('Tareas 1')).toBeTruthy();
    expect(screen.getByText('Tareas 2')).toBeTruthy();
  });

  it('keeps "Trabajo Cotidiano" and "Tareas" as separate categories even though both are type EVIDENCE', () => {
    render(<GradesTable course={makeCourse([
      { id: 'e1', type: 'EVIDENCE', name: 'Trabajo Cotidiano 1', weight: 15, dueDate: null },
      { id: 'e2', type: 'EVIDENCE', name: 'Trabajo Cotidiano 2', weight: 15, dueDate: null },
      { id: 'e3', type: 'EVIDENCE', name: 'Tareas 1', weight: 10, dueDate: null },
      { id: 'e4', type: 'EVIDENCE', name: 'Tareas 2', weight: 10, dueDate: null },
      { id: 'e5', type: 'EXAM', name: 'Pruebas 1', weight: 25, dueDate: null },
      { id: 'e6', type: 'EXAM', name: 'Pruebas 2', weight: 25, dueDate: null },
    ])} courseId="c1" />);
    // Exact match: each category header's own text is the bare base name
    // ("Trabajo Cotidiano"), distinct from a row's "Trabajo Cotidiano 1".
    expect(screen.getByText('Trabajo Cotidiano')).toBeTruthy();
    expect(screen.getByText('Tareas')).toBeTruthy();
    expect(screen.getByText('Pruebas')).toBeTruthy();
    // All 6 instances still render, just grouped under 3 headers
    expect(screen.getByText('Trabajo Cotidiano 1')).toBeTruthy();
    expect(screen.getByText('Tareas 2')).toBeTruthy();
    expect(screen.getByText('Pruebas 1')).toBeTruthy();
  });

  it('a lone one-off item (no repeated instances) renders as a bare row, no redundant accordion header', () => {
    render(<GradesTable course={makeCourse([{ id: 'e1', type: 'EXAM', name: 'Examen Final', weight: 50 }])} courseId="c1" />);
    expect(screen.getAllByText('Examen Final')).toHaveLength(1); // only the row, no duplicate header
  });

  it('categories with several instances start expanded — items visible without clicking', () => {
    render(<GradesTable course={makeCourse([
      { id: 'e1', type: 'EXAM', name: 'Pruebas 1', weight: 25 },
      { id: 'e2', type: 'EXAM', name: 'Pruebas 2', weight: 25 },
    ])} courseId="c1" />);
    expect(screen.getByText('Pruebas 1')).toBeTruthy();
    expect(screen.getByText('Pruebas 2')).toBeTruthy();
  });

  it('collapses a multi-instance category on click and hides its rows', () => {
    render(<GradesTable course={makeCourse([
      { id: 'e1', type: 'EXAM', name: 'Pruebas 1', weight: 25 },
      { id: 'e2', type: 'EXAM', name: 'Pruebas 2', weight: 25 },
    ])} courseId="c1" />);
    fireEvent.click(screen.getByText('Pruebas')); // exact match — the header, not a row
    expect(screen.queryByText('Pruebas 1')).toBeNull();
    expect(screen.queryByText('Pruebas 2')).toBeNull();
  });
});
