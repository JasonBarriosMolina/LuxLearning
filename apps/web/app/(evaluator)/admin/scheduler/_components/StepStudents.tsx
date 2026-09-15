'use client';

import { useEffect, useState } from 'react';
import { UserPlus, Users, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { CourseCatalogRow } from './types';

interface Props {
  courses: CourseCatalogRow[];
  studentNames: Record<string, string>;
  onCourseUpdated: (courseId: string, patch: Partial<CourseCatalogRow>) => void;
  onStudentNamesLoaded?: (names: Record<string, string>) => void;
}

// Trello *LUX SCHEDULER* (Mack, 2026-09-10 y 2026-09-15): "en la sección de
// estudiantes... tengo que tener la capacidad de agregar... estudiantes
// individuales [o] grupos base"; luego (09-15): "me sirve poder seleccionar
// un montón de estudiantes a la vez, o inclusive el grupo base... tampoco
// tengo opción de eliminar estudiantes... me está dejando agregar el mismo
// estudiante varias veces." Roster con nombres + quitar, multi-selección
// (checkbox) con "seleccionar grupo" que marca a todos sus miembros de una,
// y dedupe contra lo ya matriculado antes de llamar al backend.
export function StepStudents({ courses, studentNames, onCourseUpdated, onStudentNamesLoaded }: Props) {
  const [pool, setPool] = useState<{ userId: string; name: string }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; memberCount: number }[]>([]);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');

  useEffect(() => {
    api.evaluator.groups.studentPool().then((res: any) => {
      const list = res?.data ?? [];
      setPool(list);
      onStudentNamesLoaded?.(Object.fromEntries(list.map((s: any) => [s.userId, s.name])));
    }).catch(() => {});
    api.evaluator.groups.list().then((res: any) => setGroups(res?.data ?? [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalStudentSlots = courses.reduce((sum, c) => sum + c.studentCount, 0);
  const empty = courses.filter((c) => c.studentCount === 0);

  const openPanel = (courseId: string) => {
    setOpenCourseId(courseId); setSelectedGroup(''); setChecked(new Set()); setRowError('');
  };

  const toggleChecked = (userId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  // "Grupos base... arriba" — elegir un grupo marca a todos sus miembros en
  // el multi-select de abajo, sin descartar la selección individual que ya
  // hubiera (se puede afinar antes de agregar).
  const handleSelectGroup = async (groupId: string) => {
    setSelectedGroup(groupId);
    if (!groupId) return;
    try {
      const res = await api.evaluator.groups.members(groupId);
      const memberIds: string[] = (res as any)?.data?.map((m: any) => m.userId) ?? [];
      setChecked((prev) => new Set([...prev, ...memberIds]));
      onStudentNamesLoaded?.(Object.fromEntries(((res as any)?.data ?? []).map((m: any) => [m.userId, m.name])));
    } catch { /* ignore — el grupo simplemente no se pre-selecciona */ }
  };

  const handleAddSelected = async (course: CourseCatalogRow) => {
    // Dedupe: nunca reinscribir a quien ya está en el curso (Mack: "me está
    // dejando agregar el mismo estudiante varias veces").
    const already = new Set(course.studentIds);
    const toAdd = [...checked].filter((id) => !already.has(id));
    if (toAdd.length === 0) { setRowError('Esos estudiantes ya están en el curso.'); return; }
    setBusy(true); setRowError('');
    try {
      await Promise.all(toAdd.map((userId) => api.admin.users.addEnrollment(userId, course.id)));
      onCourseUpdated(course.id, { studentIds: [...course.studentIds, ...toAdd], studentCount: course.studentCount + toAdd.length });
      setOpenCourseId(null);
    } catch (err: any) {
      setRowError(err?.message ?? 'No se pudo matricular a los estudiantes seleccionados.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (course: CourseCatalogRow, userId: string) => {
    setRemovingId(userId); setRowError('');
    try {
      await api.admin.users.removeEnrollment(userId, course.id);
      onCourseUpdated(course.id, { studentIds: course.studentIds.filter((id) => id !== userId), studentCount: Math.max(0, course.studentCount - 1) });
    } catch (err: any) {
      setRowError(err?.message ?? 'No se pudo quitar al estudiante.');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-heading font-semibold text-charcoal">Matrícula por curso</h2>
        <p className="text-xs text-gray-500">Grupos base o estudiantes individuales — el motor los lee de acá para evitar choques.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {courses.map((c) => (
          <div key={c.id} className="p-3 bg-surface rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-charcoal truncate">{c.title}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.studentCount === 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {c.studentCount} estudiante{c.studentCount !== 1 ? 's' : ''}
                </span>
                <button onClick={() => openPanel(c.id)} title="Agregar estudiantes" className="p-1 text-gray-400 hover:text-cta-from">
                  <UserPlus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {c.studentIds.length > 0 && (
              <ul className="space-y-1">
                {c.studentIds.map((sid) => (
                  <li key={sid} className="flex items-center justify-between text-xs bg-white rounded-lg px-2 py-1">
                    <span className="truncate">{studentNames[sid] ?? sid}</span>
                    <button onClick={() => handleRemove(c, sid)} disabled={removingId === sid} title="Quitar del curso" className="p-0.5 text-gray-300 hover:text-red-500 disabled:opacity-50 shrink-0">
                      {removingId === sid ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {openCourseId === c.id && (
              <div className="p-2 bg-white rounded-lg border border-border space-y-2">
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <select value={selectedGroup} onChange={(e) => handleSelectGroup(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 flex-1">
                    <option value="">— Marcar todo un grupo base —</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.memberCount})</option>)}
                  </select>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-0.5 border-t border-border pt-1.5">
                  {pool.map((s) => {
                    const alreadyEnrolled = c.studentIds.includes(s.userId);
                    return (
                      <label key={s.userId} className={`flex items-center gap-1.5 text-xs px-1 py-0.5 rounded ${alreadyEnrolled ? 'opacity-40' : 'hover:bg-surface'}`}>
                        <input type="checkbox" disabled={alreadyEnrolled} checked={checked.has(s.userId)} onChange={() => toggleChecked(s.userId)} />
                        <span className="truncate">{s.name}{alreadyEnrolled ? ' (ya inscrito)' : ''}</span>
                      </label>
                    );
                  })}
                  {pool.length === 0 && <p className="text-xs text-gray-400 italic px-1">Sin estudiantes en el pool todavía.</p>}
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button onClick={() => setOpenCourseId(null)} className="text-xs text-gray-400 hover:text-gray-700 px-2">Cerrar</button>
                  <button onClick={() => handleAddSelected(c)} disabled={busy || checked.size === 0} className="text-xs px-2 py-1 rounded-lg bg-cta-gradient text-white disabled:opacity-50">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Agregar ${checked.size || ''}`.trim()}
                  </button>
                </div>
                {rowError && <p className="text-xs text-red-500">{rowError}</p>}
              </div>
            )}
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
