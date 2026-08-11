'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FileUpload } from '@/components/ui/FileUpload';
import { FolderBreadcrumb } from './FolderBreadcrumb';

interface Course { id: string; title: string; isArchived?: boolean; }

export interface UploadForm {
  title: string;
  description: string;
  folder: string;
  courseIds: string[];
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  form: UploadForm;
  setForm: React.Dispatch<React.SetStateAction<UploadForm>>;
  uploading: boolean;
  uploadError: string;
  allFolderPaths: string[];
  courses: Course[];
  onSubmit: (e: React.FormEvent) => void;
  labels: {
    modalTitle: string;
    fileLabel: string;
    titlePlaceholder: string;
    descPlaceholder: string;
    assignLabel: string;
    cancelBtn: string;
    savingBtn: string;
    saveBtn: string;
  };
}

export function UploadResourceModal({
  open, onClose, form, setForm, uploading, uploadError,
  allFolderPaths, courses, onSubmit, labels,
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
    <Modal open={open} onClose={onClose} title={labels.modalTitle} size="md">
      <form onSubmit={onSubmit} className="space-y-4">
        <FileUpload
          folder="resources"
          accept=".pdf,.docx,.pptx,.xlsx,.zip,.mp4,.jpg,.jpeg,.png"
          maxSizeMB={200}
          label={labels.fileLabel}
          onUploaded={(res) => setForm((p) => ({ ...p, fileUrl: res.fileUrl, fileName: res.fileName, fileType: res.fileType, fileSize: res.fileSize }))}
          onError={() => {}}
        />
        <input
          type="text"
          placeholder={labels.titlePlaceholder}
          required
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
            list="folder-suggestions"
            type="text"
            placeholder="Carpeta (ej: Material/Semana 1)"
            value={form.folder}
            onChange={(e) => setForm((p) => ({ ...p, folder: e.target.value }))}
            className="input-field w-full"
          />
          <datalist id="folder-suggestions">
            {allFolderPaths.map((p) => <option key={p} value={p} />)}
          </datalist>
          {form.folder && form.folder.includes('/') && (
            <div className="mt-1.5"><FolderBreadcrumb folder={form.folder} /></div>
          )}
          <p className="text-xs text-gray-400 mt-1">Usa / para crear subcarpetas. Ej: <span className="font-mono">Módulo 1/Lecturas</span></p>
        </div>
        {courses.length > 0 && (
          <div>
            <p className="text-sm font-medium text-charcoal mb-2">{labels.assignLabel}</p>
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
        {uploadError && <p className="text-sm text-red-500">{uploadError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>{labels.cancelBtn}</Button>
          <Button type="submit" disabled={uploading || !form.fileUrl}>
            {uploading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />{labels.savingBtn}</> : labels.saveBtn}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
