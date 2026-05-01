'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, BookOpen, CheckCircle, XCircle, Pencil, Trash2, ArrowRight, Tag, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';

interface CourseForm {
  title: string;
  slug: string;
  description: string;
  imageUrl: string;
  isActive: boolean;
  isPilot: boolean;
  tags: string[];
}

const EMPTY_FORM: CourseForm = {
  title: '', slug: '', description: '', imageUrl: '', isActive: false, isPilot: false, tags: [],
};

function slugify(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<any | null>(null);
  const [form, setForm] = useState<CourseForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const load = async () => {
    try {
      const res = await api.admin.courses.list();
      setCourses((res as any).data ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditingCourse(null);
    setForm(EMPTY_FORM);
    setError('');
    setModalOpen(true);
  };

  const openEdit = (course: any) => {
    setEditingCourse(course);
    setForm({
      title: course.title,
      slug: course.slug,
      description: course.description,
      imageUrl: course.imageUrl ?? '',
      isActive: course.isActive,
      isPilot: course.isPilot,
      tags: course.tags ?? [],
    });
    setTagInput('');
    setError('');
    setModalOpen(true);
  };

  const handleTitleChange = (val: string) => {
    setForm((f) => ({
      ...f,
      title: val,
      slug: editingCourse ? f.slug : slugify(val),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingCourse) {
        await api.admin.courses.update(editingCourse.id, form);
      } else {
        await api.admin.courses.create(form);
      }
      setModalOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (courseId: string) => {
    setDeleting(true);
    try {
      await api.admin.courses.delete(courseId);
      setConfirmDelete(null);
      await load();
    } catch (err: any) {
      alert(err.message ?? 'Error al eliminar');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">Gestión de Contenido</h1>
          <p className="text-gray-500 mt-1 text-sm">Crea y administra cursos, módulos, lecciones y evaluaciones</p>
        </div>
        <Button onClick={openCreate} leftIcon={<Plus className="w-4 h-4" />}>
          Nuevo curso
        </Button>
      </div>

      {/* Courses list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <div key={n} className="card h-24 animate-pulse" />)}
        </div>
      ) : courses.length === 0 ? (
        <div className="card text-center py-16">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">No hay cursos todavía</p>
          <p className="text-gray-500 text-sm mt-1">Crea el primer curso con el botón de arriba.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {courses.map((course) => (
            <div key={course.id} className="card flex items-center gap-4">
              {/* Status indicator */}
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${course.isActive ? 'bg-emerald-500' : 'bg-gray-300'}`} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-semibold text-charcoal truncate">{course.title}</p>
                  {course.isPilot && <Badge variant="info">Piloto</Badge>}
                  <Badge variant={course.isActive ? 'success' : 'default'}>
                    {course.isActive ? 'Activo' : 'Inactivo'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <p className="text-xs text-gray-500">
                    {course.modules?.length ?? 0} módulos •{' '}
                    <span className="font-mono text-gray-400">{course.slug}</span>
                  </p>
                  {course.tags?.map((tag: string) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-600 font-medium">
                      <Tag className="w-2.5 h-2.5" />{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/admin/courses/${course.id}`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-cta-from hover:bg-blue-50 transition-colors"
                >
                  Editar contenido <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <button
                  onClick={() => openEdit(course)}
                  className="p-2 rounded-lg text-gray-400 hover:text-charcoal hover:bg-surface transition-colors"
                  title="Editar información"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setConfirmDelete(course.id)}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Eliminar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingCourse ? 'Editar curso' : 'Nuevo curso'}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Título del curso"
            value={form.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="ej. StaffPad para Compositores"
            required
          />
          <Input
            label="Slug (URL)"
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="staffpad-para-compositores"
            required
          />
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Descripción</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Descripción del curso..."
              className="input-field min-h-[80px] resize-y"
              required
            />
          </div>
          <Input
            label="URL de imagen (opcional)"
            value={form.imageUrl}
            onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
            placeholder="https://..."
          />
          {/* Tags */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-indigo-500" />
              Etiquetas / Categorías
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
                placeholder="Escribe una etiqueta y presiona Enter..."
                className="input-field text-sm py-2 flex-1"
              />
            </div>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
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
              <span className="text-sm font-medium text-charcoal">Curso activo</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isPilot}
                onChange={(e) => setForm((f) => ({ ...f, isPilot: e.target.checked }))}
                className="w-4 h-4 accent-cta-from"
              />
              <span className="text-sm font-medium text-charcoal">Curso piloto</span>
            </label>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              {editingCourse ? 'Guardar cambios' : 'Crear curso'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Eliminar curso"
        size="sm"
      >
        <p className="text-gray-600 text-sm mb-6">
          ¿Seguro que quieres eliminar este curso? Se borrarán todos sus módulos, lecciones y preguntas. Esta acción no se puede deshacer.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            loading={deleting}
            onClick={() => confirmDelete && handleDelete(confirmDelete)}
          >
            Eliminar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
