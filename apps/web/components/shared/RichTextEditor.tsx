'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import { useEffect, useCallback } from 'react';
import {
  Bold, Italic, UnderlineIcon, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Minus, Undo, Redo, Link2, Image as ImageIcon,
  Highlighter,
} from 'lucide-react';

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

export function RichTextEditor({ value, onChange, placeholder = 'Escribe el contenido aquí...', minHeight = 200 }: Props) {
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

  const insertImage = useCallback(() => {
    const url = window.prompt('URL de la imagen:');
    if (url) editor?.chain().focus().setImage({ src: url }).run();
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
        <ToolbarBtn onClick={insertImage} title="Imagen"><ImageIcon className="w-3.5 h-3.5" /></ToolbarBtn>
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
  );
}
