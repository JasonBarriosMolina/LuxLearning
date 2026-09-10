// Lux Scheduler wizard — shared types (Trello *LUX SCHEDULER*, 2026-09-10).

export interface CourseCatalogRow {
  id: string;
  title: string;
  evaluatorId: string;
  teacherName: string;
  modality: string | null;
  engineModality: 'PRESENCIAL' | 'VIRTUAL' | null; // null = asincrónica, no live session
  studentCount: number;
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
}

export interface ScheduleProposal {
  label: string;
  strategy: string;
  sessions: ScheduledSession[];
  unscheduledCourseIds: string[];
}

export interface Conflict {
  sessionIndex: number;
  withIndex?: number;
  type: 'TEACHER_OVERLAP' | 'STUDENT_OVERLAP' | 'LUNCH_BREAK' | 'OUTSIDE_SATURDAY_WINDOW' | 'WORKLOAD_EXCEEDED';
  message: string;
}

export interface GenerateResult {
  proposals: ScheduleProposal[];
  courseTitles: Record<string, string>;
  teacherNames: Record<string, string>;
  academicPeriod: string;
  skippedAsyncCourseIds: string[];
}

export const WIZARD_STEPS = [
  'Período', 'Parámetros', 'Cursos', 'Disponibilidad', 'Estudiantes', 'Generación', 'Revisión', 'Reportes',
] as const;
