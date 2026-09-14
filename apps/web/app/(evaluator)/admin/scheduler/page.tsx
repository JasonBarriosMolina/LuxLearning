'use client';

import { useEffect, useState } from 'react';
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
  const [courses, setCourses] = useState<CourseCatalogRow[]>([]);
  const [overrides, setOverrides] = useState<CourseOverrides>({});
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [recipientCount, setRecipientCount] = useState(0);

  const lunchBreak = { startTime: lunchStart, endTime: lunchEnd };

  const runGenerate = async () => {
    setGenerating(true); setGenerateError(''); setResult(null);
    try {
      const res = await api.admin.scheduler.generate({ academicPeriod, courseOverrides: overrides, lunchBreak, gapMinutes, individualMinutes, groupMinutes });
      setResult((res as any).data);
      setStep(7);
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
    <WizardShell
      step={step}
      onBack={step > 1 && step !== 6 && step !== 8 ? () => setStep((s) => s - 1) : undefined}
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
      {step === 2 && <StepParams lunchStart={lunchStart} lunchEnd={lunchEnd} gapMinutes={gapMinutes} individualMinutes={individualMinutes} groupMinutes={groupMinutes} onChange={(p) => {
        if (p.lunchStart !== undefined) setLunchStart(p.lunchStart);
        if (p.lunchEnd !== undefined) setLunchEnd(p.lunchEnd);
        if (p.gapMinutes !== undefined) setGapMinutes(p.gapMinutes);
        if (p.individualMinutes !== undefined) setIndividualMinutes(p.individualMinutes);
        if (p.groupMinutes !== undefined) setGroupMinutes(p.groupMinutes);
      }} />}
      {step === 3 && (
        <StepCourses
          academicPeriod={academicPeriod} courses={courses} overrides={overrides}
          onLoaded={setCourses}
          onOverrideChange={(id, patch) => setOverrides((prev) => ({ ...prev, [id]: patch }))}
        />
      )}
      {step === 4 && <StepAvailability courses={courses} />}
      {step === 5 && <StepStudents courses={courses} />}
      {step === 6 && <StepGenerate generating={generating} error={generateError} onRetry={runGenerate} />}
      {step === 7 && result && (
        <StepReview
          result={result} academicPeriod={academicPeriod} lunchBreak={lunchBreak}
          onApproved={(count) => { setRecipientCount(count); setStep(8); }}
        />
      )}
      {step === 8 && (
        <StepReports
          academicPeriod={academicPeriod} recipientCount={recipientCount}
          onUnpublish={() => { setStep(1); setAcademicPeriod(''); setResult(null); setCourses([]); setOverrides({}); }}
        />
      )}
    </WizardShell>
  );
}
