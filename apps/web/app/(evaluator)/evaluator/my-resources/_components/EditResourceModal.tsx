'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FolderBreadcrumb } from './FolderBreadcrumb';
import { Resource } from './ResourceCard';

interface Course { id: string; title: string; isArchived?: boolean; }

export interface EditForm {
  title: string;
  description: string;
  folder: string;
  courseIds: string[];
}

interface Props {
  editResource: Resource | null;
  onClose: () => void;
  form: EditForm;
  setForm: React.Dispatch<React.SetStateAction<EditForm>>;
  saving: boolean;
  allFolderPaths: string[];
  courses: Course[];
  onSave: () => void;
  labels: {
    editTitle: (title: string) => string;
    titleFieldPlaceholder: string;
    descPlaceholder: string;
    assignedLabel: string;
    cancelBtn: string;
    savingBtn: string;
    saveChangesBtn: string;
  };
}

export function EditResourceModal({
  editResource, onClose, form, setForm, saving, allFolderPaths, courses, onSave, labels,
}: Props) {
  const toggleCourse = (courseId: string) => {
    setForm((p) => ({
      ...p,
      courseIds: p.courseIds.includes(courseId)
        ? p.courseIds.filter((id) => id !== courseId)
        : [...p.courseIds, courseId],
    }));
  };

  return (
    <Modal open={!!editResource} onClose={onClose} title={labels.editTitle(editResource?.title ?? '')} size="md">
      {editResource && (
        <div className="space-y-4">
          <input
            type="text"
            placeholder={labels.titleFieldPlaceholder}
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            className="input-field w-full"
          />
          <textarea
            placeholder={labels.descPlaceholder}
            rows={2}
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            className="input-field w-full resize-none"
          />
          <div>
            <input
              list="folder-suggestions-edit"
              type="text"
              placeholder="Carpeta (ej: Material/Semana 1)"
              value={form.folder}
              onChange={(e) => setForm((p) => ({ ...p, folder: e.target.value }))}
              className="input-field w-full"
            />
            <datalist id="folder-suggestions-edit">
              {allFolderPaths.map((p) => <option key={p} value={p} />)}
            </datalist>
            {form.folder && form.folder.includes('/') && (
              <div className="mt-1.5"><FolderBreadcrumb folder={form.folder} /></div>
            )}
            <p className="text-xs text-gray-400 mt-1">Usa / para subcarpetas. Ej: <span className="font-mono">Módulo 1/Lecturas</span></p>
          </div>
          {courses.length > 0 && (
            <div>
              <p className="text-sm font-medium text-charcoal mb-2">{labels.assignedLabel}</p>
              <div className="flex flex-wrap gap-2">
                {courses.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCourse(c.id)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${form.courseIds.includes(c.id) ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-indigo-200'}`}
                  >
                    {form.courseIds.includes(c.id) && '✓ '}{c.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>{labels.cancelBtn}</Button>
            <Button onClick={onSave} disabled={saving || !form.title.trim()}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />{labels.savingBtn}</> : labels.saveChangesBtn}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
