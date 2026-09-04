'use client';

import { PlayCircle, Mic, Loader2, WifiOff, Ban, BookOpen } from 'lucide-react';

// Extracted from LuxMentorClass.tsx (code review, 2026-09-04) to keep that file
// under the 400-line page-component limit — the 'idle'/'loading' phase's render.
interface Props {
  loading: boolean;
  voidedOnly: boolean;
  hasSessions: boolean;
  onStart: () => void;
  s: (es: string, en: string) => string;
}

export function LuxMentorClassIdle({ loading, voidedOnly, hasSessions, onStart, s }: Props) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="bg-surface px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center">
          <Mic className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-charcoal">{s('Clase con Lux Mentor', 'Lux Mentor Class')}</p>
          <p className="text-xs text-gray-500">{s('Exposición narrada + preguntas en vivo', 'Narrated exposition + live Q&A')}</p>
        </div>
      </div>
      <div className="p-4 space-y-3">
        {voidedOnly && (
          <div className="flex items-start gap-2 bg-amber-50 rounded-lg p-3">
            <WifiOff className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">{s('Tu sesión anterior falló por red. Puedes reintentar.', 'Your previous session failed due to network. You can retry.')}</p>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <BookOpen className="w-3.5 h-3.5" />
          <span>{s('Contenido → Exposición narrada → Preguntas (~5 min)', 'Content → Narrated exposition → Questions (~5 min)')}</span>
        </div>
        <button
          onClick={onStart}
          disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" />{s('Cargando…', 'Loading…')}</>
          ) : (
            <><PlayCircle className="w-4 h-4" />{voidedOnly ? s('Reintentar clase', 'Retry class') : s('Iniciar clase', 'Start class')}</>
          )}
        </button>
        {hasSessions && !voidedOnly && (
          <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1">
            <Ban className="w-3 h-3" />
            {s('Esta clase puede tomarse una sola vez', 'This class can only be taken once')}
          </p>
        )}
      </div>
    </div>
  );
}
