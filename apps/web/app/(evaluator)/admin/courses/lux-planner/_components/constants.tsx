import {
  BookOpen, FlaskConical, FolderKanban, Clock, AlignLeft, Sparkles,
  ClipboardList, FileUp, CheckCircle, Mic,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CourseTypeId = 'TEORICO' | 'TEORICO_PRACTICO' | 'PROYECTOS' | 'PROGRAMA_ESPECIAL' | 'CURSO_CORTO' | 'LIBRE';
// Trello DmPpbrff, 2026-09-02 21:48 (Mack): "vamos a sustituirlo por proyecto" —
// PROYECTO is the course's final/capstone deliverable, distinct from ongoing
// EVIDENCE submissions. QUIZ stays in the union (existing saved courses still
// have QUIZ EvaluationEvents) but is hidden from the type-selector for NEW
// items — the per-module quiz is now handled entirely by the quizWeek
// selector further down, making a second, manual "Quiz" category redundant.
export type EvalType = 'QUIZ' | 'EVIDENCE' | 'EXAM' | 'ATTENDANCE' | 'INTERVIEW' | 'PROYECTO';
export type PlanLang = 'ES' | 'EN';

export interface Step1Data {
  title: string; academicPeriod: string; classDays: string[];
  classSchedule: string; classSchedules: Record<string, string>;
  modality: string; startDate: string;
  planLanguage: PlanLang; courseType: CourseTypeId | '';
  description: string; imageUrl: string;
  cardColor: string; cardBorderColor: string; cardLabels: string[];
  pilotoAutomatico?: boolean;
  // Trello DmPpbrff, 2026-09-01 01:48 (Mack): only meaningful while modality is
  // ASINCRONICA. true = Lux Mentor auto-evaluates reflections/entregas (today's
  // default). false = a human evaluator must review them — the course still
  // needs an evaluator assigned via the normal course-editor flow.
  isAutoevaluated?: boolean;
}

export interface ExceptionItem {
  id: string; type: 'day' | 'week'; weekIndex: number; date?: string; label: string;
}

export interface Step2Data { totalWeeks: number; exceptions: ExceptionItem[]; }

export interface EvalItem {
  id: string; type: EvalType; name: string; nameEN: string;
  weight: number; count: number; dueDates: string[]; instructions: string; locked?: boolean;
  // Trello DmPpbrff, 2026-09-01 14:30 (Mack): when count > 1, each due-date instance
  // needs its own delivery instructions (parallel array, aligned by index to
  // dueDates). `instructions` above stays as the single/first-instance value for
  // count===1 items (unchanged, backward compatible). Jason (2026-09-02): each
  // instance becomes its own EvaluationEvent server-side, weight split evenly.
  instructionsByIndex?: string[];
  vapiPrompt?: string; vapiObjectives?: string;
  interviewStartDate?: string; interviewEndDate?: string; interviewTimeSlot?: string;
}

export interface Step3Data { items: EvalItem[]; luxMentorWeeks: number[]; }

export interface WeekPlanItem {
  weekNum: number; topics: string[]; module: string;
  procedure?: string; notes?: string;
  evalEvent: { name: string; type: string } | null;
}

export interface SuggestedModule {
  name: string; nameEN: string; description: string; descriptionEN: string; weeks: number[];
  quizWeek?: number | null; reflexWeek?: number | null; interviewWeek?: number | null;
}

export interface Step4Data {
  syllabusInput: string;
  weeklyPlan: WeekPlanItem[];
  modules: SuggestedModule[];
  status: 'idle' | 'loading' | 'done' | 'error';
  error: string;
}

export interface Step5Data {
  status: 'idle' | 'saving' | 'done' | 'error';
  courseId?: string;
  docUrl?: string;
  lessonJobId?: string;
  error: string;
}

export interface PendingException { type: 'week' | 'day'; weekIndex: number; date?: string; }

export interface CalendarWeek {
  index: number;
  weekNum: number;
  days: { day: string; date: string }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const STEPS = [
  { n: 1, label: 'Identidad' }, { n: 2, label: 'Calendario' },
  { n: 3, label: 'Planeamiento' }, { n: 4, label: 'Evaluación' },
  { n: 5, label: 'Resumen' },
];

export const COURSE_TYPES = [
  { id: 'TEORICO' as CourseTypeId, icon: <BookOpen className="w-5 h-5" />, label: 'Teórico', labelEN: 'Theoretical', desc: 'Lecciones, quizzes y reflexiones. Evaluación conceptual.', descEN: 'Lessons, quizzes and reflections. Conceptual assessment.', machote: 'Carrera Internacional Teórico' },
  { id: 'TEORICO_PRACTICO' as CourseTypeId, icon: <FlaskConical className="w-5 h-5" />, label: 'Teórico-Práctico', labelEN: 'Theoretical-Practical', desc: 'Combina lecciones con entregas de laboratorio o proyectos.', descEN: 'Combines lessons with lab or project deliverables.', machote: 'Carrera Internacional Práctico' },
  { id: 'PROYECTOS' as CourseTypeId, icon: <FolderKanban className="w-5 h-5" />, label: 'Taller / Proyectos', labelEN: 'Workshop / Projects', desc: 'Proyecto 85% + Asistencia 15%.', descEN: 'Project 85% + Attendance 15%.', machote: 'Planes Proyectos' },
  { id: 'PROGRAMA_ESPECIAL' as CourseTypeId, icon: <Sparkles className="w-5 h-5" />, label: 'Programa Especial', labelEN: 'Special Program', desc: 'Disciplinas artísticas o técnicas. Cotidiano 50%.', descEN: 'Artistic or technical disciplines. Daily 50%.', machote: 'Plan Práctico P.E.' },
  { id: 'CURSO_CORTO' as CourseTypeId, icon: <Clock className="w-5 h-5" />, label: 'Curso Corto', labelEN: 'Short Course', desc: '8 semanas. Asistencia mínima + proyecto final.', descEN: '8 weeks. Minimum attendance + final project.', machote: 'Plan Curso Corto' },
  { id: 'LIBRE' as CourseTypeId, icon: <AlignLeft className="w-5 h-5" />, label: 'Curso Libre / Tutoría', labelEN: 'Free Course / Tutoring', desc: '6 meses. Contenido teórico y práctico por semana.', descEN: '6 months. Weekly theoretical and practical content.', machote: 'Plan Didáctico Libre' },
] as const;

export const MODALITIES = [
  { id: 'PRESENCIAL', label: 'Presencial', labelEN: 'In-Person' },
  { id: 'SINCRONICA', label: 'Sincrónica', labelEN: 'Synchronous' },
  { id: 'ASINCRONICA', label: 'Asincrónica', labelEN: 'Asynchronous' },
  { id: 'HIBRIDA', label: 'Híbrida', labelEN: 'Hybrid' },
] as const;

export const DAYS_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_ABBR_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const DAY_ABBR_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const COLOR_PALETTE = ['#17527E','#7C3AED','#059669','#DC2626','#D97706','#0891B2','#BE185D','#374151','#1D4ED8','#065F46','#92400E','#4C1D95'];
export const BORDER_PALETTE = ['#17527E','#7C3AED','#059669','#DC2626','#D97706','#0891B2','#1D4ED8','#374151'];

export const TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let h = 6; h <= 23; h++) {
    for (const m of [0, 30]) {
      if (h === 23 && m === 30) break;
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      const ampm = h < 12 ? 'AM' : 'PM';
      const mm = m === 0 ? '00' : '30';
      slots.push(`${hour12}:${mm} ${ampm}`);
    }
  }
  return slots;
})();

export const EVAL_TYPE_META: Record<EvalType, { icon: React.ReactNode; label: string; labelEN: string; color: string }> = {
  QUIZ:       { icon: <ClipboardList className="w-3.5 h-3.5" />, label: 'Quiz',              labelEN: 'Quiz',              color: 'bg-blue-100 text-blue-700' },
  EVIDENCE:   { icon: <FileUp className="w-3.5 h-3.5" />,       label: 'Entrega de Evidencia', labelEN: 'Evidence Submission', color: 'bg-purple-100 text-purple-700' },
  EXAM:       { icon: <ClipboardList className="w-3.5 h-3.5" />, label: 'Examen/Prueba',     labelEN: 'Exam/Test',         color: 'bg-amber-100 text-amber-700' },
  ATTENDANCE: { icon: <CheckCircle className="w-3.5 h-3.5" />,  label: 'Asistencia',         labelEN: 'Attendance',        color: 'bg-emerald-100 text-emerald-700' },
  INTERVIEW:  { icon: <Mic className="w-3.5 h-3.5" />,          label: 'Entrevista Oral',    labelEN: 'Oral Interview',    color: 'bg-rose-100 text-rose-700' },
  PROYECTO:   { icon: <FolderKanban className="w-3.5 h-3.5" />, label: 'Proyecto',           labelEN: 'Project',           color: 'bg-indigo-100 text-indigo-700' },
};

// QUIZ hidden from manual selection in section 4 (Evaluación) — Trello DmPpbrff,
// 2026-09-02 21:48. Existing courses with a QUIZ item still render/save fine
// (EVAL_TYPE_META keeps the entry); this only affects what a user can newly pick.
export const SELECTABLE_EVAL_TYPES: EvalType[] = ['EVIDENCE', 'EXAM', 'INTERVIEW', 'PROYECTO'];

export function defaultEvalItems(type: CourseTypeId): EvalItem[] {
  const mk = (id: string, t: EvalType, name: string, nameEN: string, weight: number, count = 1, locked = false): EvalItem =>
    ({ id, type: t, name, nameEN, weight, count, dueDates: Array(count).fill(''), instructions: '', locked });
  // 'Trabajo Cotidiano' / 'Contenido Teórico' used EvalType QUIZ here, but QUIZ is
  // hidden from SELECTABLE_EVAL_TYPES (2026-09-02) — its Type: pill row rendered
  // with nothing selected, and clicking any visible pill silently converted the
  // item away from QUIZ with no pill left to switch it back (code-review finding,
  // 2026-09-03). These were never the automatic per-module quiz anyway (that's the
  // separate quizWeek selector) — they're daily-work/participation items, so EVIDENCE
  // is the correct type, not a workaround.
  switch (type) {
    case 'TEORICO': return [mk('1','EVIDENCE','Trabajo Cotidiano','Daily Work',30,5), mk('2','EVIDENCE','Tareas','Assignments',20,4), mk('3','EXAM','Pruebas','Exams',35,2), mk('4','ATTENDANCE','Asistencia','Attendance',15,1,true)];
    case 'TEORICO_PRACTICO': return [mk('1','EVIDENCE','Trabajo Cotidiano','Daily Work',30,5), mk('2','EVIDENCE','Tareas / Laboratorio','Tasks / Lab',15,3), mk('3','EXAM','Pruebas','Exams',40,2), mk('4','ATTENDANCE','Asistencia','Attendance',15,1,true)];
    case 'PROYECTOS': return [mk('1','EVIDENCE','Investigación temática','Topic Research',20,1), mk('2','EVIDENCE','Avances del proyecto','Project Progress',40,3), mk('3','EVIDENCE','Defensa del proyecto','Project Defense',25,1), mk('4','ATTENDANCE','Asistencia','Attendance',15,1,true)];
    case 'PROGRAMA_ESPECIAL': return [mk('1','EVIDENCE','Trabajo Cotidiano','Daily Work',50,8), mk('2','EVIDENCE','Tareas','Tasks',10,2), mk('3','EXAM','Pruebas','Exams',25,2), mk('4','ATTENDANCE','Asistencia','Attendance',15,1,true)];
    case 'CURSO_CORTO': return [mk('1','EVIDENCE','Proyecto Final','Final Project',70,1), mk('2','ATTENDANCE','Asistencia (mín. 6/8)','Attendance (min. 6/8)',30,1,true)];
    case 'LIBRE': return [mk('1','EVIDENCE','Contenido Teórico','Theoretical Content',50,1), mk('2','EVIDENCE','Contenido Práctico','Practical Content',50,1)];
    default: return [];
  }
}

// ─── Preload-for-edit mappers ──────────────────────────────────────────────────
// Pure Course-row → wizard-step-state mappers, extracted out of page.tsx's
// preloadCourse (page.tsx was over the 500-line file-size limit).
export function mapCourseToStep1(c: any): Step1Data {
  return {
    title: c.title ?? '',
    academicPeriod: c.academicPeriod ?? '',
    classDays: Array.isArray(c.classDays) ? c.classDays : [],
    classSchedule: c.classSchedule ?? '',
    classSchedules: c.classSchedules ?? {},
    modality: c.modality ?? '',
    startDate: c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : '',
    planLanguage: (c.planLanguage ?? 'ES') as Step1Data['planLanguage'],
    courseType: (c.courseType ?? '') as CourseTypeId | '',
    description: c.description ?? '',
    imageUrl: c.imageUrl ?? '',
    cardColor: c.cardColor ?? '',
    cardBorderColor: c.cardBorderColor ?? '',
    cardLabels: Array.isArray(c.cardLabels) ? c.cardLabels : [],
    pilotoAutomatico: Boolean(c.pilotoAutomatico),
    isAutoevaluated: c.isAutoevaluated ?? true,
  };
}

export function mapCourseToStep2(c: any): Step2Data {
  return {
    totalWeeks: c.totalWeeks ?? 16,
    exceptions: Array.isArray(c.calendarExceptions) ? c.calendarExceptions.map((ex: any) => ({ ...ex, id: ex.id ?? uid() })) : [],
  };
}

export function mapCourseToStep3Items(c: any): EvalItem[] {
  const evalConfig = Array.isArray(c.evaluationConfig) ? c.evaluationConfig : [];
  return evalConfig.map((it: any, i: number) => ({
    id: it.id ?? String(i),
    type: it.type ?? 'EXAM',
    name: it.name ?? '',
    nameEN: it.nameEN ?? it.name ?? '',
    weight: it.weight ?? 0,
    count: it.count ?? (Array.isArray(it.dueDates) ? it.dueDates.length : 1),
    dueDates: Array.isArray(it.dueDates) ? it.dueDates : [''],
    instructions: it.instructions ?? '',
    instructionsByIndex: Array.isArray(it.instructionsByIndex) ? it.instructionsByIndex : [],
    locked: it.locked ?? false,
    vapiPrompt: it.vapiPrompt ?? '',
    vapiObjectives: it.vapiObjectives ?? '',
    interviewStartDate: it.interviewStartDate ?? '',
    interviewEndDate: it.interviewEndDate ?? '',
    interviewTimeSlot: it.interviewTimeSlot ?? '',
  }));
}

// Trello DmPpbrff, 2026-09-05 (Mack): "Editar con Lux Planner" reopened a course with
// the "Módulos — Quiz, Reflexión y Entrevista" section (StepEvaluacion.tsx) missing
// entirely — it only renders when step4.modules.length > 0, and nothing ever restored
// that array from a saved course (mapCourseToStep1/2/3 above all existed; this one
// didn't). Mirrors mapCourseToStep3Items' defensive field-by-field fallback shape.
export function mapCourseToStep4Modules(c: any): SuggestedModule[] {
  const saved = Array.isArray(c.planModules) ? c.planModules : [];
  return saved.map((m: any) => ({
    name: m.name ?? '',
    nameEN: m.nameEN ?? m.name ?? '',
    description: m.description ?? '',
    descriptionEN: m.descriptionEN ?? m.description ?? '',
    weeks: Array.isArray(m.weeks) ? m.weeks : [],
    quizWeek: m.quizWeek ?? null,
    reflexWeek: m.reflexWeek ?? null,
    interviewWeek: m.interviewWeek ?? null,
  }));
}

export const EMPTY_STEP1: Step1Data = { title:'', academicPeriod:'', classDays:[], classSchedule:'', classSchedules:{}, modality:'', startDate:'', planLanguage:'ES', courseType:'', description:'', imageUrl:'', cardColor:'', cardBorderColor:'', cardLabels:[], pilotoAutomatico: false, isAutoevaluated: true };
export const EMPTY_STEP2: Step2Data = { totalWeeks: 16, exceptions: [] };
export const EMPTY_STEP3: Step3Data = { items: [], luxMentorWeeks: [] };
export const EMPTY_STEP4: Step4Data = { syllabusInput: '', weeklyPlan: [], modules: [], status: 'idle', error: '' };
export const EMPTY_STEP5: Step5Data = { status: 'idle', error: '' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function addDays(date: Date, n: number) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
export function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }
export function fmtDisplay(iso: string) { if (!iso) return ''; const [y, m, day] = iso.split('-'); return `${day}/${m}/${y}`; }

export function weekStart(startDate: string, weekIdx: number): Date {
  const base = new Date(startDate + 'T12:00:00');
  const dow = base.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addDays(base, mondayOffset + weekIdx * 7);
}

export const DAY_TO_JS: Record<string, number> = { 'Lunes':1,'Martes':2,'Miércoles':3,'Jueves':4,'Viernes':5,'Sábado':6,'Domingo':0 };
export function uid() { return Math.random().toString(36).slice(2, 8); }
