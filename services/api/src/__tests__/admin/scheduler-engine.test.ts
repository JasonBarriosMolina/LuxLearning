import { describe, it, expect } from 'vitest';
import { generateScheduleProposals, findConflicts, type ScheduleInput, type TeacherInput, type CourseInput, type ScheduledSession, type RoomInput } from '../../admin/scheduler-engine';

function teacher(evaluatorId: string, overrides: Partial<TeacherInput> = {}): TeacherInput {
  return {
    evaluatorId,
    maxCoursesPerWeek: 5,
    // Trello *LUX SCHEDULER*, 2026-09-15 (Mack): weekday availability is only
    // valid from 6pm on — these fixtures reflect that hard rule.
    availability: [
      { dayOfWeek: 1, startTime: '18:00', endTime: '22:00' },
      { dayOfWeek: 2, startTime: '18:00', endTime: '22:00' },
      { dayOfWeek: 3, startTime: '18:00', endTime: '22:00' },
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
      teachers: [teacher('eval-1', { availability: [{ dayOfWeek: 1, startTime: '18:00', endTime: '19:00' }] })],
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

  // Trello *LUX SCHEDULER*, 2026-09-10 (Mack): teachers should be able to narrow
  // their own Saturday availability, not just the fixed 8am-4pm institutional window.
  it('keeps the full institutional Saturday window when a teacher declares no Saturday blocks (default)', () => {
    const input: ScheduleInput = {
      teachers: [teacher('eval-1')], // no dayOfWeek:6 block at all
      courses: [course('c1', 'eval-1', { modality: 'PRESENCIAL', classType: 'GRUPAL' })],
    };
    for (const proposal of generateScheduleProposals(input)) {
      expect(proposal.unscheduledCourseIds).toEqual([]);
    }
  });

  it('narrows Saturday to the teacher\'s own declared block when they set one', () => {
    const input: ScheduleInput = {
      teachers: [teacher('eval-1', { availability: [{ dayOfWeek: 6, startTime: '08:00', endTime: '09:00' }] })],
      courses: [course('c1', 'eval-1', { modality: 'PRESENCIAL', classType: 'GRUPAL' })], // 75min — doesn't fit in a 60min window
    };
    for (const proposal of generateScheduleProposals(input)) {
      expect(proposal.unscheduledCourseIds).toEqual(['c1']);
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

  // Trello *LUX SCHEDULER*, 2026-09-15 (Mack): "si el profesor pone una lección
  // antes de las 6 de la tarde, el sistema le debe indicar que está incorrecto...
  // esa disponibilidad no existe" — el motor recorta cualquier bloque de semana
  // que empiece antes de las 6pm (segunda capa de defensa; admin/scheduler.ts ya
  // rechaza esto al guardar).
  it('clips a weekday block to start no earlier than 6pm, even if declared earlier', () => {
    const input: ScheduleInput = {
      teachers: [teacher('eval-1', { availability: [{ dayOfWeek: 1, startTime: '14:00', endTime: '20:00' }] })],
      courses: [course('c1', 'eval-1', { durationOverrideMin: 90 })], // needs exactly the 18:00-20:00 remainder
    };
    for (const proposal of generateScheduleProposals(input)) {
      expect(proposal.unscheduledCourseIds).toEqual([]);
      expect(proposal.sessions[0]!.startTime >= '18:00').toBe(true);
    }
  });

  it('drops a weekday course entirely when the only declared block is fully before 6pm', () => {
    const input: ScheduleInput = {
      teachers: [teacher('eval-1', { availability: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }] })],
      courses: [course('c1', 'eval-1')],
    };
    for (const proposal of generateScheduleProposals(input)) {
      expect(proposal.sessions).toHaveLength(0);
      expect(proposal.unscheduledCourseIds).toEqual(['c1']);
    }
  });

  // Trello *LUX SCHEDULER*, 2026-09-15 (Mack): "vamos a agregar la opción de
  // aulas... 3 para 10 estudiantes, 1 grande para 15-20, 3 medianas para 5, 3
  // individuales." La aula más chica que alcance, sin chocar en el mismo
  // horario; nunca afecta si la clase se ubica o no.
  describe('assignRooms (via generateScheduleProposals)', () => {
    const rooms: RoomInput[] = [
      { id: 'small', capacity: 5 }, { id: 'medium', capacity: 10 }, { id: 'large', capacity: 20 },
    ];

    it('assigns the smallest room that fits a PRESENCIAL group class', () => {
      const input: ScheduleInput = {
        teachers: [teacher('eval-1')],
        courses: [course('c1', 'eval-1', { modality: 'PRESENCIAL', classType: 'GRUPAL', studentIds: ['s1', 's2', 's3', 's4', 's5', 's6'] })],
        rooms,
      };
      for (const p of generateScheduleProposals(input)) {
        expect(p.sessions[0]!.roomId).toBe('medium'); // 6 estudiantes no caben en "small" (cap 5)
      }
    });

    it('never double-books a room at an overlapping day/time', () => {
      const input: ScheduleInput = {
        teachers: [teacher('eval-1', { maxCoursesPerWeek: 10 }), teacher('eval-2', { maxCoursesPerWeek: 10 })],
        courses: [
          course('c1', 'eval-1', { modality: 'PRESENCIAL', classType: 'GRUPAL', studentIds: ['s1', 's2'] }),
          course('c2', 'eval-2', { modality: 'PRESENCIAL', classType: 'GRUPAL', studentIds: ['s3', 's4'] }),
        ],
        rooms: [{ id: 'only-room', capacity: 20 }], // solo 1 aula disponible
      };
      for (const p of generateScheduleProposals(input)) {
        const withRoom = p.sessions.filter((s) => s.roomId);
        // Si ambas clases cayeron en el mismo día/hora exacto, la única aula
        // no puede estar en las dos — como mucho una la consigue.
        const sameSlot = p.sessions[0]!.dayOfWeek === p.sessions[1]?.dayOfWeek && p.sessions[0]!.startTime === p.sessions[1]?.startTime;
        if (sameSlot) expect(withRoom.length).toBeLessThanOrEqual(1);
      }
    });

    it('leaves roomId unset (class still placed) when no room has enough capacity', () => {
      const input: ScheduleInput = {
        teachers: [teacher('eval-1')],
        courses: [course('c1', 'eval-1', { modality: 'PRESENCIAL', classType: 'GRUPAL', studentIds: Array.from({ length: 25 }, (_, i) => `s${i}`) })],
        rooms, // ninguna aula tiene capacidad 25
      };
      for (const p of generateScheduleProposals(input)) {
        expect(p.unscheduledCourseIds).toEqual([]); // se ubica igual
        expect(p.sessions[0]!.roomId).toBeUndefined();
      }
    });
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

  // Trello *LUX SCHEDULER*, 2026-09-15 (Mack): "puede haber una excepción para
  // un curso en especial; puede ser de 1 hora o similar" — durationOverrideMin
  // anula individualMinutes/groupMinutes SOLO para ese curso.
  it('durationOverrideMin overrides the global duration for just that course', () => {
    const input: ScheduleInput = {
      teachers: [teacher('eval-1')],
      courses: [course('c1', 'eval-1', { durationOverrideMin: 90 })],
      individualMinutes: 55,
    };
    const proposals = generateScheduleProposals(input);
    for (const p of proposals) {
      expect(p.sessions).toHaveLength(1);
      const s = p.sessions[0]!;
      const [sh, sm] = s.startTime.split(':').map(Number);
      const [eh, em] = s.endTime.split(':').map(Number);
      const minutes = (eh! * 60 + em!) - (sh! * 60 + sm!);
      expect(minutes).toBe(90);
    }
  });
});

function session(overrides: Partial<ScheduledSession> = {}): ScheduledSession {
  return {
    courseId: 'c1', evaluatorId: 'eval-1', dayOfWeek: 1, startTime: '08:00', endTime: '08:55',
    modality: 'VIRTUAL', classType: 'INDIVIDUAL', studentIds: ['s1'],
    ...overrides,
  };
}

// Trello *LUX SCHEDULER*, 2026-09-10 (Mack, Paso 7): manual edits need instant
// conflict feedback — this is the re-check the review-step UI calls after a
// hand edit, since placeCourse's own guarantees don't apply to hand-edited slots.
describe('findConflicts', () => {
  it('flags two sessions for the same teacher overlapping in time', () => {
    const sessions = [
      session({ courseId: 'c1', evaluatorId: 'eval-1', startTime: '08:00', endTime: '08:55', studentIds: ['s1'] }),
      session({ courseId: 'c2', evaluatorId: 'eval-1', startTime: '08:30', endTime: '09:25', studentIds: ['s2'] }),
    ];
    const conflicts = findConflicts({ sessions });
    expect(conflicts.some((c) => c.type === 'TEACHER_OVERLAP')).toBe(true);
  });

  it('flags a shared student across two different teachers at overlapping times', () => {
    const sessions = [
      session({ courseId: 'c1', evaluatorId: 'eval-1', startTime: '08:00', endTime: '08:55', studentIds: ['shared'] }),
      session({ courseId: 'c2', evaluatorId: 'eval-2', startTime: '08:30', endTime: '09:25', studentIds: ['shared'] }),
    ];
    const conflicts = findConflicts({ sessions });
    expect(conflicts.some((c) => c.type === 'STUDENT_OVERLAP')).toBe(true);
  });

  it('does not flag two non-overlapping sessions for the same teacher', () => {
    const sessions = [
      session({ evaluatorId: 'eval-1', startTime: '08:00', endTime: '08:55' }),
      session({ evaluatorId: 'eval-1', startTime: '09:00', endTime: '09:55' }),
    ];
    expect(findConflicts({ sessions })).toEqual([]);
  });

  it('flags a Saturday session that straddles the lunch break', () => {
    const sessions = [session({ dayOfWeek: 6, classType: 'GRUPAL', startTime: '11:30', endTime: '12:45' })];
    const conflicts = findConflicts({ sessions });
    expect(conflicts.some((c) => c.type === 'LUNCH_BREAK')).toBe(true);
  });

  it('flags a Saturday session moved outside the 8am-4pm institutional window', () => {
    const sessions = [session({ dayOfWeek: 6, startTime: '17:00', endTime: '17:55' })];
    const conflicts = findConflicts({ sessions });
    expect(conflicts.some((c) => c.type === 'OUTSIDE_SATURDAY_WINDOW')).toBe(true);
  });

  it('flags a teacher over their weekly workload cap when teachers are provided', () => {
    const sessions = [
      session({ courseId: 'c1', evaluatorId: 'eval-1', dayOfWeek: 1 }),
      session({ courseId: 'c2', evaluatorId: 'eval-1', dayOfWeek: 2 }),
    ];
    const conflicts = findConflicts({ sessions, teachers: [teacher('eval-1', { maxCoursesPerWeek: 1 })] });
    expect(conflicts.filter((c) => c.type === 'WORKLOAD_EXCEEDED')).toHaveLength(2);
  });

  it('skips the workload check entirely when no teachers are given', () => {
    const sessions = [
      session({ courseId: 'c1', evaluatorId: 'eval-1', dayOfWeek: 1 }),
      session({ courseId: 'c2', evaluatorId: 'eval-1', dayOfWeek: 2 }),
    ];
    expect(findConflicts({ sessions })).toEqual([]);
  });
});
