'use client';
import { useState, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

interface Course { id: string; title: string }
interface Recipient { userId: string; name: string; email: string }

interface Props {
  courses: Course[];
  onClose: () => void;
  onSent: (result: { emailId: string; recipientCount: number }) => void;
}

interface AttachmentFile { name: string; url: string; size: number; type: string }

function ChipInput({ label, chips, onChange }: { label: string; chips: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && !chips.includes(v)) onChange([...chips, v]);
    setInput('');
  };
  const remove = (c: string) => onChange(chips.filter((x) => x !== c));
  return (
    <div className="flex flex-wrap gap-1.5 items-center border-b border-gray-100 px-4 py-2 min-h-[40px]">
      <span className="text-xs text-gray-400 shrink-0">{label}:</span>
      {chips.map((c) => (
        <span key={c} className="flex items-center gap-1 bg-[#17527E]/10 text-[#17527E] text-xs px-2 py-0.5 rounded-full">
          {c}<button onClick={() => remove(c)} className="text-[#17527E]/60 hover:text-[#17527E] ml-0.5">×</button>
        </span>
      ))}
      <input
        type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={chips.length ? '' : 'correo@ejemplo.com'}
        onKeyDown={(e) => { if (e.key === ',' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(); } if (e.key === 'Backspace' && !input && chips.length) remove(chips[chips.length - 1]); }}
        onBlur={add}
        className="flex-1 min-w-[140px] text-xs outline-none bg-transparent"
      />
    </div>
  );
}

export default function ComposeModal({ courses, onClose, onSent }: Props) {
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showRecipientPicker, setShowRecipientPicker] = useState(false);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadRecipients = async (cId: string) => {
    setLoadingRecipients(true);
    try {
      const r: any = await api.admin.email.recipients(cId || undefined);
      setRecipients(r.data ?? []);
    } catch { setRecipients([]); }
    setLoadingRecipients(false);
  };

  const applyFormat = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const ps: any = await api.admin.files.presign({ fileName: file.name, fileType: file.type, folder: 'uploads' });
      const { url, fields } = ps.data;
      const fd = new FormData();
      Object.entries(fields ?? {}).forEach(([k, v]) => fd.append(k, v as string));
      fd.append('file', file);
      await fetch(url, { method: 'POST', body: fd });
      const fileUrl = `${url}${fields?.key ?? file.name}`;
      setAttachments((prev) => [...prev, { name: file.name, url: fileUrl, size: file.size, type: file.type }]);
    } catch { /* ignore */ }
    setUploadingFile(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addSelectedRecipients = () => {
    const emails = recipients.filter((r) => selectedIds.has(r.userId)).map((r) => r.email);
    setTo((prev) => Array.from(new Set([...prev, ...emails])));
    setShowRecipientPicker(false);
    setSelectedIds(new Set());
  };

  const getBodyHtml = useCallback(() => {
    const raw = editorRef.current?.innerHTML ?? '';
    const attachHtml = attachments.length
      ? `<hr style="margin:16px 0"><p style="font-size:12px;color:#888">Adjuntos:</p><ul>${attachments.map((a) => `<li><a href="${a.url}">${a.name}</a></li>`).join('')}</ul>`
      : '';
    return raw + attachHtml;
  }, [attachments]);

  const handleSend = async () => {
    const allTo = [...to];
    if (!allTo.length) { setSendError('Agrega al menos un destinatario'); return; }
    if (!subject.trim()) { setSendError('El asunto es requerido'); return; }
    const bodyHtml = getBodyHtml();
    if (!bodyHtml.replace(/<[^>]+>/g, '').trim()) { setSendError('El mensaje no puede estar vacío'); return; }
    setSendError(''); setSending(true);
    try {
      const r: any = await api.admin.email.send({ to: allTo, cc: cc.length ? cc : undefined, subject, bodyHtml, bodyText: editorRef.current?.innerText ?? '' });
      onSent({ emailId: r.data?.emailId, recipientCount: r.data?.recipientCount ?? allTo.length });
    } catch (e: any) { setSendError(e?.message ?? 'Error al enviar'); }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95vh] sm:max-h-[85vh] rounded-t-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
          <h2 className="text-sm font-bold text-gray-800">Redactar email</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {/* To */}
        <div className="shrink-0">
          <div className="flex items-center border-b border-gray-100 px-4 py-2 gap-2">
            <ChipInput label="Para" chips={to} onChange={setTo} />
            <button onClick={() => { setShowRecipientPicker(!showRecipientPicker); if (!recipients.length) loadRecipients(''); }}
              className="text-[11px] text-[#17527E] font-medium shrink-0 hover:underline">Desde cursos</button>
            {!showCc && <button onClick={() => setShowCc(true)} className="text-[11px] text-gray-400 shrink-0 hover:text-gray-600">CC</button>}
          </div>

          {showCc && <ChipInput label="CC" chips={cc} onChange={setCc} />}

          {/* Recipient picker */}
          {showRecipientPicker && (
            <div className="border-b border-gray-100 px-4 py-3 bg-gray-50">
              <div className="flex items-center gap-2 mb-2">
                <select value={courseFilter} onChange={(e) => { setCourseFilter(e.target.value); loadRecipients(e.target.value); setSelectedIds(new Set()); }}
                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#17527E]">
                  <option value="">Todos los estudiantes</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <button onClick={addSelectedRecipients} disabled={selectedIds.size === 0}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#17527E] text-white disabled:opacity-40">
                  Agregar {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </button>
                <button onClick={() => setShowRecipientPicker(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
              </div>
              {loadingRecipients && <p className="text-xs text-gray-400">Cargando…</p>}
              <div className="max-h-28 overflow-y-auto divide-y divide-gray-100">
                {recipients.map((r) => (
                  <label key={r.userId} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-100 px-1 rounded">
                    <input type="checkbox" checked={selectedIds.has(r.userId)}
                      onChange={() => setSelectedIds((prev) => { const s = new Set(prev); s.has(r.userId) ? s.delete(r.userId) : s.add(r.userId); return s; })}
                      className="rounded text-[#17527E]" />
                    <span className="text-xs text-gray-700 flex-1">{r.name}</span>
                    <span className="text-[10px] text-gray-400">{r.email}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Subject */}
          <div className="border-b border-gray-100 px-4">
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto"
              className="w-full py-2.5 text-sm outline-none placeholder:text-gray-300" />
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-gray-100 shrink-0">
          {[['bold','B'],['italic','I'],['underline','U']].map(([cmd, label]) => (
            <button key={cmd} onMouseDown={(e) => { e.preventDefault(); applyFormat(cmd); }}
              className="w-7 h-7 rounded text-xs font-bold text-gray-500 hover:bg-gray-100 transition-colors"
              style={{ fontStyle: cmd === 'italic' ? 'italic' : 'normal', textDecoration: cmd === 'underline' ? 'underline' : 'none' }}>
              {label}
            </button>
          ))}
          <div className="w-px h-5 bg-gray-200 mx-1" />
          <button onMouseDown={(e) => { e.preventDefault(); applyFormat('insertUnorderedList'); }}
            className="w-7 h-7 rounded text-xs text-gray-500 hover:bg-gray-100">≡</button>
          <button onMouseDown={(e) => { e.preventDefault(); applyFormat('insertOrderedList'); }}
            className="w-7 h-7 rounded text-xs text-gray-500 hover:bg-gray-100">1.</button>
          <div className="w-px h-5 bg-gray-200 mx-1" />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-[#17527E] px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
            {uploadingFile ? 'Subiendo…' : 'Adjuntar'}
          </button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div ref={editorRef} contentEditable suppressContentEditableWarning
            className="min-h-[120px] text-sm text-gray-800 outline-none focus:outline-none leading-relaxed"
            data-placeholder="Escribe tu mensaje aquí…"
            onFocus={(e) => { if (!e.currentTarget.textContent) e.currentTarget.innerHTML = ''; }}
            style={{ caretColor: '#17527E' }}
          />
          <style>{`[contenteditable]:empty:before{content:attr(data-placeholder);color:#ccc;pointer-events:none}`}</style>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-3 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-2.5 py-1.5 text-xs text-gray-700">
                  <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                  <span className="max-w-[120px] truncate">{a.name}</span>
                  <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-400 ml-0.5">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 shrink-0">
          {sendError ? <p className="text-xs text-red-500">{sendError}</p> : <span />}
          <button onClick={handleSend} disabled={sending}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#17527E] to-[#0F3F62] disabled:opacity-50 hover:from-[#1A6494] transition-all shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
