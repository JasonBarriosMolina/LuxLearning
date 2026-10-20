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

const SOURCE_COLORS: Record<string, string> = {
  OpenAlex: 'bg-blue-100 text-blue-700',
  arXiv: 'bg-red-100 text-red-700',
  CORE: 'bg-green-100 text-green-700',
  SciELO: 'bg-amber-100 text-amber-700',
};

const SOURCES = [
  { key: 'openalex,arxiv,core,scielo', label: 'Todas' },
  { key: 'openalex', label: 'OpenAlex' },
  { key: 'arxiv', label: 'arXiv' },
  { key: 'core', label: 'CORE' },
  { key: 'scielo', label: 'SciELO' },
];

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
      setResults(r.data?.results ?? []);
    } catch { setResults([]); }
    setSearching(false);
    setSearched(true);
  };

  const handleSave = async (result: LibraryResult) => {
    if (saved.has(result.id) || !result.url) return;
    setSaving(result.id);
    try {
      await api.admin.library.save({
        title: result.title,
        authors: result.authors,
        year: result.year,
        source: result.source,
        url: result.url,
        doi: result.doi,
        abstract: result.abstract,
      });
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#17527E] via-[#1A6494] to-[#0F3F62] px-6 py-8">
        <h1 className="text-2xl font-bold text-white">Biblioteca Unificada</h1>
        <p className="text-blue-200 text-sm mt-1">
          Busca en OpenAlex · arXiv · CORE · SciELO y guarda recursos en tu biblioteca
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="flex gap-6">
          {(['search', 'local'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t ? 'border-[#17527E] text-[#17527E]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'search' ? 'Buscar' : `Mi Biblioteca${localResources.length > 0 ? ` (${localResources.length})` : ''}`}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">

        {/* ── SEARCH TAB ──────────────────────────────────────────────────────── */}
        {tab === 'search' && (
          <div className="space-y-4">
            {/* Search form */}
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar artículos, papers, investigaciones…"
                className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#17527E]/20 focus:border-[#17527E] outline-none bg-white"
              />
              <button
                type="submit"
                disabled={searching || query.trim().length < 2}
                className="px-5 py-2.5 bg-gradient-to-r from-[#17527E] to-[#0F3F62] text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:from-[#1A6494] hover:to-[#17527E] transition-all"
              >
                {searching ? 'Buscando…' : 'Buscar'}
              </button>
            </form>

            {/* Source chips */}
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSources(s.key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    sources === s.key
                      ? 'bg-[#17527E] text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-[#17527E]/40'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Results */}
            {searching && (
              <div className="text-sm text-gray-400 text-center py-10">Consultando bases de datos académicas…</div>
            )}
            {!searching && searched && results.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-10">Sin resultados para esta búsqueda</div>
            )}
            {!searching && results.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">{results.length} resultados</p>
                {results.map((r) => (
                  <div key={r.id} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[r.source] ?? 'bg-gray-100 text-gray-600'}`}>
                            {r.source}
                          </span>
                          {r.openAccess && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-600">
                              Acceso abierto
                            </span>
                          )}
                          {r.year && <span className="text-xs text-gray-400">{r.year}</span>}
                        </div>
                        <p className="text-sm font-medium text-gray-800 leading-snug line-clamp-2">{r.title}</p>
                        {r.authors.length > 0 && (
                          <p className="text-xs text-gray-500 mt-1">{r.authors.join(', ')}{r.authors.length >= 3 ? ' et al.' : ''}</p>
                        )}
                        {r.abstract && (
                          <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">{r.abstract}</p>
                        )}
                        {r.doi && <p className="text-[10px] text-gray-300 mt-1">DOI: {r.doi}</p>}
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        {r.url && (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[#17527E] font-medium hover:underline whitespace-nowrap"
                          >
                            Ver →
                          </a>
                        )}
                        <button
                          onClick={() => handleSave(r)}
                          disabled={saved.has(r.id) || saving === r.id || !r.url}
                          className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap ${
                            saved.has(r.id)
                              ? 'bg-green-50 text-green-600 cursor-default'
                              : 'bg-[#17527E]/5 text-[#17527E] hover:bg-[#17527E]/10 disabled:opacity-40'
                          }`}
                        >
                          {saving === r.id ? '…' : saved.has(r.id) ? '✓ Guardado' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── LOCAL TAB ───────────────────────────────────────────────────────── */}
        {tab === 'local' && (
          <div className="space-y-3">
            {loadingLocal && <div className="text-sm text-gray-400 text-center py-8">Cargando…</div>}
            {!loadingLocal && localResources.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-8">
                Tu biblioteca está vacía — guarda artículos desde la búsqueda
              </div>
            )}
            {localResources.map((r) => (
              <div key={r.resourceId} className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  {r.source && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full mr-2 ${SOURCE_COLORS[r.source] ?? 'bg-gray-100 text-gray-600'}`}>
                      {r.source}
                    </span>
                  )}
                  <p className="text-sm font-medium text-gray-800 mt-1 line-clamp-2">{r.title}</p>
                  {r.description && (
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{r.description}</p>
                  )}
                  <p className="text-[10px] text-gray-300 mt-1">
                    {new Date(r.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <a
                    href={r.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#17527E] font-medium hover:underline"
                  >
                    Ver →
                  </a>
                  <button
                    onClick={() => handleRemove(r.resourceId)}
                    disabled={removingId === r.resourceId}
                    className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                  >
                    {removingId === r.resourceId ? '…' : 'Quitar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
