'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, BookOpen, FlaskConical, FolderKanban,
  Clock, AlignLeft, Sparkles, Loader2, X, Image as ImageIcon,
  Tag, CheckCircle, Plus, Trash2, CalendarX, Info, GripVertical,
  ClipboardList, FileUp, Download, Save, RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useLanguage } from '@/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseTypeId = 'TEORICO' | 'TEORICO_PRACTICO' | 'PROYECTOS' | 'PROGRAMA_ESPECIAL' | 'CURSO_CORTO' | 'LIBRE';
type EvalType = 'QUIZ' | 'EVIDENCE' | 'EXAM' | 'ATTENDANCE';
type PlanLang = 'ES' | 'EN';

interface Step1Data {
  title: string; academicPeriod: string; classDays: string[];
  classSchedule: string; modality: string; startDate: string;
  planLanguage: PlanLang; courseType: CourseTypeId | '';
  description: string; imageUrl: string;
  cardColor: string; cardBorderColor: string; cardLabels: string[];
}

interface ExceptionItem {
  id: string; type: 'day' | 'week'; weekIndex: number; date?: string; label: string;
}

interface Step2Data { totalWeeks: number; exceptions: ExceptionItem[]; }

interface EvalItem {
  id: string; type: EvalType; name: string; nameEN: string;
  weight: number; count: number; dueDates: string[]; instructions: string; locked?: boolean;
}

interface Step3Data { items: EvalItem[]; }

interface WeekPlanItem {
  weekNum: number; topics: string[]; module: string;
  evalEvent: { name: string; type: string } | null;
}

interface SuggestedModule {
  name: string; nameEN: string; description: string; descriptionEN: string; weeks: number[];
}

interface Step4Data {
  syllabusInput: string;
  weeklyPlan: WeekPlanItem[];
  modules: SuggestedModule[];
  status: 'idle' | 'loading' | 'done' | 'error';
  error: string;
}

interface Step5Data {
  status: 'idle' | 'saving' | 'done' | 'error';
  courseId?: string;
  docUrl?: string;
  error: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'Identidad' }, { n: 2, label: 'Calendario' },
  { n: 3, label: 'Evaluación' }, { n: 4, label: 'Lux Planner' },
  { n: 5, label: 'Planeamiento' },
];

const COURSE_TYPES = [
  { id: 'TEORICO' as CourseTypeId, icon: <BookOpen className="w-5 h-5" />, label: 'Teórico', labelEN: 'Theoretical', desc: 'Lecciones, quizzes y reflexiones. Evaluación conceptual.', descEN: 'Lessons, quizzes and reflections. Conceptual assessment.', machote: 'Carrera Internacional Teórico' },
  { id: 'TEORICO_PRACTICO' as CourseTypeId, icon: <FlaskConical className="w-5 h-5" />, label: 'Teórico-Práctico', labelEN: 'Theoretical-Practical', desc: 'Combina lecciones con entregas de laboratorio o proyectos.', descEN: 'Combines lessons with lab or project deliverables.', machote: 'Carrera Internacional Práctico' },
  { id: 'PROYECTOS' as CourseTypeId, icon: <FolderKanban className="w-5 h-5" />, label: 'Taller / Proyectos', labelEN: 'Workshop / Projects', desc: 'Proyecto 85% + Asistencia 15%.', descEN: 'Project 85% + Attendance 15%.', machote: 'Planes Proyectos' },
  { id: 'PROGRAMA_ESPECIAL' as CourseTypeId, icon: <Sparkles className="w-5 h-5" />, label: 'Programa Especial', labelEN: 'Special Program', desc: 'Disciplinas artísticas o técnicas. Cotidiano 50%.', descEN: 'Artistic or technical disciplines. Daily 50%.', machote: 'Plan Práctico P.E.' },
  { id: 'CURSO_CORTO' as CourseTypeId, icon: <Clock className="w-5 h-5" />, label: 'Curso Corto', labelEN: 'Short Course', desc: '8 semanas. Asistencia mínima + proyecto final.', descEN: '8 weeks. Minimum attendance + final project.', machote: 'Plan Curso Corto' },
  { id: 'LIBRE' as CourseTypeId, icon: <AlignLeft className="w-5 h-5" />, label: 'Curso Libre / Tutoría', labelEN: 'Free Course / Tutoring', desc: '6 meses. Contenido teórico y práctico por semana.', descEN: '6 months. Weekly theoretical and practical content.', machote: 'Plan Didáctico Libre' },
] as const;

const MODALITIES = [
  { id: 'PRESENCIAL', label: 'Presencial', labelEN: 'In-Person' },
  { id: 'SINCRONICA', label: 'Sincrónica', labelEN: 'Synchronous' },
  { id: 'ASINCRONICA', label: 'Asincrónica', labelEN: 'Asynchronous' },
  { id: 'HIBRIDA', label: 'Híbrida', labelEN: 'Hybrid' },
] as const;

const DAYS_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ABBR_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAY_ABBR_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const COLOR_PALETTE = ['#17527E','#7C3AED','#059669','#DC2626','#D97706','#0891B2','#BE185D','#374151','#1D4ED8','#065F46','#92400E','#4C1D95'];
const BORDER_PALETTE = ['#17527E','#7C3AED','#059669','#DC2626','#D97706','#0891B2','#1D4ED8','#374151'];

// Time slots 6:00 AM – 11:00 PM in 30-min steps
const TIME_SLOTS: string[] = (() => {
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

const EVAL_TYPE_META: Record<EvalType, { icon: React.ReactNode; label: string; labelEN: string; color: string }> = {
  QUIZ:       { icon: <ClipboardList className="w-3.5 h-3.5" />, label: 'Quiz',          labelEN: 'Quiz',        color: 'bg-blue-100 text-blue-700' },
  EVIDENCE:   { icon: <FileUp className="w-3.5 h-3.5" />,       label: 'Entrega',        labelEN: 'Submission',  color: 'bg-purple-100 text-purple-700' },
  EXAM:       { icon: <ClipboardList className="w-3.5 h-3.5" />, label: 'Examen/Prueba', labelEN: 'Exam/Test',   color: 'bg-amber-100 text-amber-700' },
  ATTENDANCE: { icon: <CheckCircle className="w-3.5 h-3.5" />,  label: 'Asistencia',     labelEN: 'Attendance',  color: 'bg-emerald-100 text-emerald-700' },
};

function defaultEvalItems(type: CourseTypeId): EvalItem[] {
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

const EMPTY_STEP1: Step1Data = { title:'', academicPeriod:'', classDays:[], classSchedule:'', modality:'', startDate:'', planLanguage:'ES', courseType:'', description:'', imageUrl:'', cardColor:'', cardBorderColor:'', cardLabels:[] };
const EMPTY_STEP2: Step2Data = { totalWeeks: 16, exceptions: [] };
const EMPTY_STEP3: Step3Data = { items: [] };
const EMPTY_STEP4: Step4Data = { syllabusInput: '', weeklyPlan: [], modules: [], status: 'idle', error: '' };
const EMPTY_STEP5: Step5Data = { status: 'idle', error: '' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(date: Date, n: number) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }
function fmtDisplay(iso: string) { if (!iso) return ''; const [y,m,day] = iso.split('-'); return `${day}/${m}/${y}`; }

function weekStart(startDate: string, weekIdx: number): Date {
  const base = new Date(startDate + 'T12:00:00');
  const dow = base.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addDays(base, mondayOffset + weekIdx * 7);
}

const DAY_TO_JS: Record<string, number> = { 'Lunes':1,'Martes':2,'Miércoles':3,'Jueves':4,'Viernes':5,'Sábado':6,'Domingo':0 };
function uid() { return Math.random().toString(36).slice(2, 8); }

// ─── StepBar ──────────────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-150 ${current > s.n ? 'bg-emerald-500 text-white' : current === s.n ? 'bg-gradient-to-br from-cta-from to-cta-to text-white shadow-md' : 'bg-gray-100 text-gray-400'}`}>
              {current > s.n ? <CheckCircle className="w-4 h-4" /> : s.n}
            </div>
            <span className={`text-[10px] font-medium whitespace-nowrap ${current === s.n ? 'text-cta-from' : 'text-gray-400'}`}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`h-0.5 w-12 mx-1 mb-4 transition-colors duration-150 ${current > s.n ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{children}</p>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CourseWizardPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const isEN = lang === 'en';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [step1, setStep1] = useState<Step1Data>(EMPTY_STEP1);
  const [step2, setStep2] = useState<Step2Data>(EMPTY_STEP2);
  const [step3, setStep3] = useState<Step3Data>(EMPTY_STEP3);
  const [step4, setStep4] = useState<Step4Data>(EMPTY_STEP4);
  const [step5, setStep5] = useState<Step5Data>(EMPTY_STEP5);

  const [labelInput, setLabelInput] = useState('');
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageError, setImageError] = useState('');
  const [periods, setPeriods] = useState<{ id: string; name: string }[]>([]);
  const [newPeriodInput, setNewPeriodInput] = useState('');
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [exLabelInput, setExLabelInput] = useState('');
  const [pendingEx, setPendingEx] = useState<{ type: 'week' | 'day'; weekIndex: number; date?: string } | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());

  useEffect(() => {
    api.admin.periods.list().then((res: any) => setPeriods(res?.data ?? res ?? [])).catch(() => {});
  }, []);

  // Keep classSchedule in sync with the two time selectors
  useEffect(() => {
    if (scheduleStart && scheduleEnd) {
      setStep1((p) => ({ ...p, classSchedule: `${scheduleStart} – ${scheduleEnd}` }));
    } else if (scheduleStart) {
      setStep1((p) => ({ ...p, classSchedule: scheduleStart }));
    }
  }, [scheduleStart, scheduleEnd]);

  const s = (es: string, en: string) => isEN ? en : es;
  const planEN = step1.planLanguage === 'EN';
  const isAsync = step1.modality === 'ASINCRONICA';
  const activeDays = step1.classDays.length > 0 ? step1.classDays : ['Lunes', 'Miércoles', 'Viernes'];

  // ── Calendar weeks ─────────────────────────────────────────────────────────
  const weeks = useMemo(() => {
    if (!step1.startDate) return [];
    return Array.from({ length: step2.totalWeeks }, (_, i) => {
      const wStart = weekStart(step1.startDate, i);
      const days = activeDays.map((d) => {
        const offset = (DAY_TO_JS[d] - 1 + 7) % 7;
        return { day: d, date: fmtDate(addDays(wStart, offset)) };
      });
      return { index: i, weekNum: i + 1, days };
    });
  }, [step1.startDate, step2.totalWeeks, activeDays]);

  const exceptionSet = useMemo(() => {
    const set = new Set<string>();
    step2.exceptions.forEach((ex) => {
      if (ex.type === 'week') set.add(`w-${ex.weekIndex}`);
      else if (ex.date) set.add(`d-${ex.date}`);
    });
    return set;
  }, [step2.exceptions]);

  const isWeekEx = (idx: number) => exceptionSet.has(`w-${idx}`);
  const isDayEx = (date: string) => exceptionSet.has(`d-${date}`);

  const toggleWeekEx = (weekIdx: number) => {
    if (exceptionSet.has(`w-${weekIdx}`)) {
      setStep2((p) => ({ ...p, exceptions: p.exceptions.filter((e) => !(e.type === 'week' && e.weekIndex === weekIdx)) }));
    } else { setPendingEx({ type: 'week', weekIndex: weekIdx }); setExLabelInput(''); }
  };

  const toggleDayEx = (weekIdx: number, date: string) => {
    if (exceptionSet.has(`d-${date}`)) {
      setStep2((p) => ({ ...p, exceptions: p.exceptions.filter((e) => e.date !== date) }));
    } else { setPendingEx({ type: 'day', weekIndex: weekIdx, date }); setExLabelInput(''); }
  };

  const confirmException = () => {
    if (!pendingEx) return;
    const ex: ExceptionItem = { id: uid(), type: pendingEx.type, weekIndex: pendingEx.weekIndex, date: pendingEx.date, label: exLabelInput.trim() || (pendingEx.type === 'week' ? 'Excepción' : 'Feriado') };
    setStep2((p) => ({ ...p, exceptions: [...p.exceptions, ex] }));
    setPendingEx(null); setExLabelInput('');
  };

  const removeException = (id: string) => setStep2((p) => ({ ...p, exceptions: p.exceptions.filter((e) => e.id !== id) }));

  // ── Step 3 ─────────────────────────────────────────────────────────────────
  const totalWeight = step3.items.reduce((acc, i) => acc + i.weight, 0);
  const weightOk = Math.abs(totalWeight - 100) < 0.01;

  const updateItem = (id: string, patch: Partial<EvalItem>) =>
    setStep3((p) => ({ ...p, items: p.items.map((it) => it.id === id ? { ...it, ...patch } : it) }));

  const updateDueDate = (id: string, idx: number, val: string) =>
    setStep3((p) => ({ ...p, items: p.items.map((it) => it.id !== id ? it : { ...it, dueDates: it.dueDates.map((d, i) => i === idx ? val : d) }) }));

  const setCount = (id: string, count: number) => {
    const n = Math.max(1, count);
    setStep3((p) => ({ ...p, items: p.items.map((it) => it.id !== id ? it : { ...it, count: n, dueDates: Array(n).fill('').map((_, i) => it.dueDates[i] ?? '') }) }));
  };

  const addEvalItem = () => setStep3((p) => ({ ...p, items: [...p.items, { id: uid(), type: 'EVIDENCE' as EvalType, name: 'Actividad', nameEN: 'Activity', weight: 0, count: 1, dueDates: [''], instructions: '' }] }));
  const removeItem = (id: string) => setStep3((p) => ({ ...p, items: p.items.filter((it) => it.id !== id) }));

  const enterStep3 = () => {
    if (step3.items.length === 0 && step1.courseType) setStep3({ items: defaultEvalItems(step1.courseType as CourseTypeId) });
    setStep(3);
  };

  // ── Step 4 — Lux Planner ───────────────────────────────────────────────────
  const exceptionWeekIndices = step2.exceptions.filter((e) => e.type === 'week').map((e) => e.weekIndex + 1);
  const effectiveWeeks = step2.totalWeeks - exceptionWeekIndices.length;

  const runCopilot = async () => {
    if (!step4.syllabusInput.trim()) return;
    setStep4((p) => ({ ...p, status: 'loading', error: '' }));
    try {
      const resp = await api.admin.courses.wizardCopilot({
        title: step1.title, courseType: step1.courseType, description: step1.description,
        planLanguage: step1.planLanguage, modality: step1.modality, totalWeeks: step2.totalWeeks,
        startDate: step1.startDate, classDays: step1.classDays, classSchedule: step1.classSchedule,
        academicPeriod: step1.academicPeriod,
        evaluationItems: step3.items.map((it) => ({ name: it.name, nameEN: it.nameEN, type: it.type, weight: it.weight, count: it.count })),
        syllabusInput: step4.syllabusInput,
        exceptionWeeks: exceptionWeekIndices,
      }) as any;
      const data = resp?.data ?? resp;
      if (!data?.weeklyPlan) throw new Error('Respuesta inválida del servidor');
      setStep4((p) => ({ ...p, status: 'done', weeklyPlan: data.weeklyPlan, modules: data.modules ?? [] }));
    } catch (err: any) {
      setStep4((p) => ({ ...p, status: 'error', error: err?.message ?? 'Error desconocido' }));
    }
  };

  const updateWeekTopics = (weekNum: number, text: string) =>
    setStep4((p) => ({ ...p, weeklyPlan: p.weeklyPlan.map((wk) => wk.weekNum === weekNum ? { ...wk, topics: [text] } : wk) }));

  // ── Step 5 — Save ──────────────────────────────────────────────────────────
  const saveCourse = async () => {
    setStep5({ status: 'saving', error: '' });
    try {
      const resp = await api.admin.courses.wizardSave({
        title: step1.title, description: step1.description,
        imageUrl: step1.imageUrl || undefined,
        courseType: step1.courseType, academicPeriod: step1.academicPeriod,
        classDays: step1.classDays, classSchedule: step1.classSchedule,
        modality: step1.modality, startDate: step1.startDate || undefined,
        totalWeeks: step2.totalWeeks, planLanguage: step1.planLanguage,
        cardColor: step1.cardColor || undefined, cardBorderColor: step1.cardBorderColor || undefined,
        cardLabels: step1.cardLabels, calendarExceptions: step2.exceptions,
        evaluationItems: step3.items, weeklyPlan: step4.weeklyPlan,
        suggestedModules: step4.modules,
      }) as any;
      const data = resp?.data ?? resp;
      if (!data?.courseId) throw new Error('No se recibió courseId');
      setStep5({ status: 'done', courseId: data.courseId, docUrl: data.docUrl ?? null, error: '' });
    } catch (err: any) {
      setStep5({ status: 'error', error: err?.message ?? 'Error al guardar' });
    }
  };

  // ── Image ──────────────────────────────────────────────────────────────────
  const handleImageFile = async (file: File) => {
    setImageGenerating(true); setImageError('');
    try {
      const res = await api.admin.files.presign({ fileName: file.name, fileType: file.type, folder: 'covers' }) as any;
      const { uploadUrl, publicUrl } = res?.data ?? res;
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      setStep1((p) => ({ ...p, imageUrl: publicUrl }));
    } catch {
      setImageError(s('Error al subir la imagen', 'Error uploading image'));
    } finally {
      setImageGenerating(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!step1.title) return;
    setImageGenerating(true); setImageError('');
    try {
      const promptText = step1.description ? `${step1.title}: ${step1.description}` : step1.title;
      const resp = await api.admin.courses.generateCover('wizard-temp', { promptText });
      const url = (resp as any)?.data?.imageUrl ?? (resp as any)?.imageUrl;
      if (url) setStep1((p) => ({ ...p, imageUrl: url }));
    } catch { setImageError(s('Error al generar la imagen', 'Error generating image')); }
    finally { setImageGenerating(false); }
  };

  // ── Navigation ─────────────────────────────────────────────────────────────
  const step1Valid = step1.title.trim().length > 0 && step1.courseType !== '' && step1.modality !== '' && step1.startDate !== '';
  const step2Valid = step2.totalWeeks >= 1;
  const step3Valid = step3.items.length > 0 && weightOk;
  const step4Valid = step4.status !== 'loading';

  const canNext = step === 1 ? step1Valid : step === 2 ? step2Valid : step === 3 ? step3Valid : step === 4 ? step4Valid : false;

  const goNext = () => { if (step === 2) { enterStep3(); return; } setStep((p) => Math.min(5, p + 1) as typeof step); };
  const goBack = () => { if (step === 1) { router.push('/admin/courses'); return; } setStep((p) => Math.max(1, p - 1) as typeof step); };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP RENDERS
  // ─────────────────────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-charcoal">{s('Idioma del plan:', 'Plan language:')}</span>
        <div className="flex gap-1 bg-surface rounded-lg p-0.5">
          {(['ES', 'EN'] as PlanLang[]).map((lng) => (
            <button key={lng} onClick={() => setStep1((p) => ({ ...p, planLanguage: lng }))}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${step1.planLanguage === lng ? 'bg-white text-cta-from shadow-sm' : 'text-gray-400 hover:text-charcoal'}`}>
              {lng === 'ES' ? '🇨🇷 ES' : '🇺🇸 EN'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>{s('Tipo de curso', 'Course type')}</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {COURSE_TYPES.map((ct) => (
            <button key={ct.id} onClick={() => { setStep1((p) => ({ ...p, courseType: ct.id })); setStep3({ items: [] }); }}
              className={`text-left p-4 rounded-xl border-2 transition-all ${step1.courseType === ct.id ? 'border-cta-from bg-blue-50 dark:bg-blue-900/20' : 'border-border hover:border-gray-300 hover:bg-surface'}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${step1.courseType === ct.id ? 'bg-cta-from text-white' : 'bg-gray-100 text-gray-500'}`}>{ct.icon}</div>
              <p className="font-semibold text-charcoal text-sm">{planEN ? ct.labelEN : ct.label}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-snug">{planEN ? ct.descEN : ct.desc}</p>
              {step1.courseType === ct.id && <p className="text-[10px] text-cta-from font-medium mt-1.5">Machote: {ct.machote}</p>}
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>{s('Información del curso', 'Course information')}</SectionLabel>
        <div className="space-y-4">
          <Input label={s('Nombre del curso *', 'Course name *')} value={step1.title} onChange={(e) => setStep1((p) => ({ ...p, title: e.target.value }))} placeholder={s('Ej. Fundamentos de Programación', 'E.g. Programming Fundamentals')} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{s('Período académico', 'Academic period')}</label>
              {showNewPeriod ? (
                <div className="flex gap-1.5">
                  <input autoFocus type="text" value={newPeriodInput} onChange={(e) => setNewPeriodInput(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!newPeriodInput.trim()) return;
                        const res = await api.admin.periods.create(newPeriodInput.trim()) as any;
                        const created = res?.data ?? res;
                        setPeriods((p) => [created, ...p]);
                        setStep1((prev) => ({ ...prev, academicPeriod: created.name }));
                        setNewPeriodInput(''); setShowNewPeriod(false);
                      } else if (e.key === 'Escape') { setShowNewPeriod(false); setNewPeriodInput(''); }
                    }}
                    placeholder={s('Ej. I Cuatrimestre 2026', 'E.g. Spring 2026')}
                    className="input-field flex-1 text-sm py-2" />
                  <button onClick={() => { setShowNewPeriod(false); setNewPeriodInput(''); }} className="px-2 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <select value={step1.academicPeriod} onChange={(e) => setStep1((p) => ({ ...p, academicPeriod: e.target.value }))} className="input-field flex-1 text-sm py-2">
                    <option value="">{s('— Seleccionar —', '— Select —')}</option>
                    {periods.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                  <button onClick={() => setShowNewPeriod(true)} title={s('Crear nuevo', 'Create new')} className="px-2 text-cta-from hover:text-cta-to"><Plus className="w-4 h-4" /></button>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{s('Fecha de inicio *', 'Start date *')}</label>
              <input type="date" value={step1.startDate} onChange={(e) => setStep1((p) => ({ ...p, startDate: e.target.value }))} className="input-field w-full" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">{s('Descripción', 'Description')}</label>
            <textarea value={step1.description} onChange={(e) => setStep1((p) => ({ ...p, description: e.target.value }))} placeholder={s('Describe los objetivos generales...', 'Describe the general objectives...')} className="input-field min-h-[70px] resize-y" />
          </div>
        </div>
      </div>

      <div>
        <SectionLabel>{s('Logística', 'Logistics')}</SectionLabel>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">{s('Modalidad *', 'Modality *')}</label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {MODALITIES.map((m) => (
                <button key={m.id} onClick={() => setStep1((p) => ({ ...p, modality: m.id }))}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium border-2 transition-all ${step1.modality === m.id ? 'border-cta-from bg-blue-50 text-cta-from dark:bg-blue-900/20' : 'border-border text-gray-500 hover:border-gray-300'}`}>
                  {planEN ? m.labelEN : m.label}
                </button>
              ))}
            </div>
          </div>
          {!isAsync && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-charcoal">{s('Días de clase', 'Class days')}</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_ES.map((day, i) => {
                    const label = planEN ? DAYS_EN[i] : day;
                    const active = step1.classDays.includes(day);
                    return (
                      <button key={day} onClick={() => setStep1((p) => ({ ...p, classDays: active ? p.classDays.filter((d) => d !== day) : [...p.classDays, day] }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all ${active ? 'border-cta-from bg-cta-from text-white' : 'border-border text-gray-500 hover:border-gray-300'}`}>
                        {(label ?? day).slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-charcoal">{s('Horario de clase', 'Class schedule')}</label>
                <div className="flex items-center gap-2">
                  <select value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} className="input-field flex-1 text-sm py-2">
                    <option value="">{s('Inicio', 'Start')}</option>
                    {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span className="text-gray-400 text-sm shrink-0">–</span>
                  <select value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} className="input-field flex-1 text-sm py-2">
                    <option value="">{s('Fin', 'End')}</option>
                    {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>{s('Portada del curso', 'Course cover')}</SectionLabel>
        <div className="space-y-3">
          {step1.imageUrl ? (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-border bg-surface max-w-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step1.imageUrl} alt="cover" className="w-full h-full object-cover" />
              <button onClick={() => setStep1((p) => ({ ...p, imageUrl: '' }))} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer hover:border-gray-300 hover:bg-surface transition-colors max-w-sm"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) handleImageFile(f); }}>
              <ImageIcon className="w-7 h-7 text-gray-300" />
              <p className="text-sm font-medium text-gray-400">{s('Arrastra o haz clic', 'Drag or click')}</p>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }} />
          {imageError && <p className="text-xs text-red-500">{imageError}</p>}
          {!step1.imageUrl && step1.title && (
            <button onClick={handleGenerateImage} disabled={imageGenerating} className="flex items-center gap-2 text-sm text-purple-600 hover:text-purple-800 font-medium transition-colors disabled:opacity-50">
              {imageGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {imageGenerating ? s('Generando...', 'Generating...') : s('Generar con IA', 'Generate with AI')}
            </button>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>{s('Personalización visual', 'Visual customization')}</SectionLabel>
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">{s('Color de tinte', 'Tint color')}</label>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setStep1((p) => ({ ...p, cardColor: '' }))} className={`w-6 h-6 rounded-full border-2 bg-white flex items-center justify-center ${!step1.cardColor ? 'border-cta-from scale-110' : 'border-gray-200'}`}><X className="w-2.5 h-2.5 text-gray-300" /></button>
              {COLOR_PALETTE.map((c) => (<button key={c} onClick={() => setStep1((p) => ({ ...p, cardColor: c }))} style={{ backgroundColor: c }} className={`w-6 h-6 rounded-full border-2 transition-all ${step1.cardColor === c ? 'border-white scale-110 shadow-md' : 'border-transparent'}`} />))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">{s('Color de borde hover', 'Hover border')}</label>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setStep1((p) => ({ ...p, cardBorderColor: '' }))} className={`w-6 h-6 rounded-full border-2 bg-white flex items-center justify-center ${!step1.cardBorderColor ? 'border-cta-from scale-110' : 'border-gray-200'}`}><X className="w-2.5 h-2.5 text-gray-300" /></button>
              {BORDER_PALETTE.map((c) => (<button key={c} onClick={() => setStep1((p) => ({ ...p, cardBorderColor: c }))} style={{ borderColor: c, backgroundColor: c + '22' }} className={`w-6 h-6 rounded-full border-2 transition-all ${step1.cardBorderColor === c ? 'scale-110 shadow-md' : ''}`} />))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-indigo-500" />{s('Etiquetas de tarjeta', 'Card labels')}</label>
            <div className="flex gap-2">
              <input type="text" value={labelInput} onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = labelInput.trim(); if (v && !step1.cardLabels.includes(v)) { setStep1((p) => ({ ...p, cardLabels: [...p.cardLabels, v] })); setLabelInput(''); } } }}
                placeholder={s('Ej. Curso Core…', 'E.g. Core Course…')} className="input-field flex-1 text-sm py-2" />
              <button onClick={() => { const v = labelInput.trim(); if (v && !step1.cardLabels.includes(v)) { setStep1((p) => ({ ...p, cardLabels: [...p.cardLabels, v] })); setLabelInput(''); } }} className="px-3 py-2 rounded-xl border border-border text-sm text-gray-500 hover:bg-surface transition-colors">+</button>
            </div>
            {step1.cardLabels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {step1.cardLabels.map((lb) => (
                  <span key={lb} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
                    {lb}<button onClick={() => setStep1((p) => ({ ...p, cardLabels: p.cardLabels.filter((l) => l !== lb) }))} className="text-indigo-400 hover:text-indigo-700"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 flex gap-3">
        <Info className="w-4 h-4 text-cta-from shrink-0 mt-0.5" />
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {s('Inicia el', 'Starts')} <strong>{step1.startDate ? fmtDisplay(step1.startDate) : '—'}</strong>.{' '}
          {s('Haz clic en una semana o día para marcar excepciones.', 'Click a week or day to mark exceptions.')}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-charcoal">{s('Total de semanas lectivas', 'Total teaching weeks')}</label>
          <div className="flex items-center gap-2">
            <button onClick={() => setStep2((p) => ({ ...p, totalWeeks: Math.max(1, p.totalWeeks - 1) }))} className="w-8 h-8 rounded-lg border border-border hover:bg-surface font-bold">−</button>
            <input type="number" min={1} max={52} value={step2.totalWeeks} onChange={(e) => setStep2((p) => ({ ...p, totalWeeks: Math.max(1, Math.min(52, parseInt(e.target.value) || 1)) }))} className="input-field w-16 text-center font-semibold" />
            <button onClick={() => setStep2((p) => ({ ...p, totalWeeks: Math.min(52, p.totalWeeks + 1) }))} className="w-8 h-8 rounded-lg border border-border hover:bg-surface font-bold">+</button>
            <span className="text-sm text-gray-400">{s('semanas', 'weeks')}</span>
          </div>
        </div>
        {step2.exceptions.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
            <CalendarX className="w-3.5 h-3.5" />{step2.exceptions.length} {s('excepción(es)', 'exception(s)')}
          </div>
        )}
      </div>

      {pendingEx && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl space-y-3">
          <p className="text-sm font-semibold text-amber-800">
            {pendingEx.type === 'week' ? s(`Semana ${pendingEx.weekIndex + 1}`, `Week ${pendingEx.weekIndex + 1}`) : fmtDisplay(pendingEx.date ?? '')} — {s('Etiqueta:', 'Label:')}
          </p>
          <div className="flex gap-2">
            <input type="text" value={exLabelInput} onChange={(e) => setExLabelInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmException(); if (e.key === 'Escape') setPendingEx(null); }}
              placeholder={s('Ej. Semana Santa…', 'E.g. Easter Week…')} className="input-field flex-1 text-sm py-2" autoFocus />
            <Button onClick={confirmException} variant="secondary">OK</Button>
            <Button onClick={() => setPendingEx(null)} variant="secondary"><X className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {!step1.startDate ? (
        <p className="text-sm text-gray-400 text-center py-8">{s('Define la fecha de inicio en el Paso 1.', 'Set the start date in Step 1.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-surface">
                <th className="text-left px-3 py-2 font-semibold text-gray-500 w-20 border border-border">{s('Semana', 'Week')}</th>
                {activeDays.map((d) => (
                  <th key={d} className="px-2 py-2 font-semibold text-gray-500 border border-border text-center">
                    {planEN ? DAY_ABBR_EN[DAYS_ES.indexOf(d)] : DAY_ABBR_ES[DAYS_ES.indexOf(d)]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((wk) => {
                const wEx = isWeekEx(wk.index);
                return (
                  <tr key={wk.index} className={wEx ? 'bg-amber-50 dark:bg-amber-900/10' : 'hover:bg-surface/50'}>
                    <td className="px-3 py-1.5 border border-border">
                      <button onClick={() => toggleWeekEx(wk.index)} className={`flex items-center gap-1.5 w-full text-left ${wEx ? 'text-amber-700 font-semibold' : 'text-gray-600 hover:text-amber-600'}`}>
                        {wEx ? <CalendarX className="w-3 h-3 text-amber-500" /> : <span className="w-3 h-3" />}
                        <span>{s('S', 'W')}{wk.weekNum}</span>
                      </button>
                      {wEx && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[10px] text-amber-600 truncate max-w-[80px]">{step2.exceptions.find((e) => e.type === 'week' && e.weekIndex === wk.index)?.label}</span>
                          <button onClick={() => { const ex = step2.exceptions.find((e) => e.type === 'week' && e.weekIndex === wk.index); if (ex) removeException(ex.id); }} className="text-amber-400 hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                        </div>
                      )}
                    </td>
                    {wk.days.map(({ day, date }) => {
                      const dEx = isDayEx(date);
                      return (
                        <td key={day} className={`px-2 py-1.5 border border-border text-center ${wEx ? 'opacity-40' : ''} ${dEx ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                          <button disabled={wEx} onClick={() => toggleDayEx(wk.index, date)} className={`text-center w-full rounded transition-colors ${dEx ? 'text-red-600 font-semibold' : 'text-gray-500 hover:text-red-500'}`}>
                            {date.slice(8)}/{date.slice(5, 7)}
                            {dEx && <span className="block text-[9px] text-red-500 truncate">{step2.exceptions.find((e) => e.date === date)?.label ?? ''}</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {step2.exceptions.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>{s('Excepciones marcadas', 'Marked exceptions')}</SectionLabel>
          {step2.exceptions.map((ex) => (
            <div key={ex.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border">
              <CalendarX className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-charcoal">{ex.label}</span>
                <span className="text-xs text-gray-400 ml-2">{ex.type === 'week' ? `${s('Semana','Week')} ${ex.weekIndex + 1}` : fmtDisplay(ex.date ?? '')}</span>
              </div>
              <button onClick={() => removeException(ex.id)} className="text-gray-300 hover:text-red-500 transition-colors"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderStep3 = () => {
    const ct = COURSE_TYPES.find((c) => c.id === step1.courseType);
    return (
      <div className="space-y-6">
        <div className="p-4 bg-surface rounded-xl border border-border flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-cta-from text-white">{ct?.icon}</div>
          <div>
            <p className="font-semibold text-charcoal text-sm">{planEN ? ct?.labelEN : ct?.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s('Total debe sumar exactamente 100%.', 'Total must equal exactly 100%.')}</p>
          </div>
          <div className="ml-auto shrink-0">
            <div className={`text-sm font-bold px-3 py-1 rounded-full ${weightOk ? 'bg-emerald-100 text-emerald-700' : totalWeight > 100 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>{totalWeight.toFixed(0)}%</div>
          </div>
        </div>

        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-300 ${weightOk ? 'bg-emerald-500' : totalWeight > 100 ? 'bg-red-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, totalWeight)}%` }} />
        </div>

        <div className="space-y-3">
          {step3.items.map((item) => {
            const meta = EVAL_TYPE_META[item.type];
            return (
              <div key={item.id} className="border border-border rounded-xl overflow-hidden">
                <div className="bg-surface px-4 py-3 flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>{meta.icon}{planEN ? meta.labelEN : meta.label}</span>
                  <input value={planEN ? item.nameEN : item.name} onChange={(e) => updateItem(item.id, planEN ? { nameEN: e.target.value } : { name: e.target.value })}
                    className="flex-1 bg-transparent text-sm font-semibold text-charcoal border-0 outline-none focus:bg-white focus:px-2 focus:rounded focus:border focus:border-border transition-all" />
                  <div className="flex items-center gap-2 shrink-0">
                    <input type="number" min={0} max={100} step={5} value={item.weight} onChange={(e) => updateItem(item.id, { weight: parseFloat(e.target.value) || 0 })} className="w-16 text-center input-field py-1 text-sm font-bold" />
                    <span className="text-xs text-gray-400">%</span>
                    {!item.locked && <button onClick={() => removeItem(item.id)} className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">{s('Tipo:', 'Type:')}</span>
                      <div className="flex gap-1">
                        {(Object.keys(EVAL_TYPE_META) as EvalType[]).filter((t) => t !== 'ATTENDANCE').map((t) => {
                          const m = EVAL_TYPE_META[t];
                          return (
                            <button key={t} onClick={() => updateItem(item.id, { type: t })}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${item.type === t ? m.color + ' border-current' : 'border-border text-gray-400 hover:border-gray-300'}`}>
                              {m.icon}{planEN ? m.labelEN : m.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {item.type !== 'ATTENDANCE' && (
                      <div className="flex items-center gap-1.5 ml-auto">
                        <span className="text-xs text-gray-400">{s('Cantidad:', 'Count:')}</span>
                        <button onClick={() => setCount(item.id, item.count - 1)} className="w-6 h-6 rounded border border-border hover:bg-surface text-xs font-bold">−</button>
                        <span className="text-sm font-semibold w-5 text-center">{item.count}</span>
                        <button onClick={() => setCount(item.id, item.count + 1)} className="w-6 h-6 rounded border border-border hover:bg-surface text-xs font-bold">+</button>
                      </div>
                    )}
                  </div>
                  {item.type !== 'ATTENDANCE' && item.count > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-400">{s('Fecha(s) de entrega:', 'Due date(s):')}</p>
                      <div className="flex flex-wrap gap-2">
                        {item.dueDates.map((d, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            {item.count > 1 && <span className="text-[10px] text-gray-400 w-4">{i + 1}.</span>}
                            <input type="date" value={d} onChange={(e) => updateDueDate(item.id, i, e.target.value)} className="input-field py-1 text-xs w-36" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {item.type === 'EVIDENCE' && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-gray-400 hover:text-charcoal">{s('Instrucciones (opcional)', 'Instructions (optional)')}</summary>
                      <textarea value={item.instructions} onChange={(e) => updateItem(item.id, { instructions: e.target.value })} className="input-field w-full mt-2 min-h-[60px] text-xs resize-y" />
                    </details>
                  )}
                  {item.locked && item.type === 'ATTENDANCE' && (
                    <p className="text-[10px] text-gray-400 flex items-center gap-1"><Info className="w-3 h-3" />{s('Módulo de asistencia próximamente.', 'Attendance module coming soon.')}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={addEvalItem} className="flex items-center gap-2 w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-cta-from hover:text-cta-from transition-colors">
          <Plus className="w-4 h-4" />{s('Agregar evaluación personalizada', 'Add custom evaluation')}
        </button>

        {!weightOk && step3.items.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 flex gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {totalWeight > 100 ? s(`Excede 100% por ${(totalWeight - 100).toFixed(0)}%`, `Exceeds 100% by ${(totalWeight - 100).toFixed(0)}%`) : s(`Faltan ${(100 - totalWeight).toFixed(0)}%`, `${(100 - totalWeight).toFixed(0)}% remaining`)}
          </div>
        )}
      </div>
    );
  };

  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="p-4 bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-100 flex gap-3">
        <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-purple-800 dark:text-purple-200">{s('Lux Planner — Chrono-Planning', 'Lux Planner — Chrono-Planning')}</p>
          <p className="text-xs text-purple-600 dark:text-purple-300 mt-0.5">
            {s(`${effectiveWeeks} semanas lectivas (${step2.totalWeeks} - ${exceptionWeekIndices.length} excepciones). Pega el temario y Lux Planner distribuirá el contenido semana a semana.`,
              `${effectiveWeeks} teaching weeks (${step2.totalWeeks} - ${exceptionWeekIndices.length} exceptions). Paste the syllabus and Lux Planner will distribute content week by week.`)}
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-400">{s('Este paso es opcional. Puedes ir directo a Planeamiento sin generar el plan IA.', 'This step is optional. You can go straight to Planning without generating an AI plan.')}</p>

      <div className="space-y-2">
        <label className="text-sm font-medium text-charcoal">{s('Temario / Syllabus', 'Syllabus')}</label>
        <textarea
          value={step4.syllabusInput}
          onChange={(e) => setStep4((p) => ({ ...p, syllabusInput: e.target.value }))}
          placeholder={s(
            'Unidad 1: Introducción\n- Concepto de programación\n- Variables y tipos de datos\n\nUnidad 2: Control de flujo\n- Condicionales\n- Ciclos',
            'Unit 1: Introduction\n- Programming concepts\n- Variables and data types\n\nUnit 2: Control Flow\n- Conditionals\n- Loops'
          )}
          className="input-field w-full min-h-[180px] resize-y text-sm font-mono"
        />
        <p className="text-xs text-gray-400">{step4.syllabusInput.length}/2500 {s('caracteres', 'characters')}</p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={runCopilot}
          disabled={!step4.syllabusInput.trim() || step4.status === 'loading'}
          leftIcon={step4.status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        >
          {step4.status === 'loading'
            ? s('Generando plan...', 'Generating plan...')
            : step4.status === 'done'
            ? s('Regenerar', 'Regenerate')
            : s('Generar Plan con Lux Planner', 'Generate Plan with Lux Planner')}
        </Button>
        {step4.status === 'done' && (
          <button onClick={runCopilot} disabled={step4.status === 'loading'} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-charcoal transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />{s('Regenerar', 'Regenerate')}
          </button>
        )}
      </div>

      {step4.status === 'error' && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{step4.error}
        </div>
      )}

      {step4.modules.length > 0 && (
        <div className="space-y-3">
          <SectionLabel>{s('Módulos sugeridos', 'Suggested modules')}</SectionLabel>
          <div className="grid gap-2 sm:grid-cols-2">
            {step4.modules.map((mod, i) => (
              <div key={i} className="p-3 rounded-xl border border-border bg-surface">
                <p className="text-sm font-semibold text-charcoal">{planEN ? mod.nameEN : mod.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{planEN ? mod.descriptionEN : mod.description}</p>
                {mod.weeks?.length > 0 && <p className="text-[10px] text-cta-from mt-1.5 font-medium">{s('Semanas:', 'Weeks:')} {mod.weeks.join(', ')}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {step4.weeklyPlan.length > 0 && (
        <div className="space-y-3">
          <SectionLabel>{s('Plan semanal — haz clic en una celda para editar', 'Weekly plan — click to edit any cell')}</SectionLabel>
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface border-b border-border">
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 w-12">{s('Sem.', 'Wk.')}</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">{s('Contenido', 'Content')}</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 hidden sm:table-cell w-28">{s('Módulo', 'Module')}</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 w-28">{s('Evaluación', 'Evaluation')}</th>
                </tr>
              </thead>
              <tbody>
                {step4.weeklyPlan.map((wk) => {
                  const isEx = exceptionWeekIndices.includes(wk.weekNum);
                  const expanded = expandedWeeks.has(wk.weekNum);
                  return (
                    <tr key={wk.weekNum} className={`border-b border-border last:border-0 ${isEx ? 'bg-amber-50/60 dark:bg-amber-900/10 opacity-70' : 'hover:bg-surface/50'}`}>
                      <td className="px-3 py-2 font-semibold text-gray-500 whitespace-nowrap">{s('S', 'W')}{wk.weekNum}</td>
                      <td className="px-3 py-2">
                        {expanded ? (
                          <textarea value={wk.topics.join('\n')} onChange={(e) => updateWeekTopics(wk.weekNum, e.target.value)}
                            className="input-field w-full text-xs py-1 min-h-[56px] resize-y"
                            onBlur={() => setExpandedWeeks((p) => { const ns = new Set(p); ns.delete(wk.weekNum); return ns; })} autoFocus />
                        ) : (
                          <button className="text-left w-full text-charcoal hover:text-cta-from transition-colors line-clamp-2"
                            onClick={() => setExpandedWeeks((p) => { const ns = new Set(p); ns.add(wk.weekNum); return ns; })}>
                            {wk.topics.join(' · ')}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-400 hidden sm:table-cell"><span className="truncate block max-w-[100px]">{wk.module}</span></td>
                      <td className="px-3 py-2">
                        {wk.evalEvent && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">{wk.evalEvent.name}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step4.status === 'done' && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex gap-2">
          <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {s('Plan generado. Puedes editar cualquier celda antes de continuar.', 'Plan generated. You can edit any cell before continuing.')}
        </div>
      )}
    </div>
  );

  const renderStep5 = () => {
    if (step5.status === 'done') {
      return (
        <div className="space-y-6 text-center py-8">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
          </div>
          <div>
            <p className="font-heading font-bold text-charcoal text-xl">{s('¡Curso creado exitosamente!', 'Course created successfully!')}</p>
            <p className="text-sm text-gray-400 mt-1">{step1.title}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={() => router.push(`/admin/courses/${step5.courseId}`)} leftIcon={<BookOpen className="w-4 h-4" />}>
              {s('Ir al curso', 'Go to course')}
            </Button>
            {step5.docUrl && (
              <a href={step5.docUrl} target="_blank" rel="noopener noreferrer" download className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-border text-sm font-semibold text-charcoal hover:bg-surface transition-colors">
                <Download className="w-4 h-4 text-cta-from" />{s('Descargar plan Word', 'Download Word plan')}
              </a>
            )}
          </div>
        </div>
      );
    }

    const ct = COURSE_TYPES.find((c) => c.id === step1.courseType);
    return (
      <div className="space-y-6">
        <div className="p-4 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10 rounded-xl border border-blue-100 space-y-1">
          <p className="font-semibold text-charcoal">{step1.title}</p>
          <p className="text-xs text-gray-500">{planEN ? ct?.labelEN : ct?.label} · {step1.academicPeriod || '—'} · {step1.modality}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
          {[
            { label: s('Semanas', 'Weeks'), value: step2.totalWeeks },
            { label: s('Excepciones', 'Exceptions'), value: step2.exceptions.length },
            { label: s('Evaluaciones', 'Evaluations'), value: step3.items.length },
            { label: s('Lectivas', 'Teaching'), value: effectiveWeeks },
          ].map(({ label, value }) => (
            <div key={label} className="p-3 rounded-xl bg-surface border border-border">
              <p className="text-xl font-bold text-cta-from">{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        <div>
          <SectionLabel>{s('Sistema de evaluación', 'Evaluation system')}</SectionLabel>
          <div className="space-y-2">
            {step3.items.map((it) => {
              const meta = EVAL_TYPE_META[it.type];
              return (
                <div key={it.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>{meta.icon}{planEN ? meta.labelEN : meta.label}</span>
                  <span className="text-sm text-charcoal flex-1">{planEN ? it.nameEN : it.name}</span>
                  <span className="text-sm font-bold text-cta-from">{it.weight}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {step4.weeklyPlan.length > 0 && (
          <div className="p-3 bg-purple-50 dark:bg-purple-900/10 border border-purple-100 rounded-xl flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />
            <p className="text-xs text-purple-700 dark:text-purple-300">
              {s(`Plan de ${step4.weeklyPlan.length} semanas con Copilot IA listo para incluir en el Word.`, `${step4.weeklyPlan.length}-week AI Copilot plan ready to include in Word.`)}
            </p>
          </div>
        )}

        <div className="p-4 rounded-xl border border-border bg-surface space-y-2">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-cta-from" />
            <p className="text-sm font-semibold text-charcoal">{s('Documento Word', 'Word Document')}</p>
          </div>
          <p className="text-xs text-gray-400">{s(`Machote: "${ct?.machote}" · Idioma: ${step1.planLanguage}`, `Template: "${ct?.machote}" · Language: ${step1.planLanguage}`)}</p>
          <p className="text-xs text-gray-400">{s('Se generará automáticamente y quedará disponible para descarga.', 'Auto-generated and available for download.')}</p>
        </div>

        {step5.status === 'error' && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{step5.error}
          </div>
        )}

        <Button onClick={saveCourse} disabled={step5.status === 'saving'}
          leftIcon={step5.status === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          className="w-full justify-center">
          {step5.status === 'saving' ? s('Guardando y generando documento...', 'Saving and generating document...') : s('Guardar Curso y Generar Plan Word', 'Save Course & Generate Word Plan')}
        </Button>
      </div>
    );
  };

  // ── Layout ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-b border-border px-6 py-3 flex items-center gap-4">
        <button onClick={goBack} className="p-2 rounded-lg text-gray-400 hover:text-charcoal hover:bg-surface transition-colors"><ArrowLeft className="w-4 h-4" /></button>
        <div>
          <p className="font-heading font-bold text-charcoal text-sm">{s('Wizard de Creación de Curso', 'Course Creation Wizard')}</p>
          {step1.title && <p className="text-xs text-gray-400">{step1.title}</p>}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        <StepBar current={step} />

        <div>
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          {step === 5 && renderStep5()}
        </div>

        {step5.status !== 'done' && (
          <div className="flex items-center justify-between mt-10 pt-6 border-t border-border">
            <Button variant="secondary" onClick={goBack} leftIcon={<ArrowLeft className="w-4 h-4" />}>{s('Atrás', 'Back')}</Button>
            {step < 5 && <Button onClick={goNext} disabled={!canNext} rightIcon={<ArrowRight className="w-4 h-4" />}>{s('Siguiente', 'Next')}</Button>}
          </div>
        )}
      </div>
    </div>
  );
}
