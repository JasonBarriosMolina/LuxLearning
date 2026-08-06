'use client';

import { useState } from 'react';
import { Edit2, Trash2, ChevronDown, ChevronUp, Archive, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';

interface Module { id: string; title: string; order: number; }
interface Course { id: string; title: string; isActive: boolean; modules: Module[]; }

interface ClassDef {
  id: string;
  courseId: string;
  moduleId: string | null;
  name: string;
  dueDate: string | null;
  weight: number;
  vapiPrompt: string | null;
  vapiObjectives: string | null;
  lessonVideoUrl: string | null;
  lessonScript: string | null;
  targetStudentIds: string[];
  submissionCount?: number;
  pendingCount?: number;
  moduleTitle?: string | null;
  isDraft?: boolean;
  isArchived?: boolean;
}

interface Props {
  classes: ClassDef[];
  courses: Course[];
  canDelete: boolean;
  onDeleted: () => void;
  onUpdated: () => void;
}

export function ClassList({ classes, courses, canDelete, onDeleted, onUpdated }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const startEdit = (c: ClassDef) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditDue(c.dueDate ? c.dueDate.substring(0, 10) : '');
    setEditWeight(String(c.weight));
  };

  const saveEdit = async (c: ClassDef) => {
    setSaving(true);
    try {
      await api.admin.classes.update(c.id, {
        name: editName,
        dueDate: editDue || undefined,
        weight: parseFloat(editWeight) || 0,
      });
      setEditingId(null);
      onUpdated();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleToggleDraft = async (c: ClassDef) => {
    try {
      await api.admin.classes.update(c.id, { isDraft: !c.isDraft });
      onUpdated();
    } catch { /* ignore */ }
  };

  const handleToggleArchive = async (c: ClassDef) => {
    try {
      await api.admin.classes.update(c.id, { isArchived: !c.isArchived });
      onUpdated();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta clase? Esta acción no se puede deshacer.')) return;
    setDeleting(id);
    try {
      await api.admin.classes.delete(id);
      onDeleted();
    } catch { /* ignore */ } finally { setDeleting(null); }
  };

  if (classes.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">No hay clases para este curso.</p>;
  }

  return (
    <div className="space-y-2">
      {classes.map((c) => (
        <div key={c.id} className={`border border-border rounded-xl overflow-hidden ${c.isArchived ? 'opacity-50' : ''}`}>
          {/* Header row */}
          <div className="px-4 py-3 flex items-center gap-3 bg-surface">
            {editingId === c.id ? (
              <div className="flex-1 flex items-center gap-2">
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input flex-1 text-sm" />
                <input type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} className="input w-36 text-sm" />
                <input type="number" value={editWeight} onChange={(e) => setEditWeight(e.target.value)} className="input w-20 text-sm" min="0" max="100" />
                <button onClick={() => saveEdit(c)} disabled={saving} className="btn-primary text-xs px-3 py-1.5">{saving ? '…' : 'Guardar'}</button>
                <button onClick={() => setEditingId(null)} className="text-xs text-gray-500">Cancelar</button>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-charcoal text-sm truncate">{c.name}</p>
                    {c.isDraft && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Borrador</span>}
                    {c.isArchived && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">Archivada</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {c.moduleTitle ?? 'Nivel de curso'}
                    {c.dueDate && ` · Límite: ${new Date(c.dueDate).toLocaleDateString('es-MX')}`}
                    {` · ${c.weight}%`}
                    {c.submissionCount !== undefined && ` · ${c.submissionCount} completadas`}
                    {c.pendingCount !== undefined && c.pendingCount > 0 && ` · ${c.pendingCount} por calificar`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => startEdit(c)} title="Editar" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleToggleDraft(c)} title={c.isDraft ? 'Publicar' : 'Hacer borrador'} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                    {c.isDraft ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => handleToggleArchive(c)} title={c.isArchived ? 'Desarchivar' : 'Archivar'} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                  {canDelete && (
                    <button onClick={() => handleDelete(c.id)} disabled={deleting === c.id} title="Eliminar" className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => setExpandedId((p) => p === c.id ? null : c.id)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                    {expandedId === c.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Expanded detail */}
          {expandedId === c.id && (
            <div className="px-4 py-3 border-t border-border space-y-3 bg-white">
              {c.lessonVideoUrl && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Video / URL</p>
                  <a href={c.lessonVideoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate block">{c.lessonVideoUrl}</a>
                </div>
              )}
              {c.lessonScript && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Guión (primeros 200 chars)</p>
                  <p className="text-xs text-gray-600">{c.lessonScript.slice(0, 200)}{c.lessonScript.length > 200 ? '…' : ''}</p>
                </div>
              )}
              {c.vapiPrompt && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Prompt de Mentor</p>
                  <p className="text-xs text-gray-600">{c.vapiPrompt.slice(0, 200)}{c.vapiPrompt.length > 200 ? '…' : ''}</p>
                </div>
              )}
              {c.vapiObjectives && (() => {
                try {
                  const objs = JSON.parse(c.vapiObjectives);
                  return Array.isArray(objs) ? (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">Objetivos</p>
                      <ol className="space-y-0.5">
                        {objs.map((o: string, i: number) => <li key={i} className="text-xs text-gray-600">{i + 1}. {o}</li>)}
                      </ol>
                    </div>
                  ) : null;
                } catch { return null; }
              })()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
