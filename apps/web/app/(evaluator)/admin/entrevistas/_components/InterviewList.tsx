'use client';

import { useState } from 'react';
import { Mic, Pencil, Trash2, ChevronDown, Check, Loader2, Users, Calendar, BarChart2 } from 'lucide-react';
import { api } from '@/lib/api';

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
}

interface Props {
  interviews: InterviewDef[];
  canDelete: boolean;
  onDeleted: (id: string) => void;
  onUpdated: (updated: InterviewDef) => void;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function InterviewList({ interviews, canDelete, onDeleted, onUpdated }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  function startEdit(iv: InterviewDef) {
    setEditingId(iv.id);
    setEditName(iv.name);
    setEditDueDate(iv.dueDate ? iv.dueDate.slice(0, 10) : '');
    setEditWeight(String(iv.weight));
    setExpandedId(iv.id);
  }

  async function saveEdit(iv: InterviewDef) {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await api.admin.interviews.update(iv.id, {
        name: editName.trim(),
        dueDate: editDueDate || undefined,
        weight: parseFloat(editWeight) || 0,
      });
      const updated = (res as any).data ?? res;
      onUpdated({ ...iv, ...updated });
      setEditingId(null);
    } catch {
      // keep editing on error
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

  if (interviews.length === 0) {
    return (
      <div className="text-center py-14">
        <Mic className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-gray-400 text-sm">No hay entrevistas creadas para este curso</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {interviews.map((iv) => {
        const isExpanded = expandedId === iv.id;
        const isEditing = editingId === iv.id;

        return (
          <div key={iv.id} className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-white">
              <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                <Mic className="w-4 h-4 text-rose-600" />
              </div>

              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full border border-blue-300 rounded-lg px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                ) : (
                  <p className="text-sm font-semibold text-gray-900 truncate">{iv.name}</p>
                )}
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
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

              <div className="flex items-center gap-1.5 shrink-0">
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
                  <button onClick={() => startEdit(iv)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-50 hover:text-blue-600" title="Editar">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => handleDelete(iv.id)}
                    disabled={deleting === iv.id}
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500"
                    title="Eliminar"
                  >
                    {deleting === iv.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : iv.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-50"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {isEditing ? (
                    <>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 mb-1 flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> Fecha límite
                        </label>
                        <input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 mb-1 flex items-center gap-1">
                          <BarChart2 className="w-3 h-3" /> Peso (%)
                        </label>
                        <input type="number" min={0} max={100} value={editWeight} onChange={(e) => setEditWeight(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200" />
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
