'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
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
  const [evaluators, setEvaluators] = useState<{ username: string; name: string }[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newEvaluatorId, setNewEvaluatorId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    if (!academicPeriod) return;
    setLoading(true); setError('');
    api.admin.scheduler.courses(academicPeriod)
      .then((res: any) => onLoaded(res?.data ?? []))
      .catch((err: any) => setError(err?.message ?? 'No se pudieron cargar los cursos.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicPeriod]);

  useEffect(() => {
    api.admin.users.list().then((res: any) => {
      const list: any[] = res?.data ?? [];
      // Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "me indica que el nombre de ciertos
      // evaluadores es un código en lugar del nombre." admin/users.ts falls back
      // email -> username when the Cognito email attribute is unset — for an
      // evaluator with neither name nor email set, that username IS the raw
      // Cognito sub/UUID, which is exactly the "código" Mack saw. Never show
      // that raw id as if it were a name; show a readable placeholder instead.
      setEvaluators(list.filter((u) => u.role === 'EVALUATOR').map((u) => ({
        username: u.username,
        name: u.name || (u.email?.includes('@') ? u.email : `Evaluador sin nombre (${String(u.username).slice(0, 8)}…)`),
      })));
    }).catch(() => {});
  }, []);

  const handleAddCourse = async () => {
    if (!newTitle.trim() || !newEvaluatorId) return;
    setAdding(true); setAddError('');
    try {
      const res = await api.admin.scheduler.createCourse({ academicPeriod, title: newTitle.trim(), evaluatorId: newEvaluatorId });
      onLoaded([...courses, (res as any).data]);
      setNewTitle(''); setNewEvaluatorId(''); setShowAdd(false);
    } catch (err: any) {
      setAddError(err?.message ?? 'No se pudo crear el curso.');
    } finally {
      setAdding(false);
    }
  };

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
                <th className="py-2 pr-3">Tipo de clase</th>
                <th className="py-2"></th>
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
                    <td className="py-2 pr-3">
                      <select value={classType} onChange={(e) => onOverrideChange(c.id, { ...ov, classType: e.target.value as any })} className="text-xs border border-gray-200 rounded-lg px-2 py-1">
                        <option value="INDIVIDUAL">Individual (55 min)</option>
                        <option value="GRUPAL">Grupal (1h15)</option>
                      </select>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => onLoaded(courses.filter((x) => x.id !== c.id))}
                        title="Quitar de este plan (no se elimina el curso de Lux Learning)"
                        className="p-1 text-gray-300 hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
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

      {/* Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "no necesariamente tienen que estar
          creados ya... yo pueda ponerles un nombre y crear estos cursos... el horario no
          debería estar disponible, eso es justamente lo que esto va a resolver." Crea un
          Course real (isDraft:true) con solo nombre+profesor — sin horario todavía. */}
      {showAdd ? (
        <div className="p-3 bg-surface rounded-xl border border-border space-y-2">
          <input
            autoFocus type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nombre del curso" className="input-field text-sm py-1.5"
          />
          <select value={newEvaluatorId} onChange={(e) => setNewEvaluatorId(e.target.value)} className="input-field text-sm py-1.5">
            <option value="">— Seleccionar profesor —</option>
            {evaluators.map((e) => <option key={e.username} value={e.username}>{e.name}</option>)}
          </select>
          {addError && <p className="text-xs text-red-500">{addError}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowAdd(false); setNewTitle(''); setNewEvaluatorId(''); }} className="text-xs text-gray-400 hover:text-gray-700 px-2">Cancelar</button>
            <Button size="sm" onClick={handleAddCourse} loading={adding} disabled={!newTitle.trim() || !newEvaluatorId}>Crear curso</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowAdd(true)}>
          Curso aún no creado en Lux Learning
        </Button>
      )}
    </div>
  );
}
