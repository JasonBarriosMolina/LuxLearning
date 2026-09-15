'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, X, Trash2, Pencil, Check, Clock, Users2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import type { CourseCatalogRow } from './types';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "hay cursos que pueden ser
// híbridos... hay estudiantes virtuales y hay estudiantes presenciales...
// es bueno que pregunte eso en la sección de cursos." hybridPresencialIds
// son los de course.studentIds marcados presencial; el resto se asume
// virtual — el curso genera DOS sesiones (una sábado, una entre semana).
export type CourseOverrides = Record<string, {
  classType?: 'INDIVIDUAL' | 'GRUPAL'; modality?: 'PRESENCIAL' | 'VIRTUAL' | 'HIBRIDA';
  durationOverrideMin?: number; hybridPresencialIds?: string[];
}>;

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "es importante que aparezcan los
// tags del tipo de curso: si es teórico, teórico-práctico, etc... también...
// si el curso va a ser híbrido, virtual (sincrónico o asincrónico) o
// presencial... todo eso es lo que se jala desde la sección número 3 de
// cursos." Informativo — ambos ya vienen de Lux Planner, se editan ahí, acá
// solo se muestran como tags junto al resto de la fila.
const COURSE_TYPE_LABELS: Record<string, string> = {
  TEORICO: 'Teórico', TEORICO_PRACTICO: 'Teórico-Práctico', PROYECTOS: 'Taller/Proyectos',
  PROGRAMA_ESPECIAL: 'Programa Especial', CURSO_CORTO: 'Curso Corto', LIBRE: 'Curso Libre/Tutoría',
};
const MODALITY_FULL_LABELS: Record<string, string> = {
  PRESENCIAL: 'Presencial', SINCRONICA: 'Sincrónica', ASINCRONICA: 'Asincrónica', HIBRIDA: 'Híbrida',
};

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
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newEvaluatorId, setNewEvaluatorId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "no quiero que esa sección...
  // aparezca siempre... quiero que sea un botón que se desprenda del tipo de
  // clase" — la excepción de duración ya no es una columna fija, es un
  // popover que se abre solo cuando se necesita.
  const [durationPopoverId, setDurationPopoverId] = useState<string | null>(null);
  const [hybridPopoverId, setHybridPopoverId] = useState<string | null>(null);
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

  // Trello *LUX SCHEDULER* (Mack, 2026-09-10): "para los cursos que ya creé,
  // también tengo que tener la opción de editar o eliminar... si me equivoqué
  // en algo, yo pueda eliminar cosas" — reasignar profesor (el dato editable
  // más relevante en un contexto de horario) y eliminar el curso, sin salir
  // del wizard. Reusa los mismos endpoints que Gestión de Contenido.
  const handleReassignTeacher = async (courseId: string, evaluatorId: string) => {
    const evaluator = evaluators.find((e) => e.username === evaluatorId);
    if (!evaluator) return;
    setReassigningId(courseId); setRowError('');
    try {
      await api.admin.courses.assignEvaluator(courseId, { evaluatorId, evaluatorName: evaluator.name });
      onLoaded(courses.map((c) => (c.id === courseId ? { ...c, evaluatorId, teacherName: evaluator.name } : c)));
    } catch (err: any) {
      setRowError(err?.message ?? 'No se pudo reasignar el profesor.');
    } finally {
      setReassigningId(null);
    }
  };

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "recuerda tener un botón de
  // editar para que... se pueda modificar el nombre del curso... así no hay
  // que eliminarlo y volver a crearlo".
  const handleSaveTitle = async (courseId: string) => {
    const title = editTitleValue.trim();
    if (!title) return;
    setSavingTitle(true); setRowError('');
    try {
      await api.admin.courses.update(courseId, { titleOnly: true, title });
      onLoaded(courses.map((c) => (c.id === courseId ? { ...c, title } : c)));
      setEditingTitleId(null);
    } catch (err: any) {
      setRowError(err?.message ?? 'No se pudo renombrar el curso.');
    } finally {
      setSavingTitle(false);
    }
  };

  const handleDeleteCourse = async (courseId: string, title: string) => {
    if (!confirm(`¿Eliminar "${title}" de Lux Learning por completo? Esta acción no se puede deshacer.`)) return;
    setDeletingId(courseId); setRowError('');
    try {
      await api.admin.courses.delete(courseId);
      onLoaded(courses.filter((c) => c.id !== courseId));
    } catch (err: any) {
      setRowError(err?.message ?? 'No se pudo eliminar el curso.');
    } finally {
      setDeletingId(null);
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
                    <td className="py-2 pr-3 font-medium text-charcoal">
                      {editingTitleId === c.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus type="text" value={editTitleValue} onChange={(e) => setEditTitleValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(c.id); else if (e.key === 'Escape') setEditingTitleId(null); }}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 w-32"
                          />
                          <button onClick={() => handleSaveTitle(c.id)} disabled={savingTitle || !editTitleValue.trim()} className="p-1 text-emerald-500 hover:text-emerald-600 disabled:opacity-50">
                            {savingTitle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => setEditingTitleId(null)} className="p-1 text-gray-300 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-1 group">
                            {c.title}
                            <button
                              onClick={() => { setEditingTitleId(c.id); setEditTitleValue(c.title); }}
                              title="Renombrar curso"
                              className="p-0.5 text-gray-300 hover:text-cta-from opacity-0 group-hover:opacity-100"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            {c.courseType && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">
                                {COURSE_TYPE_LABELS[c.courseType] ?? c.courseType}
                              </span>
                            )}
                            {c.modality && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-600 font-medium">
                                {MODALITY_FULL_LABELS[c.modality] ?? c.modality}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={c.evaluatorId} disabled={reassigningId === c.id}
                        onChange={(e) => handleReassignTeacher(c.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 disabled:opacity-50"
                      >
                        {!evaluators.some((e) => e.username === c.evaluatorId) && (
                          <option value={c.evaluatorId}>{c.teacherName}</option>
                        )}
                        {evaluators.map((e) => <option key={e.username} value={e.username}>{e.name}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{c.studentCount}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1 relative">
                        <select value={modality} onChange={(e) => onOverrideChange(c.id, { ...ov, modality: e.target.value as any })} className="text-xs border border-gray-200 rounded-lg px-2 py-1">
                          <option value="PRESENCIAL">Presencial (sábado)</option>
                          <option value="VIRTUAL">Virtual (semana)</option>
                          <option value="HIBRIDA">Híbrido</option>
                        </select>
                        {/* Trello *LUX SCHEDULER* (Mack, 2026-09-15): "hay
                            cursos que pueden ser híbridos... es bueno que
                            pregunte eso en la sección de cursos" — al elegir
                            Híbrido, hay que decidir quién es presencial. */}
                        {modality === 'HIBRIDA' && (
                          <button
                            type="button" onClick={() => setHybridPopoverId(hybridPopoverId === c.id ? null : c.id)}
                            title="Elegir quién es presencial"
                            className={`p-1 rounded-lg ${ov.hybridPresencialIds?.length ? 'text-amber-600 bg-amber-50' : 'text-gray-300 hover:text-gray-600'}`}
                          >
                            <Users2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {hybridPopoverId === c.id && (
                          <div className="absolute z-10 top-full left-0 mt-1 p-2 bg-white border border-border rounded-lg shadow-lg w-56">
                            <p className="text-[10px] text-gray-400 mb-1.5">Marcá quién asiste presencial (sábado) — el resto va virtual.</p>
                            <div className="max-h-32 overflow-y-auto space-y-0.5">
                              {c.studentIds.length === 0 && <p className="text-xs text-gray-400 italic">Sin estudiantes matriculados todavía.</p>}
                              {c.studentIds.map((sid) => {
                                const isPresencial = ov.hybridPresencialIds?.includes(sid) ?? false;
                                return (
                                  <label key={sid} className="flex items-center gap-1.5 text-xs px-1 py-0.5 rounded hover:bg-surface">
                                    <input
                                      type="checkbox" checked={isPresencial}
                                      onChange={(e) => {
                                        const current = ov.hybridPresencialIds ?? [];
                                        const next = e.target.checked ? [...current, sid] : current.filter((id) => id !== sid);
                                        onOverrideChange(c.id, { ...ov, hybridPresencialIds: next });
                                      }}
                                    />
                                    <span className="truncate">{studentNames?.[sid] ?? sid}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <button type="button" onClick={() => setHybridPopoverId(null)} className="text-xs text-cta-from hover:underline mt-1.5">Listo</button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1 relative">
                        <select value={classType} onChange={(e) => onOverrideChange(c.id, { ...ov, classType: e.target.value as any })} className="text-xs border border-gray-200 rounded-lg px-2 py-1">
                          <option value="INDIVIDUAL">Individual (55 min)</option>
                          <option value="GRUPAL">Grupal (1h15)</option>
                        </select>
                        {/* Trello *LUX SCHEDULER* (Mack, 2026-09-15): "puede haber
                            una excepción para un curso en especial; puede ser de
                            1 hora o similar" — botón que se desprende del tipo de
                            clase en vez de una columna fija casi siempre vacía. */}
                        <button
                          type="button" onClick={() => setDurationPopoverId(durationPopoverId === c.id ? null : c.id)}
                          title="Excepción de duración para este curso"
                          className={`p-1 rounded-lg ${ov.durationOverrideMin ? 'text-amber-600 bg-amber-50' : 'text-gray-300 hover:text-gray-600'}`}
                        >
                          <Clock className="w-3.5 h-3.5" />
                        </button>
                        {durationPopoverId === c.id && (
                          <div className="absolute z-10 top-full left-0 mt-1 p-2 bg-white border border-border rounded-lg shadow-lg flex items-center gap-1.5 whitespace-nowrap">
                            <input
                              autoFocus type="number" min={15} max={240} placeholder="min"
                              value={ov.durationOverrideMin ?? ''}
                              onChange={(e) => onOverrideChange(c.id, { ...ov, durationOverrideMin: e.target.value ? Number(e.target.value) : undefined })}
                              className="text-xs border border-gray-200 rounded-lg px-2 py-1 w-16"
                            />
                            <span className="text-[10px] text-gray-400">min — vacío usa el default</span>
                            <button type="button" onClick={() => setDurationPopoverId(null)} className="p-0.5 text-gray-300 hover:text-gray-600"><X className="w-3 h-3" /></button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onLoaded(courses.filter((x) => x.id !== c.id))}
                          title="Quitar de este plan (no se elimina el curso de Lux Learning)"
                          className="p-1 text-gray-300 hover:text-amber-500"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteCourse(c.id, c.title)}
                          disabled={deletingId === c.id}
                          title="Eliminar curso de Lux Learning por completo"
                          className="p-1 text-gray-300 hover:text-red-500 disabled:opacity-50"
                        >
                          {deletingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
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
