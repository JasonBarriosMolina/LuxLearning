'use client';

import { useState } from 'react';
import { Loader2, X, Trash2, Pencil, Check, Clock, Users2, AlertTriangle, DoorOpen } from 'lucide-react';
import { api } from '@/lib/api';
import type { CourseCatalogRow, ClassRoomRow } from './types';
import type { CourseOverrides } from './StepCourses';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): una fila del catálogo de cursos,
// extraída de StepCourses.tsx (que superaba el límite de 400 líneas por
// componente) — cada fila maneja su propio estado de edición/popovers, en
// vez de mapas id->estado en el padre.
const COURSE_TYPE_LABELS: Record<string, string> = {
  TEORICO: 'Teórico', TEORICO_PRACTICO: 'Teórico-Práctico', PROYECTOS: 'Taller/Proyectos',
  PROGRAMA_ESPECIAL: 'Programa Especial', CURSO_CORTO: 'Curso Corto', LIBRE: 'Curso Libre/Tutoría',
};
const MODALITY_FULL_LABELS: Record<string, string> = {
  PRESENCIAL: 'Presencial', SINCRONICA: 'Sincrónica', ASINCRONICA: 'Asincrónica', HIBRIDA: 'Híbrida',
};

interface Props {
  course: CourseCatalogRow;
  override: CourseOverrides[string] | undefined;
  evaluators: { username: string; name: string }[];
  studentNames: Record<string, string>;
  rooms: ClassRoomRow[];
  onUpdated: (patch: Partial<CourseCatalogRow>) => void;
  onOverrideChange: (patch: CourseOverrides[string]) => void;
  onRemoveFromPlan: () => void;
  onError: (msg: string) => void;
}

export function CourseRow({ course: c, override, evaluators, studentNames, rooms, onUpdated, onOverrideChange, onRemoveFromPlan, onError }: Props) {
  const ov = override ?? {};
  const modality = ov.modality ?? c.engineModality ?? 'VIRTUAL';
  const classType = ov.classType ?? (c.studentCount > 1 ? 'GRUPAL' : 'INDIVIDUAL');

  const [reassigning, setReassigning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState(c.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [tagSaving, setTagSaving] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const [hybridOpen, setHybridOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);

  const handleReassignTeacher = async (evaluatorId: string) => {
    const evaluator = evaluators.find((e) => e.username === evaluatorId);
    if (!evaluator) return;
    setReassigning(true);
    try {
      await api.admin.courses.assignEvaluator(c.id, { evaluatorId, evaluatorName: evaluator.name });
      onUpdated({ evaluatorId, teacherName: evaluator.name });
    } catch (err: any) {
      onError(err?.message ?? 'No se pudo reasignar el profesor.');
    } finally {
      setReassigning(false);
    }
  };

  const handleSaveTitle = async () => {
    const title = editTitleValue.trim();
    if (!title) return;
    setSavingTitle(true);
    try {
      await api.admin.courses.update(c.id, { titleOnly: true, title });
      onUpdated({ title });
      setEditingTitle(false);
    } catch (err: any) {
      onError(err?.message ?? 'No se pudo renombrar el curso.');
    } finally {
      setSavingTitle(false);
    }
  };

  const handleUpdateTag = async (field: 'courseType' | 'modality', value: string) => {
    setTagSaving(true);
    try {
      await api.admin.courses.update(c.id, { [field]: value || null });
      const patch: Partial<CourseCatalogRow> = { [field]: value || null } as any;
      // Keep engineModality in sync so StepCourses' isAsync filter reacts immediately.
      if (field === 'modality') {
        patch.engineModality = value === 'PRESENCIAL' ? 'PRESENCIAL' : value === 'ASINCRONICA' ? null : 'VIRTUAL';
      }
      onUpdated(patch);
    } catch (err: any) {
      onError(err?.message ?? 'No se pudo actualizar el tag.');
    } finally {
      setTagSaving(false);
    }
  };

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "yo quisiera que se
  // respete que ese Ensamble Instrumental se dé siempre en el aula de
  // ensayos... eso bloquearía el uso de ese aula para un horario en
  // específico directamente para ese curso." Persiste en Course.preferredRoomId.
  const handlePickRoom = async (roomId: string) => {
    try {
      await api.admin.courses.update(c.id, { preferredRoomId: roomId || null });
      onUpdated({ preferredRoomId: roomId || null });
    } catch (err: any) {
      onError(err?.message ?? 'No se pudo asignar el aula.');
    }
  };

  const handleDeleteCourse = async () => {
    if (!confirm(`¿Eliminar "${c.title}" de Lux Learning por completo? Esta acción no se puede deshacer.`)) return;
    setDeleting(true);
    try {
      await api.admin.courses.delete(c.id);
      onRemoveFromPlan();
    } catch (err: any) {
      onError(err?.message ?? 'No se pudo eliminar el curso.');
    } finally {
      setDeleting(false);
    }
  };

  const pinnedRoom = rooms.find((r) => r.id === c.preferredRoomId);

  return (
    <tr>
      <td className="py-2 pr-3 font-medium text-charcoal">
        {editingTitle ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus type="text" value={editTitleValue} onChange={(e) => setEditTitleValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); else if (e.key === 'Escape') setEditingTitle(false); }}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 w-32"
            />
            <button onClick={handleSaveTitle} disabled={savingTitle || !editTitleValue.trim()} className="p-1 text-emerald-500 hover:text-emerald-600 disabled:opacity-50">
              {savingTitle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => setEditingTitle(false)} className="p-1 text-gray-300 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-1 group">
              {c.title}
              <button
                onClick={() => { setEditingTitle(true); setEditTitleValue(c.title); }}
                title="Renombrar curso"
                className="p-0.5 text-gray-300 hover:text-cta-from opacity-0 group-hover:opacity-100"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <select
                value={c.courseType ?? ''} disabled={tagSaving}
                onChange={(e) => handleUpdateTag('courseType', e.target.value)}
                title="Tipo de curso"
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium border-0 outline-none disabled:opacity-50"
              >
                <option value="">— tipo —</option>
                {Object.entries(COURSE_TYPE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <select
                value={c.modality ?? ''} disabled={tagSaving}
                onChange={(e) => handleUpdateTag('modality', e.target.value)}
                title="Modalidad del curso"
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-600 font-medium border-0 outline-none disabled:opacity-50"
              >
                <option value="">— modalidad —</option>
                {Object.entries(MODALITY_FULL_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div>
          </div>
        )}
      </td>
      <td className="py-2 pr-3">
        <select
          value={c.evaluatorId} disabled={reassigning}
          onChange={(e) => handleReassignTeacher(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 disabled:opacity-50"
        >
          {!evaluators.some((e) => e.username === c.evaluatorId) && (
            <option value={c.evaluatorId}>{c.teacherName}</option>
          )}
          {evaluators.map((e) => <option key={e.username} value={e.username}>{e.name}</option>)}
        </select>
      </td>
      <td className="py-2 pr-3 text-gray-500">
        <span className="flex items-center gap-1">
          {c.studentCount}
          {/* Trello *LUX SCHEDULER* (Mack, 2026-09-15): "¿Tienes un curso
              virtual que está entre semana?... sería importante si son más
              de 20, o entre 15 y 20, poner un aviso." Solo informativo. */}
          {modality === 'VIRTUAL' && c.studentCount >= 15 && (
            <span title="Curso con muchos estudiantes (15+) para modalidad virtual entre semana">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            </span>
          )}
        </span>
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1 relative">
          <select value={modality} onChange={(e) => onOverrideChange({ ...ov, modality: e.target.value as any })} className="text-xs border border-gray-200 rounded-lg px-2 py-1">
            <option value="PRESENCIAL">Presencial (sábado)</option>
            <option value="VIRTUAL">Virtual (semana)</option>
            <option value="HIBRIDA">Híbrido</option>
          </select>
          {/* Trello *LUX SCHEDULER* (Mack, 2026-09-15): "hay cursos que pueden
              ser híbridos... es bueno que pregunte eso en la sección de
              cursos" — al elegir Híbrido, hay que decidir quién es presencial. */}
          {modality === 'HIBRIDA' && (
            <button
              type="button" onClick={() => setHybridOpen(!hybridOpen)}
              title="Elegir quién es presencial"
              className={`p-1 rounded-lg ${ov.hybridPresencialIds?.length ? 'text-amber-600 bg-amber-50' : 'text-gray-300 hover:text-gray-600'}`}
            >
              <Users2 className="w-3.5 h-3.5" />
            </button>
          )}
          {/* Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "yo quisiera
              que se respete que ese Ensamble Instrumental se dé siempre en
              el aula de ensayos" — solo tiene sentido para sesiones con
              componente presencial. */}
          {(modality === 'PRESENCIAL' || modality === 'HIBRIDA') && (
            <button
              type="button" onClick={() => setRoomOpen(!roomOpen)}
              title={pinnedRoom ? `Aula fija: ${pinnedRoom.preferredName || pinnedRoom.name}` : 'Fijar un aula para este curso'}
              className={`p-1 rounded-lg ${c.preferredRoomId ? 'text-amber-600 bg-amber-50' : 'text-gray-300 hover:text-gray-600'}`}
            >
              <DoorOpen className="w-3.5 h-3.5" />
            </button>
          )}
          {hybridOpen && (
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
                          onOverrideChange({ ...ov, hybridPresencialIds: next });
                        }}
                      />
                      <span className="truncate">{studentNames?.[sid] ?? sid}</span>
                    </label>
                  );
                })}
              </div>
              <button type="button" onClick={() => setHybridOpen(false)} className="text-xs text-cta-from hover:underline mt-1.5">Listo</button>
            </div>
          )}
          {roomOpen && (
            <div className="absolute z-10 top-full left-0 mt-1 p-2 bg-white border border-border rounded-lg shadow-lg w-56">
              <p className="text-[10px] text-gray-400 mb-1.5">Aula fija — bloquea ese horario para los demás cursos.</p>
              <select
                value={c.preferredRoomId ?? ''}
                onChange={(e) => handlePickRoom(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 w-full"
              >
                <option value="">— sin aula fija (auto-asignar) —</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.preferredName || r.name} (cap. {r.capacity})</option>)}
              </select>
              <button type="button" onClick={() => setRoomOpen(false)} className="text-xs text-cta-from hover:underline mt-1.5">Listo</button>
            </div>
          )}
        </div>
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1 relative">
          <select value={classType} onChange={(e) => onOverrideChange({ ...ov, classType: e.target.value as any })} className="text-xs border border-gray-200 rounded-lg px-2 py-1">
            <option value="INDIVIDUAL">Individual (55 min)</option>
            <option value="GRUPAL">Grupal (1h15)</option>
          </select>
          {/* Trello *LUX SCHEDULER* (Mack, 2026-09-15): "puede haber una
              excepción para un curso en especial; puede ser de 1 hora o
              similar" — botón que se desprende del tipo de clase en vez de
              una columna fija casi siempre vacía. */}
          <button
            type="button" onClick={() => setDurationOpen(!durationOpen)}
            title="Excepción de duración para este curso"
            className={`p-1 rounded-lg ${ov.durationOverrideMin ? 'text-amber-600 bg-amber-50' : 'text-gray-300 hover:text-gray-600'}`}
          >
            <Clock className="w-3.5 h-3.5" />
          </button>
          {durationOpen && (
            <div className="absolute z-10 top-full left-0 mt-1 p-2 bg-white border border-border rounded-lg shadow-lg flex items-center gap-1.5 whitespace-nowrap">
              <input
                autoFocus type="number" min={15} max={240} placeholder="min"
                value={ov.durationOverrideMin ?? ''}
                onChange={(e) => onOverrideChange({ ...ov, durationOverrideMin: e.target.value ? Number(e.target.value) : undefined })}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 w-16"
              />
              <span className="text-[10px] text-gray-400">min — vacío usa el default</span>
              <button type="button" onClick={() => setDurationOpen(false)} className="p-0.5 text-gray-300 hover:text-gray-600"><X className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      </td>
      <td className="py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={onRemoveFromPlan}
            title="Quitar de este plan (no se elimina el curso de Lux Learning)"
            className="p-1 text-gray-300 hover:text-amber-500"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDeleteCourse}
            disabled={deleting}
            title="Eliminar curso de Lux Learning por completo"
            className="p-1 text-gray-300 hover:text-red-500 disabled:opacity-50"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </td>
    </tr>
  );
}
