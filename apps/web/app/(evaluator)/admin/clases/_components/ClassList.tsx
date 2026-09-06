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
  // Trello DmPpbrff, 2026-09-06 (Mack): "editar" used to only touch name/date/
  // weight (a local 3-field mini-editor). Opens the full ClassWizard (prompt,
  // objectives, script, video) pre-filled instead — see page.tsx.
  onEdit: (c: ClassDef) => void;
}

export function ClassList({ classes, courses, canDelete, onDeleted, onUpdated, onEdit }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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
              <button onClick={() => onEdit(c)} title="Editar" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
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
