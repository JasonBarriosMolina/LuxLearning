'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import { useEffect, useCallback, useState, useRef } from 'react';
import {
  Bold, Italic, UnderlineIcon, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Minus, Undo, Redo, Link2, Image as ImageIcon,
  Highlighter, Sparkles, Search, Upload, X, Loader2, Check,
} from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

const TEXT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Rojo', value: '#dc2626' },
  { label: 'Naranja', value: '#ea580c' },
  { label: 'Amarillo', value: '#ca8a04' },
  { label: 'Verde', value: '#16a34a' },
  { label: 'Azul', value: '#2563eb' },
  { label: 'Morado', value: '#7c3aed' },
  { label: 'Rosa', value: '#db2777' },
  { label: 'Gris', value: '#6b7280' },
];

const HIGHLIGHT_COLORS = [
  { label: 'Amarillo', value: '#fef08a' },
  { label: 'Verde', value: '#bbf7d0' },
  { label: 'Azul', value: '#bfdbfe' },
  { label: 'Rosa', value: '#fbcfe8' },
  { label: 'Naranja', value: '#fed7aa' },
];

const AI_STYLES = [
  { value: 'illustration', label: 'Ilustración' },
  { value: 'realistic', label: 'Realista' },
  { value: 'minimal', label: 'Minimalista' },
  { value: 'colorful', label: 'Colorida' },
  { value: 'corporate', label: 'Corporativo' },
  { value: 'comic', label: 'Cómic' },
];

function ToolbarBtn({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-cta-from text-white'
          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

type ImageTab = 'ai' | 'stock' | 'upload';

function ImageModal({ onInsert, onClose }: { onInsert: (url: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<ImageTab>('ai');

  // AI tab state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStyle, setAiStyle] = useState('illustration');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState('');
  const [aiError, setAiError] = useState('');

  // Stock tab state
  const [stockQ, setStockQ] = useState('');
  const [stockPage, setStockPage] = useState(1);
  const [stockPhotos, setStockPhotos] = useState<any[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState('');
  const [stockTotalPages, setStockTotalPages] = useState(0);

  // Upload tab state
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadPreview, setUploadPreview] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const generateAI = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true); setAiError(''); setAiPreview('');
    try {
      const res = await api.admin.generateImage({ promptText: aiPrompt.trim(), style: aiStyle });
      setAiPreview((res as any)?.data?.imageUrl ?? '');
    } catch { setAiError('No se pudo generar la imagen. Intenta de nuevo.'); }
    finally { setAiLoading(false); }
  };

  const searchStock = async (page = 1) => {
    if (!stockQ.trim()) return;
    setStockLoading(true); setStockError('');
    try {
      const res = await api.admin.stockPhotos(stockQ.trim(), page);
      setStockPhotos((res as any)?.data?.photos ?? []);
      setStockTotalPages((res as any)?.data?.totalPages ?? 0);
      setStockPage(page);
    } catch { setStockError('Error al buscar imágenes.'); }
    finally { setStockLoading(false); }
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { setUploadError('Solo se aceptan imágenes.'); return; }
    setUploadLoading(true); setUploadError(''); setUploadPreview(''); setUploadUrl('');
    try {
      const reader = new FileReader();
      reader.onload = (e) => setUploadPreview(e.target?.result as string);
      reader.readAsDataURL(file);

      const presignRes = await api.admin.files.presign({ fileName: file.name, fileType: file.type, folder: 'uploads' });
      const { uploadUrl: signedUrl, publicUrl } = (presignRes as any)?.data ?? {};
      await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      setUploadUrl(publicUrl);
    } catch { setUploadError('Error al subir la imagen.'); }
    finally { setUploadLoading(false); }
  };

  const tabs: { id: ImageTab; label: string; icon: React.ReactNode }[] = [
    { id: 'ai', label: 'Generar con IA', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'stock', label: 'Buscar en stock', icon: <Search className="w-4 h-4" /> },
    { id: 'upload', label: 'Subir archivo', icon: <Upload className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#1A1A2E] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-heading font-bold text-lg text-charcoal dark:text-white">Insertar imagen</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-cta-from text-cta-from'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── Tab IA ── */}
          {tab === 'ai' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-charcoal dark:text-gray-200 block mb-1.5">
                  Describe la imagen que quieres generar
                </label>
                <textarea
                  className="input-field resize-none"
                  rows={3}
                  placeholder="Ej: Laboratorio artístico, estudiantes colaborando, colores vibrantes"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) generateAI(); }}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-charcoal dark:text-gray-200 block mb-1.5">Estilo</label>
                <div className="flex flex-wrap gap-2">
                  {AI_STYLES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setAiStyle(s.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        aiStyle === s.value
                          ? 'border-cta-from bg-blue-50 dark:bg-blue-950 text-cta-from'
                          : 'border-border text-gray-500 hover:border-gray-400'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={generateAI}
                disabled={aiLoading || !aiPrompt.trim()}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {aiLoading ? 'Generando...' : 'Generar imagen'}
              </button>
              {aiError && <p className="text-sm text-red-500">{aiError}</p>}
              {aiPreview && (
                <div className="space-y-3">
                  <img src={aiPreview} alt="Preview" className="w-full rounded-xl object-cover max-h-64" />
                  <button
                    type="button"
                    onClick={() => onInsert(aiPreview)}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" /> Insertar en editor
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Tab Stock ── */}
          {tab === 'stock' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  className="input-field flex-1"
                  placeholder="Buscar en Unsplash... (ej: educación, tecnología)"
                  value={stockQ}
                  onChange={(e) => setStockQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') searchStock(1); }}
                />
                <button
                  type="button"
                  onClick={() => searchStock(1)}
                  disabled={stockLoading || !stockQ.trim()}
                  className="btn-primary px-4 flex items-center gap-1.5"
                >
                  {stockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>
              {stockError && <p className="text-sm text-red-500">{stockError}</p>}
              {stockPhotos.length > 0 && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {stockPhotos.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onInsert(p.full)}
                        className="relative group rounded-xl overflow-hidden aspect-video"
                      >
                        <img src={p.thumb} alt={p.author} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Check className="w-6 h-6 text-white" />
                        </div>
                        <span className="absolute bottom-1 left-1 text-[10px] text-white/80 bg-black/30 px-1 rounded truncate max-w-[90%]">
                          {p.author}
                        </span>
                      </button>
                    ))}
                  </div>
                  {stockTotalPages > 1 && (
                    <div className="flex justify-center gap-2">
                      <button type="button" onClick={() => searchStock(stockPage - 1)} disabled={stockPage <= 1} className="btn-ghost px-3 py-1.5 text-sm">← Anterior</button>
                      <span className="text-sm text-gray-500 self-center">Pág {stockPage} / {stockTotalPages}</span>
                      <button type="button" onClick={() => searchStock(stockPage + 1)} disabled={stockPage >= stockTotalPages} className="btn-ghost px-3 py-1.5 text-sm">Siguiente →</button>
                    </div>
                  )}
                  <p className="text-xs text-gray-400 text-center">
                    Fotos de <a href="https://unsplash.com" target="_blank" rel="noopener noreferrer" className="underline">Unsplash</a>
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── Tab Upload ── */}
          {tab === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleFile(file);
                }}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-cta-from bg-blue-50 dark:bg-blue-950'
                    : 'border-border hover:border-gray-400'
                }`}
              >
                {uploadLoading ? (
                  <Loader2 className="w-8 h-8 animate-spin text-cta-from mx-auto" />
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-charcoal dark:text-gray-200">Arrastra una imagen aquí</p>
                    <p className="text-xs text-gray-400 mt-1">o haz clic para seleccionar</p>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {uploadError && <p className="text-sm text-red-500">{uploadError}</p>}
              {uploadPreview && (
                <div className="space-y-3">
                  <img src={uploadPreview} alt="Preview" className="w-full rounded-xl object-cover max-h-48" />
                  {uploadUrl && (
                    <button
                      type="button"
                      onClick={() => onInsert(uploadUrl)}
                      className="btn-primary w-full flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4" /> Insertar en editor
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RichTextEditor({ value, onChange, placeholder = 'Escribe el contenido aquí...', minHeight = 200 }: Props) {
  const [showImageModal, setShowImageModal] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Image.configure({ allowBase64: true, inline: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-cta-from underline' } }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none dark:prose-invert px-3 py-2',
        style: `min-height:${minHeight}px`,
      },
    },
  });

  // Sync external value changes (e.g. restore snapshot)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== value) {
      editor.commands.setContent(value || '', false);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const insertImage = useCallback((url: string) => {
    editor?.chain().focus().setImage({ src: url }).run();
    setShowImageModal(false);
  }, [editor]);

  const setLink = useCallback(() => {
    const prev = editor?.getAttributes('link').href ?? '';
    const url = window.prompt('URL del enlace:', prev);
    if (url === null) return;
    if (url === '') { editor?.chain().focus().unsetLink().run(); return; }
    editor?.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <>
      <div className="border border-border rounded-xl overflow-hidden bg-white dark:bg-[#1A1A2E]">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-gray-50 dark:bg-gray-800/50">
          {/* History */}
          <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} title="Deshacer"><Undo className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} title="Rehacer"><Redo className="w-3.5 h-3.5" /></ToolbarBtn>
          <span className="w-px h-4 bg-border mx-1" />

          {/* Headings */}
          <ToolbarBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Título 1"><Heading1 className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Título 2"><Heading2 className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Título 3"><Heading3 className="w-3.5 h-3.5" /></ToolbarBtn>
          <span className="w-px h-4 bg-border mx-1" />

          {/* Formatting */}
          <ToolbarBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrita"><Bold className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Cursiva"><Italic className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Subrayado"><UnderlineIcon className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado"><Strikethrough className="w-3.5 h-3.5" /></ToolbarBtn>
          <span className="w-px h-4 bg-border mx-1" />

          {/* Color */}
          <div className="relative group">
            <button
              type="button"
              title="Color de texto"
              className="flex items-center gap-0.5 p-1.5 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <span className="text-xs font-bold" style={{ color: editor.getAttributes('textStyle').color || undefined }}>A</span>
              <span className="text-[8px] text-gray-400">▼</span>
            </button>
            <div className="absolute top-full left-0 mt-1 z-20 hidden group-hover:flex flex-wrap gap-1 p-2 bg-white dark:bg-gray-800 border border-border rounded-xl shadow-lg w-40">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    c.value ? editor.chain().focus().setColor(c.value).run() : editor.chain().focus().unsetColor().run();
                  }}
                  title={c.label}
                  className="w-5 h-5 rounded border border-gray-200"
                  style={{ backgroundColor: c.value || '#374151' }}
                />
              ))}
            </div>
          </div>

          {/* Highlight */}
          <div className="relative group">
            <button
              type="button"
              title="Resaltado"
              className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <Highlighter className="w-3.5 h-3.5" />
            </button>
            <div className="absolute top-full left-0 mt-1 z-20 hidden group-hover:flex gap-1 p-2 bg-white dark:bg-gray-800 border border-border rounded-xl shadow-lg">
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetHighlight().run(); }}
                className="w-5 h-5 rounded border border-gray-300 bg-white"
                title="Sin resaltado"
              />
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setHighlight({ color: c.value }).run(); }}
                  className="w-5 h-5 rounded border border-gray-200"
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
            </div>
          </div>
          <span className="w-px h-4 bg-border mx-1" />

          {/* Lists */}
          <ToolbarBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista"><List className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada"><ListOrdered className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Cita"><Quote className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Separador"><Minus className="w-3.5 h-3.5" /></ToolbarBtn>
          <span className="w-px h-4 bg-border mx-1" />

          {/* Link & Image */}
          <ToolbarBtn active={editor.isActive('link')} onClick={setLink} title="Enlace"><Link2 className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn onClick={() => setShowImageModal(true)} title="Insertar imagen"><ImageIcon className="w-3.5 h-3.5" /></ToolbarBtn>
        </div>

        {/* Editor area */}
        <EditorContent
          editor={editor}
          className="min-h-[200px] text-charcoal dark:text-gray-100"
        />

        {/* Char count */}
        <div className="px-3 py-1 border-t border-border text-xs text-gray-400 text-right">
          {editor.storage.characterCount?.characters?.() ?? editor.getText().length} caracteres
        </div>
      </div>

      {showImageModal && (
        <ImageModal onInsert={insertImage} onClose={() => setShowImageModal(false)} />
      )}
    </>
  );
}
