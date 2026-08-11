'use client';

import { Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

export interface CourseForm {
  title: string;
  slug: string;
  description: string;
  imageUrl: string;
  isActive: boolean;
  isPilot: boolean;
  tags: string[];
  startDate: string;
  closeDate: string;
}

interface CourseFormModalProps {
  open: boolean;
  onClose: () => void;
  editingCourse: any | null;
  form: CourseForm;
  setForm: React.Dispatch<React.SetStateAction<CourseForm>>;
  tagInput: string;
  setTagInput: React.Dispatch<React.SetStateAction<string>>;
  saving: boolean;
  error: string;
  onSave: (e: React.FormEvent) => void;
  onTitleChange: (val: string) => void;
  t: any;
}

export function CourseFormModal({
  open,
  onClose,
  editingCourse,
  form,
  setForm,
  tagInput,
  setTagInput,
  saving,
  error,
  onSave,
  onTitleChange,
  t,
}: CourseFormModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingCourse ? t.admin.editCourseTitle : t.admin.createCourseTitle}
      size="lg"
    >
      <form onSubmit={onSave} className="space-y-4">
        <Input
          label={t.admin.courseTitleLabel}
          value={form.title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={t.admin.courseTitlePlaceholder}
          required
        />
        <Input
          label={t.admin.slugLabel}
          value={form.slug}
          onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
          placeholder={t.admin.slugPlaceholder}
          required
        />
        <div className="space-y-1">
          <label className="text-sm font-medium text-charcoal">{t.admin.descriptionLabel}</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder={t.admin.descriptionPlaceholder}
            className="input-field min-h-[80px] resize-y"
            required
          />
        </div>
        <Input
          label={t.admin.imageUrlLabel}
          value={form.imageUrl}
          onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
          placeholder="https://..."
        />

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">{t.admin.startDateLabel}</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              className="input-field"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">{t.admin.closeDateLabel}</label>
            <input
              type="date"
              value={form.closeDate}
              onChange={(e) => setForm((f) => ({ ...f, closeDate: e.target.value }))}
              className="input-field"
            />
          </div>
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-charcoal flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-indigo-500" />
            {t.admin.tagsLabel}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                  e.preventDefault();
                  const tag = tagInput.trim().toLowerCase();
                  if (!form.tags.includes(tag)) {
                    setForm((f) => ({ ...f, tags: [...f.tags, tag] }));
                  }
                  setTagInput('');
                }
              }}
              placeholder={t.admin.tagsPlaceholder}
              className="input-field text-sm py-2 flex-1"
            />
          </div>
          {form.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {form.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }))}
                    className="text-indigo-400 hover:text-indigo-700 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="w-4 h-4 accent-cta-from"
            />
            <span className="text-sm font-medium text-charcoal">{t.admin.courseActiveLabel}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isPilot}
              onChange={(e) => setForm((f) => ({ ...f, isPilot: e.target.checked }))}
              className="w-4 h-4 accent-cta-from"
            />
            <span className="text-sm font-medium text-charcoal">{t.admin.coursePilotLabel}</span>
          </label>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t.admin.deleteUserCancelBtn}
          </Button>
          <Button type="submit" loading={saving}>
            {editingCourse ? t.admin.saveChangesBtn : t.admin.createCourseBtn}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
