'use client';

import { useState, useRef, useMemo, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/i18n';

import {
  Step1Data, Step2Data, Step3Data, Step4Data, Step5Data,
  ExceptionItem, EvalItem, CourseTypeId, PendingException, CalendarWeek,
  EMPTY_STEP1, EMPTY_STEP2, EMPTY_STEP3, EMPTY_STEP4, EMPTY_STEP5,
  DAY_TO_JS, uid, weekStart, addDays, fmtDate, defaultEvalItems,
} from './_components/constants';
import { StepBar } from './_components/StepBar';
import { StepIdentidad } from './_components/StepIdentidad';
import { StepCalendario } from './_components/StepCalendario';
import { StepEvaluacion } from './_components/StepEvaluacion';
import { StepLuxPlanner } from './_components/StepLuxPlanner';
import { StepPlaneamiento } from './_components/StepPlaneamiento';

// ─── Main ─────────────────────────────────────────────────────────────────────

function CourseWizardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang } = useLanguage();
  const isEN = lang === 'en';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [step1, setStep1] = useState<Step1Data>(EMPTY_STEP1);
  const [step2, setStep2] = useState<Step2Data>(EMPTY_STEP2);
  const [step3, setStep3] = useState<Step3Data>(EMPTY_STEP3);
  const [step4, setStep4] = useState<Step4Data>(EMPTY_STEP4);
  const [step5, setStep5] = useState<Step5Data>(EMPTY_STEP5);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [loadingCourse, setLoadingCourse] = useState(false);

  const [labelInput, setLabelInput] = useState('');
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageError, setImageError] = useState('');
  const [periods, setPeriods] = useState<{ id: string; name: string }[]>([]);
  const [newPeriodInput, setNewPeriodInput] = useState('');
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [schedulesPerDay, setSchedulesPerDay] = useState<Record<string, { start: string; end: string }>>({});
  const [exLabelInput, setExLabelInput] = useState('');
  const [pendingEx, setPendingEx] = useState<PendingException | null>(null);
  const [dateWarningDismissed, setDateWarningDismissed] = useState(false);

  // ── Exit confirmation ──────────────────────────────────────────────────────
  const [exitConfirm, setExitConfirm] = useState(false);
  const [pendingNavDest, setPendingNavDest] = useState<string | null>(null);

  const DRAFT_KEY = 'lux-planner-draft';

  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step1, step2, step3, step4, scheduleStart, scheduleEnd, schedulesPerDay, editingCourseId, savedAt: new Date().toISOString() }));
    } catch { /* ignore */ }
  }, [step1, step2, step3, step4, scheduleStart, scheduleEnd, schedulesPerDay, editingCourseId]);

  // Block browser tab close/refresh
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (step > 1 && step5.status !== 'done') { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [step, step5.status]);

  useEffect(() => {
    api.admin.periods.list().then((res: any) => setPeriods(res?.data ?? res ?? [])).catch(() => {});
  }, []);

  // Restore draft from localStorage (only when not editing an existing course)
  useEffect(() => {
    const courseId = searchParams.get('courseId');
    if (courseId) return; // editing mode loads from API
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.step1) setStep1(draft.step1);
      if (draft.step2) setStep2(draft.step2);
      if (draft.step3) setStep3(draft.step3);
      if (draft.step4) setStep4(draft.step4);
      if (draft.scheduleStart) setScheduleStart(draft.scheduleStart);
      if (draft.scheduleEnd) setScheduleEnd(draft.scheduleEnd);
      if (draft.schedulesPerDay) setSchedulesPerDay(draft.schedulesPerDay);
    } catch { /* corrupt draft — ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preload existing course when editing
  const preloadCourse = useCallback(async (courseId: string) => {
    setLoadingCourse(true);
    try {
      const res = await api.admin.courses.get(courseId) as any;
      const c = res?.data ?? res;
      if (!c) return;
      setEditingCourseId(courseId);

      const [schStart, schEnd] = (c.classSchedule ?? '').split(' – ');
      setScheduleStart(schStart ?? '');
      setScheduleEnd(schEnd ?? '');

      setStep1({
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
      });

      setStep2({
        totalWeeks: c.totalWeeks ?? 16,
        exceptions: Array.isArray(c.calendarExceptions) ? c.calendarExceptions.map((ex: any) => ({ ...ex, id: ex.id ?? uid() })) : [],
      });

      const evalConfig = Array.isArray(c.evaluationConfig) ? c.evaluationConfig : [];
      if (evalConfig.length > 0) {
        setStep3({
          items: evalConfig.map((it: any, i: number) => ({
            id: it.id ?? String(i),
            type: it.type ?? 'EXAM',
            name: it.name ?? '',
            nameEN: it.nameEN ?? it.name ?? '',
            weight: it.weight ?? 0,
            count: it.count ?? (Array.isArray(it.dueDates) ? it.dueDates.length : 1),
            dueDates: Array.isArray(it.dueDates) ? it.dueDates : [''],
            instructions: it.instructions ?? '',
            locked: it.locked ?? false,
            vapiPrompt: it.vapiPrompt ?? '',
            vapiObjectives: it.vapiObjectives ?? '',
            interviewStartDate: it.interviewStartDate ?? '',
            interviewEndDate: it.interviewEndDate ?? '',
            interviewTimeSlot: it.interviewTimeSlot ?? '',
          })),
        });
      }

      // Restore weekly plan and syllabus if previously saved
      const savedPlan = Array.isArray(c.planWeeklyPlan) ? c.planWeeklyPlan : [];
      const savedSyllabus = typeof c.planSyllabusInput === 'string' ? c.planSyllabusInput : '';
      // Always restore — even if empty string (keeps step4 in sync with DB)
      setStep4((p) => ({
        ...p,
        syllabusInput: savedSyllabus,
        weeklyPlan: savedPlan.length > 0 ? savedPlan : p.weeklyPlan,
        status: savedPlan.length > 0 ? 'done' : 'idle',
      }));
    } catch {
      // Ignore — wizard will start blank
    } finally {
      setLoadingCourse(false);
    }
  }, []);

  useEffect(() => {
    const courseId = searchParams.get('courseId');
    if (courseId) preloadCourse(courseId);
  }, [searchParams, preloadCourse]);

  const copilotPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => { if (copilotPollRef.current) clearInterval(copilotPollRef.current); };
  }, []);

  // Keep classSchedule in sync with the single time selectors (used when only 1 day)
  useEffect(() => {
    if (step1.classDays.length <= 1) {
      if (scheduleStart && scheduleEnd) {
        setStep1((p) => ({ ...p, classSchedule: `${scheduleStart} – ${scheduleEnd}` }));
      } else if (scheduleStart) {
        setStep1((p) => ({ ...p, classSchedule: scheduleStart }));
      }
    }
  }, [scheduleStart, scheduleEnd, step1.classDays.length]);

  // Keep classSchedules in sync for multi-day
  useEffect(() => {
    if (step1.classDays.length > 1) {
      const built: Record<string, string> = {};
      for (const day of step1.classDays) {
        const v = schedulesPerDay[day];
        if (v?.start) built[day] = v.end ? `${v.start} – ${v.end}` : v.start;
      }
      setStep1((p) => ({ ...p, classSchedules: built, classSchedule: Object.values(built)[0] ?? p.classSchedule }));
    }
  }, [schedulesPerDay, step1.classDays]);

  const s = (es: string, en: string) => isEN ? en : es;
  const activeDays = step1.classDays.length > 0 ? step1.classDays : ['Lunes', 'Miércoles', 'Viernes'];

  // ── Out-of-range date detection ────────────────────────────────────────────
  const courseEndDate = useMemo(() => {
    if (!step1.startDate || !step2.totalWeeks) return null;
    const d = new Date(step1.startDate + 'T12:00:00');
    d.setDate(d.getDate() + step2.totalWeeks * 7);
    return d;
  }, [step1.startDate, step2.totalWeeks]);

  const outOfRangeItems = useMemo(() => {
    if (!step1.startDate || !courseEndDate) return [];
    const rangeStart = new Date(step1.startDate + 'T00:00:00');
    return step3.items.flatMap((item) =>
      item.dueDates
        .filter((d) => d && (new Date(d) < rangeStart || new Date(d) > courseEndDate))
        .map((d) => ({ itemName: item.name || item.nameEN, date: d }))
    );
  }, [step3.items, step1.startDate, courseEndDate]);

  useEffect(() => { setDateWarningDismissed(false); }, [outOfRangeItems.length]);

  // ── Calendar weeks ─────────────────────────────────────────────────────────
  const weeks = useMemo<CalendarWeek[]>(() => {
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

  const addEvalItem = () => setStep3((p) => ({ ...p, items: [...p.items, { id: uid(), type: 'EVIDENCE' as EvalItem['type'], name: 'Actividad', nameEN: 'Activity', weight: 0, count: 1, dueDates: [''], instructions: '' }] }));
  const removeItem = (id: string) => setStep3((p) => ({ ...p, items: p.items.filter((it) => it.id !== id) }));

  // Init default eval items when entering Evaluación (step 4)
  const enterEvaluacion = () => {
    if (step3.items.length === 0 && step1.courseType) setStep3({ items: defaultEvalItems(step1.courseType as CourseTypeId) });
    setStep(4);
  };

  // ── Step 4 — Lux Planner ───────────────────────────────────────────────────
  const exceptionWeekIndices = step2.exceptions.filter((e) => e.type === 'week').map((e) => e.weekIndex + 1);
  const effectiveWeeks = step2.totalWeeks - exceptionWeekIndices.length;

  const runCopilot = async () => {
    if (!step4.syllabusInput.trim()) return;
    if (copilotPollRef.current) clearInterval(copilotPollRef.current);
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
      const init = resp?.data ?? resp;
      if (!init?.jobId) throw new Error('No se recibió jobId del servidor');
      let pollCount = 0;
      const MAX_POLLS = 60; // 3 minutos máximo
      copilotPollRef.current = setInterval(async () => {
        pollCount++;
        if (pollCount > MAX_POLLS) {
          clearInterval(copilotPollRef.current!);
          setStep4((p) => ({ ...p, status: 'error', error: 'La generación tardó demasiado. Intenta de nuevo.' }));
          return;
        }
        try {
          const jobResp = await api.admin.courses.aiJob(init.jobId) as any;
          const job = jobResp?.data ?? jobResp;
          if (job?.status === 'done') {
            clearInterval(copilotPollRef.current!);
            if (!job.weeklyPlan) { setStep4((p) => ({ ...p, status: 'error', error: 'Respuesta inválida del servidor. Intenta de nuevo.' })); return; }
            setStep4((p) => ({ ...p, status: 'done', weeklyPlan: job.weeklyPlan, modules: job.modules ?? [] }));
          } else if (job?.status === 'error') {
            clearInterval(copilotPollRef.current!);
            setStep4((p) => ({ ...p, status: 'error', error: job.error ?? 'Error generando plan. Intenta de nuevo.' }));
          }
        } catch { /* network hiccup — keep polling until MAX_POLLS */ }
      }, 3000);
    } catch (err: any) {
      setStep4((p) => ({ ...p, status: 'error', error: err?.message ?? 'Error desconocido' }));
    }
  };

  const updateWeekTopics = (weekNum: number, text: string) =>
    setStep4((p) => ({ ...p, weeklyPlan: p.weeklyPlan.map((wk) => wk.weekNum === weekNum ? { ...wk, topics: [text] } : wk) }));

  const updateWeekProcedure = (weekNum: number, text: string) =>
    setStep4((p) => ({ ...p, weeklyPlan: p.weeklyPlan.map((wk) => wk.weekNum === weekNum ? { ...wk, procedure: text } : wk) }));

  const updateWeekNotes = (weekNum: number, text: string) =>
    setStep4((p) => ({ ...p, weeklyPlan: p.weeklyPlan.map((wk) => wk.weekNum === weekNum ? { ...wk, notes: text } : wk) }));

  const updateModuleQuizWeek = (moduleIdx: number, quizWeek: number | null) =>
    setStep4((p) => ({ ...p, modules: p.modules.map((m, i) => i === moduleIdx ? { ...m, quizWeek } : m) }));

  const updateModuleReflexWeek = (moduleIdx: number, reflexWeek: number | null) =>
    setStep4((p) => ({ ...p, modules: p.modules.map((m, i) => i === moduleIdx ? { ...m, reflexWeek } : m) }));

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
        suggestedModules: step4.modules.map((m) => ({
          ...m,
          quizWeek: m.quizWeek ?? null,
          reflexWeek: m.reflexWeek ?? null,
        })),
        pilotoAutomatico: step1.pilotoAutomatico ?? false,
        syllabusInput: step4.syllabusInput,
        ...(editingCourseId ? { editingCourseId } : {}),
      }) as any;
      const data = resp?.data ?? resp;
      if (!data?.courseId) throw new Error('No se recibió courseId');
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setStep5({ status: 'done', courseId: data.courseId, docUrl: data.docUrl ?? null, lessonJobId: data.lessonJobId ?? null, error: '' });
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
      else setImageError(s('No se recibió imagen. Intenta de nuevo.', 'No image received. Try again.'));
    } catch (err: any) {
      setImageError(err?.message ?? s('Stability AI tardó demasiado. Inténtalo de nuevo.', 'Stability AI timed out. Try again.'));
    } finally { setImageGenerating(false); }
  };

  // ── Navigation ─────────────────────────────────────────────────────────────
  const step1Valid = step1.title.trim().length > 0 && step1.courseType !== '' && step1.modality !== '' && step1.startDate !== '';
  const step2Valid = step2.totalWeeks >= 1;
  const step3Valid = step3.items.length > 0 && weightOk;
  const step4Valid = step4.status !== 'loading';

  // Order: 1=Identidad, 2=Calendario, 3=Planeamiento(LuxPlanner), 4=Evaluación, 5=Resumen Lux Planner
  const canNext = step === 1 ? step1Valid : step === 2 ? step2Valid : step === 3 ? step4Valid : step === 4 ? step3Valid : false;

  const goNext = () => {
    if (step === 3) { enterEvaluacion(); return; }
    setStep((p) => Math.min(5, p + 1) as typeof step);
  };
  const goBack = () => {
    if (step5.status === 'done') { router.push('/admin/courses'); return; }
    if (step === 1) { setPendingNavDest('/admin/courses'); setExitConfirm(true); return; }
    setStep((p) => Math.max(1, p - 1) as typeof step);
  };

  // ── Layout ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-b border-border px-6 py-3 flex items-center gap-4">
        <button onClick={goBack} className="p-2 rounded-lg text-gray-400 hover:text-charcoal hover:bg-surface transition-colors"><ArrowLeft className="w-4 h-4" /></button>
        <div>
          <p className="font-heading font-bold text-charcoal text-sm">{editingCourseId ? s('Lux Planner — Editar Curso', 'Lux Planner — Edit Course') : s('Lux Planner — Creación de Curso', 'Lux Planner — Course Creation')}</p>
          {step1.title && <p className="text-xs text-gray-400">{step1.title}</p>}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {loadingCourse && (
          <div className="flex items-center gap-3 mb-6 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-300">{s('Cargando datos del curso...', 'Loading course data...')}</p>
          </div>
        )}
        <StepBar current={step} />

        <div>
          {step === 1 && (
            <StepIdentidad
              step1={step1} setStep1={setStep1} setStep3={setStep3}
              periods={periods} setPeriods={setPeriods}
              newPeriodInput={newPeriodInput} setNewPeriodInput={setNewPeriodInput}
              showNewPeriod={showNewPeriod} setShowNewPeriod={setShowNewPeriod}
              scheduleStart={scheduleStart} setScheduleStart={setScheduleStart}
              scheduleEnd={scheduleEnd} setScheduleEnd={setScheduleEnd}
              schedulesPerDay={schedulesPerDay} setSchedulesPerDay={setSchedulesPerDay}
              labelInput={labelInput} setLabelInput={setLabelInput}
              imageGenerating={imageGenerating} imageError={imageError} setImageError={setImageError}
              fileInputRef={fileInputRef}
              handleImageFile={handleImageFile} handleGenerateImage={handleGenerateImage}
              isEN={isEN}
            />
          )}
          {step === 2 && (
            <StepCalendario
              step1={step1} step2={step2} setStep2={setStep2}
              weeks={weeks} exceptionSet={exceptionSet}
              pendingEx={pendingEx} setPendingEx={setPendingEx}
              exLabelInput={exLabelInput} setExLabelInput={setExLabelInput}
              toggleWeekEx={toggleWeekEx} toggleDayEx={toggleDayEx}
              confirmException={confirmException} removeException={removeException}
              activeDays={activeDays} isEN={isEN}
            />
          )}
          {step === 3 && (
            <StepLuxPlanner
              step4={step4} setStep4={setStep4}
              effectiveWeeks={effectiveWeeks} exceptionWeekIndices={exceptionWeekIndices}
              step2TotalWeeks={step2.totalWeeks}
              planEN={step1.planLanguage === 'EN'}
              runCopilot={runCopilot} updateWeekTopics={updateWeekTopics}
              updateWeekProcedure={updateWeekProcedure} updateWeekNotes={updateWeekNotes}
              updateModuleQuizWeek={updateModuleQuizWeek} updateModuleReflexWeek={updateModuleReflexWeek}
              weeks={weeks}
              isEN={isEN}
            />
          )}
          {step === 4 && (
            <StepEvaluacion
              step1={step1} step2={step2} step3={step3} step4={step4}
              totalWeight={totalWeight} weightOk={weightOk}
              outOfRangeItems={outOfRangeItems}
              dateWarningDismissed={dateWarningDismissed} setDateWarningDismissed={setDateWarningDismissed}
              updateItem={updateItem} updateDueDate={updateDueDate} setCount={setCount}
              addEvalItem={addEvalItem} removeItem={removeItem}
              isEN={isEN}
              onPilotoToggle={(val) => setStep1((p) => ({ ...p, pilotoAutomatico: val }))}
              step5Error={''}
              editingCourseId={editingCourseId}
            />
          )}
          {step === 5 && (
            <StepPlaneamiento
              step1={step1} step2={step2} step3={step3} step4={step4} step5={step5}
              effectiveWeeks={effectiveWeeks}
              editingCourseId={editingCourseId}
              saveCourse={saveCourse}
              onGoToCourse={(courseId) => router.push(`/admin/courses/${courseId}`)}
              onGoToEval={() => setStep(4)}
              onRemoveEval={removeItem}
              isEN={isEN}
            />
          )}
        </div>

        {step5.status !== 'done' && (
          <div className="flex items-center justify-between mt-10 pt-6 border-t border-border">
            <Button variant="secondary" onClick={goBack} leftIcon={<ArrowLeft className="w-4 h-4" />}>{s('Atrás', 'Back')}</Button>
            {step < 5 && <Button onClick={goNext} disabled={!canNext} rightIcon={<ArrowRight className="w-4 h-4" />}>{s('Siguiente', 'Next')}</Button>}
          </div>
        )}

        {/* Exit confirmation modal */}
        {exitConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
              <p className="font-heading font-bold text-charcoal text-lg">{s('¿Desea salir de Lux Planner?', 'Leave Lux Planner?')}</p>
              <p className="text-sm text-gray-500">{s('El progreso no guardado se perderá a menos que guardes un borrador.', 'Unsaved progress will be lost unless you save a draft.')}</p>
              <div className="flex flex-col gap-2 pt-1">
                <button onClick={() => { setExitConfirm(false); router.push(pendingNavDest ?? '/admin/courses'); }} className="w-full px-4 py-2.5 rounded-xl bg-red-500 text-white font-semibold text-sm hover:bg-red-600 transition-colors">
                  {s('Salir sin guardar', 'Exit without saving')}
                </button>
                <button onClick={() => { saveDraft(); setExitConfirm(false); router.push(pendingNavDest ?? '/admin/courses'); }} className="w-full px-4 py-2.5 rounded-xl border-2 border-cta-from text-cta-from font-semibold text-sm hover:bg-blue-50 transition-colors">
                  {s('Guardar borrador y salir', 'Save draft and exit')}
                </button>
                <button onClick={() => { setExitConfirm(false); setPendingNavDest(null); }} className="w-full px-4 py-2.5 rounded-xl border border-border text-gray-500 font-semibold text-sm hover:bg-surface transition-colors">
                  {s('Cancelar', 'Cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CourseWizardPage() {
  return <Suspense fallback={null}><CourseWizardInner /></Suspense>;
}
