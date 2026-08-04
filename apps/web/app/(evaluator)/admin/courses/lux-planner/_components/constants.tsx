import {
  BookOpen, FlaskConical, FolderKanban, Clock, AlignLeft, Sparkles,
  ClipboardList, FileUp, CheckCircle, Mic,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CourseTypeId = 'TEORICO' | 'TEORICO_PRACTICO' | 'PROYECTOS' | 'PROGRAMA_ESPECIAL' | 'CURSO_CORTO' | 'LIBRE';
export type EvalType = 'QUIZ' | 'EVIDENCE' | 'EXAM' | 'ATTENDANCE' | 'INTERVIEW';
export type PlanLang = 'ES' | 'EN';

export interface Step1Data {
  title: string; academicPeriod: string; classDays: string[];
  classSchedule: string; classSchedules: Record<string, string>;
  modality: string; startDate: string;
  planLanguage: PlanLang; courseType: CourseTypeId | '';
  description: string; imageUrl: string;
  cardColor: string; cardBorderColor: string; cardLabels: string[];
  pilotoAutomatico?: boolean;
}

export interface ExceptionItem {
  id: string; type: 'day' | 'week'; weekIndex: number; date?: string; label: string;
}

export interface Step2Data { totalWeeks: number; exceptions: ExceptionItem[]; }

export interface EvalItem {
  id: string; type: EvalType; name: string; nameEN: string;
  weight: number; count: number; dueDates: string[]; instructions: string; locked?: boolean;
  vapiPrompt?: string; vapiObjectives?: string;
  interviewStartDate?: string; interviewEndDate?: string; interviewTimeSlot?: string;
}

export interface Step3Data { items: EvalItem[]; }

export interface WeekPlanItem {
  weekNum: number; topics: string[]; module: string;
  procedure?: string; notes?: string;
  evalEvent: { name: string; type: string } | null;
}

export interface SuggestedModule {
  name: string; nameEN: string; description: string; descriptionEN: string; weeks: number[];
  quizWeek?: number | null; reflexWeek?: number | null;
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
  { n: 3, label: 'Planeamiento' }, { n: 4, label: 'Lux Planner' },
  { n: 5, label: 'Evaluación' },
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
  QUIZ:       { icon: <ClipboardList className="w-3.5 h-3.5" />, label: 'Quiz',           labelEN: 'Quiz',           color: 'bg-blue-100 text-blue-700' },
  EVIDENCE:   { icon: <FileUp className="w-3.5 h-3.5" />,       label: 'Entrega',         labelEN: 'Submission',     color: 'bg-purple-100 text-purple-700' },
  EXAM:       { icon: <ClipboardList className="w-3.5 h-3.5" />, label: 'Examen/Prueba',  labelEN: 'Exam/Test',      color: 'bg-amber-100 text-amber-700' },
  ATTENDANCE: { icon: <CheckCircle className="w-3.5 h-3.5" />,  label: 'Asistencia',      labelEN: 'Attendance',     color: 'bg-emerald-100 text-emerald-700' },
  INTERVIEW:  { icon: <Mic className="w-3.5 h-3.5" />,          label: 'Entrevista Oral', labelEN: 'Oral Interview', color: 'bg-rose-100 text-rose-700' },
};

export function defaultEvalItems(type: CourseTypeId): EvalItem[] {
  const mk = (id: string, t: EvalType, name: string, nameEN: string, weight: number, count = 1, locked = false): EvalItem =>
    ({ id, type: t, name, nameEN, weight, count, dueDates: Array(count).fill(''), instructions: '', locked });
  switch (type) {
    case 'TEORICO': return [mk('1','QUIZ','Trabajo Cotidiano','Daily Work',30,5), mk('2','EVIDENCE','Tareas','Assignments',20,4), mk('3','EXAM','Pruebas','Exams',35,2), mk('4','ATTENDANCE','Asistencia','Attendance',15,1,true)];
    case 'TEORICO_PRACTICO': return [mk('1','QUIZ','Trabajo Cotidiano','Daily Work',30,5), mk('2','EVIDENCE','Tareas / Laboratorio','Tasks / Lab',15,3), mk('3','EXAM','Pruebas','Exams',40,2), mk('4','ATTENDANCE','Asistencia','Attendance',15,1,true)];
    case 'PROYECTOS': return [mk('1','EVIDENCE','Investigación temática','Topic Research',20,1), mk('2','EVIDENCE','Avances del proyecto','Project Progress',40,3), mk('3','EVIDENCE','Defensa del proyecto','Project Defense',25,1), mk('4','ATTENDANCE','Asistencia','Attendance',15,1,true)];
    case 'PROGRAMA_ESPECIAL': return [mk('1','QUIZ','Trabajo Cotidiano','Daily Work',50,8), mk('2','EVIDENCE','Tareas','Tasks',10,2), mk('3','EXAM','Pruebas','Exams',25,2), mk('4','ATTENDANCE','Asistencia','Attendance',15,1,true)];
    case 'CURSO_CORTO': return [mk('1','EVIDENCE','Proyecto Final','Final Project',70,1), mk('2','ATTENDANCE','Asistencia (mín. 6/8)','Attendance (min. 6/8)',30,1,true)];
    case 'LIBRE': return [mk('1','QUIZ','Contenido Teórico','Theoretical Content',50,1), mk('2','EVIDENCE','Contenido Práctico','Practical Content',50,1)];
    default: return [];
  }
}

export const EMPTY_STEP1: Step1Data = { title:'', academicPeriod:'', classDays:[], classSchedule:'', classSchedules:{}, modality:'', startDate:'', planLanguage:'ES', courseType:'', description:'', imageUrl:'', cardColor:'', cardBorderColor:'', cardLabels:[], pilotoAutomatico: false };
export const EMPTY_STEP2: Step2Data = { totalWeeks: 16, exceptions: [] };
export const EMPTY_STEP3: Step3Data = { items: [] };
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
