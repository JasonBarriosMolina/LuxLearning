'use client';

import type { CourseCatalogRow } from './types';

interface Props {
  courses: CourseCatalogRow[];
}

export function StepStudents({ courses }: Props) {
  const totalStudentSlots = courses.reduce((sum, c) => sum + c.studentCount, 0);
  const empty = courses.filter((c) => c.studentCount === 0);

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-heading font-semibold text-charcoal">Matrícula por curso</h2>
        <p className="text-xs text-gray-500">Grupos cerrados o estudiantes individuales, ya inscritos en Lux Learning — el motor los lee de acá para evitar choques.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {courses.map((c) => (
          <div key={c.id} className="flex items-center justify-between p-3 bg-surface rounded-xl">
            <span className="text-sm text-charcoal truncate">{c.title}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.studentCount === 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {c.studentCount} estudiante{c.studentCount !== 1 ? 's' : ''}
            </span>
          </div>
        ))}
      </div>
      {empty.length > 0 && (
        <p className="text-xs text-amber-600">⚠️ {empty.length} curso(s) sin estudiantes matriculados todavía — se agendarán igual pero sin alumnos asignados.</p>
      )}
      <p className="text-xs text-gray-400">{totalStudentSlots} cupo(s)-curso en total para este período.</p>
    </div>
  );
}
