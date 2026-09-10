'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { CourseCatalogRow } from './types';

export type CourseOverrides = Record<string, { classType?: 'INDIVIDUAL' | 'GRUPAL'; modality?: 'PRESENCIAL' | 'VIRTUAL' }>;

interface Props {
  academicPeriod: string;
  courses: CourseCatalogRow[];
  overrides: CourseOverrides;
  onLoaded: (courses: CourseCatalogRow[]) => void;
  onOverrideChange: (courseId: string, patch: CourseOverrides[string]) => void;
}

export function StepCourses({ academicPeriod, courses, overrides, onLoaded, onOverrideChange }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!academicPeriod) return;
    setLoading(true); setError('');
    api.admin.scheduler.courses(academicPeriod)
      .then((res: any) => onLoaded(res?.data ?? []))
      .catch((err: any) => setError(err?.message ?? 'No se pudieron cargar los cursos.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicPeriod]);

  if (loading) return (
    <div className="card flex items-center justify-center py-12 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando cursos del período…
    </div>
  );

  if (error) return <div className="card bg-red-50 border border-red-200 text-sm text-red-600">{error}</div>;

  const live = courses.filter((c) => c.engineModality !== null || overrides[c.id]?.modality);
  const async_ = courses.filter((c) => c.engineModality === null && !overrides[c.id]?.modality);

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-heading font-semibold text-charcoal">Catálogo de cursos — {academicPeriod}</h2>
        <p className="text-xs text-gray-500">Extraído directamente de Lux Learning. Ajustá modalidad o tipo de clase si el motor no debe usar el valor por defecto.</p>
      </div>

      {courses.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4">Ningún curso con profesor asignado en este período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-gray-500">
                <th className="py-2 pr-3">Curso</th>
                <th className="py-2 pr-3">Profesor</th>
                <th className="py-2 pr-3">Estudiantes</th>
                <th className="py-2 pr-3">Modalidad</th>
                <th className="py-2">Tipo de clase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {live.map((c) => {
                const ov = overrides[c.id] ?? {};
                const modality = ov.modality ?? c.engineModality ?? 'VIRTUAL';
                const classType = ov.classType ?? (c.studentCount > 1 ? 'GRUPAL' : 'INDIVIDUAL');
                return (
                  <tr key={c.id}>
                    <td className="py-2 pr-3 font-medium text-charcoal">{c.title}</td>
                    <td className="py-2 pr-3 text-gray-600">{c.teacherName}</td>
                    <td className="py-2 pr-3 text-gray-500">{c.studentCount}</td>
                    <td className="py-2 pr-3">
                      <select value={modality} onChange={(e) => onOverrideChange(c.id, { ...ov, modality: e.target.value as any })} className="text-xs border border-gray-200 rounded-lg px-2 py-1">
                        <option value="PRESENCIAL">Presencial (sábado)</option>
                        <option value="VIRTUAL">Virtual (semana)</option>
                      </select>
                    </td>
                    <td className="py-2">
                      <select value={classType} onChange={(e) => onOverrideChange(c.id, { ...ov, classType: e.target.value as any })} className="text-xs border border-gray-200 rounded-lg px-2 py-1">
                        <option value="INDIVIDUAL">Individual (55 min)</option>
                        <option value="GRUPAL">Grupal (1h15)</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {async_.length > 0 && (
            <p className="text-xs text-gray-400 mt-3">{async_.length} curso(s) asincrónico(s) no requieren clase en vivo, se excluyen automáticamente.</p>
          )}
        </div>
      )}
    </div>
  );
}
