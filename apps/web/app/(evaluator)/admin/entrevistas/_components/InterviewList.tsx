'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Mic, Pencil, Trash2, ChevronDown, Check, Loader2, Users, Calendar,
  BarChart2, Archive, BookmarkX, MoreVertical, RefreshCw, Eye, EyeOff,
} from 'lucide-react';
import { api } from '@/lib/api';

interface Module { id: string; title: string; order: number; }
interface Course { id: string; title: string; isActive: boolean; modules: Module[]; }

interface InterviewDef {
  id: string;
  courseId: string;
  moduleId: string | null;
  name: string;
  dueDate: string | null;
  weight: number;
  vapiPrompt: string | null;
  vapiObjectives: string | null;
  targetStudentIds: string[];
  submissionCount?: number;
  pendingCount?: number;
  moduleTitle?: string | null;
  isDraft?: boolean;
  isArchived?: boolean;
}

interface Props {
  interviews: InterviewDef[];
  courses: Course[];
  canDelete: boolean;
  onDeleted: (id: string) => void;
  onUpdated: (updated: InterviewDef) => void;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ActionMenu({ onEdit, onReassign, onDraft, onArchive, onDelete, canDelete, isDraft, isArchived }: {
  onEdit: () => void; onReassign: () => void; onDraft: () => void;
  onArchive: () => void; onDelete: () => void; canDelete: boolean;
  isDraft: boolean; isArchived: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const item = (icon: React.ReactNode, label: string, onClick: () => void, danger = false) => (
    <button
      onClick={() => { onClick(); setOpen(false); }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-gray-50 transition-colors ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'}`}
    >
      {icon}{label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
        title="Más opciones"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-48 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden py-1">
          {item(<Pencil className="w-3.5 h-3.5" />, 'Editar', onEdit)}
          {item(<RefreshCw className="w-3.5 h-3.5" />, 'Reasignar', onReassign)}
          {item(
            isDraft ? <Eye className="w-3.5 h-3.5" /> : <BookmarkX className="w-3.5 h-3.5" />,
            isDraft ? 'Marcar como activa' : 'Guardar como borrador',
            onDraft,
          )}
          {item(
            isArchived ? <Eye className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />,
            isArchived ? 'Desarchivar' : 'Archivar',
            onArchive,
          )}
          {canDelete && (
            <>
              <div className="border-t border-gray-100 my-1" />
              {item(<Trash2 className="w-3.5 h-3.5" />, 'Eliminar', onDelete, true)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ReassignModal({ iv, courses, onClose, onSaved }: {
  iv: InterviewDef; courses: Course[]; onClose: () => void; onSaved: (updated: InterviewDef) => void;
}) {
  const [courseId, setCourseId] = useState(iv.courseId);
  const [moduleId, setModuleId] = useState(iv.moduleId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedCourse = courses.find((c) => c.id === courseId);

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await api.admin.interviews.update(iv.id, {
        courseId,
        moduleId: moduleId || undefined,
      });
      onSaved({ ...iv, ...(res as any).data ?? res, courseId, moduleId: moduleId || null });
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Error al reasignar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-blue-500" /> Reasignar entrevista
        </h3>
        <p className="text-xs text-gray-500">Cambia el curso o módulo al que se asigna «{iv.name}».</p>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Curso</label>
          <select
            value={courseId}
            onChange={(e) => { setCourseId(e.target.value); setModuleId(''); }}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Módulo (opcional)</label>
          <select
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="">— Nivel de curso —</option>
            {(selectedCourse?.modules ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.order}. {m.title}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || courseId === iv.courseId && moduleId === (iv.moduleId ?? '')}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

export function InterviewList({ interviews, courses, canDelete, onDeleted, onUpdated }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<{ name: string; dueDate: string; weight: string; vapiPrompt: string; vapiObjectives: string }>({
    name: '', dueDate: '', weight: '', vapiPrompt: '', vapiObjectives: '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  function startEdit(iv: InterviewDef) {
    setEditingId(iv.id);
    setEditState({
      name: iv.name,
      dueDate: iv.dueDate ? iv.dueDate.slice(0, 10) : '',
      weight: String(iv.weight),
      vapiPrompt: iv.vapiPrompt ?? '',
      vapiObjectives: iv.vapiObjectives ?? '',
    });
    setExpandedId(iv.id);
  }

  async function saveEdit(iv: InterviewDef) {
    if (!editState.name.trim()) return;
    setSaving(true);
    try {
      const res = await api.admin.interviews.update(iv.id, {
        name: editState.name.trim(),
        dueDate: editState.dueDate || undefined,
        weight: parseFloat(editState.weight) || 0,
        vapiPrompt: editState.vapiPrompt || undefined,
        vapiObjectives: editState.vapiObjectives || undefined,
      });
      onUpdated({ ...iv, ...(res as any).data ?? res });
      setEditingId(null);
    } catch {
      // keep editing
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('¿Eliminar esta entrevista? Esta acción no se puede deshacer.')) return;
    setDeleting(id);
    try {
      await api.admin.interviews.delete(id);
      onDeleted(id);
    } catch {
      setDeleting(null);
    }
  }

  async function handleToggleDraft(iv: InterviewDef) {
    setActioning(iv.id);
    try {
      const res = await api.admin.interviews.update(iv.id, { isDraft: !iv.isDraft });
      onUpdated({ ...iv, ...(res as any).data ?? res });
    } catch { /* silent */ } finally {
      setActioning(null);
    }
  }

  async function handleToggleArchive(iv: InterviewDef) {
    const msg = iv.isArchived ? '¿Restaurar esta entrevista?' : '¿Archivar esta entrevista? No será visible para los estudiantes.';
    if (!window.confirm(msg)) return;
    setActioning(iv.id);
    try {
      const res = await api.admin.interviews.update(iv.id, { isArchived: !iv.isArchived });
      onUpdated({ ...iv, ...(res as any).data ?? res });
    } catch { /* silent */ } finally {
      setActioning(null);
    }
  }

  const visible = interviews.filter((iv) => showArchived ? iv.isArchived : !iv.isArchived);
  const archivedCount = interviews.filter((iv) => iv.isArchived).length;
  const reassigning = reassigningId ? interviews.find((iv) => iv.id === reassigningId) : null;

  if (interviews.length === 0) {
    return (
      <div className="text-center py-14">
        <Mic className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-gray-400 text-sm">No hay entrevistas creadas para este curso</p>
      </div>
    );
  }

  if (visible.length === 0 && !showArchived) {
    return (
      <div className="text-center py-14 space-y-3">
        <Mic className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Todas las entrevistas están archivadas</p>
        {archivedCount > 0 && (
          <button onClick={() => setShowArchived(true)} className="text-xs text-blue-600 underline">
            Ver {archivedCount} archivada{archivedCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {archivedCount > 0 && (
        <button
          onClick={() => setShowArchived((p) => !p)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Archive className="w-3.5 h-3.5" />
          {showArchived ? 'Ver activas' : `Ver ${archivedCount} archivada${archivedCount !== 1 ? 's' : ''}`}
        </button>
      )}

      {visible.map((iv) => {
        const isExpanded = expandedId === iv.id;
        const isEditing = editingId === iv.id;
        const isActioning = actioning === iv.id;

        return (
          <div key={iv.id} className={`border rounded-2xl overflow-hidden shadow-sm ${iv.isArchived ? 'border-gray-100 opacity-60' : iv.isDraft ? 'border-dashed border-amber-200' : 'border-gray-100'}`}>
            <div className="flex items-center gap-3 px-4 py-3 bg-white">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iv.isArchived ? 'bg-gray-100' : iv.isDraft ? 'bg-amber-50' : 'bg-rose-100'}`}>
                <Mic className={`w-4 h-4 ${iv.isArchived ? 'text-gray-400' : iv.isDraft ? 'text-amber-500' : 'text-rose-600'}`} />
              </div>

              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    autoFocus
                    value={editState.name}
                    onChange={(e) => setEditState((p) => ({ ...p, name: e.target.value }))}
                    className="w-full border border-blue-300 rounded-lg px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                ) : (
                  <p className="text-sm font-semibold text-gray-900 truncate">{iv.name}</p>
                )}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {iv.isDraft && <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">Borrador</span>}
                  {iv.isArchived && <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">Archivada</span>}
                  {iv.moduleTitle && (
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{iv.moduleTitle}</span>
                  )}
                  {iv.submissionCount != null && (
                    <span className="text-[10px] text-blue-600 font-medium">
                      {iv.submissionCount} entrega{iv.submissionCount !== 1 ? 's' : ''}
                      {iv.pendingCount ? ` · ${iv.pendingCount} pendiente${iv.pendingCount !== 1 ? 's' : ''}` : ''}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isActioning && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                {isEditing ? (
                  <button
                    onClick={() => saveEdit(iv)}
                    disabled={saving}
                    className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100"
                    title="Guardar"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </button>
                ) : (
                  <ActionMenu
                    onEdit={() => startEdit(iv)}
                    onReassign={() => setReassigningId(iv.id)}
                    onDraft={() => handleToggleDraft(iv)}
                    onArchive={() => handleToggleArchive(iv)}
                    onDelete={() => handleDelete(iv.id)}
                    canDelete={canDelete}
                    isDraft={iv.isDraft ?? false}
                    isArchived={iv.isArchived ?? false}
                  />
                )}
                {deleting === iv.id
                  ? <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                  : (
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : iv.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-50"
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  )}
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 mb-1 flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> Fecha límite
                        </label>
                        <input type="date" value={editState.dueDate} onChange={(e) => setEditState((p) => ({ ...p, dueDate: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 mb-1 flex items-center gap-1">
                          <BarChart2 className="w-3 h-3" /> Peso (%)
                        </label>
                        <input type="number" min={0} max={100} value={editState.weight} onChange={(e) => setEditState((p) => ({ ...p, weight: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-rose-600 mb-1 block">Instrucciones IA (Vapi)</label>
                      <textarea rows={4} value={editState.vapiPrompt}
                        onChange={(e) => setEditState((p) => ({ ...p, vapiPrompt: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs resize-y focus:outline-none focus:ring-2 focus:ring-rose-200" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500 mb-1 block">Objetivos (uno por línea)</label>
                      <textarea rows={3} value={editState.vapiObjectives}
                        onChange={(e) => setEditState((p) => ({ ...p, vapiObjectives: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs resize-y focus:outline-none focus:ring-2 focus:ring-blue-200" />
                    </div>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar edición</button>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Fecha límite</p>
                        <p className="text-xs text-gray-700 mt-0.5">{fmtDate(iv.dueDate)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Peso</p>
                        <p className="text-xs text-gray-700 mt-0.5">{iv.weight}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1"><Users className="w-3 h-3" /> Asignados</p>
                        <p className="text-xs text-gray-700 mt-0.5">
                          {iv.targetStudentIds?.length > 0 ? `${iv.targetStudentIds.length} estudiante(s)` : 'Todo el curso'}
                        </p>
                      </div>
                    </div>
                    {iv.vapiPrompt && (
                      <div>
                        <p className="text-[10px] font-semibold text-rose-600 mb-1">Instrucciones IA</p>
                        <p className="text-xs text-gray-600 line-clamp-3 leading-relaxed">{iv.vapiPrompt}</p>
                      </div>
                    )}
                    {iv.vapiObjectives && (
                      <div>
                        <p className="text-[10px] font-semibold text-gray-500 mb-1">Objetivos de preguntas</p>
                        <ul className="space-y-0.5">
                          {iv.vapiObjectives.split('\n').filter(Boolean).map((o, i) => (
                            <li key={i} className="text-xs text-gray-600">· {o}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {reassigning && (
        <ReassignModal
          iv={reassigning}
          courses={courses}
          onClose={() => setReassigningId(null)}
          onSaved={(updated) => { onUpdated(updated); setReassigningId(null); }}
        />
      )}
    </div>
  );
}
