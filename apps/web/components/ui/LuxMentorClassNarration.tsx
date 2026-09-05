'use client';

// ─── LuxMentorClassNarration.tsx ──────────────────────────────────────────────
// Exposition redesign (Trello DmPpbrff, 2026-09-01 01:10 — Mack): "cuando yo le dé a
// iniciar la clase, me lleve a una sección aparte, como las lecciones en texto...
// donde tengamos un HTML diseñado... hay una sección donde puedo tomar notas y,
// además, puedo ver el close caption". Split out of LuxMentorClass.tsx (already over
// the 400-line component limit) — this file owns the 'narrating' phase only:
// styled lessonScript content with live captions synced to lessonSpeechMarks, plus
// a persisted notes textarea.
import { useEffect, useRef, useState } from 'react';
import { Volume2, NotebookPen, X } from 'lucide-react';
import { findActiveCaptionIndex, type SpeechMark } from './LuxMentorClass.helpers';
import { NotesPanel } from '@/app/(student)/courses/[courseId]/modules/[moduleId]/lessons/[lessonId]/_components/NotesPanel';

interface Props {
  lessonScript: string | null;
  lessonAudioUrl: string;
  lessonSpeechMarks: SpeechMark[] | null;
  moduleId: string;
  lang: string;
  onEnded: () => void;
  onError: () => void;
}

export function LuxMentorClassNarration({
  lessonScript, lessonAudioUrl, lessonSpeechMarks, moduleId, lang, onEnded, onError,
}: Props) {
  const s = (es: string, en: string) => (lang === 'en' ? en : es);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeCaptionRef = useRef<HTMLParagraphElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  // Notes redesign (Trello DmPpbrff, 2026-09-05 — Mack: "la interfaz de las clases de
  // las notas de LuxMentor sea como las del pop-up"): was a localStorage-only textarea
  // (v1 scope, per-device, no backend). Now the same server-persisted popup used on
  // the text-lesson page (NotesPanel, contextType='class') — userId scoping that used
  // to live in the old notesStorageKey string is handled server-side via the auth
  // token, same as every other Notes call.
  const [notesOpen, setNotesOpen] = useState(false);

  const marks = lessonSpeechMarks ?? [];
  const activeIndex = findActiveCaptionIndex(marks, currentMs);

  useEffect(() => {
    activeCaptionRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <audio
        ref={audioRef}
        src={lessonAudioUrl}
        autoPlay
        onEnded={onEnded}
        // Found in code review (2026-09-01): a 404/CORS/blocked-autoplay failure must
        // not strand the student on this screen forever — fall through to Q&A same
        // as natural completion.
        onError={onError}
        onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
      />

      <div className="bg-gradient-to-br from-[#17527E] to-[#7B2FBE] px-4 py-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
          <Volume2 className="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm">{s('Lux Mentor está exponiendo la clase…', 'Lux Mentor is presenting the class…')}</p>
          <p className="text-white/70 text-xs">{s('Al terminar, se abrirá la sesión de preguntas.', 'When it finishes, the Q&A session will open.')}</p>
        </div>
      </div>

      {/* Styled lesson content, matching the text-lesson visual language */}
      <div className="p-4 max-h-72 overflow-y-auto bg-white dark:bg-transparent">
        {marks.length > 0 ? (
          <div className="space-y-2.5">
            {marks.map((m, i) => (
              <p
                key={i}
                ref={i === activeIndex ? activeCaptionRef : undefined}
                className={`text-sm leading-relaxed rounded-lg px-2 py-1 transition-colors ${
                  i === activeIndex
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-charcoal dark:text-gray-100 font-medium'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                {m.value}
              </p>
            ))}
          </div>
        ) : lessonScript ? (
          // Legacy class (generated before lessonSpeechMarks existed) — no marks to
          // sync captions against, still show the styled script content.
          <p className="text-sm text-charcoal dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
            {lessonScript}
          </p>
        ) : null}
      </div>

      {/* Notes panel (fixed overlay) — Trello DmPpbrff, 2026-09-05 (Mack) */}
      {notesOpen && (
        <NotesPanel contextType="class" contextId={moduleId} highlightsForSummary={[]} />
      )}

      {/* Floating notes button — same convention as the text-lesson page */}
      <button
        onClick={() => setNotesOpen((prev) => !prev)}
        title={s('Mis notas', 'My notes')}
        className="fixed bottom-6 right-4 z-50 w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-fuchsia-500 text-white shadow-xl flex items-center justify-center hover:scale-110 transition-transform"
      >
        {notesOpen ? <X className="w-5 h-5" /> : <NotebookPen className="w-5 h-5" />}
      </button>
    </div>
  );
}
