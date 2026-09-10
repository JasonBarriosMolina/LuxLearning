import { describe, it, expect } from 'vitest';
import { generateScheduleProposals, type ScheduleInput, type TeacherInput, type CourseInput } from '../../admin/scheduler-engine';

function teacher(evaluatorId: string, overrides: Partial<TeacherInput> = {}): TeacherInput {
  return {
    evaluatorId,
    maxCoursesPerWeek: 5,
    availability: [
      { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' },
      { dayOfWeek: 2, startTime: '08:00', endTime: '12:00' },
      { dayOfWeek: 3, startTime: '08:00', endTime: '12:00' },
    ],
    ...overrides,
  };
}

function course(courseId: string, evaluatorId: string, overrides: Partial<CourseInput> = {}): CourseInput {
  return {
    courseId, evaluatorId,
    modality: 'VIRTUAL', classType: 'INDIVIDUAL',
    studentIds: [`student-of-${courseId}`],
    ...overrides,
  };
}

// Every proposal must place each session inside a valid window and never
// overlap another session for the same teacher or any shared student.
function assertNoOverlaps(sessions: ReturnType<typeof generateScheduleProposals>[number]['sessions']) {
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i]!, b = sessions[j]!;
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      const overlap = a.startTime < b.endTime && b.startTime < a.endTime;
      if (!overlap) continue;
      // Overlap is only a bug if it's the same teacher or a shared student.
      const sameTeacher = a.evaluatorId === b.evaluatorId;
      const sharedStudent = a.studentIds.some((s) => b.studentIds.includes(s));
      expect({ sameTeacher, sharedStudent, a, b }).toEqual({ sameTeacher: false, sharedStudent: false, a, b });
    }
  }
}

describe('generateScheduleProposals', () => {
  it('two teachers, two independent courses — both placed, no conflicts', () => {
    const input: ScheduleInput = {
      teachers: [teacher('eval-1'), teacher('eval-2')],
      courses: [course('c1', 'eval-1'), course('c2', 'eval-2')],
    };
    for (const proposal of generateScheduleProposals(input)) {
      expect(proposal.unscheduledCourseIds).toEqual([]);
      expect(proposal.sessions).toHaveLength(2);
      assertNoOverlaps(proposal.sessions);
    }
  });

  it('rejects a course once the teacher hits maxCoursesPerWeek', () => {
    const input: ScheduleInput = {
      teachers: [teacher('eval-1', { maxCoursesPerWeek: 1 })],
      courses: [course('c1', 'eval-1'), course('c2', 'eval-1')],
    };
    for (const proposal of generateScheduleProposals(input)) {
      expect(proposal.sessions).toHaveLength(1);
      expect(proposal.unscheduledCourseIds).toHaveLength(1);
    }
  });

  it('never double-books a student shared across two courses with the same teacher availability', () => {
    // Same teacher, same student in both courses, teacher only has ONE viable
    // 55-min slot pattern (a single Monday morning block) — the two courses
    // cannot both use the exact same instant, so the engine must offset them.
    const input: ScheduleInput = {
      teachers: [teacher('eval-1', { availability: [{ dayOfWeek: 1, startTime: '08:00', endTime: '09:00' }] })],
      courses: [
        course('c1', 'eval-1', { studentIds: ['shared-student'] }),
        course('c2', 'eval-1', { studentIds: ['shared-student'] }),
      ],
    };
    for (const proposal of generateScheduleProposals(input)) {
      assertNoOverlaps(proposal.sessions);
    }
  });

  it('Saturday sessions never straddle the lunch break', () => {
    const input: ScheduleInput = {
      teachers: [teacher('eval-1', { maxCoursesPerWeek: 10 })],
      courses: Array.from({ length: 6 }, (_, i) => course(`c${i}`, 'eval-1', { modality: 'PRESENCIAL', classType: 'GRUPAL' })),
    };
    for (const proposal of generateScheduleProposals(input)) {
      for (const s of proposal.sessions) {
        expect(s.dayOfWeek).toBe(6);
        const straddlesLunch = s.startTime < '13:00' && s.endTime > '12:00';
        expect(straddlesLunch).toBe(false);
      }
    }
  });

  it('marks courses unscheduled instead of dropping them when no slot fits', () => {
    const input: ScheduleInput = {
      teachers: [teacher('eval-1', { availability: [] })], // zero weekday availability
      courses: [course('c1', 'eval-1', { modality: 'VIRTUAL' })],
    };
    for (const proposal of generateScheduleProposals(input)) {
      expect(proposal.sessions).toHaveLength(0);
      expect(proposal.unscheduledCourseIds).toEqual(['c1']);
    }
  });

  it('returns 3 differently-labeled proposals', () => {
    const input: ScheduleInput = {
      teachers: [teacher('eval-1'), teacher('eval-2')],
      courses: [course('c1', 'eval-1'), course('c2', 'eval-2')],
    };
    const proposals = generateScheduleProposals(input);
    expect(proposals).toHaveLength(3);
    expect(new Set(proposals.map((p) => p.strategy)).size).toBe(3);
  });
});
