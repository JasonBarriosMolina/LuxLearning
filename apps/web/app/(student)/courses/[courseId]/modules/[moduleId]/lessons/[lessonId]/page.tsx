'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, CheckCircle, Lightbulb, ChevronRight,
  Star, FileText, ChevronDown, ChevronUp, Loader2, MessageCircle, X, Send,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCourseDuration } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

// ── Highlight colors ──────────────────────────────────────────────────────────
const COLORS: Record<string, { bg: string; label: string }> = {
  yellow: { bg: '#FEF08A', label: '🟡' },
  green:  { bg: '#BBF7D0', label: '🟢' },
  blue:   { bg: '#BFDBFE', label: '🔵' },
  pink:   { bg: '#FBCFE8', label: '🩷' },
};

interface HighlightItem { id: string; text: string; color: string; createdAt: string; }

// Apply highlights to plain text → render as ReactNode
function applyHighlights(text: string, highlights: HighlightItem[]): React.ReactNode {
  if (!highlights.length) return text;
  // Build sorted list of non-overlapping matches
  const matches: Array<{ start: number; end: number; color: string; id: string }> = [];
  for (const h of highlights) {
    let idx = 0;
    while (true) {
      const pos = text.indexOf(h.text, idx);
      if (pos === -1) break;
      const overlaps = matches.some((m) => pos < m.end && pos + h.text.length > m.start);
      if (!overlaps) matches.push({ start: pos, end: pos + h.text.length, color: h.color, id: h.id });
      idx = pos + 1;
    }
  }
  matches.sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) parts.push(text.slice(cursor, m.start));
    parts.push(
      <mark key={m.id} style={{ backgroundColor: COLORS[m.color]?.bg ?? '#FEF08A', borderRadius: '3px', padding: '0 2px' }}>
        {text.slice(m.start, m.end)}
      </mark>
    );
    cursor = m.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

// ── Lightweight markdown renderer (for Mentor chat responses) ────────────────
function renderMarkdown(text: string): React.ReactNode {
  const formatInline = (line: string): React.ReactNode => {
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
      return part;
    });
  };

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="list-disc pl-4 space-y-0.5 my-1">
          {listItems.map((item, i) => <li key={i}>{formatInline(item)}</li>)}
        </ul>
      );
      listItems = [];
    }
  };

  lines.forEach((line, i) => {
    if (/^#{1,3} /.test(line)) {
      flushList();
      elements.push(<p key={i} className="font-semibold mt-2 mb-0.5">{line.replace(/^#{1,3} /, '')}</p>);
    } else if (/^[-*] /.test(line)) {
      listItems.push(line.slice(2));
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      elements.push(<p key={i} className="mb-1">{formatInline(line)}</p>);
    }
  });
  flushList();
  return <div className="space-y-0.5">{elements}</div>;
}

// ── Highlight toolbar (appears on text selection) ─────────────────────────────
interface ToolbarProps {
  position: { x: number; y: number } | null;
  onHighlight: (color: string) => void;
  onClose: () => void;
}

function HighlightToolbar({ position, onHighlight, onClose }: ToolbarProps) {
  if (!position) return null;
  return (
    <div
      className="fixed z-50 flex items-center gap-1.5 bg-white dark:bg-[#1A1A2E] border border-border rounded-xl shadow-xl px-2 py-1.5 animate-fade-in"
      style={{ top: position.y - 48, left: Math.max(8, position.x - 60) }}
    >
      <span className="text-[10px] text-gray-400 font-medium mr-1">Resaltar</span>
      {Object.entries(COLORS).map(([key, { label, bg }]) => (
        <button
          key={key}
          onClick={() => onHighlight(key)}
          title={key}
          className="w-6 h-6 rounded-full border-2 border-white shadow-sm hover:scale-125 transition-transform"
          style={{ backgroundColor: bg }}
        />
      ))}
      <button onClick={onClose} className="text-gray-300 hover:text-gray-500 ml-1 text-xs">✕</button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LessonPage() {
  const { courseId, moduleId, lessonId } = useParams<{
    courseId: string; moduleId: string; lessonId: string;
  }>();
  const router = useRouter();

  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [markingDone, setMarkingDone] = useState(false);
  const [completed, setCompleted] = useState(false);
  const startTimeRef = useRef(Date.now());

  // Highlights
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [toolbar, setToolbar] = useState<{ x: number; y: number; selectedText: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  // Favorites
  const [isFavorite, setIsFavorite] = useState(false);
  const [favLoading, setFavLoading] = useState(false);

  // Transcript
  const [transcript, setTranscript] = useState<string | null>(null);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState(false);

  useEffect(() => {
    Promise.all([
      api.courses.get(courseId),
      api.lessons.highlights(lessonId),
      api.lessons.favorites(),
    ]).then(([courseRes, hlRes, favRes]) => {
      setCourse((courseRes as any).data);
      setHighlights((hlRes as any).data ?? []);
      const favs: any[] = (favRes as any).data ?? [];
      setIsFavorite(favs.some((f: any) => f?.id === lessonId));
      setLoading(false);
    }).catch(() => setLoading(false));
    startTimeRef.current = Date.now();
  }, [courseId, lessonId]);

  const module = course?.modules?.find((m: any) => m.id === moduleId);
  const lesson = module?.lessons?.find((l: any) => l.id === lessonId);
  const lessonIndex = module?.lessons?.findIndex((l: any) => l.id === lessonId) ?? -1;
  const prevLesson = lessonIndex > 0 ? module?.lessons[lessonIndex - 1] : null;
  const nextLesson = lessonIndex < (module?.lessons?.length - 1) ? module?.lessons[lessonIndex + 1] : null;

  useEffect(() => { if (lesson?.completed) setCompleted(true); }, [lesson]);

  // ── Highlight logic ──────────────────────────────────────────────────────────

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    const selText = selection?.toString().trim() ?? '';
    if (!selText || selText.length < 3 || selText.length > 300) { setToolbar(null); return; }

    // Only highlight inside the content area
    if (!contentRef.current) { setToolbar(null); return; }
    const range = selection?.getRangeAt(0);
    if (!range || !contentRef.current.contains(range.commonAncestorContainer)) { setToolbar(null); return; }

    const rect = range.getBoundingClientRect();
    setToolbar({ x: rect.left + rect.width / 2, y: rect.top + window.scrollY, selectedText: selText });
  }, []);

  const addHighlight = async (color: string) => {
    if (!toolbar?.selectedText || savingRef.current) return;
    const newHL: HighlightItem = {
      id: `hl_${Date.now()}`,
      text: toolbar.selectedText,
      color,
      createdAt: new Date().toISOString(),
    };
    const updated = [...highlights.filter((h) => h.text !== toolbar.selectedText), newHL];
    setHighlights(updated);
    setToolbar(null);
    window.getSelection()?.removeAllRanges();
    savingRef.current = true;
    try { await api.lessons.saveHighlights(lessonId, updated); } finally { savingRef.current = false; }
  };

  const removeHighlight = async (id: string) => {
    const updated = highlights.filter((h) => h.id !== id);
    setHighlights(updated);
    try { await api.lessons.saveHighlights(lessonId, updated); } catch {}
  };

  // ── Favorite logic ───────────────────────────────────────────────────────────

  const toggleFav = async () => {
    if (!lesson) return;
    setFavLoading(true);
    try {
      const res = await api.lessons.toggleFavorite({
        type: 'lesson', id: lessonId, title: lesson.title, courseId, moduleId,
      });
      setIsFavorite((res as any).data?.added ?? !isFavorite);
    } catch {} finally { setFavLoading(false); }
  };

  // ── Transcript logic ─────────────────────────────────────────────────────────

  const loadTranscript = async () => {
    if (transcript !== null || !lesson?.youtubeId) return;
    setTranscriptLoading(true);
    setTranscriptError(false);
    try {
      const res = await api.lessons.transcript(lessonId, lesson.youtubeId);
      const text = (res as any).data?.transcript ?? null;
      setTranscript(text ?? '');
      if (!text) setTranscriptError(true);
    } catch {
      setTranscriptError(true);
    } finally {
      setTranscriptLoading(false);
    }
  };

  const handleTranscriptToggle = () => {
    const next = !showTranscript;
    setShowTranscript(next);
    if (next && transcript === null) loadTranscript();
  };

  // ── Chat ─────────────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    const newHistory: { role: 'user' | 'assistant'; content: string }[] = [...chatHistory, { role: 'user', content: msg }];
    setChatHistory(newHistory);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await api.lessons.chat({
        lessonId,
        lessonTitle: lesson?.title,
        lessonContent: lesson?.content ?? lesson?.points?.join('\n') ?? '',
        moduleTitle: module?.title,
        history: chatHistory,
        message: msg,
      });
      const reply = (res as any).data?.reply ?? '';
      setChatHistory([...newHistory, { role: 'assistant', content: reply }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch {
      setChatHistory([...newHistory, { role: 'assistant', content: 'Lo siento, ocurrió un error. Intenta de nuevo.' }]);
    } finally { setChatLoading(false); }
  };

  // ── Mark complete ────────────────────────────────────────────────────────────

  const handleMarkComplete = async () => {
    setMarkingDone(true);
    try {
      const durationMs = Date.now() - startTimeRef.current;
      await api.lessons.complete({ courseId, moduleId, lessonId, durationMs });
      setCompleted(true);
      setTimeout(() => {
        if (nextLesson) router.push(`/courses/${courseId}/modules/${moduleId}/lessons/${nextLesson.id}`);
        else router.push(`/courses/${courseId}/modules/${moduleId}`);
      }, 800);
    } catch (err) { console.error(err); }
    finally { setMarkingDone(false); }
  };

  if (loading || !lesson) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="aspect-video bg-gray-200 rounded-2xl" />
        <div className="h-4 bg-gray-100 rounded" />
        <div className="h-4 bg-gray-100 rounded w-3/4" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in" onMouseUp={handleMouseUp}>
      {/* Highlight toolbar */}
      <HighlightToolbar
        position={toolbar}
        onHighlight={addHighlight}
        onClose={() => setToolbar(null)}
      />

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="hover:text-charcoal flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> {module?.title}
        </Link>
        <span>/</span>
        <span className="text-charcoal font-medium truncate">{lesson.title}</span>
      </div>

      {/* Lesson header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-gray-400">LECCIÓN {lesson.order}</span>
            {completed && (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <CheckCircle className="w-3.5 h-3.5" /> Completada
              </span>
            )}
          </div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">{lesson.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{formatCourseDuration(lesson.duration)}</p>
        </div>
        {/* Favorite star */}
        <button
          onClick={toggleFav}
          disabled={favLoading}
          title={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          className={`mt-1 p-2 rounded-xl transition-all ${
            isFavorite
              ? 'text-amber-500 bg-amber-50 hover:bg-amber-100'
              : 'text-gray-300 hover:text-amber-400 hover:bg-amber-50'
          }`}
        >
          <Star className={`w-5 h-5 ${isFavorite ? 'fill-amber-500' : ''}`} />
        </button>
      </div>

      {/* Lesson content: video player OR text content */}
      {lesson.youtubeId ? (
        <div className="aspect-video rounded-2xl overflow-hidden shadow-card bg-black">
          <iframe
            className="w-full h-full"
            src={`https://www.youtube.com/embed/${lesson.youtubeId}?rel=0&modestbranding=1`}
            title={lesson.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="card">
          {lesson.content ? (
            <div
              className="prose prose-sm max-w-none dark:prose-invert leading-relaxed text-charcoal"
              dangerouslySetInnerHTML={{ __html: lesson.content }}
            />
          ) : (
            <p className="text-gray-400 text-sm text-center py-8">El contenido de esta lección no está disponible aún.</p>
          )}
        </div>
      )}

      {/* Transcript toggle — only for video lessons */}
      {(lesson.type !== 'text' && lesson.youtubeId) && (
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            onClick={handleTranscriptToggle}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-charcoal">Transcripción del video</span>
              {transcriptLoading && <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />}
            </div>
            {showTranscript ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showTranscript && (
            <div className="px-4 pb-4 border-t border-border">
              {transcriptLoading ? (
                <div className="py-6 text-center text-sm text-gray-400">Obteniendo transcripción...</div>
              ) : transcriptError || !transcript ? (
                <div className="py-4 text-sm text-gray-400 text-center">
                  No hay transcripción disponible para este video.
                </div>
              ) : (
                <div className="mt-3 max-h-60 overflow-y-auto scrollbar-thin text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                  {transcript}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lesson image */}
      {lesson.imageUrl && (
        <div className="rounded-2xl overflow-hidden shadow-card">
          <img src={lesson.imageUrl} alt={lesson.title} className="w-full h-auto object-cover" />
        </div>
      )}

      {/* Key points — highlightable */}
      {lesson.points?.length > 0 && (
        <div className="card" ref={contentRef}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-bold text-base text-charcoal">Puntos clave</h2>
            {highlights.length > 0 && (
              <span className="text-xs text-gray-400">{highlights.length} resaltado{highlights.length > 1 ? 's' : ''}</span>
            )}
          </div>
          <ul className="space-y-2 select-text">
            {lesson.points.map((point: string, i: number) => (
              <li key={i} className="flex items-start gap-3 text-sm text-gray-600">
                <ChevronRight className="w-4 h-4 text-cta-from mt-0.5 shrink-0" />
                <span>{applyHighlights(point, highlights)}</span>
              </li>
            ))}
          </ul>
          {highlights.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-xs text-gray-400 mb-2 font-medium">Mis resaltados</p>
              <div className="flex flex-wrap gap-2">
                {highlights.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-gray-700 group"
                    style={{ backgroundColor: COLORS[h.color]?.bg ?? '#FEF08A' }}
                  >
                    <span className="truncate max-w-[120px]">{h.text}</span>
                    <button
                      onClick={() => removeHighlight(h.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-red-500"
                      title="Eliminar resaltado"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tip */}
      {lesson.tip && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <Lightbulb className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Consejo: </span>{lesson.tip}
          </p>
        </div>
      )}

      {/* Chat panel (fixed overlay) */}
      {chatOpen && (
        <div className="fixed bottom-24 right-4 z-50 w-80 h-[70vh] flex flex-col bg-white dark:bg-[#1A1A2E] rounded-2xl shadow-2xl border border-border animate-fade-in overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-cta-from to-cta-to">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-white" />
              <span className="text-white font-semibold text-sm">Mentor</span>
            </div>
            <button onClick={() => setChatOpen(false)} className="text-white/80 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {chatHistory.length === 0 && (
              <div className="text-center text-sm text-gray-400 mt-8 px-4">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p>¡Hola! Soy tu Mentor. Pregúntame cualquier cosa sobre esta lección.</p>
              </div>
            )}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-cta-from to-cta-to text-white rounded-br-sm'
                    : 'bg-surface dark:bg-[#16213E] text-charcoal rounded-bl-sm border border-border'
                }`}>
                  {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-surface dark:bg-[#16213E] border border-border px-3 py-2 rounded-2xl rounded-bl-sm">
                  <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {/* Input */}
          <div className="p-3 border-t border-border flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Escribe tu pregunta..."
              className="flex-1 text-sm px-3 py-2 rounded-xl border border-border bg-surface dark:bg-[#0F0F1A] text-charcoal placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cta-from"
            />
            <button
              onClick={sendMessage}
              disabled={chatLoading || !chatInput.trim()}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-gradient-to-br from-cta-from to-cta-to text-white disabled:opacity-40 transition-opacity shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating chat button */}
      <button
        onClick={() => setChatOpen((prev) => !prev)}
        title="Mentor"
        className="fixed bottom-6 right-4 z-50 w-12 h-12 rounded-full bg-gradient-to-br from-cta-from to-cta-to text-white shadow-xl flex items-center justify-center hover:scale-110 transition-transform"
      >
        {chatOpen ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>

      {/* Navigation + Complete */}
      <div className="flex items-center justify-between gap-4 pb-8">
        <div>
          {prevLesson && (
            <Link
              href={`/courses/${courseId}/modules/${moduleId}/lessons/${prevLesson.id}`}
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Anterior
            </Link>
          )}
        </div>

        <div className="flex items-center gap-3">
          {!completed && (
            <Button
              onClick={handleMarkComplete}
              loading={markingDone}
              className="flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Marcar completada
            </Button>
          )}

          {nextLesson && (
            completed ? (
              <Link
                href={`/courses/${courseId}/modules/${moduleId}/lessons/${nextLesson.id}`}
                className="btn-primary text-sm flex items-center gap-2"
              >
                Siguiente <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <button
                disabled
                title="Marca esta lección como completada para continuar"
                className="btn-secondary text-sm flex items-center gap-2 opacity-50 cursor-not-allowed"
              >
                Siguiente <ArrowRight className="w-4 h-4" />
              </button>
            )
          )}

          {!nextLesson && completed && (
            <Link
              href={`/courses/${courseId}/modules/${moduleId}`}
              className="btn-primary text-sm flex items-center gap-2"
            >
              Volver al módulo <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
