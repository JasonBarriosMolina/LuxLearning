'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, X, Send, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { MiniMarkdown } from './MiniMarkdown';

type Msg = { role: 'user' | 'assistant'; content: string; error?: boolean };

const SUGGESTIONS = [
  '¿Cuál fue el último error en CloudWatch en test?',
  '¿Cómo están las Lambdas de prod en las últimas 24 horas?',
  '¿Qué ambiente está gastando más y por qué?',
  'Explícame cómo funciona la generación de cursos con IA',
];

const POLL_MS = 2500;
const MAX_POLLS = 96; // ~4 min (tool rounds can chain several CloudWatch queries)

export function CostChat({ days }: { days: number }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy, open]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = msgs.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: q }]);
    setInput('');
    setBusy(true);
    setProgress([]);
    try {
      const { jobId } = await api.admin.costsChat.send({ question: q, history, days });
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const job = await api.admin.costsChat.job(jobId);
        if (job.status === 'done') { setMsgs((m) => [...m, { role: 'assistant', content: job.result?.answer ?? '' }]); return; }
        if (job.status === 'error') throw new Error(job.error ?? 'Error generando la respuesta');
        if (Array.isArray(job.progress)) setProgress(job.progress);
      }
      throw new Error('La respuesta tardó demasiado. Intenta de nuevo.');
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: e?.message ?? 'Error inesperado', error: true }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full px-5 py-3 shadow-lg text-sm font-medium">
        <Sparkles className="w-4 h-4" /> Preguntar a la IA
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] sm:w-[440px] h-[min(640px,calc(100vh-2rem))] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-indigo-600 text-white">
        <div className="flex items-center gap-2"><MessageSquare className="w-4 h-4" /><span className="font-semibold text-sm">Asistente Lux · Sonnet</span></div>
        <div className="flex items-center gap-1">
          {msgs.length > 0 && <button onClick={() => setMsgs([])} disabled={busy} title="Limpiar conversación" className="p-1.5 hover:bg-white/20 rounded disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>}
          <button onClick={() => setOpen(false)} title="Cerrar" className="p-1.5 hover:bg-white/20 rounded"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {msgs.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Pregúntame lo que quieras de Lux Learning y sus 3 ambientes (test, staging, prod): cómo funciona, costos, errores recientes en CloudWatch, salud de las Lambdas, tablas. Consulto datos reales en modo solo lectura.</p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="text-left text-sm bg-white border border-gray-200 hover:border-indigo-300 rounded-lg px-3 py-2 text-gray-700">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 ${m.role === 'user' ? 'bg-indigo-600 text-white text-sm' : m.error ? 'bg-red-50 text-red-700 text-sm' : 'bg-white border border-gray-100 shadow-sm'}`}>
              {m.role === 'assistant' && !m.error ? <MiniMarkdown text={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="text-sm text-gray-500 space-y-1">
            <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {progress.length ? progress[progress.length - 1] : 'Pensando…'}</div>
            {progress.length > 1 && <p className="text-xs text-gray-400 pl-6">{progress.slice(0, -1).join(' · ')}</p>}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="p-3 border-t border-gray-100 flex gap-2 bg-white">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe tu pregunta…" maxLength={2000} disabled={busy}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none disabled:bg-gray-50" />
        <button type="submit" disabled={busy || !input.trim()} className="p-2.5 bg-indigo-600 text-white rounded-lg disabled:opacity-40"><Send className="w-4 h-4" /></button>
      </form>
    </div>
  );
}
