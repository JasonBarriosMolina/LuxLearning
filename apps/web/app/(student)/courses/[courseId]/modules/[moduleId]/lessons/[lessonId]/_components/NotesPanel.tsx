'use client';

// ─── NotesPanel.tsx ────────────────────────────────────────────────────────────
// Trello DmPpbrff, 2026-09-04 (Mack): server-persisted student notes (replacing
// the idea of exporting to PDF — "el uso y consumo [de la app] es importante,
// la idea es que el estudiante revisite la app"), with tags, a search, and a
// "Consultar a Lux Mentor" button that summarizes the lesson's highlighted
// passages into a new note. Kept as its own file — page.tsx is already well past
// the file-size guideline (pre-existing, not from this change).
import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Trash2, Search, Tag as TagIcon, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';

interface Note {
  noteId: string;
  contextType: 'lesson' | 'class';
  contextId: string;
  text: string;
  tags: string[];
  source: 'manual' | 'highlight-summary';
  createdAt: string;
  updatedAt: string;
}

interface Props {
  contextType: 'lesson' | 'class';
  contextId: string;
  lessonTitle?: string;
  /** Plain-text highlighted passages available to summarize right now — omit or
   *  pass an empty array to hide/disable the "Consultar a Lux Mentor" button. */
  highlightsForSummary?: string[];
}

export function NotesPanel({ contextType, contextId, lessonTitle, highlightsForSummary = [] }: Props) {
  const { t, lang } = useLanguage();
  const tp = t.notesPanel;

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [draftText, setDraftText] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.lessons.notes(contextType, contextId)
      .then((res: any) => setNotes((res as any)?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [contextType, contextId]);

  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    if (!draftText.trim()) return;
    setSaving(true);
    setError('');
    try {
      const tags = draftTags.split(',').map((s) => s.trim()).filter(Boolean);
      await api.lessons.saveNote({ contextType, contextId, text: draftText.trim(), tags });
      setDraftText('');
      setDraftTags('');
      load();
    } catch {
      setError(tp.summarizeError); // generic save failure — reuse the same "try again" copy
    } finally {
      setSaving(false);
    }
  };

  const removeNote = async (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.noteId !== noteId)); // optimistic
    try {
      await api.lessons.deleteNote({ contextType, contextId, noteId });
    } catch {
      load(); // revert on failure
    }
  };

  const summarizeHighlights = async () => {
    if (highlightsForSummary.length === 0) return;
    setSummarizing(true);
    setError('');
    try {
      await api.lessons.summarizeHighlights({ contextId, highlights: highlightsForSummary, lessonTitle });
      load();
    } catch {
      setError(tp.summarizeError);
    } finally {
      setSummarizing(false);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? notes.filter((n) => n.text.toLowerCase().includes(q) || n.tags.some((tag) => tag.toLowerCase().includes(q)))
    : notes;

  if (loading) return null;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-heading font-bold text-base text-charcoal">{tp.title}</h3>
        <button
          onClick={summarizeHighlights}
          disabled={summarizing || highlightsForSummary.length === 0}
          title={highlightsForSummary.length === 0 ? tp.noHighlightsYet : undefined}
          className="flex items-center gap-1.5 text-xs font-semibold text-cta-from hover:text-cta-to disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {summarizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {summarizing ? tp.summarizing : tp.summarizeHighlights}
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Add a manual note */}
      <div className="space-y-1.5">
        <textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder={tp.addPlaceholder}
          className="input-field w-full min-h-[60px] text-sm resize-y"
        />
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5">
            <TagIcon className="w-3.5 h-3.5 text-gray-300 shrink-0" />
            <input
              value={draftTags}
              onChange={(e) => setDraftTags(e.target.value)}
              placeholder={tp.tagsPlaceholder}
              className="flex-1 text-xs outline-none bg-transparent"
            />
          </div>
          <button
            onClick={addNote}
            disabled={saving || !draftText.trim()}
            className="px-3 py-1.5 rounded-lg bg-cta-from text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {tp.add}
          </button>
        </div>
      </div>

      {/* Search */}
      {notes.length > 3 && (
        <div className="flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5">
          <Search className="w-3.5 h-3.5 text-gray-300 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tp.searchPlaceholder}
            className="flex-1 text-xs outline-none bg-transparent"
          />
        </div>
      )}

      {/* List */}
      {notes.length === 0 ? (
        <p className="text-sm text-gray-400">{tp.empty}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400">{tp.noResults}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => (
            <div key={n.noteId} className="p-3 rounded-xl border border-border space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-charcoal whitespace-pre-wrap flex-1">{n.text}</p>
                <button onClick={() => removeNote(n.noteId)} title={tp.delete} className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {n.source === 'highlight-summary' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" /> {tp.summaryTag}
                  </span>
                )}
                {/* The 'resumen' tag is a fixed internal marker the backend always writes in Spanish
                    (services/api/src/lessons/notes.ts) regardless of UI language — comparing it to
                    the translated tp.summaryTag label would miss it for non-Spanish locales. */}
                {n.tags.filter((tag) => !(n.source === 'highlight-summary' && tag === 'resumen')).map((tag) => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{tag}</span>
                ))}
                <span className="text-[10px] text-gray-300 ml-auto">
                  {new Date(n.createdAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short' })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
