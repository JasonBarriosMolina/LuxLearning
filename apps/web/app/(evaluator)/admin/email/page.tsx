'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

interface Recipient { userId: string; name: string; email: string }
interface Course { id: string; title: string }
interface SentEmail {
  emailId: string; subject: string; sentAt: string;
  recipientCount: number; status: 'sent' | 'failed'; to: string[];
}

export default function EmailPage() {
  const [tab, setTab] = useState<'compose' | 'sent'>('compose');

  // Compose state
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseFilter, setCourseFilter] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Sent state
  const [sent, setSent] = useState<SentEmail[]>([]);
  const [loadingSent, setLoadingSent] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.admin.email.courses().then((r: any) => setCourses(r.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'sent') return;
    setLoadingSent(true);
    api.admin.email.sent().then((r: any) => setSent(r.data ?? [])).catch(() => {}).finally(() => setLoadingSent(false));
  }, [tab]);

  const loadRecipients = async (cId: string) => {
    setLoadingRecipients(true);
    setSelectedIds(new Set());
    try {
      const r: any = await api.admin.email.recipients(cId || undefined);
      setRecipients(r.data ?? []);
    } catch { setRecipients([]); }
    setLoadingRecipients(false);
  };

  const toggleAll = () => {
    if (selectedIds.size === recipients.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(recipients.map((r) => r.userId)));
  };

  const toggleOne = (id: string) => {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedIds(s);
  };

  const handleSend = async () => {
    if (!subject.trim() || !body.trim() || selectedIds.size === 0) return;
    setSending(true);
    setSendResult(null);
    try {
      const r: any = await api.admin.email.send({
        to: Array.from(selectedIds),
        subject,
        bodyHtml: body.replace(/\n/g, '<br>'),
        bodyText: body,
        courseId: courseFilter || undefined,
      });
      if (r.data?.sent) {
        setSendResult({ ok: true, msg: `Enviado a ${r.data.recipientCount} destinatario(s)` });
        setSubject('');
        setBody('');
        setSelectedIds(new Set());
      } else {
        setSendResult({ ok: false, msg: 'Error al enviar. Revisa los logs.' });
      }
    } catch (e: any) {
      setSendResult({ ok: false, msg: e?.message ?? 'Error desconocido' });
    }
    setSending(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#17527E] via-[#1A6494] to-[#0F3F62] px-6 py-8">
        <h1 className="text-2xl font-bold text-white">Correos</h1>
        <p className="text-blue-200 text-sm mt-1">Envía mensajes a estudiantes por curso o de forma individual</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="flex gap-6">
          {(['compose', 'sent'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-[#17527E] text-[#17527E]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'compose' ? 'Redactar' : 'Enviados'}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">

        {/* ── COMPOSE TAB ─────────────────────────────────────────────────────── */}
        {tab === 'compose' && (
          <div className="space-y-5">
            {/* Course filter + recipient list */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700">Destinatarios</span>
                <select
                  value={courseFilter}
                  onChange={(e) => { setCourseFilter(e.target.value); loadRecipients(e.target.value); }}
                  className="ml-auto text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-[#17527E]/20 focus:border-[#17527E] outline-none"
                >
                  <option value="">Todos los estudiantes</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <button
                  onClick={() => loadRecipients(courseFilter)}
                  className="text-xs text-[#17527E] font-medium hover:underline"
                >
                  {loadingRecipients ? 'Cargando…' : 'Cargar'}
                </button>
              </div>

              {recipients.length > 0 && (
                <>
                  <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-3 text-xs text-gray-500">
                    <input type="checkbox" checked={selectedIds.size === recipients.length}
                      onChange={toggleAll}
                      className="rounded border-gray-300 text-[#17527E] focus:ring-[#17527E]" />
                    <span>{selectedIds.size} de {recipients.length} seleccionados</span>
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-gray-50">
                    {recipients.map((r) => (
                      <label key={r.userId} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={selectedIds.has(r.userId)} onChange={() => toggleOne(r.userId)}
                          className="rounded border-gray-300 text-[#17527E] focus:ring-[#17527E]" />
                        <span className="text-sm text-gray-800 flex-1">{r.name}</span>
                        <span className="text-xs text-gray-400">{r.email}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {recipients.length === 0 && !loadingRecipients && (
                <div className="px-5 py-6 text-sm text-gray-400 text-center">
                  Selecciona un curso o carga todos los estudiantes
                </div>
              )}
            </div>

            {/* Subject */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Asunto</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Escribe el asunto del correo…"
                className="w-full text-sm text-gray-800 focus:outline-none placeholder:text-gray-300"
              />
            </div>

            {/* Body */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Mensaje</label>
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Escribe tu mensaje aquí…"
                rows={10}
                className="w-full text-sm text-gray-800 resize-none focus:outline-none placeholder:text-gray-300"
              />
            </div>

            {/* Send result */}
            {sendResult && (
              <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
                sendResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {sendResult.msg}
              </div>
            )}

            {/* Send button */}
            <div className="flex justify-end">
              <button
                onClick={handleSend}
                disabled={sending || selectedIds.size === 0 || !subject.trim() || !body.trim()}
                className="px-6 py-2.5 bg-gradient-to-r from-[#17527E] to-[#0F3F62] text-white text-sm font-semibold rounded-xl shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:from-[#1A6494] hover:to-[#17527E] transition-all"
              >
                {sending ? 'Enviando…' : `Enviar a ${selectedIds.size} destinatario${selectedIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* ── SENT TAB ────────────────────────────────────────────────────────── */}
        {tab === 'sent' && (
          <div className="space-y-3">
            {loadingSent && <div className="text-sm text-gray-400 text-center py-8">Cargando…</div>}
            {!loadingSent && sent.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-8">No has enviado correos todavía</div>
            )}
            {sent.map((e) => (
              <div key={e.emailId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button
                  className="w-full px-5 py-4 flex items-start gap-3 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedId(expandedId === e.emailId ? null : e.emailId)}
                >
                  <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${e.status === 'sent' ? 'bg-green-400' : 'bg-red-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{e.subject}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(e.sentAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{e.recipientCount} destinatario{e.recipientCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <span className="text-gray-300 text-xs shrink-0">{expandedId === e.emailId ? '▲' : '▼'}</span>
                </button>
                {expandedId === e.emailId && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    <p className="text-xs text-gray-500 mb-2 font-medium">Destinatarios:</p>
                    <p className="text-xs text-gray-600 leading-relaxed">{e.to.join(', ')}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
