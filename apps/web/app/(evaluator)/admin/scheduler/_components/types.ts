// Lux Scheduler wizard — shared types (Trello *LUX SCHEDULER*, 2026-09-10).

export interface CourseCatalogRow {
  id: string;
  title: string;
  evaluatorId: string;
  teacherName: string;
  modality: string | null;
  engineModality: 'PRESENCIAL' | 'VIRTUAL' | null; // null = asincrónica, no live session
  courseType: string | null; // TEORICO | TEORICO_PRACTICO | PROYECTOS | PROGRAMA_ESPECIAL | CURSO_CORTO | LIBRE — se define en Lux Planner
  // Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "yo quisiera que se
  // respete que ese Ensamble Instrumental se dé siempre en el aula de
  // ensayos" — persiste entre generaciones, se edita desde el catálogo.
  preferredRoomId?: string | null;
  studentIds: string[];
  studentCount: number;
}

// Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "la institución puede
// agregar aulas, puede agregar edificios... divididas por piso... nombre
// preferencial... aforo."
export interface Building {
  id: string;
  name: string;
}

export interface ClassRoomRow {
  id: string;
  name: string;
  capacity: number;
  buildingId: string | null;
  floor: number | null;
  preferredName: string | null;
  courseTypeTags: string[];
}

export interface ScheduledSession {
  courseId: string;
  evaluatorId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  modality: 'PRESENCIAL' | 'VIRTUAL';
  classType: 'INDIVIDUAL' | 'GRUPAL';
  studentGroupId?: string;
  studentIds: string[];
  roomId?: string; // solo PRESENCIAL — ver WeekCalendarGrid/StepReview
}

export interface ScheduleProposal {
  label: string;
  strategy: string;
  sessions: ScheduledSession[];
  unscheduledCourseIds: string[];
  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "necesito saber por qué no se
  // pueden ubicar... que me dé una posible solución" — frase corta por curso.
  unscheduledReasons: Record<string, string>;
}

export interface Conflict {
  sessionIndex: number;
  withIndex?: number;
  type: 'TEACHER_OVERLAP' | 'STUDENT_OVERLAP' | 'LUNCH_BREAK' | 'OUTSIDE_PRESENCIAL_WINDOW' | 'WORKLOAD_EXCEEDED';
  message: string;
}

export interface GenerateResult {
  proposals: ScheduleProposal[];
  courseTitles: Record<string, string>;
  teacherNames: Record<string, string>;
  studentNames?: Record<string, string>;
  roomNames?: Record<string, string>;
  academicPeriod: string;
  skippedAsyncCourseIds: string[];
}

export const WIZARD_STEPS = [
  'Período', 'Parámetros', 'Cursos', 'Disponibilidad', 'Estudiantes', 'Generación', 'Revisión', 'Reportes',
] as const;
