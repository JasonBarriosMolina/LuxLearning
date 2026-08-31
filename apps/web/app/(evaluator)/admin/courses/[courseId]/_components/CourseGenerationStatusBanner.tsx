'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  jobId: string | null;
  onDone: () => void;
}

// Makes course-generation status visible from the admin course editor, not just the
// Lux Planner wizard screen the evaluator might have already navigated away from
// (Trello DmPpbrff, 2026-08-31: "no hay ninguna referencia visual... por qué
// porcentaje vamos" — modules 1-2 looked permanently empty because there was no way
// to tell generation was still running in the background). Mirrors the phase-labeled
// status already shown in StepPlaneamiento.tsx.
export function CourseGenerationStatusBanner({ jobId, onDone }: Props) {
  const [status, setStatus] = useState<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) { setStatus(null); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.admin.courses.aiJob(jobId);
        const data = (res as any)?.data ?? res;
        if (!cancelled) setStatus(data);
        return data?.status;
      } catch { return undefined; }
    };
    poll();
    intervalRef.current = setInterval(async () => {
      const s = await poll();
      if (s === 'done' || s === 'done_incomplete' || s === 'error') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        onDone();
      }
    }, 3000);
    return () => { cancelled = true; if (intervalRef.current) clearInterval(intervalRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  if (!jobId) return null;

  const phaseLabel: Record<string, string> = {
    lessons: 'Generando lecciones',
    quiz: 'Generando quizzes',
    reflections: 'Registrando reflexiones',
    carousels: 'Generando carrouseles interactivos',
    classes: 'Generando clases con Lux Mentor',
    interviews: 'Registrando entrevistas',
    repair: 'Verificando y completando módulos',
  };

  if (status?.status === 'done') {
    return (
      <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-3">
        <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
        <p className="text-xs text-emerald-700">Generación completa — todos los módulos tienen contenido.</p>
      </div>
    );
  }
  if (status?.status === 'done_incomplete') {
    return (
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-xs text-amber-700">
          Listo, pero {status?.incompleteModuleIds?.length ?? 0} módulo(s) necesitan revisión manual — usa el botón de regenerar.
        </p>
      </div>
    );
  }
  if (status?.status === 'error') {
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
        <p className="text-xs text-red-700">Ocurrió un error generando el contenido. Revisa los módulos manualmente.</p>
      </div>
    );
  }

  const label = status?.phase ? (phaseLabel[status.phase] ?? phaseLabel.lessons) : 'Generando contenido del curso';
  const processed = status?.modulesProcessed ?? 0;
  const total = status?.totalModules;
  return (
    <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-3">
      <Loader2 className="w-4 h-4 text-blue-500 shrink-0 animate-spin" />
      <p className="text-xs text-blue-700">
        {total ? `${label}: ${processed}/${total} módulos listos…` : 'Lux Planner está generando el contenido del curso en segundo plano…'}
      </p>
    </div>
  );
}
