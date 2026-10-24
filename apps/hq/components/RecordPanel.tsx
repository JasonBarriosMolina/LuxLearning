'use client';

import { useState, type FormEvent } from 'react';
import { Loader2, UserCheck, UserMinus } from 'lucide-react';
import type { HistoryItem, Note } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { findStatus, formatDateTime, type StatusDef } from '@/lib/statuses';

export function StatusBadge({ statuses, value }: { statuses: StatusDef[]; value: string }) {
  const s = findStatus(statuses, value);
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${s.tone}`}>{s.label}</span>;
}

/** Right-hand panel on a record: status, owner, notes and history. */
export function RecordPanel({ statuses, status, owner, notes, history, onUpdate, onAddNote }: {
  statuses: StatusDef[];
  status: string;
  owner: string | null;
  notes: Note[];
  history: HistoryItem[];
  onUpdate: (patch: { status?: string; ownerEmail?: string | null }) => Promise<void>;
  onAddNote: (body: string) => Promise<void>;
}) {
  const { staff } = useAuth();
  const [saving, setSaving] = useState<'status' | 'owner' | 'note' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const act = async (kind: 'status' | 'owner' | 'note', fn: () => Promise<void>) => {
    setSaving(kind);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos guardar el cambio.');
    } finally {
      setSaving(null);
    }
  };

  const submitNote = (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return setError('Escribe la nota antes de guardarla.');
    act('note', async () => { await onAddNote(note.trim()); setNote(''); });
  };

  const mine = owner && staff && owner === staff.email;

  return (
    <aside className="space-y-5">
      <section className="card p-5">
        <label className="block text-sm font-bold text-navy">
          Estado
          <div className="relative">
            <select
              className="field appearance-none pr-10"
              value={status}
              disabled={saving === 'status'}
              onChange={(e) => act('status', () => onUpdate({ status: e.target.value }))}
            >
              {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {saving === 'status' && <Loader2 className="absolute right-3 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 animate-spin text-royal" aria-hidden="true" />}
          </div>
        </label>

        <div className="mt-5">
          <p className="text-sm font-bold text-navy">Responsable</p>
          <p className="mt-1 truncate text-sm text-muted">{owner ?? 'Sin asignar'}</p>
          <button
            type="button"
            className="btn-ghost mt-2.5 w-full"
            disabled={saving === 'owner'}
            onClick={() => act('owner', () => onUpdate({ ownerEmail: mine ? null : staff!.email }))}
          >
            {saving === 'owner' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : mine ? <UserMinus className="h-4 w-4" aria-hidden="true" /> : <UserCheck className="h-4 w-4" aria-hidden="true" />}
            {mine ? 'Quitarme como responsable' : 'Asignármelo'}
          </button>
        </div>
        {error && <p className="mt-4 rounded-xl bg-[#FEF3F2] px-3 py-2.5 text-sm font-medium text-[#B42318]" role="alert">{error}</p>}
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-bold text-navy">Notas</h2>
        <form onSubmit={submitNote} className="mt-2">
          <label className="sr-only" htmlFor="note">Nueva nota</label>
          <textarea id="note" className="field mt-0" rows={3} placeholder="Ej.: Llamé el martes, prefiere demo el jueves en la tarde." value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="btn-primary mt-2.5 w-full" disabled={saving === 'note'}>
            {saving === 'note' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Guardar nota
          </button>
        </form>
        {notes.length > 0 && (
          <ul className="mt-5 space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="rounded-xl bg-canvas p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{n.body}</p>
                <p className="mt-1.5 text-xs text-soft">{n.author_email} · {formatDateTime(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-bold text-navy">Historial</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Aún no hay cambios de estado.</p>
        ) : (
          <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">
            {history.map((h, i) => (
              <li key={i} className="text-sm">
                <p className="font-semibold text-ink">
                  {h.from_status ? `${findStatus(statuses, h.from_status).label} → ` : ''}{findStatus(statuses, h.to_status).label}
                </p>
                <p className="text-xs text-soft">{h.changed_by} · {formatDateTime(h.changed_at)}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
