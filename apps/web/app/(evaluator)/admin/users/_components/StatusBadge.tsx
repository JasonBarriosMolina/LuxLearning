'use client';

interface Props {
  status: string;
  enabled: boolean;
  labels?: { disabled: string; pending: string; active: string };
}

export function StatusBadge({ status, enabled, labels }: Props) {
  const l = labels ?? { disabled: 'Desactivado', pending: 'Pendiente activación', active: 'Activo' };
  if (!enabled)
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">{l.disabled}</span>;
  if (status === 'FORCE_CHANGE_PASSWORD')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{l.pending}</span>;
  if (status === 'CONFIRMED')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">{l.active}</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">{status}</span>;
}
