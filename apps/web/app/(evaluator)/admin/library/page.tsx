'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

interface LibraryResult {
  id: string; title: string; authors: string[]; year?: number;
  source: string; url?: string; doi?: string; abstract?: string; openAccess: boolean;
}
interface LocalResource {
  resourceId: string; title: string; description?: string; fileUrl: string;
  source?: string; folder?: string; courseIds?: string[]; createdAt: string;
}
interface Course { id: string; title: string }
interface FolderMeta { [name: string]: { color: string } }

const SOURCE_META: Record<string, { color: string; bg: string; textClass: string }> = {
  OpenAlex: { color: '#1d4ed8', bg: '#eff6ff', textClass: 'text-blue-700' },
  arXiv:    { color: '#b91c1c', bg: '#fef2f2', textClass: 'text-red-700' },
  CORE:     { color: '#15803d', bg: '#f0fdf4', textClass: 'text-green-700' },
  SciELO:   { color: '#b45309', bg: '#fffbeb', textClass: 'text-amber-700' },
};
const SOURCE_SVG: Record<string, string> = {
  OpenAlex: 'M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z',
  arXiv:    'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  CORE:     'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  SciELO:   'M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z',
};
const FOLDER_COLORS = ['#17527E','#0F3F62','#E2BA50','#C9A130','#15803d','#b91c1c','#7c3aed','#db2777','#ea580c','#64748b'];
const SOURCES = [
  { key: 'openalex,arxiv,core,scielo', label: 'Todas' },
  { key: 'openalex', label: 'OpenAlex' },
  { key: 'arxiv', label: 'arXiv' },
  { key: 'core', label: 'CORE' },
  { key: 'scielo', label: 'SciELO' },
];
const DEFAULT_FOLDER = 'General';

function sortResults(r: LibraryResult[]) {
  return [...r].sort((a, b) => (a.openAccess === b.openAccess ? 0 : a.openAccess ? -1 : 1));
}

export default function LibraryPage() {
  const [tab, setTab] = useState<'search' | 'local'>('search');
  // search
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState('openalex,arxiv,core,scielo');
  const [results, setResults] = useState<LibraryResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  // local
  const [resources, setResources] = useState<LocalResource[]>([]);
  const [folderMeta, setFolderMeta] = useState<FolderMeta>({});
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  // folder modal
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);
  const [editFolder, setEditFolder] = useState<string | null>(null);
  // resource move/assign
  const [movingResource, setMovingResource] = useState<LocalResource | null>(null);
  const [moveFolder, setMoveFolder] = useState('');
  const [moveCourses, setMoveCourses] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const loadLocal = async () => {
    setLoadingLocal(true);
    try {
      const [lr, cm] = await Promise.all([
        api.admin.library.local() as Promise<any>,
        api.admin.email.courses() as Promise<any>,
      ]);
      setResources(lr.data?.resources ?? []);
      setFolderMeta(lr.data?.folderMeta ?? {});
      setCourses(cm.data ?? []);
    } catch { /* ignore */ }
    setLoadingLocal(false);
  };

  useEffect(() => { if (tab === 'local') loadLocal(); }, [tab]);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || query.trim().length < 2) return;
    setSearching(true); setSearched(false);
    try {
      const r: any = await api.admin.library.search(query.trim(), sources);
      setResults(sortResults(r.data?.results ?? []));
    } catch { setResults([]); }
    setSearching(false); setSearched(true);
  };

  const handleSave = async (result: LibraryResult) => {
    if (saved.has(result.id) || !result.url) return;
    setSaving(result.id);
    try {
      await api.admin.library.save({ title: result.title, authors: result.authors, year: result.year, source: result.source, url: result.url, doi: result.doi, abstract: result.abstract });
      setSaved((prev) => new Set([...prev, result.id]));
    } catch { /* ignore */ }
    setSaving(null);
  };

  const handleRemove = async (resourceId: string) => {
    try {
      await api.admin.library.remove(resourceId);
      setResources((prev) => prev.filter((r) => r.resourceId !== resourceId));
    } catch { /* ignore */ }
  };

  const handleSaveFolder = async () => {
    if (!newFolderName.trim()) return;
    try { await api.admin.library.saveFolderMeta(newFolderName.trim(), newFolderColor); } catch { /* ignore */ }
    setFolderMeta((prev) => ({ ...prev, [newFolderName.trim()]: { color: newFolderColor } }));
    setShowFolderModal(false); setNewFolderName(''); setEditFolder(null);
  };

  const handleDeleteFolder = async (name: string) => {
    try { await api.admin.library.deleteFolder(name); } catch { /* ignore */ }
    setFolderMeta((prev) => { const n = { ...prev }; delete n[name]; return n; });
    setResources((prev) => prev.map((r) => r.folder === name ? { ...r, folder: DEFAULT_FOLDER } : r));
  };

  const handleUpdateResource = async () => {
    if (!movingResource) return;
    try {
      await api.admin.library.update(movingResource.resourceId, { folder: moveFolder || DEFAULT_FOLDER, courseIds: moveCourses });
      setResources((prev) => prev.map((r) => r.resourceId === movingResource.resourceId ? { ...r, folder: moveFolder || DEFAULT_FOLDER, courseIds: moveCourses } : r));
    } catch { /* ignore */ }
    setMovingResource(null);
  };

  // PDF viewer
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const isPdf = (url: string) => url.toLowerCase().includes('.pdf') || url.includes('arxiv.org/pdf') || url.includes('core.ac.uk');
  const openResource = (url: string) => {
    if (isPdf(url)) { setPdfUrl(url); }
    else { window.open(url, '_blank', 'noopener,noreferrer'); }
  };

  // Group resources by folder
  const allFolderNames = Array.from(new Set([DEFAULT_FOLDER, ...Object.keys(folderMeta), ...resources.map((r) => r.folder ?? DEFAULT_FOLDER)]));
  const grouped = allFolderNames.reduce<Record<string, LocalResource[]>>((acc, f) => {
    acc[f] = resources.filter((r) => (r.folder ?? DEFAULT_FOLDER) === f);
    return acc;
  }, {});

  const freeCount = results.filter((r) => r.openAccess).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-[#17527E] via-[#1A6494] to-[#0F3F62] px-6 py-8">
        <h1 className="text-2xl font-bold text-white">Biblioteca Unificada</h1>
        <p className="text-blue-200 text-sm mt-1">OpenAlex · arXiv · CORE · SciELO — gratuitos primero</p>
      </div>

      <div className="border-b border-gray-200 bg-white px-6">
        <div className="flex gap-6">
          {(['search', 'local'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-[#17527E] text-[#17527E]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t === 'search' ? 'Buscar' : `Mi Biblioteca${resources.length > 0 ? ` (${resources.length})` : ''}`}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">

        {/* ── SEARCH ──────────────────────────────────────────────────────────── */}
        {tab === 'search' && (
          <div className="space-y-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar artículos, papers, investigaciones…"
                className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#17527E]/20 focus:border-[#17527E] outline-none bg-white" />
              <button type="submit" disabled={searching || query.trim().length < 2}
                className="px-5 py-2.5 bg-gradient-to-r from-[#17527E] to-[#0F3F62] text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:from-[#1A6494] transition-all">
                {searching ? 'Buscando…' : 'Buscar'}
              </button>
            </form>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((s) => (
                <button key={s.key} onClick={() => setSources(s.key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${sources === s.key ? 'bg-[#17527E] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-[#17527E]/40'}`}>
                  {s.label}
                </button>
              ))}
            </div>
            {!searching && results.length > 0 && (
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>{results.length} resultados</span>
                <span className="flex items-center gap-1 text-green-600 font-medium"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />{freeCount} gratuitos</span>
                {results.length - freeCount > 0 && <span className="text-gray-400">{results.length - freeCount} restringidos</span>}
              </div>
            )}
            {searching && <div className="text-sm text-gray-400 text-center py-10">Consultando bases de datos académicas…</div>}
            {!searching && searched && results.length === 0 && <div className="text-sm text-gray-400 text-center py-10">Sin resultados</div>}
            {!searching && results.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {results.map((r) => {
                  const meta = SOURCE_META[r.source] ?? { color: '#64748b', bg: '#f8fafc', textClass: 'text-gray-600' };
                  const svgPath = SOURCE_SVG[r.source] ?? SOURCE_SVG['arXiv'];
                  return (
                    <div key={r.id} className={`bg-white rounded-xl border overflow-hidden flex flex-col ${r.openAccess ? 'border-green-100' : 'border-gray-200'}`}>
                      <div className="px-4 py-3 flex items-center gap-2.5" style={{ backgroundColor: meta.bg }}>
                        <div className="w-8 h-8 rounded-lg bg-white/70 flex items-center justify-center shrink-0">
                          <svg className={`w-5 h-5 ${meta.textClass}`} viewBox="0 0 24 24" fill="currentColor"><path d={svgPath} /></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-[10px] font-bold uppercase tracking-wide ${meta.textClass}`}>{r.source}</span>
                          {r.openAccess && <span className="ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Gratis</span>}
                        </div>
                        {r.year && <span className="text-[10px] text-gray-400 shrink-0">{r.year}</span>}
                      </div>
                      <div className="px-4 py-3 flex-1 flex flex-col gap-1.5">
                        <p className="text-xs font-semibold text-gray-800 line-clamp-3 leading-snug">{r.title}</p>
                        {r.authors.length > 0 && <p className="text-[11px] text-gray-400 line-clamp-1">{r.authors.join(', ')}{r.authors.length >= 3 ? ' et al.' : ''}</p>}
                        {r.doi && <p className="text-[9px] text-gray-300 font-mono truncate">{r.doi}</p>}
                      </div>
                      <div className="px-4 pb-3 flex gap-2">
                        {r.url ? (
                          <button onClick={() => openResource(r.url!)}
                            className="flex-1 text-center text-[11px] font-medium py-1.5 rounded-lg text-[#17527E] bg-[#17527E]/5 hover:bg-[#17527E]/10 transition-colors">
                            {r.openAccess ? 'Ver →' : '🔒 Ver →'}
                          </button>
                        ) : (
                          <span className="flex-1 text-center text-[11px] text-gray-300 py-1.5">Sin enlace</span>
                        )}
                        <button onClick={() => handleSave(r)} disabled={saved.has(r.id) || saving === r.id}
                          className={`flex-1 text-[11px] font-medium py-1.5 rounded-lg transition-colors ${saved.has(r.id) ? 'bg-green-50 text-green-600 cursor-default' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40'}`}>
                          {saving === r.id ? '…' : saved.has(r.id) ? '✓' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── MY LIBRARY ──────────────────────────────────────────────────────── */}
        {tab === 'local' && (
          <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{resources.length} recursos en {Object.keys(grouped).filter((f) => grouped[f].length > 0).length} carpeta(s)</p>
              <button onClick={() => { setEditFolder(null); setNewFolderName(''); setNewFolderColor(FOLDER_COLORS[0]); setShowFolderModal(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#17527E] bg-[#17527E]/5 hover:bg-[#17527E]/10 transition-colors">
                + Nueva carpeta
              </button>
            </div>

            {loadingLocal && <div className="text-sm text-gray-400 text-center py-8">Cargando…</div>}

            {/* Folders */}
            {allFolderNames.filter((f) => grouped[f]?.length > 0 || f === DEFAULT_FOLDER).map((folderName) => {
              const color = folderMeta[folderName]?.color ?? (folderName === DEFAULT_FOLDER ? '#64748b' : '#17527E');
              const items = grouped[folderName] ?? [];
              const isOpen = expandedFolder === folderName;
              return (
                <div key={folderName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Folder header */}
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedFolder(isOpen ? null : folderName)}>
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-sm font-semibold text-gray-800 flex-1">{folderName}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{items.length}</span>
                    {folderName !== DEFAULT_FOLDER && (
                      <button onClick={(e) => { e.stopPropagation(); setEditFolder(folderName); setNewFolderName(folderName); setNewFolderColor(color); setShowFolderModal(true); }}
                        className="text-xs text-gray-400 hover:text-[#17527E] px-1.5">✏️</button>
                    )}
                    {folderName !== DEFAULT_FOLDER && items.length === 0 && (
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folderName); }}
                        className="text-xs text-gray-300 hover:text-red-400 px-1.5">✕</button>
                    )}
                    <span className="text-gray-300 text-xs">{isOpen ? '▲' : '▼'}</span>
                  </div>

                  {/* Resources grid */}
                  {isOpen && (
                    <div className={`border-t border-gray-100 p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`}>
                      {items.length === 0 && <p className="col-span-3 text-xs text-gray-400 py-4 text-center">Carpeta vacía</p>}
                      {items.map((r) => {
                        const meta = r.source ? (SOURCE_META[r.source] ?? { color: '#64748b', bg: '#f8fafc', textClass: 'text-gray-600' }) : { color: '#64748b', bg: '#f8fafc', textClass: 'text-gray-600' };
                        const svgPath = r.source ? (SOURCE_SVG[r.source] ?? SOURCE_SVG['arXiv']) : SOURCE_SVG['arXiv'];
                        const assignedCourses = (r.courseIds ?? []).map((id) => courses.find((c) => c.id === id)?.title).filter(Boolean);
                        return (
                          <div key={r.resourceId} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
                            <div className="px-3 py-2.5 flex items-center gap-2" style={{ backgroundColor: meta.bg }}>
                              <div className="w-7 h-7 rounded-lg bg-white/70 flex items-center justify-center shrink-0">
                                <svg className={`w-4 h-4 ${meta.textClass}`} viewBox="0 0 24 24" fill="currentColor"><path d={svgPath} /></svg>
                              </div>
                              <span className={`text-[10px] font-bold uppercase tracking-wide flex-1 ${meta.textClass}`}>{r.source ?? 'Guardado'}</span>
                            </div>
                            <div className="px-3 py-2.5 flex-1">
                              <p className="text-xs font-semibold text-gray-800 line-clamp-2 leading-snug">{r.title}</p>
                              {r.description && <p className="text-[11px] text-gray-400 mt-1 line-clamp-1">{r.description}</p>}
                              {assignedCourses.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {assignedCourses.map((ct) => (
                                    <span key={ct} className="text-[9px] bg-[#17527E]/8 text-[#17527E] px-1.5 py-0.5 rounded-full">{ct}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="px-3 pb-2.5 flex gap-1.5">
                              <button onClick={() => openResource(r.fileUrl)}
                                className="flex-1 text-center text-[10px] font-medium py-1 rounded-lg text-[#17527E] bg-[#17527E]/5 hover:bg-[#17527E]/10">
                                {isPdf(r.fileUrl) ? '📄 Ver' : 'Ver'}
                              </button>
                              <button onClick={() => { setMovingResource(r); setMoveFolder(r.folder ?? DEFAULT_FOLDER); setMoveCourses(r.courseIds ?? []); }}
                                className="flex-1 text-[10px] font-medium py-1 rounded-lg text-gray-600 bg-gray-100 hover:bg-gray-200">Editar</button>
                              <button onClick={() => handleRemove(r.resourceId)}
                                className="text-[10px] font-medium py-1 px-1.5 rounded-lg text-red-400 hover:bg-red-50">✕</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── FOLDER MODAL ────────────────────────────────────────────────────── */}
      {showFolderModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-bold text-gray-800 mb-4">{editFolder ? 'Editar carpeta' : 'Nueva carpeta'}</h3>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">Nombre</label>
            <input type="text" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#17527E]/20 focus:border-[#17527E] outline-none mb-4" />
            <label className="text-xs font-medium text-gray-500 block mb-2">Color</label>
            <div className="flex flex-wrap gap-2 mb-5">
              {FOLDER_COLORS.map((c) => (
                <button key={c} onClick={() => setNewFolderColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform ${newFolderColor === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: newFolderColor }} />
              <span className="text-xs text-gray-600 font-medium">{newFolderName || 'Vista previa'}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowFolderModal(false); setEditFolder(null); }}
                className="flex-1 py-2 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">Cancelar</button>
              <button onClick={handleSaveFolder} disabled={!newFolderName.trim()}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#17527E] to-[#0F3F62] disabled:opacity-40">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PDF VIEWER MODAL ────────────────────────────────────────────────── */}
      {pdfUrl && (
        <div className="fixed inset-0 bg-black/70 flex flex-col z-50">
          <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 shrink-0">
            <p className="text-sm font-semibold text-gray-800 truncate max-w-lg">Vista previa — PDF</p>
            <div className="flex items-center gap-2">
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                Abrir en nueva pestaña ↗
              </a>
              <button onClick={() => setPdfUrl(null)} className="text-gray-400 hover:text-gray-700 text-lg leading-none ml-2">×</button>
            </div>
          </div>
          <iframe
            src={`https://docs.google.com/viewer?url=${encodeURIComponent(pdfUrl)}&embedded=true`}
            className="flex-1 w-full border-0"
            title="PDF viewer"
          />
        </div>
      )}

      {/* ── RESOURCE EDIT MODAL ─────────────────────────────────────────────── */}
      {movingResource && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-bold text-gray-800 mb-1">Organizar recurso</h3>
            <p className="text-xs text-gray-400 mb-4 line-clamp-2">{movingResource.title}</p>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">Carpeta</label>
            <select value={moveFolder} onChange={(e) => setMoveFolder(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#17527E]/20 focus:border-[#17527E] outline-none mb-4">
              <option value={DEFAULT_FOLDER}>{DEFAULT_FOLDER}</option>
              {Object.keys(folderMeta).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">Asignar a cursos (opcional)</label>
            <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50 mb-4">
              {courses.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">Sin cursos disponibles</p>}
              {courses.map((c) => (
                <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={moveCourses.includes(c.id)}
                    onChange={() => setMoveCourses((prev) => prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                    className="rounded border-gray-300 text-[#17527E] focus:ring-[#17527E]" />
                  <span className="text-xs text-gray-700">{c.title}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setMovingResource(null)} className="flex-1 py-2 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">Cancelar</button>
              <button onClick={handleUpdateResource} className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#17527E] to-[#0F3F62]">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
