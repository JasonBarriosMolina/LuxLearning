'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

interface LibraryResult {
  id: string; title: string; authors: string[]; year?: number;
  source: string; url?: string; doi?: string; abstract?: string; openAccess: boolean;
}

interface LocalResource {
  resourceId: string; title: string; description?: string;
  fileUrl: string; source?: string; createdAt: string;
}

const SOURCE_META: Record<string, { color: string; bg: string; icon: string }> = {
  OpenAlex: { color: 'text-blue-700',   bg: 'bg-blue-50',   icon: '🔵' },
  arXiv:    { color: 'text-red-700',    bg: 'bg-red-50',    icon: '📄' },
  CORE:     { color: 'text-green-700',  bg: 'bg-green-50',  icon: '🟢' },
  SciELO:   { color: 'text-amber-700',  bg: 'bg-amber-50',  icon: '🌐' },
};

const SOURCE_ILLUS: Record<string, string> = {
  OpenAlex: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z',
  arXiv:    'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  CORE:     'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  SciELO:   'M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z',
};

const SOURCES = [
  { key: 'openalex,arxiv,core,scielo', label: 'Todas' },
  { key: 'openalex', label: 'OpenAlex' },
  { key: 'arxiv', label: 'arXiv' },
  { key: 'core', label: 'CORE' },
  { key: 'scielo', label: 'SciELO' },
];

function sortResults(results: LibraryResult[]): LibraryResult[] {
  return [...results].sort((a, b) => {
    if (a.openAccess && !b.openAccess) return -1;
    if (!a.openAccess && b.openAccess) return 1;
    return 0;
  });
}

export default function LibraryPage() {
  const [tab, setTab] = useState<'search' | 'local'>('search');
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState('openalex,arxiv,core,scielo');
  const [results, setResults] = useState<LibraryResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [localResources, setLocalResources] = useState<LocalResource[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (tab !== 'local') return;
    setLoadingLocal(true);
    api.admin.library.local().then((r: any) => setLocalResources(r.data ?? [])).catch(() => {}).finally(() => setLoadingLocal(false));
  }, [tab]);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || query.trim().length < 2) return;
    setSearching(true);
    setSearched(false);
    try {
      const r: any = await api.admin.library.search(query.trim(), sources);
      setResults(sortResults(r.data?.results ?? []));
    } catch { setResults([]); }
    setSearching(false);
    setSearched(true);
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
    setRemovingId(resourceId);
    try {
      await api.admin.library.remove(resourceId);
      setLocalResources((prev) => prev.filter((r) => r.resourceId !== resourceId));
    } catch { /* ignore */ }
    setRemovingId(null);
  };

  const freeCount = results.filter((r) => r.openAccess).length;
  const paidCount = results.length - freeCount;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#17527E] via-[#1A6494] to-[#0F3F62] px-6 py-8">
        <h1 className="text-2xl font-bold text-white">Biblioteca Unificada</h1>
        <p className="text-blue-200 text-sm mt-1">OpenAlex · arXiv · CORE · SciELO — gratuitos primero</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="flex gap-6">
          {(['search', 'local'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-[#17527E] text-[#17527E]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t === 'search' ? 'Buscar' : `Mi Biblioteca${localResources.length > 0 ? ` (${localResources.length})` : ''}`}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">

        {/* ── SEARCH TAB ──────────────────────────────────────────────────────── */}
        {tab === 'search' && (
          <div className="space-y-4">
            {/* Search form */}
            <form onSubmit={handleSearch} className="flex gap-2">
              <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar artículos, papers, investigaciones…"
                className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#17527E]/20 focus:border-[#17527E] outline-none bg-white" />
              <button type="submit" disabled={searching || query.trim().length < 2}
                className="px-5 py-2.5 bg-gradient-to-r from-[#17527E] to-[#0F3F62] text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:from-[#1A6494] hover:to-[#17527E] transition-all">
                {searching ? 'Buscando…' : 'Buscar'}
              </button>
            </form>

            {/* Source chips */}
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((s) => (
                <button key={s.key} onClick={() => setSources(s.key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${sources === s.key ? 'bg-[#17527E] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-[#17527E]/40'}`}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Stats */}
            {!searching && results.length > 0 && (
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>{results.length} resultados</span>
                <span className="flex items-center gap-1 text-green-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                  {freeCount} gratuitos
                </span>
                {paidCount > 0 && (
                  <span className="flex items-center gap-1 text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
                    {paidCount} restringidos
                  </span>
                )}
              </div>
            )}

            {searching && <div className="text-sm text-gray-400 text-center py-10">Consultando bases de datos académicas…</div>}
            {!searching && searched && results.length === 0 && <div className="text-sm text-gray-400 text-center py-10">Sin resultados</div>}

            {/* 3-column grid */}
            {!searching && results.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {results.map((r) => {
                  const meta = SOURCE_META[r.source] ?? { color: 'text-gray-600', bg: 'bg-gray-50', icon: '📖' };
                  const path = SOURCE_ILLUS[r.source] ?? SOURCE_ILLUS['arXiv'];
                  return (
                    <div key={r.id} className={`bg-white rounded-xl border overflow-hidden flex flex-col ${r.openAccess ? 'border-green-100' : 'border-gray-200'}`}>
                      {/* Illustration strip */}
                      <div className={`px-4 py-3 flex items-center gap-2.5 ${meta.bg}`}>
                        <div className="w-8 h-8 rounded-lg bg-white/70 flex items-center justify-center shrink-0">
                          <svg className={`w-5 h-5 ${meta.color}`} viewBox="0 0 24 24" fill="currentColor">
                            <path d={path} />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-[10px] font-bold uppercase tracking-wide ${meta.color}`}>{r.source}</span>
                          {r.openAccess && (
                            <span className="ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Gratis</span>
                          )}
                        </div>
                        {r.year && <span className="text-[10px] text-gray-400 shrink-0">{r.year}</span>}
                      </div>

                      {/* Content */}
                      <div className="px-4 py-3 flex-1 flex flex-col gap-2">
                        <p className="text-xs font-semibold text-gray-800 line-clamp-3 leading-snug">{r.title}</p>
                        {r.authors.length > 0 && (
                          <p className="text-[11px] text-gray-400 line-clamp-1">{r.authors.join(', ')}{r.authors.length >= 3 ? ' et al.' : ''}</p>
                        )}
                        {r.doi && <p className="text-[9px] text-gray-300 font-mono truncate">{r.doi}</p>}
                      </div>

                      {/* Actions */}
                      <div className="px-4 pb-3 flex gap-2">
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noopener noreferrer"
                            className="flex-1 text-center text-[11px] font-medium py-1.5 rounded-lg text-[#17527E] bg-[#17527E]/5 hover:bg-[#17527E]/10 transition-colors">
                            Ver →
                          </a>
                        )}
                        <button onClick={() => handleSave(r)}
                          disabled={saved.has(r.id) || saving === r.id || !r.url}
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

        {/* ── LOCAL TAB ───────────────────────────────────────────────────────── */}
        {tab === 'local' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {loadingLocal && <div className="col-span-3 text-sm text-gray-400 text-center py-8">Cargando…</div>}
            {!loadingLocal && localResources.length === 0 && (
              <div className="col-span-3 text-sm text-gray-400 text-center py-8">Tu biblioteca está vacía — guarda artículos desde la búsqueda</div>
            )}
            {localResources.map((r) => {
              const meta = r.source ? (SOURCE_META[r.source] ?? { color: 'text-gray-600', bg: 'bg-gray-50', icon: '📖' }) : { color: 'text-gray-600', bg: 'bg-gray-50', icon: '📖' };
              const path = r.source ? (SOURCE_ILLUS[r.source] ?? SOURCE_ILLUS['arXiv']) : SOURCE_ILLUS['arXiv'];
              return (
                <div key={r.resourceId} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
                  <div className={`px-4 py-3 flex items-center gap-2.5 ${meta.bg}`}>
                    <div className="w-8 h-8 rounded-lg bg-white/70 flex items-center justify-center shrink-0">
                      <svg className={`w-5 h-5 ${meta.color}`} viewBox="0 0 24 24" fill="currentColor">
                        <path d={path} />
                      </svg>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wide ${meta.color}`}>{r.source ?? 'Biblioteca'}</span>
                  </div>
                  <div className="px-4 py-3 flex-1">
                    <p className="text-xs font-semibold text-gray-800 line-clamp-3 leading-snug">{r.title}</p>
                    {r.description && <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">{r.description}</p>}
                    <p className="text-[10px] text-gray-300 mt-1">
                      {new Date(r.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="px-4 pb-3 flex gap-2">
                    <a href={r.fileUrl} target="_blank" rel="noopener noreferrer"
                      className="flex-1 text-center text-[11px] font-medium py-1.5 rounded-lg text-[#17527E] bg-[#17527E]/5 hover:bg-[#17527E]/10 transition-colors">
                      Ver →
                    </a>
                    <button onClick={() => handleRemove(r.resourceId)} disabled={removingId === r.resourceId}
                      className="flex-1 text-[11px] font-medium py-1.5 rounded-lg text-red-400 bg-red-50 hover:bg-red-100 disabled:opacity-40 transition-colors">
                      {removingId === r.resourceId ? '…' : 'Quitar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
