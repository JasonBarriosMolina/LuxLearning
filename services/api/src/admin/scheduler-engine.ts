// ─── scheduler-engine.ts ──────────────────────────────────────────────────────
// Lux Scheduler (Trello *LUX SCHEDULER*, 2026-09-10) — pure constraint-based
// weekly schedule generator. No AWS/Prisma imports on purpose: this file is
// unit-testable in isolation, the domain module (scheduler.ts) does all the
// DB reads/writes and hands this function plain-object input.
//
// Algorithm: greedy slot-packing with a hard-constraint validator, run once
// per named strategy to produce 2-3 distinct candidate proposals. Not a full
// CP-SAT/ILP solver — no new native-binary dependency (lesson learned this
// session from sharp/detect-libc packaging pain), just hand-rolled greedy +
// per-slot conflict checks, which is enough for the scale here (tens of
// courses/teachers per academic period, not thousands).

export interface AvailabilityBlock {
  dayOfWeek: number; // 0=Sunday .. 6=Saturday
  startTime: string; // "HH:mm" 24h
  endTime: string;
}

export interface TeacherInput {
  evaluatorId: string;
  availability: AvailabilityBlock[]; // weekday blocks only matter (see WEEKDAYS below)
  maxCoursesPerWeek: number;
}

export type CourseModality = 'PRESENCIAL' | 'VIRTUAL';
export type ClassType = 'INDIVIDUAL' | 'GRUPAL';

export interface CourseInput {
  courseId: string;
  evaluatorId: string;
  modality: CourseModality;
  classType: ClassType;
  studentIds: string[]; // already resolved (group members or individual enrollments)
  studentGroupId?: string;
}

export interface LunchBreak {
  startTime: string;
  endTime: string;
}

export interface ScheduleInput {
  courses: CourseInput[];
  teachers: TeacherInput[];
  lunchBreak?: LunchBreak; // Saturday only, default 12:00-13:00
  gapMinutes?: number;     // soft preferred gap between a teacher's consecutive classes, default 5
  // Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "es importante que la opción de
  // cuántos minutos exactos pueda modificarse" — was a fixed 55/75 constant.
  individualMinutes?: number; // default 55
  groupMinutes?: number;      // default 75
}

export interface ScheduledSession {
  courseId: string;
  evaluatorId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  modality: CourseModality;
  classType: ClassType;
  studentGroupId?: string;
  studentIds: string[];
}

export interface ScheduleProposal {
  label: string;
  strategy: string;
  sessions: ScheduledSession[];
  unscheduledCourseIds: string[];
}

const SATURDAY = 6;
const WEEKDAYS = [1, 2, 3, 4, 5]; // Monday-Friday
const DEFAULT_LUNCH: LunchBreak = { startTime: '12:00', endTime: '13:00' };
const DEFAULT_DURATION_MIN: Record<ClassType, number> = { INDIVIDUAL: 55, GRUPAL: 75 };
const PREFERRED_GAP_MIN = 5;
const SLOT_STEP_MIN = 5; // candidate start-time granularity
const SATURDAY_OPEN = '08:00';
const SATURDAY_CLOSE = '16:00';

// ── Time helpers (plain HH:mm strings, minutes-since-midnight math) ────────
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

interface Window { start: number; end: number } // minutes-since-midnight

function subtractWindow(windows: Window[], hole: Window): Window[] {
  const out: Window[] = [];
  for (const w of windows) {
    if (hole.end <= w.start || hole.start >= w.end) { out.push(w); continue; } // no overlap
    if (hole.start > w.start) out.push({ start: w.start, end: Math.min(hole.start, w.end) });
    if (hole.end < w.end) out.push({ start: Math.max(hole.end, w.start), end: w.end });
  }
  return out.filter((w) => w.end > w.start);
}

function intersectWindows(a: Window[], b: Window[]): Window[] {
  const out: Window[] = [];
  for (const wa of a) {
    for (const wb of b) {
      const start = Math.max(wa.start, wb.start);
      const end = Math.min(wa.end, wb.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

/** Free windows for a teacher on a given day, before subtracting already-booked slots. */
function baseWindowsForDay(teacher: TeacherInput, dayOfWeek: number, lunch: LunchBreak): Window[] {
  if (dayOfWeek === SATURDAY) {
    const institutional = subtractWindow(
      [{ start: toMinutes(SATURDAY_OPEN), end: toMinutes(SATURDAY_CLOSE) }],
      { start: toMinutes(lunch.startTime), end: toMinutes(lunch.endTime) }
    );
    // Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "el día sábado no está incluido
    // en la opción que los evaluadores tienen para seleccionar disponibilidad...
    // agrega también el día sábado." A teacher who never declared a Saturday
    // block keeps the full institutional window (unchanged default behavior);
    // one who did narrows it to their own blocks intersected with 8am-4pm minus
    // lunch — so declaring "solo 8-11" actually excludes the rest of Saturday.
    const saturdayBlocks = teacher.availability
      .filter((b) => b.dayOfWeek === SATURDAY)
      .map((b) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) }));
    return saturdayBlocks.length ? intersectWindows(institutional, saturdayBlocks) : institutional;
  }
  return teacher.availability
    .filter((b) => b.dayOfWeek === dayOfWeek)
    .map((b) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) }))
    .filter((w) => w.end > w.start);
}

/** Tracks per-day booked windows for teachers and students across the run so far. */
class Bookings {
  private teacherDay = new Map<string, Window[]>(); // key: evaluatorId#dayOfWeek
  private studentDay = new Map<string, Window[]>(); // key: studentId#dayOfWeek

  private key(id: string, day: number) { return `${id}#${day}`; }

  private overlaps(list: Window[], win: Window): boolean {
    return list.some((b) => win.start < b.end && win.end > b.start);
  }

  teacherFree(evaluatorId: string, day: number, win: Window): boolean {
    return !this.overlaps(this.teacherDay.get(this.key(evaluatorId, day)) ?? [], win);
  }

  studentsFree(studentIds: string[], day: number, win: Window): boolean {
    return studentIds.every((sid) => !this.overlaps(this.studentDay.get(this.key(sid, day)) ?? [], win));
  }

  /** Minutes to the teacher's nearest booking that day (Infinity if none) — used for the soft gap preference. */
  teacherGapTo(evaluatorId: string, day: number, win: Window): number {
    const list = this.teacherDay.get(this.key(evaluatorId, day)) ?? [];
    if (!list.length) return Infinity;
    return Math.min(...list.map((b) => Math.min(Math.abs(win.start - b.end), Math.abs(b.start - win.end))));
  }

  book(evaluatorId: string, studentIds: string[], day: number, win: Window): void {
    const tk = this.key(evaluatorId, day);
    this.teacherDay.set(tk, [...(this.teacherDay.get(tk) ?? []), win]);
    for (const sid of studentIds) {
      const sk = this.key(sid, day);
      this.studentDay.set(sk, [...(this.studentDay.get(sk) ?? []), win]);
    }
  }
}

/** Try to place one course; returns the chosen session or null if no slot fits anywhere. */
function placeCourse(
  course: CourseInput,
  teacher: TeacherInput,
  bookings: Bookings,
  lunch: LunchBreak,
  workloadUsed: Map<string, number>,
  gapMinutes: number,
  durationMin: Record<ClassType, number>
): ScheduledSession | null {
  const used = workloadUsed.get(course.evaluatorId) ?? 0;
  if (used >= teacher.maxCoursesPerWeek) return null; // hard cap, no partial exceptions

  const duration = durationMin[course.classType];
  const days = course.modality === 'PRESENCIAL' ? [SATURDAY] : WEEKDAYS;

  // Two passes: first require the soft gap, then relax it if nothing fit.
  for (const requireGap of [true, false]) {
    for (const day of days) {
      const free = baseWindowsForDay(teacher, day, lunch);
      for (const w of free) {
        for (let start = w.start; start + duration <= w.end; start += SLOT_STEP_MIN) {
          const candidate: Window = { start, end: start + duration };
          if (!bookings.teacherFree(course.evaluatorId, day, candidate)) continue;
          if (!bookings.studentsFree(course.studentIds, day, candidate)) continue;
          if (requireGap && bookings.teacherGapTo(course.evaluatorId, day, candidate) < gapMinutes) continue;
          bookings.book(course.evaluatorId, course.studentIds, day, candidate);
          workloadUsed.set(course.evaluatorId, used + 1);
          return {
            courseId: course.courseId,
            evaluatorId: course.evaluatorId,
            dayOfWeek: day,
            startTime: toHHMM(candidate.start),
            endTime: toHHMM(candidate.end),
            modality: course.modality,
            classType: course.classType,
            studentGroupId: course.studentGroupId,
            studentIds: course.studentIds,
          };
        }
      }
    }
  }
  return null;
}

function runStrategy(input: ScheduleInput, order: CourseInput[], label: string, strategy: string): ScheduleProposal {
  const lunch = input.lunchBreak ?? DEFAULT_LUNCH;
  const gapMinutes = input.gapMinutes ?? PREFERRED_GAP_MIN;
  const durationMin: Record<ClassType, number> = {
    INDIVIDUAL: input.individualMinutes ?? DEFAULT_DURATION_MIN.INDIVIDUAL,
    GRUPAL: input.groupMinutes ?? DEFAULT_DURATION_MIN.GRUPAL,
  };
  const teacherById = new Map(input.teachers.map((t) => [t.evaluatorId, t]));
  const bookings = new Bookings();
  const workloadUsed = new Map<string, number>();
  const sessions: ScheduledSession[] = [];
  const unscheduledCourseIds: string[] = [];

  for (const course of order) {
    const teacher = teacherById.get(course.evaluatorId);
    if (!teacher) { unscheduledCourseIds.push(course.courseId); continue; }
    const placed = placeCourse(course, teacher, bookings, lunch, workloadUsed, gapMinutes, durationMin);
    if (placed) sessions.push(placed);
    else unscheduledCourseIds.push(course.courseId);
  }

  return { label, strategy, sessions, unscheduledCourseIds };
}

/**
 * Generates 2-3 candidate weekly schedules by running the same greedy placer
 * with different course-processing orders. Each proposal is independently
 * hard-constraint-safe by construction (placeCourse never returns an
 * overlapping slot) — no separate validation pass needed.
 */
export function generateScheduleProposals(input: ScheduleInput): ScheduleProposal[] {
  const { courses } = input;

  // "Compacta" — group by teacher so each teacher's sessions get packed as
  // tightly together as the greedy placer's gap preference allows.
  const compactOrder = [...courses].sort((a, b) => a.evaluatorId.localeCompare(b.evaluatorId));

  // "Balanceada" — round-robin across teachers so no single teacher's block
  // of courses gets first pick of every early slot before others get a turn.
  const byTeacher = new Map<string, CourseInput[]>();
  for (const c of courses) byTeacher.set(c.evaluatorId, [...(byTeacher.get(c.evaluatorId) ?? []), c]);
  const teacherIds = [...byTeacher.keys()];
  const balancedOrder: CourseInput[] = [];
  let remaining = courses.length;
  let round = 0;
  while (remaining > 0) {
    for (const tid of teacherIds) {
      const bucket = byTeacher.get(tid)!;
      if (bucket[round]) { balancedOrder.push(bucket[round]); remaining--; }
    }
    round++;
  }

  // "Inversa" — same grouping as "compacta" but reverse teacher order, cheap
  // way to get a genuinely different third option without new logic.
  const reverseOrder = [...compactOrder].reverse();

  return [
    runStrategy(input, compactOrder, 'Opción A — Compacta', 'compact'),
    runStrategy(input, balancedOrder, 'Opción B — Balanceada', 'balanced'),
    runStrategy(input, reverseOrder, 'Opción C — Alternativa', 'reverse'),
  ];
}

// ── Manual-edit conflict checking ───────────────────────────────────────────
// Trello *LUX SCHEDULER*, 2026-09-10 (Mack, Paso 7): "si un movimiento manual
// genera un choque, el sistema arroja una alerta preventiva inmediata." The
// generator never needs this (placeCourse only ever returns conflict-free
// slots by construction) — this is for re-checking a session list AFTER the
// admin hand-edits a day/time in the review step, where anything goes.

export type ConflictType = 'TEACHER_OVERLAP' | 'STUDENT_OVERLAP' | 'LUNCH_BREAK' | 'OUTSIDE_SATURDAY_WINDOW' | 'WORKLOAD_EXCEEDED';

export interface Conflict {
  sessionIndex: number;
  withIndex?: number; // the other session index it collides with, if applicable
  type: ConflictType;
  message: string;
}

export interface ConflictCheckInput {
  sessions: ScheduledSession[];
  lunchBreak?: LunchBreak;
  teachers?: TeacherInput[]; // optional — pass to also flag workload-cap violations
}

export function findConflicts({ sessions, lunchBreak, teachers }: ConflictCheckInput): Conflict[] {
  const lunch = lunchBreak ?? DEFAULT_LUNCH;
  const conflicts: Conflict[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const a = sessions[i]!;
    for (let j = i + 1; j < sessions.length; j++) {
      const b = sessions[j]!;
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (!(a.startTime < b.endTime && b.startTime < a.endTime)) continue; // no time overlap
      if (a.evaluatorId === b.evaluatorId) {
        conflicts.push({ sessionIndex: i, withIndex: j, type: 'TEACHER_OVERLAP', message: `El profesor ya tiene otra clase a esa hora (choca con la sesión ${j + 1}).` });
      }
      if (a.studentIds.some((s) => b.studentIds.includes(s))) {
        conflicts.push({ sessionIndex: i, withIndex: j, type: 'STUDENT_OVERLAP', message: `Un estudiante ya tiene otra clase a esa hora (choca con la sesión ${j + 1}).` });
      }
    }

    const s = sessions[i]!;
    if (s.dayOfWeek === SATURDAY) {
      if (s.startTime < SATURDAY_OPEN || s.endTime > SATURDAY_CLOSE) {
        conflicts.push({ sessionIndex: i, type: 'OUTSIDE_SATURDAY_WINDOW', message: `Fuera del horario institucional de sábado (${SATURDAY_OPEN}-${SATURDAY_CLOSE}).` });
      }
      if (s.startTime < lunch.endTime && lunch.startTime < s.endTime) {
        conflicts.push({ sessionIndex: i, type: 'LUNCH_BREAK', message: `Choca con el bloque de almuerzo obligatorio (${lunch.startTime}-${lunch.endTime}).` });
      }
    }
  }

  if (teachers) {
    const capByTeacher = new Map(teachers.map((t) => [t.evaluatorId, t.maxCoursesPerWeek]));
    const countByTeacher = new Map<string, number>();
    for (const s of sessions) countByTeacher.set(s.evaluatorId, (countByTeacher.get(s.evaluatorId) ?? 0) + 1);
    sessions.forEach((s, i) => {
      const cap = capByTeacher.get(s.evaluatorId);
      const count = countByTeacher.get(s.evaluatorId) ?? 0;
      if (cap != null && count > cap) {
        conflicts.push({ sessionIndex: i, type: 'WORKLOAD_EXCEEDED', message: `El profesor supera su tope de ${cap} curso(s)/semana (tiene ${count}).` });
      }
    });
  }

  return conflicts;
}
