'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Loads one record and renders the back link; children get the data and a reload function. */
export function DetailShell<T>({ backHref, backLabel, load, children }: {
  backHref: string;
  backLabel: string;
  load: () => Promise<T>;
  children: (data: T, reload: () => Promise<void>) => ReactNode;
}) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setData(await load());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { await signOut(); router.replace('/login'); return; }
      setError(err instanceof Error ? err.message : 'No pudimos cargar el registro.');
    }
  }, [load, router, signOut]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div>
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-bold text-lux hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {backLabel}
      </Link>
      <div className="mt-5">
        {error ? (
          <p className="rounded-xl bg-[#FEF3F2] px-4 py-3 text-sm font-medium text-[#B42318]" role="alert">{error}</p>
        ) : data === null ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-royal" aria-label="Cargando" /></div>
        ) : (
          children(data, reload)
        )}
      </div>
    </div>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="text-[15px] leading-relaxed text-ink">{children}</dd>
    </div>
  );
}
