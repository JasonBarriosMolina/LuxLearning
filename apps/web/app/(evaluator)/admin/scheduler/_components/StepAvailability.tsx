'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { CourseCatalogRow } from './types';

const DAY_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

interface TeacherSummary { evaluatorId: string; name: string; blocks: number; days: string; maxCoursesPerWeek: number }

interface Props {
  courses: CourseCatalogRow[];
}

export function StepAvailability({ courses }: Props) {
  const [summaries, setSummaries] = useState<TeacherSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const teachers = [...new Map(courses.map((c) => [c.evaluatorId, c.teacherName])).entries()];
    if (!teachers.length) { setLoading(false); return; }
    setLoading(true);
    Promise.all(teachers.map(async ([evaluatorId, name]) => {
      const res: any = await api.admin.teachers.getAvailability(evaluatorId).catch(() => null);
      const blocks = res?.data?.blocks ?? [];
      const days = [...new Set(blocks.map((b: any) => DAY_LABEL[b.dayOfWeek]))].join(', ');
      return { evaluatorId, name, blocks: blocks.length, days, maxCoursesPerWeek: res?.data?.maxCoursesPerWeek ?? 5 };
    })).then(setSummaries).finally(() => setLoading(false));
  }, [courses]);

  if (loading) return (
    <div className="card flex items-center justify-center py-12 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Revisando disponibilidad docente…
    </div>
  );

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-heading font-semibold text-charcoal">Disponibilidad docente</h2>
        <p className="text-xs text-gray-500">Autogestionada por cada profesor en su perfil — acá solo se revisa antes de generar.</p>
      </div>
      <div className="space-y-2">
        {summaries.map((s) => (
          <div key={s.evaluatorId} className="flex items-center justify-between p-3 bg-surface rounded-xl">
            <div>
              <p className="text-sm font-medium text-charcoal">{s.name}</p>
              <p className="text-xs text-gray-500">{s.blocks > 0 ? `${s.blocks} bloque(s) — ${s.days}` : 'Sin bloques de disponibilidad'}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Tope: {s.maxCoursesPerWeek}/sem</span>
              {s.blocks === 0
                ? <AlertTriangle className="w-4 h-4 text-amber-500" />
                : <CheckCircle className="w-4 h-4 text-emerald-500" />}
            </div>
          </div>
        ))}
      </div>
      {summaries.some((s) => s.blocks === 0) && (
        <p className="text-xs text-amber-600">⚠️ Profesores sin disponibilidad marcada solo podrán recibir clases presenciales de sábado — pedíles que la completen en su perfil.</p>
      )}
    </div>
  );
}
