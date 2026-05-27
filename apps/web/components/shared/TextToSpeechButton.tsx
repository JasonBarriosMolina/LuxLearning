'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Pause, Play, Square } from 'lucide-react';

interface Props {
  text: string;
  className?: string;
}

// ── Voice profiles (6 personas: 3M, 3F) ──────────────────────────────────────
const VOICE_PROFILES = [
  { id: 'carlos',    label: 'Carlos',    lang: 'es-ES', hints: ['carlos', 'jorge', 'diego'] },
  { id: 'miguel',    label: 'Miguel',    lang: 'es-MX', hints: ['miguel', 'juan', 'pablo'] },
  { id: 'diego',     label: 'Diego',     lang: 'es-AR', hints: ['diego', 'martin', 'gabriel'] },
  { id: 'sofia',     label: 'Sofia',     lang: 'es-ES', hints: ['sofia', 'monica', 'lucia'] },
  { id: 'valentina', label: 'Valentina', lang: 'es-MX', hints: ['valentina', 'paulina', 'maria'] },
  { id: 'isabella',  label: 'Isabella',  lang: 'es-CO', hints: ['isabella', 'camila', 'diana'] },
] as const;

type VoiceProfileId = (typeof VOICE_PROFILES)[number]['id'];

function resolveVoice(profileId: VoiceProfileId): SpeechSynthesisVoice | null {
  const profile = VOICE_PROFILES.find((p) => p.id === profileId);
  if (!profile) return null;
  const voices = window.speechSynthesis.getVoices();
  // 1. Try name match (case-insensitive hint in voice name)
  const byName = voices.find(
    (v) => profile.hints.some((h) => v.name.toLowerCase().includes(h)) && v.lang.startsWith('es')
  );
  if (byName) return byName;
  // 2. Try locale match
  const byLang = voices.find((v) => v.lang === profile.lang);
  if (byLang) return byLang;
  // 3. Any Spanish voice
  return voices.find((v) => v.lang.startsWith('es')) ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '. ')
    .replace(/<\/h[1-6]>/gi, '. ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type TTSState = 'idle' | 'speaking' | 'paused';

export function TextToSpeechButton({ text, className = '' }: Props) {
  const [state, setState] = useState<TTSState>('idle');
  const [supported, setSupported] = useState(true);
  const [rate, setRate] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return parseFloat(localStorage.getItem('tts-rate') ?? '1');
    }
    return 1;
  });
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfileId>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tts-voice-profile');
      return (VOICE_PROFILES.find((p) => p.id === saved)?.id ?? 'carlos') as VoiceProfileId;
    }
    return 'carlos';
  });
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setSupported(false);
    }
  }, []);

  // Stop on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const handleVoiceChange = (profileId: VoiceProfileId) => {
    setVoiceProfile(profileId);
    localStorage.setItem('tts-voice-profile', profileId);
    if (state === 'speaking') {
      window.speechSynthesis?.cancel();
      setState('idle');
    }
  };

  const handlePlay = useCallback(() => {
    if (!window.speechSynthesis) return;

    if (state === 'paused') {
      window.speechSynthesis.resume();
      setState('speaking');
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const plain = stripHtml(text);
    if (!plain.trim()) return;

    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.lang = 'es-ES';
    utterance.rate = rate;

    // Use selected voice profile
    const voice = resolveVoice(voiceProfile);
    if (voice) utterance.voice = voice;

    utterance.onstart = () => setState('speaking');
    utterance.onpause = () => setState('paused');
    utterance.onresume = () => setState('speaking');
    utterance.onend = () => setState('idle');
    utterance.onerror = () => setState('idle');

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setState('speaking');
  }, [state, text, rate, voiceProfile]);

  const handlePause = useCallback(() => {
    window.speechSynthesis?.pause();
    setState('paused');
  }, []);

  const handleStop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setState('idle');
  }, []);

  const handleRateChange = (newRate: number) => {
    setRate(newRate);
    localStorage.setItem('tts-rate', String(newRate));
    if (state === 'speaking') {
      // Restart with new rate
      window.speechSynthesis?.cancel();
      setState('idle');
    }
  };

  if (!supported) return null;

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {/* Play / Pause button */}
      {state === 'idle' && (
        <button
          onClick={handlePlay}
          title="Escuchar"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white dark:bg-[#1A1A2E] text-gray-600 dark:text-gray-300 hover:border-cta-from hover:text-cta-from text-xs font-medium transition-colors"
        >
          <Volume2 className="w-3.5 h-3.5" />
          Escuchar
        </button>
      )}

      {state === 'speaking' && (
        <button
          onClick={handlePause}
          title="Pausar"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cta-from bg-cta-from/10 text-cta-from text-xs font-medium transition-colors hover:bg-cta-from/20"
        >
          <Pause className="w-3.5 h-3.5" />
          Pausar
        </button>
      )}

      {state === 'paused' && (
        <button
          onClick={handlePlay}
          title="Continuar"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium transition-colors hover:bg-amber-100"
        >
          <Play className="w-3.5 h-3.5" />
          Continuar
        </button>
      )}

      {/* Stop button (when active) */}
      {state !== 'idle' && (
        <button
          onClick={handleStop}
          title="Detener"
          className="p-1.5 rounded-lg border border-border text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors"
        >
          <Square className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Voice profile selector */}
      <select
        value={voiceProfile}
        onChange={(e) => handleVoiceChange(e.target.value as VoiceProfileId)}
        className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
        title="Perfil de voz"
      >
        {VOICE_PROFILES.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>

      {/* Speed selector */}
      <select
        value={rate}
        onChange={(e) => handleRateChange(parseFloat(e.target.value))}
        className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
        title="Velocidad de lectura"
      >
        <option value={0.75}>0.75×</option>
        <option value={1}>1×</option>
        <option value={1.25}>1.25×</option>
        <option value={1.5}>1.5×</option>
        <option value={2}>2×</option>
      </select>
    </div>
  );
}
