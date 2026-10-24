'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Inbox, Loader2, Search } from 'lucide-react';
import { ApiError, type Counts } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { StatusDef } from '@/lib/statuses';

export type Column<T> = { header: string; cell: (row: T) => ReactNode; className?: string };

/** Shared tray for both pipelines: status tabs with counts, search, table (desktop) / cards (mobile). */
export function PipelineList<T extends { id: string; status: string }>({ title, intro, statuses, load, columns, primary, secondary, hrefFor, emptyText }: {
  title: string;
  intro: string;
  statuses: StatusDef[];
  load: (p: { status?: string; q?: string }) => Promise<{ rows: T[]; counts: Counts }>;
  columns: Column<T>[];
  primary: (row: T) => ReactNode;
  secondary: (row: T) => ReactNode;
  hrefFor: (row: T) => string;
  emptyText: string;
}) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [status, setStatus] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<T[] | null>(null);
  const [counts, setCounts] = useState<Counts>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError('');
    load({ status, q: debounced || undefined })
      .then((r) => { if (alive) { setRows(r.rows); setCounts(r.counts); } })
      .catch(async (err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 401) { await signOut(); router.replace('/login'); return; }
        setError(err instanceof Error ? err.message : 'No pudimos cargar la bandeja.');
        setRows([]);
      });
    return () => { alive = false; };
  }, [status, debounced, load, router, signOut]);

  const total = useMemo(() => counts.reduce((n, c) => n + c.total, 0), [counts]);
  const countOf = (s: string) => counts.find((c) => c.status === s)?.total ?? 0;
  const tabs = [{ value: undefined, label: 'Todos', count: total }, ...statuses.map((s) => ({ value: s.value, label: s.label, count: countOf(s.value) }))];

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-navy">{title}</h1>
      <p className="mt-1.5 text-muted">{intro}</p>

      <div className="mt-7 flex flex-col gap-4">
        <div role="tablist" aria-label="Filtrar por estado" className="flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
          {tabs.map((t) => {
            const on = t.value === status;
            return (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setStatus(t.value)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-bold transition-colors ${
                  on ? 'bg-lux text-white' : 'bg-white text-muted ring-1 ring-line hover:text-navy'
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 text-xs ${on ? 'bg-white/20' : 'bg-ice text-lux'}`}>{t.count}</span>
              </button>
            );
          })}
        </div>
        <label className="relative block sm:max-w-md">
          <span className="sr-only">Buscar</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" aria-hidden="true" />
          <input className="field mt-0 pl-10" placeholder="Buscar por nombre, correo o tema" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {error && <p className="mt-6 rounded-xl bg-[#FEF3F2] px-4 py-3 text-sm font-medium text-[#B42318]" role="alert">{error}</p>}

      <div className="card mt-5 overflow-hidden">
        {rows === null ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-royal" aria-label="Cargando" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Inbox className="h-10 w-10 text-soft" aria-hidden="true" />
            <p className="mt-3 font-bold text-navy">{debounced || status ? 'Nada coincide con este filtro' : emptyText}</p>
          </div>
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-line bg-canvas text-xs font-bold text-muted">
                <tr>
                  {columns.map((c) => <th key={c.header} scope="col" className={`px-5 py-3 ${c.className ?? ''}`}>{c.header}</th>)}
                  <th scope="col" className="w-10 px-5 py-3"><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} className="cursor-pointer transition-colors hover:bg-ice/60" onClick={() => router.push(hrefFor(row))}>
                    {columns.map((c) => <td key={c.header} className={`px-5 py-4 align-top ${c.className ?? ''}`}>{c.cell(row)}</td>)}
                    <td className="px-5 py-4 align-top">
                      <Link href={hrefFor(row)} className="text-soft hover:text-lux" aria-label="Abrir" onClick={(e) => e.stopPropagation()}>
                        <ChevronRight className="h-5 w-5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link href={hrefFor(row)} className="flex items-center gap-3 px-4 py-4">
                    <div className="min-w-0 flex-1">
                      {primary(row)}
                      <div className="mt-1.5">{secondary(row)}</div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-soft" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
