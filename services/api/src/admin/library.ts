// Biblioteca Unificada — searches OpenAlex, arXiv, CORE, SciELO in parallel; local save via LuxResources.
import { AdminCtx } from './ctx';
import { saveResource, getResourcesByEvaluator, updateResource } from '../shared/db-tasks';
import { ok, badRequest } from '../shared/response';

export interface LibraryResult {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  source: string;
  url?: string;
  doi?: string;
  abstract?: string;
  openAccess: boolean;
}

const MAIL = 'info@luxlearning.academy';

async function searchOpenAlex(query: string): Promise<LibraryResult[]> {
  try {
    const res = await fetch(
      `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=8&mailto=${MAIL}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.results ?? []).map((w: any): LibraryResult => ({
      id: w.id ?? '',
      title: w.title ?? '',
      authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean).slice(0, 3),
      year: w.publication_year ?? undefined,
      source: 'OpenAlex',
      url: w.open_access?.oa_url ?? (w.doi ? `https://doi.org/${w.doi}` : undefined),
      doi: w.doi ?? undefined,
      openAccess: !!(w.open_access?.is_oa),
    }));
  } catch { return []; }
}

async function searchArxiv(query: string): Promise<LibraryResult[]> {
  try {
    const res = await fetch(
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=8&sortBy=relevance`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const text = await res.text();
    const entries = text.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];
    return entries.slice(0, 8).map((entry): LibraryResult => {
      const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim().replace(/\n\s+/g, ' ') ?? '';
      const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? '';
      const published = entry.match(/<published>(.*?)<\/published>/)?.[1]?.trim() ?? '';
      const abstract = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim().slice(0, 300) ?? '';
      const authors = [...entry.matchAll(/<name>(.*?)<\/name>/g)].map((m) => m[1]).slice(0, 3);
      return {
        id: `arxiv:${id}`,
        title,
        authors,
        year: published ? parseInt(published.slice(0, 4)) : undefined,
        source: 'arXiv',
        url: id.includes('arxiv.org') ? id.replace('http://', 'https://') : undefined,
        openAccess: true,
        abstract,
      };
    });
  } catch { return []; }
}

async function searchCORE(query: string): Promise<LibraryResult[]> {
  const apiKey = process.env.CORE_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(
      `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(query)}&limit=8`,
      { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.results ?? []).map((w: any): LibraryResult => ({
      id: `core:${w.id}`,
      title: w.title ?? '',
      authors: (w.authors ?? []).map((a: any) => a.name ?? a).filter(Boolean).slice(0, 3),
      year: w.yearPublished ?? undefined,
      source: 'CORE',
      url: w.downloadUrl ?? w.sourceFulltextUrls?.[0] ?? undefined,
      doi: w.doi ?? undefined,
      openAccess: true,
      abstract: w.abstract?.slice(0, 300) ?? undefined,
    }));
  } catch { return []; }
}

async function searchSciELO(query: string): Promise<LibraryResult[]> {
  try {
    const res = await fetch(
      `https://search.scielo.org/?q=${encodeURIComponent(query)}&format=json&count=8&lang=es`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const data: any = await res.json();
    const articles = data?.response?.docs ?? [];
    return articles.slice(0, 8).map((a: any): LibraryResult => ({
      id: `scielo:${a.id ?? a.pid ?? ''}`,
      title: Array.isArray(a.ti) ? a.ti[0] : (a.ti ?? ''),
      authors: (a.au ?? []).slice(0, 3),
      year: a.da ? parseInt(String(a.da).slice(0, 4)) : undefined,
      source: 'SciELO',
      url: a.ur?.[0] ? `https://www.scielo.org/pdf/${a.ur[0]}` : undefined,
      doi: a.doi ?? undefined,
      openAccess: true,
    }));
  } catch { return []; }
}

export async function handleLibrary(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, userId } = ctx;

  // ── GET /admin/library/search?q=...&sources=openalex,arxiv,core,scielo ────────
  if (method === 'GET' && path === '/admin/library/search') {
    const q = event.queryStringParameters?.q?.trim();
    if (!q || q.length < 2) return badRequest('q (mínimo 2 caracteres) requerido');
    const sourcesParam = event.queryStringParameters?.sources ?? 'openalex,arxiv,core,scielo';
    const sources = sourcesParam.split(',').map((s) => s.trim().toLowerCase());

    const searches: Promise<LibraryResult[]>[] = [];
    if (sources.includes('openalex') || sources.includes('all')) searches.push(searchOpenAlex(q));
    if (sources.includes('arxiv') || sources.includes('all')) searches.push(searchArxiv(q));
    if (sources.includes('core') || sources.includes('all')) searches.push(searchCORE(q));
    if (sources.includes('scielo') || sources.includes('all')) searches.push(searchSciELO(q));

    const batches = await Promise.allSettled(searches);
    const results: LibraryResult[] = batches.flatMap((b) => b.status === 'fulfilled' ? b.value : []);
    return ok({ results, count: results.length });
  }

  // ── GET /admin/library/local — saved resources in LuxResources ────────────────
  if (method === 'GET' && path === '/admin/library/local') {
    const all = await getResourcesByEvaluator(userId!);
    const library = all.filter((r) => !r.archived && r.folder === '__library__');
    return ok(library);
  }

  // ── POST /admin/library/save — save external result as local resource ─────────
  if (method === 'POST' && path === '/admin/library/save') {
    const { title, authors, year, source, url, doi, abstract } = ctx.body as any;
    if (!title || !url) return badRequest('title y url requeridos');
    const now = new Date().toISOString();
    const resource = {
      evaluatorId: userId!,
      resourceId: `lib-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: String(title).slice(0, 200),
      description: [
        authors?.length ? `Autores: ${authors.join(', ')}` : '',
        year ? `Año: ${year}` : '',
        doi ? `DOI: ${doi}` : '',
        abstract ? abstract.slice(0, 300) : '',
      ].filter(Boolean).join(' | ').slice(0, 500),
      fileUrl: String(url),
      fileName: String(title).slice(0, 100),
      fileType: 'link/external',
      folder: '__library__',
      courseIds: [],
      archived: false,
      source: String(source ?? ''),
      createdAt: now,
      updatedAt: now,
    };
    await saveResource(resource as any);
    return ok({ saved: true, resourceId: resource.resourceId });
  }

  // ── DELETE /admin/library/local/:resourceId ───────────────────────────────────
  const libDeleteMatch = path.match(/^\/admin\/library\/local\/([^/]+)$/);
  if (libDeleteMatch && method === 'DELETE') {
    const resourceId = libDeleteMatch[1]!;
    const ttl = Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60;
    await updateResource(userId!, resourceId, { archived: true, ttl, updatedAt: new Date().toISOString() });
    return ok({ removed: true });
  }

  return null;
}
