'use client';

import { Mic, MicOff } from 'lucide-react';
import { formatCountdown } from './LuxMentorClass.helpers';

// Extracted from LuxMentorClass.tsx (code review, 2026-09-04) to keep that file
// under the 400-line page-component limit — this is purely the 'active'/'connecting'
// phase's render, no state of its own.
interface Props {
  phase: 'active' | 'connecting';
  isSpeaking: boolean;
  volume: number;
  visibleCountdown: number | null;
  onEndClick: () => void;
  s: (es: string, en: string) => string;
}

export function LuxMentorClassActive({ phase, isSpeaking, volume, visibleCountdown, onEndClick, s }: Props) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Animated logo area */}
      <div className="bg-gradient-to-br from-[#17527E] to-[#7B2FBE] px-4 py-6 flex flex-col items-center gap-4">
        {/* Concentric rings reacting to volume */}
        <div className="relative flex items-center justify-center">
          {[1, 2, 3].map((ring) => (
            <div
              key={ring}
              className="absolute rounded-full border border-white/20 transition-all duration-150"
              style={{
                width: `${48 + ring * (isSpeaking ? 20 + volume * 30 * ring : 16)}px`,
                height: `${48 + ring * (isSpeaking ? 20 + volume * 30 * ring : 16)}px`,
                opacity: isSpeaking ? 0.6 - ring * 0.15 : 0.25 - ring * 0.06,
              }}
            />
          ))}
          <div className={`w-12 h-12 rounded-full bg-white/20 border border-white/40 flex items-center justify-center z-10 transition-transform duration-200 ${isSpeaking ? 'scale-110' : 'scale-100'}`}>
            <Mic className="w-5 h-5 text-white" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-white font-semibold text-sm">Lux Mentor</p>
          <p className="text-white/70 text-xs mt-0.5">
            {phase === 'connecting'
              ? s('Conectando…', 'Connecting…')
              : isSpeaking ? s('Hablando…', 'Speaking…') : s('Escuchando…', 'Listening…')}
          </p>
        </div>
        {phase === 'active' && (
          <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1 text-xs text-white/80">
            <Mic className="w-3 h-3" />
            {s('Sesión de preguntas — tu micrófono está activo', 'Q&A session — your mic is active')}
          </div>
        )}
        {/* Visible wrap-up countdown, last 2 min (Trello q1yXHIob, 2026-08-29 — Mack:
            "cuando solo queden dos minutos va a comenzar un contador ... para avisar
            que ya se va a acabar la lección") */}
        {phase === 'active' && visibleCountdown !== null && (
          <div className="flex items-center gap-1.5 bg-amber-400/20 border border-amber-300/40 rounded-full px-3 py-1 text-xs text-amber-100 font-medium tabular-nums">
            {s('Cerrando pronto —', 'Wrapping up —')} {formatCountdown(visibleCountdown)}
          </div>
        )}
      </div>
      <div className="p-4 flex items-center justify-between">
        <p className="text-xs text-gray-500">{s('Sesión con Lux Mentor en curso', 'Lux Mentor session in progress')}</p>
        {phase === 'active' && (
          <button
            onClick={onEndClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors"
          >
            <MicOff className="w-3.5 h-3.5" />
            {s('Terminar', 'End')}
          </button>
        )}
      </div>
    </div>
  );
}
