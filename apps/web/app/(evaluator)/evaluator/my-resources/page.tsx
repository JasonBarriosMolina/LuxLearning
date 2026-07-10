'use client';

import { Suspense, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  FolderOpen, FolderClosed, Plus, Pencil, Trash2, RotateCcw, BookOpen,
  Loader2, Link2, ChevronLeft, ChevronRight, X, Calendar, FileType2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FileUpload } from '@/components/ui/FileUpload';
import { useLanguage } from '@/lib/i18n';
import { useAuth } from '@/lib/hooks/useAuth';

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

interface Course { id: string; title: string; isArchived?: boolean; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Folder tree ──────────────────────────────────────────────────────────────

interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  count: number; // resources directly in this folder
  total: number; // resources in this folder + all children
}

function buildTree(resources: Resource[]): FolderNode[] {
  const map = new Map<string, FolderNode>();

  for (const r of resources) {
    if (!r.folder) continue;
    const parts = r.folder.split('/').map((p) => p.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/');
      if (!map.has(path)) {
        map.set(path, { name: parts[i]!, path, children: [], count: 0, total: 0 });
      }
      if (i === parts.length - 1) {
        map.get(path)!.count++;
      }
    }
  }

  // Wire children
  const roots: FolderNode[] = [];
  for (const [path, node] of map) {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) {
      roots.push(node);
    } else {
      const parentPath = path.slice(0, lastSlash);
      map.get(parentPath)?.children.push(node);
    }
  }

  // Compute totals bottom-up
  function computeTotal(node: FolderNode): number {
    node.total = node.count + node.children.reduce((s, c) => s + computeTotal(c), 0);
    return node.total;
  }
  roots.forEach(computeTotal);

  // Sort alphabetically
  function sortNode(node: FolderNode) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sortNode);
  }
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(sortNode);

  return roots;
}

function FolderTree({
  nodes, selected, onSelect, depth = 0,
}: {
  nodes: FolderNode[];
  selected: string | null;
  onSelect: (path: string | null) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (path: string) =>
    setExpanded((prev) => { const s = new Set(prev); s.has(path) ? s.delete(path) : s.add(path); return s; });

  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const isSelected = selected === node.path;
        const isExpanded = expanded.has(node.path);
        const hasChildren = node.children.length > 0;
        return (
          <li key={node.path}>
            <div
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors select-none
                ${isSelected ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-surface'}`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              {hasChildren ? (
                <button onClick={() => toggle(node.path)} className="shrink-0 text-gray-400 hover:text-gray-600">
                  {isExpanded ? <ChevronRight className="w-3.5 h-3.5 rotate-90 transition-transform" /> : <ChevronRight className="w-3.5 h-3.5 transition-transform" />}
                </button>
              ) : (
                <span className="w-3.5 h-3.5 shrink-0" />
              )}
              <button
                onClick={() => onSelect(isSelected ? null : node.path)}
                className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
              >
                {isExpanded || isSelected
                  ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                  : <FolderClosed className="w-3.5 h-3.5 shrink-0 text-gray-400" />}
                <span className="truncate">{node.name}</span>
                <span className="ml-auto text-xs text-gray-400 shrink-0">{node.total}</span>
              </button>
            </div>
            {isExpanded && hasChildren && (
              <FolderTree nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const FILE_TYPES = [
  { key: 'all', label: 'Todos' },
  { key: 'pdf', label: '📄 PDF' },
  { key: 'video', label: '🎬 Video' },
  { key: 'image', label: '🖼️ Imagen' },
  { key: 'doc', label: '📝 Documento' },
  { key: 'ppt', label: '📊 Presentación' },
  { key: 'sheet', label: '📈 Hoja de cálculo' },
  { key: 'other', label: '📁 Otro' },
];

const DATE_FILTERS = [
  { key: 'all', label: 'Todo' },
  { key: 'week', label: 'Esta semana' },
  { key: 'month', label: 'Este mes' },
];

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

  // Filters
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<'all' | 'week' | 'month'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [courseFilter, setCourseFilter] = useState<string>(courseIdFilter ?? 'all');

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '', description: '', folder: '', courseIds: [] as string[],
    fileUrl: '', fileName: '', fileType: '', fileSize: 0,
  });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Edit modal
  const [editResource, setEditResource] = useState<Resource | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', folder: '', courseIds: [] as string[] });
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

  // Sync courseFilter with URL param
  useEffect(() => { if (courseIdFilter) setCourseFilter(courseIdFilter); }, [courseIdFilter]);

  // Active resources (not archived) for tree building
  const activeResources = useMemo(
    () => resources.filter((r) => r.archived === showArchived),
    [resources, showArchived],
  );

  const folderTree = useMemo(() => buildTree(activeResources), [activeResources]);

  // All known folder paths (for datalist autocomplete)
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
      // Course filter
      const effectiveCourse = courseIdFilter ?? (courseFilter !== 'all' ? courseFilter : null);
      if (effectiveCourse && !r.courseIds.includes(effectiveCourse)) return false;
      // Folder filter (prefix match for subfolders)
      if (selectedFolder) {
        if (!r.folder) return false;
        if (r.folder !== selectedFolder && !r.folder.startsWith(selectedFolder + '/')) return false;
      }
      // Date filter
      if (dateFilter !== 'all') {
        const created = new Date(r.createdAt);
        if (dateFilter === 'week' && created < weekStart) return false;
        if (dateFilter === 'month' && created < monthStart) return false;
      }
      // Type filter
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

  const toggleCourse = (courseId: string, form: typeof uploadForm | typeof editForm, setForm: any) => {
    const ids = (form as any).courseIds as string[];
    setForm((p: any) => ({ ...p, courseIds: ids.includes(courseId) ? ids.filter((id) => id !== courseId) : [...ids, courseId] }));
  };

  if (loading || authLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;

  if (loadError) return (
    <div className="max-w-5xl mx-auto flex flex-col items-center justify-center h-64 gap-3 text-center">
      <p className="text-red-500 font-medium">{loadError}</p>
      <button onClick={() => { setLoading(true); load(); }} className="text-sm text-cta-from hover:underline">Reintentar</button>
    </div>
  );

  const renderFolderBreadcrumb = (folder: string) => {
    const parts = folder.split('/').filter(Boolean);
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {parts.map((part, i) => (
          <span key={i} className="flex items-center gap-1 text-xs text-indigo-600">
            {i > 0 && <ChevronRight className="w-3 h-3 text-gray-300" />}
            <span className={`${i === parts.length - 1 ? 'bg-indigo-50 px-2 py-0.5 rounded-full font-medium' : 'text-gray-400'}`}>
              {i === 0 && '📂 '}{part}
            </span>
          </span>
        ))}
      </div>
    );
  };

  const renderCard = (r: Resource) => (
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
      {r.folder && renderFolderBreadcrumb(r.folder)}
      {!courseIdFilter && courseFilter === 'all' && r.courseIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.courseIds.map((cid) => {
            const c = courses.find((x) => x.id === cid);
            return c ? <span key={cid} className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">✓ {c.title}</span> : null;
          })}
        </div>
      )}
      <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline flex items-center gap-1">
        <Link2 className="w-3 h-3" /> {t.admin.myResourcesViewFile}
      </a>
    </div>
  );

  const activeCourse = courseIdFilter ? courses.find((c) => c.id === courseIdFilter) : null;

  return (
    <div className="max-w-6xl mx-auto space-y-5 animate-fade-in">
      {/* Back link */}
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

      {/* ── Filter bar ── */}
      <div className="card p-4 space-y-3">
        {/* Row 1: Curso + Fecha */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Curso filter (only when not locked by URL param) */}
          {!courseIdFilter && (
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-gray-400 shrink-0" />
              <select
                value={courseFilter}
                onChange={(e) => { setCourseFilter(e.target.value); setSelectedFolder(null); }}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-charcoal focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="all">Todos los cursos</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
          )}

          {/* Date filter */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
            <div className="flex gap-1">
              {DATE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setDateFilter(f.key as any)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${dateFilter === f.key ? 'bg-indigo-100 border-indigo-300 text-indigo-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-indigo-200'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Clear filters */}
          {activeFiltersCount > 0 && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 ml-auto">
              <X className="w-3.5 h-3.5" /> Limpiar filtros ({activeFiltersCount})
            </button>
          )}
        </div>

        {/* Row 2: File type */}
        <div className="flex items-center gap-2 flex-wrap">
          <FileType2 className="w-4 h-4 text-gray-400 shrink-0" />
          <div className="flex flex-wrap gap-1">
            {FILE_TYPES.map((f) => (
              <button
                key={f.key}
                onClick={() => setTypeFilter(f.key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${typeFilter === f.key ? 'bg-indigo-100 border-indigo-300 text-indigo-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-indigo-200'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main layout: folder tree + content ── */}
      <div className="flex gap-5 items-start">
        {/* Folder tree sidebar */}
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

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Active folder badge */}
          {selectedFolder && (
            <div className="flex items-center gap-2 mb-4">
              {renderFolderBreadcrumb(selectedFolder)}
              <button onClick={() => setSelectedFolder(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Results count */}
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
              {filtered.map(renderCard)}
            </div>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title={t.admin.myResourcesUploadModalTitle} size="md">
        <form onSubmit={handleUpload} className="space-y-4">
          <FileUpload
            folder="resources"
            accept=".pdf,.docx,.pptx,.xlsx,.zip,.mp4,.jpg,.jpeg,.png"
            maxSizeMB={200}
            label={t.admin.myResourcesFileLabel}
            onUploaded={(res) => setUploadForm((p) => ({ ...p, fileUrl: res.fileUrl, fileName: res.fileName, fileType: res.fileType, fileSize: res.fileSize }))}
            onError={setUploadError}
          />
          <input
            type="text" placeholder={t.admin.myResourcesTitlePlaceholder} required
            value={uploadForm.title}
            onChange={(e) => setUploadForm((p) => ({ ...p, title: e.target.value }))}
            className="input-field w-full"
          />
          <textarea
            placeholder={t.admin.myResourcesDescPlaceholder} rows={2}
            value={uploadForm.description}
            onChange={(e) => setUploadForm((p) => ({ ...p, description: e.target.value }))}
            className="input-field w-full resize-none"
          />
          {/* Folder input with subfolder support */}
          <div>
            <input
              list="folder-suggestions"
              type="text"
              placeholder="Carpeta (ej: Material/Semana 1)"
              value={uploadForm.folder}
              onChange={(e) => setUploadForm((p) => ({ ...p, folder: e.target.value }))}
              className="input-field w-full"
            />
            <datalist id="folder-suggestions">
              {allFolderPaths.map((p) => <option key={p} value={p} />)}
            </datalist>
            {uploadForm.folder && uploadForm.folder.includes('/') && (
              <div className="mt-1.5">{renderFolderBreadcrumb(uploadForm.folder)}</div>
            )}
            <p className="text-xs text-gray-400 mt-1">Usa / para crear subcarpetas. Ej: <span className="font-mono">Módulo 1/Lecturas</span></p>
          </div>
          {/* Course assignment */}
          {courses.length > 0 && (
            <div>
              <p className="text-sm font-medium text-charcoal mb-2">{t.admin.myResourcesAssignLabel}</p>
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
            <Button variant="secondary" type="button" onClick={() => setUploadOpen(false)}>{t.admin.myResourcesCancelBtn}</Button>
            <Button type="submit" disabled={uploading || !uploadForm.fileUrl}>
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />{t.admin.myResourcesSavingBtn}</> : t.admin.myResourcesSaveBtn}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editResource} onClose={() => setEditResource(null)} title={t.admin.myResourcesEditTitle(editResource?.title ?? '')} size="md">
        {editResource && (
          <div className="space-y-4">
            <input
              type="text" placeholder={t.admin.myResourcesTitleFieldPlaceholder}
              value={editForm.title}
              onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
              className="input-field w-full"
            />
            <textarea
              placeholder={t.admin.myResourcesDescPlaceholder} rows={2}
              value={editForm.description}
              onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
              className="input-field w-full resize-none"
            />
            <div>
              <input
                list="folder-suggestions-edit"
                type="text"
                placeholder="Carpeta (ej: Material/Semana 1)"
                value={editForm.folder}
                onChange={(e) => setEditForm((p) => ({ ...p, folder: e.target.value }))}
                className="input-field w-full"
              />
              <datalist id="folder-suggestions-edit">
                {allFolderPaths.map((p) => <option key={p} value={p} />)}
              </datalist>
              {editForm.folder && editForm.folder.includes('/') && (
                <div className="mt-1.5">{renderFolderBreadcrumb(editForm.folder)}</div>
              )}
              <p className="text-xs text-gray-400 mt-1">Usa / para subcarpetas. Ej: <span className="font-mono">Módulo 1/Lecturas</span></p>
            </div>
            {courses.length > 0 && (
              <div>
                <p className="text-sm font-medium text-charcoal mb-2">{t.admin.myResourcesAssignedLabel}</p>
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
              <Button variant="secondary" onClick={() => setEditResource(null)}>{t.admin.myResourcesCancelBtn}</Button>
              <Button onClick={handleSaveEdit} disabled={saving || !editForm.title.trim()}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />{t.admin.myResourcesSavingBtn}</> : t.admin.myResourcesSaveChangesBtn}
              </Button>
            </div>
          </div>
        )}
      </Modal>
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
