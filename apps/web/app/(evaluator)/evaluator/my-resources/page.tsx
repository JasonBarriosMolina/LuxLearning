'use client';

import { Suspense, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FolderOpen, Plus, Loader2, ChevronLeft, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/i18n';
import { useAuth } from '@/lib/hooks/useAuth';
import { FolderTree, buildTree, FolderNode } from './_components/FolderTree';
import { FolderBreadcrumb } from './_components/FolderBreadcrumb';
import { ResourceCard, Resource } from './_components/ResourceCard';
import { ResourceFilterBar } from './_components/ResourceFilterBar';
import { UploadResourceModal, UploadForm } from './_components/UploadResourceModal';
import { EditResourceModal, EditForm } from './_components/EditResourceModal';

interface Course { id: string; title: string; isArchived?: boolean; }

function fileCategory(fileType: string): string {
  if (fileType.includes('pdf')) return 'pdf';
  if (fileType.includes('word') || fileType.includes('docx')) return 'doc';
  if (fileType.includes('ppt') || fileType.includes('presentation')) return 'ppt';
  if (fileType.includes('excel') || fileType.includes('sheet')) return 'sheet';
  if (fileType.includes('image')) return 'image';
  if (fileType.includes('video')) return 'video';
  if (fileType.includes('zip') || fileType.includes('rar')) return 'zip';
  return 'other';
}

function startOfWeek() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function startOfMonth() {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1);
  return d;
}

function MyResourcesInner() {
  const { t } = useLanguage();
  const { role, isLoading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const courseIdFilter = searchParams.get('courseId');

  const [resources, setResources] = useState<Resource[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<'all' | 'week' | 'month'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [courseFilter, setCourseFilter] = useState<string>(courseIdFilter ?? 'all');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState<UploadForm>({
    title: '', description: '', folder: '', courseIds: [],
    fileUrl: '', fileName: '', fileType: '', fileSize: 0,
  });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const [editResource, setEditResource] = useState<Resource | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ title: '', description: '', folder: '', courseIds: [] });
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  const load = async () => {
    setLoadError('');
    try {
      const [resRes, coursesRes] = await Promise.all([
        api.evaluator.resources.list(),
        isAdmin ? api.admin.courses.list() : api.evaluator.myCourses(),
      ]);
      setResources((resRes as any).data ?? []);
      setCourses(((coursesRes as any).data ?? []).map((c: any) => ({ id: c.id, title: c.title, isArchived: c.isArchived ?? false })));
    } catch (err: any) {
      setLoadError(err?.message ?? 'Error al cargar recursos');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (!authLoading) load(); }, [authLoading, role]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (courseIdFilter) setCourseFilter(courseIdFilter); }, [courseIdFilter]);

  const activeResources = useMemo(
    () => resources.filter((r) => r.archived === showArchived),
    [resources, showArchived],
  );

  const folderTree = useMemo(() => buildTree(activeResources), [activeResources]);

  const allFolderPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const r of resources) {
      if (!r.folder) continue;
      const parts = r.folder.split('/').map((p) => p.trim()).filter(Boolean);
      for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
    }
    return Array.from(paths).sort();
  }, [resources]);

  const filtered = useMemo(() => {
    const weekStart = startOfWeek();
    const monthStart = startOfMonth();
    return activeResources.filter((r) => {
      const effectiveCourse = courseIdFilter ?? (courseFilter !== 'all' ? courseFilter : null);
      if (effectiveCourse && !r.courseIds.includes(effectiveCourse)) return false;
      if (selectedFolder) {
        if (!r.folder) return false;
        if (r.folder !== selectedFolder && !r.folder.startsWith(selectedFolder + '/')) return false;
      }
      if (dateFilter !== 'all') {
        const created = new Date(r.createdAt);
        if (dateFilter === 'week' && created < weekStart) return false;
        if (dateFilter === 'month' && created < monthStart) return false;
      }
      if (typeFilter !== 'all' && fileCategory(r.fileType) !== typeFilter) return false;
      return true;
    });
  }, [activeResources, courseIdFilter, courseFilter, selectedFolder, dateFilter, typeFilter]);

  const activeFiltersCount = [
    courseFilter !== 'all' && !courseIdFilter,
    selectedFolder !== null,
    dateFilter !== 'all',
    typeFilter !== 'all',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setSelectedFolder(null);
    setDateFilter('all');
    setTypeFilter('all');
    if (!courseIdFilter) setCourseFilter('all');
  };

  const openUpload = (preselectedCourseId?: string) => {
    const ids = preselectedCourseId
      ? [preselectedCourseId]
      : courseIdFilter ? [courseIdFilter] : courseFilter !== 'all' ? [courseFilter] : [];
    setUploadForm({ title: '', description: '', folder: selectedFolder ?? '', courseIds: ids, fileUrl: '', fileName: '', fileType: '', fileSize: 0 });
    setUploadError('');
    setUploadOpen(true);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadForm.fileUrl) { setUploadError(t.admin.myResourcesFileRequired); return; }
    if (!uploadForm.title.trim()) { setUploadError(t.admin.myResourcesTitleRequired); return; }
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
    if (!confirm(t.admin.myResourcesArchiveConfirm(r.title))) return;
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

  if (loading || authLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;

  if (loadError) return (
    <div className="max-w-5xl mx-auto flex flex-col items-center justify-center h-64 gap-3 text-center">
      <p className="text-red-500 font-medium">{loadError}</p>
      <button onClick={() => { setLoading(true); load(); }} className="text-sm text-cta-from hover:underline">Reintentar</button>
    </div>
  );

  const activeCourse = courseIdFilter ? courses.find((c) => c.id === courseIdFilter) : null;

  return (
    <div className="max-w-6xl mx-auto space-y-5 animate-fade-in">
      {courseIdFilter && (
        <Link href={isAdmin ? '/admin/courses' : '/evaluator/my-courses'} className="inline-flex items-center gap-1.5 text-sm text-cta-from font-medium hover:underline">
          <ChevronLeft className="w-4 h-4" />
          {isAdmin ? t.admin.contentMgmt : t.nav.myCourses}
        </Link>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">{t.admin.myResourcesTitle}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {courseIdFilter ? (activeCourse ? activeCourse.title : '...') : t.admin.myResourcesSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${showArchived ? 'bg-red-50 border-red-200 text-red-700' : 'border-gray-200 text-gray-500 hover:bg-surface'}`}
          >
            {showArchived ? t.admin.myResourcesTrashBtn : t.admin.myResourcesArchivedBtn}
          </button>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => openUpload()}>
            {t.admin.myResourcesUploadBtn}
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <ResourceFilterBar
        courses={courses}
        courseIdFilter={courseIdFilter}
        courseFilter={courseFilter}
        dateFilter={dateFilter}
        typeFilter={typeFilter}
        activeFiltersCount={activeFiltersCount}
        onCourseChange={(id) => { setCourseFilter(id); setSelectedFolder(null); }}
        onDateChange={setDateFilter}
        onTypeChange={setTypeFilter}
        onClearFilters={clearFilters}
      />

      {/* Main layout: folder tree + content */}
      <div className="flex gap-5 items-start">
        {folderTree.length > 0 && (
          <div className="hidden md:block w-52 shrink-0 card p-3 sticky top-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 mb-2">Carpetas</p>
            <button
              onClick={() => setSelectedFolder(null)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors mb-1 ${selectedFolder === null ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-500 hover:bg-surface'}`}
            >
              <FolderOpen className="w-3.5 h-3.5" /> Todas
            </button>
            <FolderTree nodes={folderTree} selected={selectedFolder} onSelect={setSelectedFolder} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {selectedFolder && (
            <div className="flex items-center gap-2 mb-4">
              <FolderBreadcrumb folder={selectedFolder} />
              <button onClick={() => setSelectedFolder(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <p className="text-xs text-gray-400 mb-3">{filtered.length} recurso{filtered.length !== 1 ? 's' : ''}</p>

          {filtered.length === 0 ? (
            <div className="card text-center py-16">
              <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="font-heading font-bold text-charcoal">
                {showArchived ? t.admin.myResourcesEmptyArchived : t.admin.myResourcesEmpty}
              </p>
              <p className="text-gray-500 text-sm mt-1">
                {activeFiltersCount > 0 ? 'Prueba cambiando los filtros.' : (showArchived ? t.admin.myResourcesEmptyArchivedHint : t.admin.myResourcesEmptyHint)}
              </p>
              {!showArchived && activeFiltersCount === 0 && (
                <button onClick={() => openUpload()} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-cta-from hover:underline">
                  <Plus className="w-4 h-4" /> Subir el primer recurso
                </button>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((r) => (
                <ResourceCard
                  key={r.resourceId}
                  resource={r}
                  courses={courses}
                  courseIdFilter={courseIdFilter}
                  courseFilter={courseFilter}
                  deleting={deleting}
                  restoring={restoring}
                  viewFileLabel={t.admin.myResourcesViewFile}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onRestore={handleRestore}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <UploadResourceModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        form={uploadForm}
        setForm={setUploadForm}
        uploading={uploading}
        uploadError={uploadError}
        allFolderPaths={allFolderPaths}
        courses={courses}
        onSubmit={handleUpload}
        labels={{
          modalTitle: t.admin.myResourcesUploadModalTitle,
          fileLabel: t.admin.myResourcesFileLabel,
          titlePlaceholder: t.admin.myResourcesTitlePlaceholder,
          descPlaceholder: t.admin.myResourcesDescPlaceholder,
          assignLabel: t.admin.myResourcesAssignLabel,
          cancelBtn: t.admin.myResourcesCancelBtn,
          savingBtn: t.admin.myResourcesSavingBtn,
          saveBtn: t.admin.myResourcesSaveBtn,
        }}
      />

      <EditResourceModal
        editResource={editResource}
        onClose={() => setEditResource(null)}
        form={editForm}
        setForm={setEditForm}
        saving={saving}
        allFolderPaths={allFolderPaths}
        courses={courses}
        onSave={handleSaveEdit}
        labels={{
          editTitle: t.admin.myResourcesEditTitle,
          titleFieldPlaceholder: t.admin.myResourcesTitleFieldPlaceholder,
          descPlaceholder: t.admin.myResourcesDescPlaceholder,
          assignedLabel: t.admin.myResourcesAssignedLabel,
          cancelBtn: t.admin.myResourcesCancelBtn,
          savingBtn: t.admin.myResourcesSavingBtn,
          saveChangesBtn: t.admin.myResourcesSaveChangesBtn,
        }}
      />
    </div>
  );
}

export default function MyResourcesPage() {
  return (
    <Suspense>
      <MyResourcesInner />
    </Suspense>
  );
}
