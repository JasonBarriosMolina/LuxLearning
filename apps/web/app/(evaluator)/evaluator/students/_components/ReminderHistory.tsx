'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ReminderEntry } from './types';
import { formatReminderAge } from './helpers';

export function ReminderHistory({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<ReminderEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.evaluator.getReminderHistory(userId)
      .then((res: any) => setEntries(Array.isArray(res) ? res : (res?.data ?? [])))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <p className="text-xs text-gray-400 py-2">Cargando historial…</p>;
  if (!entries || entries.length === 0) return <p className="text-xs text-gray-400 py-2">Sin historial de recordatorios.</p>;

  return (
    <ul className="space-y-1.5">
      {entries.map((e, i) => (
        <li key={i} className="flex items-center gap-2 text-xs text-gray-600">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${e.type === 'auto' ? 'bg-blue-100 text-blue-600' : 'bg-violet-100 text-violet-600'}`}>
            {e.type === 'auto' ? '⚙' : '👤'}
          </span>
          <span className="font-medium">{e.type === 'auto' ? 'Sistema' : e.sentBy}</span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-400">{formatReminderAge(e.sentAt)}</span>
          {e.courseTitle && <span className="text-gray-400 truncate">· {e.courseTitle}</span>}
        </li>
      ))}
    </ul>
  );
}
