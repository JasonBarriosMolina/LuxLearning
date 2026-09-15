'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { WizardShell } from './_components/WizardShell';
import { StepPeriod } from './_components/StepPeriod';
import { StepParams } from './_components/StepParams';
import { StepCourses, type CourseOverrides } from './_components/StepCourses';
import { StepAvailability } from './_components/StepAvailability';
import { StepStudents } from './_components/StepStudents';
import { StepGenerate } from './_components/StepGenerate';
import { StepReview } from './_components/StepReview';
import { StepReports } from './_components/StepReports';
import type { CourseCatalogRow, GenerateResult } from './_components/types';

// Borrador local del wizard (Trello *LUX SCHEDULER*, Mack 2026-09-10: "debería
// haber siempre una opción de guardar como borrador... por si le doy atrás sin
// querer"). Solo pasos 1-6 (entrada de datos) — el resultado generado (7-8) no
// se persiste, se regenera al volver porque la disponibilidad pudo cambiar.
const DRAFT_KEY = 'lux-scheduler-draft-v1';
interface Draft {
  step: number; academicPeriod: string; lunchStart: string; lunchEnd: string;
  gapMinutes: number; individualMinutes: number; groupMinutes: number;
  courses: CourseCatalogRow[]; overrides: CourseOverrides;
}
function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveDraft(d: Draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* storage unavailable — draft is a convenience, not critical */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

// Lux Scheduler — wizard de 8 pasos (Trello *LUX SCHEDULER*, 2026-09-10, spec de
// Mack completa en el card). Todo el estado vive acá, cada Step es presentacional.
export default function SchedulerPage() {
  const { role } = useAuth();
  const isAdminRole = role === 'ADMIN' || role === 'SUPER_ADMIN';

  const [step, setStep] = useState(1);
  const [academicPeriod, setAcademicPeriod] = useState('');
  const [lunchStart, setLunchStart] = useState('12:00');
  const [lunchEnd, setLunchEnd] = useState('13:00');
  const [gapMinutes, setGapMinutes] = useState(5);
  const [individualMinutes, setIndividualMinutes] = useState(55);
  const [groupMinutes, setGroupMinutes] = useState(75);
  // Trello *LUX SCHEDULER*, 2026-09-15 (Mack): "que se puedan elegir los días
  // de la semana que son cursos presenciales [y] virtuales... así
  // funcionaría con cualquier centro educativo." Defaults = comportamiento
  // de siempre (sábado presencial, lunes-viernes virtual, 8am-4pm).
  const [presencialDays, setPresencialDays] = useState<number[]>([6]);
  const [virtualDays, setVirtualDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [institutionalOpen, setInstitutionalOpen] = useState('08:00');
  const [institutionalClose, setInstitutionalClose] = useState('16:00');
  const [courses, setCourses] = useState<CourseCatalogRow[]>([]);
  const [studentNames, setStudentNames] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<CourseOverrides>({});
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftAvailable, setDraftAvailable] = useState(false);

  // Restaurar borrador una sola vez al montar.
  useEffect(() => {
    const d = loadDraft();
    if (d) {
      setStep(Math.min(d.step, 6));
      setAcademicPeriod(d.academicPeriod);
      setLunchStart(d.lunchStart); setLunchEnd(d.lunchEnd);
      setGapMinutes(d.gapMinutes); setIndividualMinutes(d.individualMinutes); setGroupMinutes(d.groupMinutes);
      setCourses(d.courses); setOverrides(d.overrides);
      setDraftAvailable(true);
    }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guardar borrador en cada cambio relevante, solo mientras estamos en los
  // pasos de entrada (1-6) y ya pasamos la restauración inicial.
  useEffect(() => {
    if (!draftRestored || step > 6 || !academicPeriod) return;
    saveDraft({ step, academicPeriod, lunchStart, lunchEnd, gapMinutes, individualMinutes, groupMinutes, courses, overrides });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRestored, step, academicPeriod, lunchStart, lunchEnd, gapMinutes, individualMinutes, groupMinutes, courses, overrides]);

  const discardDraft = () => {
    clearDraft();
    setDraftAvailable(false);
    setStep(1); setAcademicPeriod(''); setCourses([]); setOverrides({}); setResult(null);
  };

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "cuando yo vuelva a Lux
  // Scheduler, yo tengo que tener la opción de volver a previsualizar cómo
  // quedó eso final" — si el período elegido ya tiene un candidato aprobado
  // (o publicado), ofrecer saltar directo a revisarlo en vez de regenerar.
  const [existingApproval, setExistingApproval] = useState<{ status: string } | null>(null);
  useEffect(() => {
    if (!academicPeriod || step !== 1) { setExistingApproval(null); return; }
    api.admin.scheduler.getApproval(academicPeriod).then((res: any) => setExistingApproval(res?.data ?? null)).catch(() => setExistingApproval(null));
  }, [academicPeriod, step]);

  const resumeApproval = async () => {
    try {
      const res = await api.admin.scheduler.getApproval(academicPeriod);
      const approval = (res as any)?.data;
      if (!approval) return;
      const { proposal, courseTitles, teacherNames, studentNames, roomNames } = approval.proposalJson as { proposal: any; courseTitles?: Record<string, string>; teacherNames?: Record<string, string>; studentNames?: Record<string, string>; roomNames?: Record<string, string> };
      setResult({ proposals: [proposal], courseTitles: courseTitles ?? {}, teacherNames: teacherNames ?? {}, studentNames: studentNames ?? {}, roomNames: roomNames ?? {}, academicPeriod, skippedAsyncCourseIds: [] });
      setStep(approval.status === 'PUBLISHED' ? 8 : 7);
    } catch { /* stay on step 1 — nothing to resume */ }
  };

  const lunchBreak = { startTime: lunchStart, endTime: lunchEnd };

  // Trello *LUX SCHEDULER* (Mack, 2026-09-10): si el admin usa el stepper para
  // volver a un paso anterior mientras "armando rompecabezas" sigue en vuelo,
  // no queremos que la respuesta tardía lo empuje de vuelta al paso 7.
  const stepRef = useRef(step);
  stepRef.current = step;

  const runGenerate = async () => {
    setGenerating(true); setGenerateError(''); setResult(null);
    try {
      const res = await api.admin.scheduler.generate({
        academicPeriod, courseOverrides: overrides, lunchBreak, gapMinutes, individualMinutes, groupMinutes,
        presencialDays, virtualDays, institutionalOpen, institutionalClose,
      });
      setResult((res as any).data);
      if (stepRef.current === 6) setStep(7);
    } catch (err: any) {
      setGenerateError(err?.message ?? 'No se pudo generar el horario.');
    } finally {
      setGenerating(false);
    }
  };

  // Entering step 6 kicks off generation automatically.
  useEffect(() => {
    if (step === 6 && !result && !generating && !generateError) runGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const liveCourseCount = courses.filter((c) => c.engineModality !== null || overrides[c.id]?.modality).length;

  // Volver a un paso de entrada (1-5) invalida un resultado/errror de generación
  // previo, para que re-entrar al paso 6 dispare una regeneración fresca en vez
  // de mostrar el resultado viejo o quedarse pegado.
  const goToStep = (n: number) => {
    if (n <= 5) { setResult(null); setGenerateError(''); }
    setStep(n);
  };

  if (!isAdminRole) {
    return (
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <CalendarClock className="w-6 h-6 text-cta-from" />
          <h1 className="font-heading font-bold text-2xl text-charcoal">Lux Scheduler</h1>
        </div>
        <div className="card bg-amber-50 border border-amber-200 text-sm text-amber-700">
          Solo un administrador puede generar y aprobar horarios institucionales.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {draftAvailable && step <= 6 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-cta-from/30 bg-cta-from/5 px-3 py-2 text-xs text-charcoal">
          <span>Se restauró tu borrador guardado.</span>
          <button type="button" onClick={discardDraft} className="font-semibold text-cta-from hover:underline shrink-0">
            Empezar de nuevo
          </button>
        </div>
      )}
      {existingApproval && step === 1 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <span>Ya existe un horario {existingApproval.status === 'PUBLISHED' ? 'publicado' : 'aprobado (sin publicar)'} para este período.</span>
          <button type="button" onClick={resumeApproval} className="font-semibold text-emerald-700 hover:underline shrink-0">
            Ver / continuar
          </button>
        </div>
      )}
      <WizardShell
        step={step}
      onBack={step > 1 && step !== 8 ? () => goToStep(step === 7 ? 5 : step - 1) : undefined}
      onStepClick={goToStep}
      onNext={
        step === 1 ? () => setStep(2) :
        step === 2 ? () => setStep(3) :
        step === 3 ? () => setStep(4) :
        step === 4 ? () => setStep(5) :
        step === 5 ? () => setStep(6) :
        undefined
      }
      nextDisabled={(step === 1 && !academicPeriod) || (step === 3 && liveCourseCount === 0)}
      hideNext={step === 6 || step === 7 || step === 8}
    >
      {step === 1 && <StepPeriod academicPeriod={academicPeriod} onChange={setAcademicPeriod} />}
      {step === 2 && (
        <StepParams
          lunchStart={lunchStart} lunchEnd={lunchEnd} gapMinutes={gapMinutes} individualMinutes={individualMinutes} groupMinutes={groupMinutes}
          presencialDays={presencialDays} virtualDays={virtualDays} institutionalOpen={institutionalOpen} institutionalClose={institutionalClose}
          onChange={(p) => {
            if (p.lunchStart !== undefined) setLunchStart(p.lunchStart);
            if (p.lunchEnd !== undefined) setLunchEnd(p.lunchEnd);
            if (p.gapMinutes !== undefined) setGapMinutes(p.gapMinutes);
            if (p.individualMinutes !== undefined) setIndividualMinutes(p.individualMinutes);
            if (p.groupMinutes !== undefined) setGroupMinutes(p.groupMinutes);
            if (p.presencialDays !== undefined) setPresencialDays(p.presencialDays);
            if (p.virtualDays !== undefined) setVirtualDays(p.virtualDays);
            if (p.institutionalOpen !== undefined) setInstitutionalOpen(p.institutionalOpen);
            if (p.institutionalClose !== undefined) setInstitutionalClose(p.institutionalClose);
          }}
        />
      )}
      {step === 3 && (
        <StepCourses
          academicPeriod={academicPeriod} courses={courses} overrides={overrides}
          onLoaded={setCourses}
          onOverrideChange={(id, patch) => setOverrides((prev) => ({ ...prev, [id]: patch }))}
          onStudentNamesLoaded={(names) => setStudentNames((prev) => ({ ...prev, ...names }))}
        />
      )}
      {step === 4 && <StepAvailability courses={courses} />}
      {step === 5 && (
        <StepStudents
          courses={courses} studentNames={studentNames}
          onCourseUpdated={(courseId, patch) => setCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, ...patch } : c)))}
          onStudentNamesLoaded={(names) => setStudentNames((prev) => ({ ...prev, ...names }))}
        />
      )}
      {step === 6 && <StepGenerate generating={generating} error={generateError} onRetry={runGenerate} />}
      {step === 7 && result && (
        <StepReview
          result={result} academicPeriod={academicPeriod} lunchBreak={lunchBreak}
          presencialDays={presencialDays} institutionalOpen={institutionalOpen} institutionalClose={institutionalClose}
          onApproved={() => { clearDraft(); setStep(8); }}
        />
      )}
      {step === 8 && (
        <StepReports
          academicPeriod={academicPeriod}
          onBackToReview={() => setStep(7)}
          onUnpublish={() => { clearDraft(); setStep(1); setAcademicPeriod(''); setResult(null); setCourses([]); setOverrides({}); }}
        />
      )}
      </WizardShell>
    </div>
  );
}
