import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StudentProfileModal } from './StudentProfileModal';
import type { Student } from './types';

// Trello DmPpbrff, 2026-09-07 (Mack): "entender... desde el perfil del
// estudiante en qué cursos llegó o qué semestres llevó cursos."
function makeStudent(courses: Student['courses']): Student {
  return {
    userId: 'u1', studentName: 'Ana Perez', studentEmail: 'ana@test.com',
    courses, presenceStatus: 'online',
  };
}

function makeCourse(overrides: Partial<Student['courses'][number]> = {}): Student['courses'][number] {
  return {
    courseId: 'c1', title: 'Curso 1', totalLessons: 10, completedLessons: 5,
    progressPct: 50, modulesApproved: 1, modules: [],
    ...overrides,
  };
}

describe('StudentProfileModal — academicPeriod / semesters', () => {
  it('shows a per-course period badge next to the course title (plus the header semester summary)', () => {
    render(<StudentProfileModal student={makeStudent([makeCourse({ academicPeriod: '2026-1' })])} onClose={() => {}} />);
    expect(screen.getAllByText('2026-1')).toHaveLength(2); // header summary + course badge
  });

  it('does not render a period badge for a course with no academicPeriod', () => {
    render(<StudentProfileModal student={makeStudent([makeCourse({ academicPeriod: null })])} onClose={() => {}} />);
    expect(screen.queryByText('2026-1')).toBeNull();
  });

  it('summarizes distinct semesters once in the header, even with repeated periods across courses', () => {
    render(<StudentProfileModal student={makeStudent([
      makeCourse({ courseId: 'c1', title: 'Curso 1', academicPeriod: '2026-1' }),
      makeCourse({ courseId: 'c2', title: 'Curso 2', academicPeriod: '2026-1' }),
      makeCourse({ courseId: 'c3', title: 'Curso 3', academicPeriod: '2026-2' }),
    ])} onClose={() => {}} />);
    // Header summary badge + the per-course badges: "2026-1" appears 3 times total
    // (1 header + 2 courses), "2026-2" appears twice (1 header + 1 course).
    expect(screen.getAllByText('2026-1')).toHaveLength(3);
    expect(screen.getAllByText('2026-2')).toHaveLength(2);
  });

  it('renders no semester summary when no course has a period', () => {
    render(<StudentProfileModal student={makeStudent([makeCourse({ academicPeriod: null })])} onClose={() => {}} />);
    expect(screen.queryByText(/\d{4}-\d/)).toBeNull();
  });
});
