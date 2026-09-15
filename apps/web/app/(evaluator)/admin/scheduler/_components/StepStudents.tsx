'use client';

import { useEffect, useState } from 'react';
import { UserPlus, Users, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { CourseCatalogRow } from './types';

interface Props {
  courses: CourseCatalogRow[];
  onCourseUpdated?: (courseId: string, patch: Partial<CourseCatalogRow>) => void;
}

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "en la sección de estudiantes...
// tengo que tener la capacidad de agregar, en cada uno de los cursos,
// estudiantes individuales [o] grupos base" — antes esta sección solo
// mostraba el conteo ya matriculado en Lux Learning, sin forma de agregar
// desde acá. Reusa los mismos endpoints que Gestión de Estudiantes/Grupos
// Base (POST /admin/users/:username/enrollments y POST
// /evaluator/groups/:id/enroll) — sin rutas nuevas.
export function StepStudents({ courses, onCourseUpdated }: Props) {
  const [pool, setPool] = useState<{ userId: string; name: string }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; memberCount: number }[]>([]);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [tab, setTab] = useState<'individual' | 'group'>('individual');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState('');

  useEffect(() => {
    api.evaluator.groups.studentPool().then((res: any) => setPool(res?.data ?? [])).catch(() => {});
    api.evaluator.groups.list().then((res: any) => setGroups(res?.data ?? [])).catch(() => {});
  }, []);

  const totalStudentSlots = courses.reduce((sum, c) => sum + c.studentCount, 0);
  const empty = courses.filter((c) => c.studentCount === 0);

  const openPanel = (courseId: string) => {
    setOpenCourseId(courseId); setTab('individual'); setSelectedStudent(''); setSelectedGroup(''); setRowError('');
  };

  const handleAddIndividual = async (courseId: string) => {
    if (!selectedStudent) return;
    setBusy(true); setRowError('');
    try {
      await api.admin.users.addEnrollment(selectedStudent, courseId);
      onCourseUpdated?.(courseId, { studentCount: (courses.find((c) => c.id === courseId)?.studentCount ?? 0) + 1 });
      setOpenCourseId(null);
    } catch (err: any) {
      setRowError(err?.message ?? 'No se pudo matricular al estudiante.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnrollGroup = async (courseId: string) => {
    if (!selectedGroup) return;
    setBusy(true); setRowError('');
    try {
      const membersRes = await api.evaluator.groups.members(selectedGroup);
      const userIds: string[] = (membersRes as any)?.data?.map((m: any) => m.userId) ?? [];
      if (!userIds.length) { setRowError('Ese grupo no tiene miembros.'); return; }
      await api.evaluator.groups.enroll(selectedGroup, { userIds, courseId });
      onCourseUpdated?.(courseId, { studentCount: (courses.find((c) => c.id === courseId)?.studentCount ?? 0) + userIds.length });
      setOpenCourseId(null);
    } catch (err: any) {
      setRowError(err?.message ?? 'No se pudo matricular al grupo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-heading font-semibold text-charcoal">Matrícula por curso</h2>
        <p className="text-xs text-gray-500">Grupos cerrados o estudiantes individuales, ya inscritos en Lux Learning — el motor los lee de acá para evitar choques.</p>
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

            {openCourseId === c.id && (
              <div className="p-2 bg-white rounded-lg border border-border space-y-2">
                <div className="flex gap-1 text-xs">
                  <button onClick={() => setTab('individual')} className={`px-2 py-1 rounded-lg font-medium ${tab === 'individual' ? 'bg-cta-gradient text-white' : 'text-gray-500'}`}>Individual</button>
                  <button onClick={() => setTab('group')} className={`px-2 py-1 rounded-lg font-medium flex items-center gap-1 ${tab === 'group' ? 'bg-cta-gradient text-white' : 'text-gray-500'}`}><Users className="w-3 h-3" /> Grupo base</button>
                </div>
                {tab === 'individual' ? (
                  <div className="flex gap-1.5">
                    <select value={selectedStudent} onChange={(e) => setSelectedStudent(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 flex-1">
                      <option value="">— Seleccionar estudiante —</option>
                      {pool.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
                    </select>
                    <button onClick={() => handleAddIndividual(c.id)} disabled={busy || !selectedStudent} className="text-xs px-2 py-1 rounded-lg bg-cta-gradient text-white disabled:opacity-50">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Agregar'}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 flex-1">
                      <option value="">— Seleccionar grupo —</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.memberCount})</option>)}
                    </select>
                    <button onClick={() => handleEnrollGroup(c.id)} disabled={busy || !selectedGroup} className="text-xs px-2 py-1 rounded-lg bg-cta-gradient text-white disabled:opacity-50">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Inscribir grupo'}
                    </button>
                  </div>
                )}
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
