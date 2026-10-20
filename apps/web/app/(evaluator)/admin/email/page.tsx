'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import ComposeModal from './_components/ComposeModal';

interface Course { id: string; title: string }
interface SentEmail {
  emailId: string; subject: string; sentAt: string;
  recipientCount: number; status: 'sent' | 'failed'; to: string[]; bodyHtml?: string;
}
interface Draft { id: string; subject: string; to: string[]; bodyHtml: string; savedAt: string }

const DRAFT_KEY = 'lux_email_drafts';

function loadDrafts(): Draft[] {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '[]'); } catch { return []; }
}
function saveDraft(d: Draft) {
  const drafts = loadDrafts().filter((x) => x.id !== d.id);
  localStorage.setItem(DRAFT_KEY, JSON.stringify([d, ...drafts].slice(0, 20)));
}
function deleteDraft(id: string) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(loadDrafts().filter((x) => x.id !== id)));
}

function Avatar({ label }: { label: string }) {
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#17527E] to-[#0F3F62] flex items-center justify-center text-white text-sm font-bold shrink-0">
      {label.slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function EmailPage() {
  const [folder, setFolder] = useState<'sent' | 'drafts'>('sent');
  const [sent, setSent] = useState<SentEmail[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SentEmail | Draft | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.admin.email.courses().then((r: any) => setCourses(r.data ?? [])).catch(() => {});
    setDrafts(loadDrafts());
  }, []);

  useEffect(() => {
    if (folder !== 'sent') return;
    setLoading(true);
    setSelected(null);
    api.admin.email.sent()
      .then((r: any) => setSent(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [folder]);

  useEffect(() => {
    if (folder === 'drafts') { setDrafts(loadDrafts()); setSelected(null); }
  }, [folder]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const handleSent = (result: { emailId: string; recipientCount: number }) => {
    setShowCompose(false);
    showToast(`Enviado a ${result.recipientCount} destinatario${result.recipientCount !== 1 ? 's' : ''}`);
    if (folder === 'sent') {
      setLoading(true);
      api.admin.email.sent().then((r: any) => setSent(r.data ?? [])).catch(() => {}).finally(() => setLoading(false));
    }
  };

  const isSentEmail = (x: SentEmail | Draft | null): x is SentEmail => !!x && 'status' in x;
  const isDraft = (x: SentEmail | Draft | null): x is Draft => !!x && 'savedAt' in x;

  const listItems = folder === 'sent' ? sent : drafts;

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#17527E] to-[#0F3F62] flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="4" strokeWidth={2} /><path strokeLinecap="round" strokeWidth={2} d="M16 12a4 4 0 0 1 8 0c0 1.5-.5 2.5-2 2.5S20 13.5 20 12" />
            </svg>
          </div>
          <span className="text-base font-bold text-gray-800">Emails</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-52 border-r border-gray-100 flex flex-col shrink-0 py-3">
          <button
            onClick={() => setShowCompose(true)}
            className="mx-3 mb-4 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-[#17527E] to-[#0F3F62] text-white text-sm font-semibold shadow-md hover:from-[#1A6494] transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Redactar
          </button>

          {([
            { key: 'sent', label: 'Enviados', icon: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8', count: sent.length },
            { key: 'drafts', label: 'Borradores', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', count: drafts.length },
          ] as const).map((item) => (
            <button
              key={item.key}
              onClick={() => setFolder(item.key)}
              className={`flex items-center gap-3 px-4 py-2 mx-1 rounded-xl text-sm transition-colors ${
                folder === item.key
                  ? 'bg-[#17527E]/10 text-[#17527E] font-semibold'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
              </svg>
              <span className="flex-1 text-left">{item.label}</span>
              {item.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  folder === item.key ? 'bg-[#17527E] text-white' : 'bg-gray-200 text-gray-500'
                }`}>{item.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Email list */}
        <div className="w-72 border-r border-gray-100 flex flex-col overflow-hidden shrink-0">
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {folder === 'sent' ? 'Enviados' : 'Borradores'}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-[#17527E]/30 border-t-[#17527E] rounded-full animate-spin" />
              </div>
            )}

            {!loading && listItems.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-gray-400">{folder === 'sent' ? 'No hay emails enviados' : 'No hay borradores'}</p>
              </div>
            )}

            {!loading && (folder === 'sent' ? (sent as SentEmail[]) : (drafts as Draft[])).map((item) => {
              const isSent = 'status' in item;
              const subject = item.subject || '(Sin asunto)';
              const date = isSent ? (item as SentEmail).sentAt : (item as Draft).savedAt;
              const preview = isSent
                ? `${(item as SentEmail).recipientCount} destinatario${(item as SentEmail).recipientCount !== 1 ? 's' : ''}`
                : ((item as Draft).to.length ? (item as Draft).to.join(', ') : 'Sin destinatarios');
              const isActive = selected && ('emailId' in selected ? (selected as SentEmail).emailId === (item as any).emailId : (selected as Draft).id === (item as any).id);

              return (
                <button
                  key={isSent ? (item as SentEmail).emailId : (item as Draft).id}
                  onClick={() => setSelected(item as any)}
                  className={`w-full text-left px-4 py-3.5 border-b border-gray-50 hover:bg-gray-50 transition-colors ${isActive ? 'bg-[#17527E]/5 border-l-2 border-l-[#17527E]' : ''}`}
                >
                  <div className="flex items-start gap-2.5">
                    <Avatar label={subject} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <p className="text-xs font-semibold text-gray-800 truncate">{subject}</p>
                        {isSent && (item as SentEmail).status === 'failed' && (
                          <span className="text-[9px] text-red-500 font-bold shrink-0">ERROR</span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 truncate">{preview}</p>
                      <p className="text-[10px] text-gray-300 mt-0.5">
                        {new Date(date).toLocaleDateString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Reading pane */}
        <div className="flex-1 overflow-y-auto">
          {!selected && (
            <div className="h-full flex flex-col items-center justify-center text-center px-8">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-400">Selecciona un email para leerlo</p>
            </div>
          )}

          {selected && isSentEmail(selected) && (
            <div className="px-8 py-6 max-w-3xl">
              <div className="flex items-start justify-between gap-4 mb-6">
                <h2 className="text-xl font-bold text-gray-800 leading-tight">{selected.subject}</h2>
                <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${
                  selected.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                }`}>
                  {selected.status === 'sent' ? 'Enviado' : 'Error'}
                </span>
              </div>

              <div className="flex items-center gap-3 mb-2">
                <Avatar label={selected.subject} />
                <div>
                  <p className="text-sm font-medium text-gray-700">Tú</p>
                  <p className="text-xs text-gray-400">
                    Para: {selected.to.slice(0, 3).join(', ')}{selected.to.length > 3 ? ` y ${selected.to.length - 3} más` : ''}
                  </p>
                </div>
                <p className="ml-auto text-xs text-gray-400">
                  {new Date(selected.sentAt).toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>

              <div className="mb-4">
                <button
                  onClick={() => {/* toggle full recipients */}}
                  className="text-xs text-[#17527E] hover:underline"
                >
                  {selected.recipientCount} destinatario{selected.recipientCount !== 1 ? 's' : ''}
                </button>
              </div>

              <hr className="border-gray-100 mb-6" />

              {selected.bodyHtml ? (
                <div
                  className="prose prose-sm max-w-none text-gray-700 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: selected.bodyHtml }}
                />
              ) : (
                <p className="text-sm text-gray-400 italic">Sin contenido guardado</p>
              )}
            </div>
          )}

          {selected && isDraft(selected) && (
            <div className="px-8 py-6 max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-800">{selected.subject || '(Sin asunto)'}</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowCompose(true); }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[#17527E] text-white font-semibold hover:bg-[#1A6494]"
                  >
                    Editar y enviar
                  </button>
                  <button
                    onClick={() => { deleteDraft(selected.id); setDrafts(loadDrafts()); setSelected(null); }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              <p className="text-sm text-gray-500 mb-1">
                <span className="font-medium">Para:</span> {selected.to.join(', ') || '—'}
              </p>
              <p className="text-xs text-gray-400 mb-6">
                Guardado: {new Date(selected.savedAt).toLocaleDateString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>

              <hr className="border-gray-100 mb-6" />

              <div
                className="prose prose-sm max-w-none text-gray-700 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: selected.bodyHtml || '<p class="text-gray-400 italic">Sin contenido</p>' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <ComposeModal
          courses={courses}
          onClose={() => setShowCompose(false)}
          onSent={handleSent}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-5 py-2.5 rounded-xl shadow-xl z-50 animate-pulse">
          {toast}
        </div>
      )}
    </div>
  );
}
