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
  // Trello *LUX SCHEDULER*, 2026-09-15 (Mack): "puede haber una excepción para
  // un curso en especial; puede ser de 1 hora o similar" — anula el
  // individualMinutes/groupMinutes global SOLO para este curso.
  durationOverrideMin?: number;
  // Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "yo quisiera que se
  // respete que ese Ensamble Instrumental se dé siempre en el aula de
  // ensayos... eso bloquearía el uso de ese aula para un horario en
  // específico directamente para ese curso." Solo aplica a PRESENCIAL — un
  // aula pineada se asigna directo, sin pasar por assignRooms(), y bloquea
  // ese hueco para el auto-assign de los demás cursos.
  pinnedRoomId?: string;
}

export interface LunchBreak {
  startTime: string;
  endTime: string;
}

export interface ScheduleInput {
  courses: CourseInput[];
  teachers: TeacherInput[];
  lunchBreak?: LunchBreak; // aplica a los días presenciales, default 12:00-13:00
  gapMinutes?: number;     // soft preferred gap between a teacher's consecutive classes, default 5
  // Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "es importante que la opción de
  // cuántos minutos exactos pueda modificarse" — was a fixed 55/75 constant.
  individualMinutes?: number; // default 55
  groupMinutes?: number;      // default 75
  rooms?: RoomInput[];        // Trello *LUX SCHEDULER*, 2026-09-15 (Mack) — solo se usan para sesiones PRESENCIAL
  // Trello *LUX SCHEDULER*, 2026-09-15 (Mack): "vamos a pensar en diferentes
  // centros educativos... que se puedan elegir los días de la semana que son
  // cursos presenciales [y] los días que son cursos virtuales... así
  // funcionaría con cualquier centro educativo." Antes sábado=presencial y
  // lunes-viernes=virtual estaban fijos en el código; ahora son configurables
  // por período, con esos mismos valores como default (domingo nunca es
  // día de clase, en ningún caso).
  presencialDays?: number[];    // default [6] (sábado)
  virtualDays?: number[];       // default [1,2,3,4,5] (lunes-viernes)
  institutionalOpen?: string;   // horario de los días presenciales, default '08:00'
  institutionalClose?: string;  // default '16:00'
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
  // Trello *LUX SCHEDULER*, 2026-09-15 (Mack): "vamos a agregar la opción de
  // aulas" — solo para PRESENCIAL; undefined si no había aula libre con
  // capacidad suficiente (la clase igual se ubica, solo queda sin aula
  // asignada, en vez de marcarse como no ubicable).
  roomId?: string;
}

export interface RoomInput {
  id: string;
  capacity: number;
}

export interface ScheduleProposal {
  label: string;
  strategy: string;
  sessions: ScheduledSession[];
  unscheduledCourseIds: string[];
  // Trello *LUX SCHEDULER* (Mack, 2026-09-15, reforzado 15:36): "necesito
  // saber por qué no se pueden ubicar... ¿es un tema de estudiantes? ¿el
  // profesor no puede?... que me dé una posible solución." Una frase corta
  // por curso sin ubicar — no bloquea nada, es puramente informativo.
  unscheduledReasons: Record<string, string>;
}

const DEFAULT_PRESENCIAL_DAYS = [6]; // sábado
const DEFAULT_VIRTUAL_DAYS = [1, 2, 3, 4, 5]; // lunes-viernes
const DEFAULT_LUNCH: LunchBreak = { startTime: '12:00', endTime: '13:00' };
const DEFAULT_DURATION_MIN: Record<ClassType, number> = { INDIVIDUAL: 55, GRUPAL: 75 };
const PREFERRED_GAP_MIN = 5;
const SLOT_STEP_MIN = 5; // candidate start-time granularity
const DEFAULT_INSTITUTIONAL_OPEN = '08:00';
const DEFAULT_INSTITUTIONAL_CLOSE = '16:00';

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
function baseWindowsForDay(
  teacher: TeacherInput, dayOfWeek: number, lunch: LunchBreak,
  presencialDays: number[], institutionalOpen: string, institutionalClose: string
): Window[] {
  if (presencialDays.includes(dayOfWeek)) {
    const institutional = subtractWindow(
      [{ start: toMinutes(institutionalOpen), end: toMinutes(institutionalClose) }],
      { start: toMinutes(lunch.startTime), end: toMinutes(lunch.endTime) }
    );
    // Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "el día sábado no está incluido
    // en la opción que los evaluadores tienen para seleccionar disponibilidad...
    // agrega también el día sábado." A teacher who never declared a block for
    // this presencial day keeps the full institutional window (unchanged
    // default behavior); one who did narrows it to their own blocks
    // intersected with the institutional window minus lunch — so declaring
    // "solo 8-11" actually excludes the rest of that day.
    const dayBlocks = teacher.availability
      .filter((b) => b.dayOfWeek === dayOfWeek)
      .map((b) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) }));
    return dayBlocks.length ? intersectWindows(institutional, dayBlocks) : institutional;
  }
  // Trello *LUX SCHEDULER* (Mack, 2026-09-15, revertido el mismo día): la
  // regla dura de "nunca antes de las 6pm entre semana" se quitó — vuelve a
  // usar el bloque declarado por el profesor tal cual, sin recortarlo. 6pm
  // sigue siendo la hora sugerida en el perfil, ya no una validación.
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
  durationMin: Record<ClassType, number>,
  presencialDays: number[],
  virtualDays: number[],
  institutionalOpen: string,
  institutionalClose: string
): ScheduledSession | null {
  const used = workloadUsed.get(course.evaluatorId) ?? 0;
  if (used >= teacher.maxCoursesPerWeek) return null; // hard cap, no partial exceptions

  const duration = course.durationOverrideMin ?? durationMin[course.classType];
  const days = course.modality === 'PRESENCIAL' ? presencialDays : virtualDays;

  // Two passes: first require the soft gap, then relax it if nothing fit.
  for (const requireGap of [true, false]) {
    for (const day of days) {
      const free = baseWindowsForDay(teacher, day, lunch, presencialDays, institutionalOpen, institutionalClose);
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
            // Pineada directo acá — assignRooms() ni la toca (ver ahí cómo
            // reserva este hueco para que no se le asigne a otro curso).
            roomId: course.modality === 'PRESENCIAL' ? course.pinnedRoomId : undefined,
          };
        }
      }
    }
  }
  return null;
}

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "necesito saber por qué no se
// pueden ubicar: ¿es un tema de estudiantes?, ¿el profesor no puede?, ¿no hay
// capacidad de profesores?... que me dé una posible solución." Re-recorre las
// mismas ventanas que placeCourse pero sin reservar nada, solo para explicar
// la causa más probable del fallo en una frase.
function diagnoseFailure(
  course: CourseInput, teacher: TeacherInput, bookings: Bookings, lunch: LunchBreak,
  workloadUsed: Map<string, number>, durationMin: Record<ClassType, number>,
  presencialDays: number[], virtualDays: number[], institutionalOpen: string, institutionalClose: string
): string {
  const used = workloadUsed.get(course.evaluatorId) ?? 0;
  if (used >= teacher.maxCoursesPerWeek) {
    return `El profesor ya alcanzó su límite semanal de ${teacher.maxCoursesPerWeek} curso(s). Sugerencia: subir el límite en su perfil o reasignar el curso a otro profesor.`;
  }

  const duration = course.durationOverrideMin ?? durationMin[course.classType];
  const days = course.modality === 'PRESENCIAL' ? presencialDays : virtualDays;
  let anyWindow = false;
  let anyWindowFitsDuration = false;
  let candidatesChecked = 0;
  let teacherBusyCount = 0;
  let studentBusyCount = 0;

  for (const day of days) {
    const free = baseWindowsForDay(teacher, day, lunch, presencialDays, institutionalOpen, institutionalClose);
    if (free.length) anyWindow = true;
    for (const w of free) {
      if (w.end - w.start >= duration) anyWindowFitsDuration = true;
      for (let start = w.start; start + duration <= w.end; start += SLOT_STEP_MIN) {
        candidatesChecked++;
        const candidate: Window = { start, end: start + duration };
        if (!bookings.teacherFree(course.evaluatorId, day, candidate)) teacherBusyCount++;
        if (!bookings.studentsFree(course.studentIds, day, candidate)) studentBusyCount++;
      }
    }
  }

  if (!anyWindow) {
    return course.modality === 'PRESENCIAL'
      ? 'No hay ventana institucional disponible para cursos presenciales ese día. Sugerencia: revisar el horario institucional en Parámetros.'
      : 'El profesor no declaró disponibilidad para los días entre semana en su perfil. Sugerencia: pedirle que agregue bloques de disponibilidad entre semana.';
  }
  if (!anyWindowFitsDuration) {
    return `Ningún bloque de disponibilidad del profesor es suficientemente largo para ${duration} min. Sugerencia: ampliar ese bloque o usar una excepción de duración más corta para este curso.`;
  }
  if (candidatesChecked === 0) {
    return 'No hay franjas de tiempo suficientes dentro de la disponibilidad declarada para la duración de este curso.';
  }
  if (teacherBusyCount === candidatesChecked) {
    return 'El profesor ya tiene otro curso en todos los horarios en que está disponible. Sugerencia: mover uno de sus otros cursos o ampliar su disponibilidad.';
  }
  if (studentBusyCount === candidatesChecked) {
    return 'Uno o más estudiantes de este curso ya tienen clase en todos los horarios en que el profesor está disponible. Sugerencia: revisar si conviene mover ese grupo base a otro horario.';
  }
  return 'No se encontró un horario donde coincidan la disponibilidad del profesor y la de todos los estudiantes matriculados. Sugerencia: revisar disponibilidad de ambos o dividir el grupo.';
}

function runStrategy(input: ScheduleInput, order: CourseInput[], label: string, strategy: string): ScheduleProposal {
  const lunch = input.lunchBreak ?? DEFAULT_LUNCH;
  const gapMinutes = input.gapMinutes ?? PREFERRED_GAP_MIN;
  const durationMin: Record<ClassType, number> = {
    INDIVIDUAL: input.individualMinutes ?? DEFAULT_DURATION_MIN.INDIVIDUAL,
    GRUPAL: input.groupMinutes ?? DEFAULT_DURATION_MIN.GRUPAL,
  };
  const presencialDays = input.presencialDays?.length ? input.presencialDays : DEFAULT_PRESENCIAL_DAYS;
  const virtualDays = input.virtualDays?.length ? input.virtualDays : DEFAULT_VIRTUAL_DAYS;
  const institutionalOpen = input.institutionalOpen ?? DEFAULT_INSTITUTIONAL_OPEN;
  const institutionalClose = input.institutionalClose ?? DEFAULT_INSTITUTIONAL_CLOSE;
  const teacherById = new Map(input.teachers.map((t) => [t.evaluatorId, t]));
  const bookings = new Bookings();
  const workloadUsed = new Map<string, number>();
  const sessions: ScheduledSession[] = [];
  const unscheduledCourseIds: string[] = [];
  const unscheduledReasons: Record<string, string> = {};

  for (const course of order) {
    const teacher = teacherById.get(course.evaluatorId);
    if (!teacher) {
      unscheduledCourseIds.push(course.courseId);
      unscheduledReasons[course.courseId] = 'No se encontró un profesor asignado a este curso. Sugerencia: asigná un profesor en el catálogo de cursos.';
      continue;
    }
    const placed = placeCourse(course, teacher, bookings, lunch, workloadUsed, gapMinutes, durationMin, presencialDays, virtualDays, institutionalOpen, institutionalClose);
    if (placed) sessions.push(placed);
    else {
      unscheduledCourseIds.push(course.courseId);
      unscheduledReasons[course.courseId] = diagnoseFailure(course, teacher, bookings, lunch, workloadUsed, durationMin, presencialDays, virtualDays, institutionalOpen, institutionalClose);
    }
  }

  if (input.rooms?.length) assignRooms(sessions, input.rooms);

  return { label, strategy, sessions, unscheduledCourseIds, unscheduledReasons };
}

// Trello *LUX SCHEDULER*, 2026-09-15 (Mack): "vamos a agregar la opción de
// aulas... 3 para 10 estudiantes, 1 grande para 15-20, 3 medianas para 5, 3
// individuales." Asigna la aula más chica que alcance, sin chocar con otra
// sesión el mismo día/hora — post-proceso sobre sesiones ya ubicadas (el
// horario en sí nunca depende de si hay aula libre, solo el tag de aula).
// Ampliado 2026-09-15 (15:36): un curso puede tener el aula PINEADA
// (course.pinnedRoomId, ya escrita en session.roomId por placeCourse) — acá
// no se le toca ni se valida, solo se reserva su hueco para que el
// auto-assign no le entregue esa misma aula/horario a otro curso.
function assignRooms(sessions: ScheduledSession[], rooms: RoomInput[]): void {
  const byCapacity = [...rooms].sort((a, b) => a.capacity - b.capacity);
  const bookedByRoom = new Map<string, Window[]>(); // roomId -> windows booked that day (day baked into window via +day*1440 offset)
  const presencial = sessions
    .filter((s) => s.modality === 'PRESENCIAL')
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  const windowOf = (s: ScheduledSession): Window => {
    const dayOffset = s.dayOfWeek * 1440;
    return { start: dayOffset + toMinutes(s.startTime), end: dayOffset + toMinutes(s.endTime) };
  };

  for (const s of presencial) {
    if (!s.roomId) continue;
    bookedByRoom.set(s.roomId, [...(bookedByRoom.get(s.roomId) ?? []), windowOf(s)]);
  }

  for (const s of presencial) {
    if (s.roomId) continue; // ya pineada — no se reasigna
    const needed = s.classType === 'INDIVIDUAL' ? 1 : s.studentIds.length;
    const window = windowOf(s);
    const room = byCapacity.find((r) => {
      if (r.capacity < needed) return false;
      const booked = bookedByRoom.get(r.id) ?? [];
      return !booked.some((b) => b.start < window.end && window.start < b.end);
    });
    if (!room) continue; // sin aula libre con capacidad suficiente — la clase queda sin aula asignada
    bookedByRoom.set(room.id, [...(bookedByRoom.get(room.id) ?? []), window]);
    s.roomId = room.id;
  }
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

export type ConflictType = 'TEACHER_OVERLAP' | 'STUDENT_OVERLAP' | 'LUNCH_BREAK' | 'OUTSIDE_PRESENCIAL_WINDOW' | 'WORKLOAD_EXCEEDED' | 'ROOM_OVERLAP';

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
  presencialDays?: number[];
  institutionalOpen?: string;
  institutionalClose?: string;
}

export function findConflicts({ sessions, lunchBreak, teachers, presencialDays, institutionalOpen, institutionalClose }: ConflictCheckInput): Conflict[] {
  const lunch = lunchBreak ?? DEFAULT_LUNCH;
  const presDays = presencialDays?.length ? presencialDays : DEFAULT_PRESENCIAL_DAYS;
  const open = institutionalOpen ?? DEFAULT_INSTITUTIONAL_OPEN;
  const close = institutionalClose ?? DEFAULT_INSTITUTIONAL_CLOSE;
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
      // Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): un aula pineada a un
      // curso se asigna directo sin pasar por assignRooms() — si dos cursos
      // pinean la MISMA aula a una hora que se solapa, nadie más lo detecta.
      if (a.roomId && a.roomId === b.roomId) {
        conflicts.push({ sessionIndex: i, withIndex: j, type: 'ROOM_OVERLAP', message: `El aula ya está ocupada a esa hora (choca con la sesión ${j + 1}).` });
      }
    }

    const s = sessions[i]!;
    if (presDays.includes(s.dayOfWeek)) {
      if (s.startTime < open || s.endTime > close) {
        conflicts.push({ sessionIndex: i, type: 'OUTSIDE_PRESENCIAL_WINDOW', message: `Fuera del horario institucional de los días presenciales (${open}-${close}).` });
      }
      if (s.startTime < lunch.endTime && lunch.startTime < s.endTime) {
        conflicts.push({ sessionIndex: i, type: 'LUNCH_BREAK', message: `Choca con la hora de almuerzo (${lunch.startTime}-${lunch.endTime}).` });
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
