'use client';

import { useEffect, useState } from 'react';
import { FolderOpen, Plus, Pencil, Trash2, RotateCcw, BookOpen, Loader2, FileText, Link2, X, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FileUpload } from '@/components/ui/FileUpload';

interface Resource {
  evaluatorId: string;
  resourceId: string;
  title: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  folder?: string;
  courseIds: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Course { id: string; title: string; }

function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fileIcon(fileType: string) {
  if (fileType.includes('pdf')) return '📄';
  if (fileType.includes('word') || fileType.includes('docx')) return '📝';
  if (fileType.includes('ppt') || fileType.includes('presentation')) return '📊';
  if (fileType.includes('excel') || fileType.includes('sheet')) return '📈';
  if (fileType.includes('image')) return '🖼️';
  if (fileType.includes('video')) return '🎬';
  if (fileType.includes('zip') || fileType.includes('rar')) return '🗜️';
  return '📁';
}

export default function MyResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [folderFilter, setFolderFilter] = useState<string>('all');

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({ title: '', description: '', folder: '', courseIds: [] as string[], fileUrl: '', fileName: '', fileType: '', fileSize: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Edit modal
  const [editResource, setEditResource] = useState<Resource | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', folder: '', courseIds: [] as string[] });
  const [saving, setSaving] = useState(false);

  // Delete/restore state
  const [deleting, setDeleting] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = async () => {
    try {
      const [resRes, coursesRes] = await Promise.all([
        api.evaluator.resources.list(),
        api.evaluator.myCourses(),
      ]);
      setResources((resRes as any).data ?? []);
      setCourses(((coursesRes as any).data ?? []).map((c: any) => ({ id: c.id, title: c.title })));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const folders = ['all', ...Array.from(new Set(resources.filter(r => r.folder).map(r => r.folder!)))];

  const filtered = resources.filter(r => {
    if (r.archived !== showArchived) return false;
    if (folderFilter !== 'all' && r.folder !== folderFilter) return false;
    return true;
  });

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadForm.fileUrl) { setUploadError('Sube un archivo primero'); return; }
    if (!uploadForm.title.trim()) { setUploadError('El título es requerido'); return; }
    setUploading(true); setUploadError('');
    try {
      await api.evaluator.resources.create({
        title: uploadForm.title.trim(),
        description: uploadForm.description.trim() || undefined,
        fileUrl: uploadForm.fileUrl,
        fileName: uploadForm.fileName,
        fileType: uploadForm.fileType,
        fileSize: uploadForm.fileSize,
        folder: uploadForm.folder.trim() || undefined,
        courseIds: uploadForm.courseIds,
      });
      setUploadOpen(false);
      setUploadForm({ title: '', description: '', folder: '', courseIds: [], fileUrl: '', fileName: '', fileType: '', fileSize: 0 });
      await load();
    } catch (err: any) {
      setUploadError(err.message ?? 'Error al crear recurso');
    } finally { setUploading(false); }
  };

  const openEdit = (r: Resource) => {
    setEditResource(r);
    setEditForm({ title: r.title, description: r.description ?? '', folder: r.folder ?? '', courseIds: r.courseIds });
  };

  const handleSaveEdit = async () => {
    if (!editResource) return;
    setSaving(true);
    try {
      await api.evaluator.resources.update(editResource.resourceId, {
        title: editForm.title.trim(),
        description: editForm.description.trim() || undefined,
        folder: editForm.folder.trim() || undefined,
        courseIds: editForm.courseIds,
      });
      setEditResource(null);
      await load();
    } catch { alert('Error al guardar'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (r: Resource) => {
    if (!confirm(`¿Archivar "${r.title}"? Se moverá a la papelera por 60 días.`)) return;
    setDeleting(r.resourceId);
    try { await api.evaluator.resources.delete(r.resourceId); await load(); }
    catch { alert('Error al archivar'); }
    finally { setDeleting(null); }
  };

  const handleRestore = async (r: Resource) => {
    setRestoring(r.resourceId);
    try { await api.evaluator.resources.restore(r.resourceId); await load(); }
    catch { alert('Error al restaurar'); }
    finally { setRestoring(null); }
  };

  const toggleCourse = (courseId: string, form: typeof uploadForm | typeof editForm, setForm: any) => {
    const ids = (form as any).courseIds as string[];
    setForm((p: any) => ({ ...p, courseIds: ids.includes(courseId) ? ids.filter((id) => id !== courseId) : [...ids, courseId] }));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">Mis Recursos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sube y asigna materiales a tus cursos</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${showArchived ? 'bg-red-50 border-red-200 text-red-700' : 'border-gray-200 text-gray-500 hover:bg-surface'}`}
          >
            {showArchived ? '📁 Papelera' : '🗂️ Archivados'}
          </button>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setUploadOpen(true)}>
            Subir recurso
          </Button>
        </div>
      </div>

      {/* Folder filter */}
      {folders.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {folders.map((f) => (
            <button
              key={f}
              onClick={() => setFolderFilter(f)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${folderFilter === f ? 'bg-indigo-100 text-indigo-700' : 'bg-surface text-gray-500 hover:bg-indigo-50'}`}
            >
              {f === 'all' ? 'Todos' : `📂 ${f}`}
            </button>
          ))}
        </div>
      )}

      {/* Resources grid */}
      {filtered.length === 0 ? (
        <div className="card text-center py-16">
          <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">{showArchived ? 'Papelera vacía' : 'Sin recursos todavía'}</p>
          <p className="text-gray-500 text-sm mt-1">{showArchived ? 'No hay recursos archivados' : 'Sube materiales con el botón de arriba'}</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {filtered.map((r) => (
            <div key={r.resourceId} className="card p-4 space-y-3">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{fileIcon(r.fileType)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-charcoal text-sm truncate">{r.title}</p>
                  {r.description && <p className="text-xs text-gray-500 line-clamp-2">{r.description}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">{r.fileName} {formatSize(r.fileSize) && `· ${formatSize(r.fileSize)}`}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!r.archived ? (
                    <>
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-surface text-gray-400 hover:text-charcoal transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDelete(r)} disabled={deleting === r.resourceId} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50">
                        {deleting === r.resourceId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleRestore(r)} disabled={restoring === r.resourceId} className="p-1.5 rounded-lg hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-colors disabled:opacity-50">
                      {restoring === r.resourceId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>

              {r.folder && <div className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">📂 {r.folder}</div>}

              {r.courseIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {r.courseIds.map((cid) => {
                    const c = courses.find((x) => x.id === cid);
                    return c ? <span key={cid} className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">✓ {c.title}</span> : null;
                  })}
                </div>
              )}

              <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline flex items-center gap-1">
                <Link2 className="w-3 h-3" /> Ver archivo
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Subir recurso" size="md">
        <form onSubmit={handleUpload} className="space-y-4">
          <FileUpload
            folder="resources"
            accept=".pdf,.docx,.pptx,.xlsx,.zip,.mp4,.jpg,.jpeg,.png"
            maxSizeMB={200}
            label="Arrastra o selecciona el archivo"
            onUploaded={(res) => setUploadForm((p) => ({ ...p, fileUrl: res.fileUrl, fileName: res.fileName, fileType: res.fileType, fileSize: res.fileSize }))}
            onError={setUploadError}
          />
          <input
            type="text" placeholder="Título del recurso *" required
            value={uploadForm.title}
            onChange={(e) => setUploadForm((p) => ({ ...p, title: e.target.value }))}
            className="input-field w-full"
          />
          <textarea
            placeholder="Descripción (opcional)"
            rows={2}
            value={uploadForm.description}
            onChange={(e) => setUploadForm((p) => ({ ...p, description: e.target.value }))}
            className="input-field w-full resize-none"
          />
          <input
            type="text" placeholder="Carpeta (opcional, ej: Semana 1)"
            value={uploadForm.folder}
            onChange={(e) => setUploadForm((p) => ({ ...p, folder: e.target.value }))}
            className="input-field w-full"
          />
          {courses.length > 0 && (
            <div>
              <p className="text-sm font-medium text-charcoal mb-2">Asignar a cursos</p>
              <div className="flex flex-wrap gap-2">
                {courses.map((c) => (
                  <button
                    key={c.id} type="button"
                    onClick={() => toggleCourse(c.id, uploadForm, setUploadForm)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${uploadForm.courseIds.includes(c.id) ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-indigo-200'}`}
                  >
                    {uploadForm.courseIds.includes(c.id) && '✓ '}{c.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          {uploadError && <p className="text-sm text-red-500">{uploadError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setUploadOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={uploading || !uploadForm.fileUrl}>
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Guardando...</> : 'Guardar recurso'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editResource} onClose={() => setEditResource(null)} title={`Editar: ${editResource?.title}`} size="md">
        {editResource && (
          <div className="space-y-4">
            <input
              type="text" placeholder="Título *"
              value={editForm.title}
              onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
              className="input-field w-full"
            />
            <textarea
              placeholder="Descripción" rows={2}
              value={editForm.description}
              onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
              className="input-field w-full resize-none"
            />
            <input
              type="text" placeholder="Carpeta"
              value={editForm.folder}
              onChange={(e) => setEditForm((p) => ({ ...p, folder: e.target.value }))}
              className="input-field w-full"
            />
            {courses.length > 0 && (
              <div>
                <p className="text-sm font-medium text-charcoal mb-2">Cursos asignados</p>
                <div className="flex flex-wrap gap-2">
                  {courses.map((c) => (
                    <button
                      key={c.id} type="button"
                      onClick={() => toggleCourse(c.id, editForm, setEditForm)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${editForm.courseIds.includes(c.id) ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-indigo-200'}`}
                    >
                      {editForm.courseIds.includes(c.id) && '✓ '}{c.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditResource(null)}>Cancelar</Button>
              <Button onClick={handleSaveEdit} disabled={saving || !editForm.title.trim()}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Guardando...</> : 'Guardar cambios'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
