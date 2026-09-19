'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { CourseRow } from './CourseRow';
import type { CourseCatalogRow, ClassRoomRow } from './types';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "hay cursos que pueden ser
// híbridos... hay estudiantes virtuales y hay estudiantes presenciales...
// es bueno que pregunte eso en la sección de cursos." hybridPresencialIds
// son los de course.studentIds marcados presencial; el resto se asume
// virtual — el curso genera DOS sesiones (una sábado, una entre semana).
export type CourseOverrides = Record<string, {
  classType?: 'INDIVIDUAL' | 'GRUPAL'; modality?: 'PRESENCIAL' | 'VIRTUAL' | 'HIBRIDA';
  durationOverrideMin?: number; hybridPresencialIds?: string[];
  // Override de aula solo para esta generación — si no se manda, se usa
  // Course.preferredRoomId (fijado desde el catálogo, ver CourseRow.tsx).
  roomId?: string;
  // Trello *LUX SCHEDULER* (Mack, 2026-09-18): cursos cortos presenciales
  // pueden darse cualquier día de la semana, no solo sábado.
  preferredDay?: number; // 1=Lun … 6=Sáb
}>;

interface Props {
  academicPeriod: string;
  courses: CourseCatalogRow[];
  overrides: CourseOverrides;
  onLoaded: (courses: CourseCatalogRow[]) => void;
  onStudentNamesLoaded?: (studentNames: Record<string, string>) => void;
  onOverrideChange: (courseId: string, patch: CourseOverrides[string]) => void;
}

export function StepCourses({ academicPeriod, courses, overrides, onLoaded, onOverrideChange, onStudentNamesLoaded }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [evaluators, setEvaluators] = useState<{ username: string; name: string }[]>([]);
  const [rooms, setRooms] = useState<ClassRoomRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newEvaluatorId, setNewEvaluatorId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [rowError, setRowError] = useState('');
  const [studentNames, setStudentNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!academicPeriod) return;
    setLoading(true); setError('');
    api.admin.scheduler.courses(academicPeriod)
      .then((res: any) => { onLoaded(res?.data?.courses ?? []); setStudentNames(res?.data?.studentNames ?? {}); onStudentNamesLoaded?.(res?.data?.studentNames ?? {}); })
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
    // Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): aulas para el dropdown
    // de "fijar aula" por curso — ver CourseRow.tsx.
    api.admin.scheduler.rooms.list().then((res: any) => setRooms(res?.data ?? [])).catch(() => {});
  }, []);

  const handleAddCourse = async () => {
    if (!newTitle.trim() || !newEvaluatorId) return;
    setAdding(true); setAddError('');
    try {
      const res = await api.admin.scheduler.createCourse({ academicPeriod, title: newTitle.trim(), evaluatorId: newEvaluatorId });
      const created = (res as any).data;
      onLoaded([...courses, created]);
      // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "por defecto... que sea
      // grupal, pues automáticamente cuando se crea un curso nuevo... debe
      // ser grupal" — un curso recién creado tiene 0 estudiantes, así que el
      // fallback por conteo (studentCount>1) lo dejaría en Individual.
      onOverrideChange(created.id, { classType: 'GRUPAL' });
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

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "cuando un tag es asincrónico,
  // se deshabilita la opción que dice 'virtual semana', o la modalidad y el
  // tipo de clase... si es asincrónico el curso, entonces no debería de
  // existir directamente. Y no debería de tener una afectación en términos
  // de horario." engineModality===null <=> el tag catálogo es ASINCRONICA
  // (toEngineModality en el backend); antes un override viejo podía colar de
  // vuelta un curso asincrónico a la tabla programable — ahora el tag manda
  // siempre, sin importar si quedó un override de modalidad pegado.
  const isAsync = (c: CourseCatalogRow) => c.engineModality === null;
  const live = courses.filter((c) => !isAsync(c));
  const async_ = courses.filter(isAsync);

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-heading font-semibold text-charcoal">Catálogo de cursos — {academicPeriod}</h2>
        <p className="text-xs text-gray-500">Extraído directamente de Lux Learning. Ajustá modalidad o tipo de clase si el motor no debe usar el valor por defecto.</p>
      </div>

      {rowError && <p className="text-xs text-red-500">{rowError}</p>}

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
                <th className="py-2 sticky right-0 bg-white dark:bg-card"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {live.map((c) => (
                <CourseRow
                  key={c.id} course={c} override={overrides[c.id]} evaluators={evaluators} studentNames={studentNames} rooms={rooms}
                  onUpdated={(patch) => onLoaded(courses.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))}
                  onOverrideChange={(patch) => onOverrideChange(c.id, patch)}
                  onRemoveFromPlan={() => onLoaded(courses.filter((x) => x.id !== c.id))}
                  onError={setRowError}
                />
              ))}
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
