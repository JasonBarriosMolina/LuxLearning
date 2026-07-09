'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Pause, Play, Square } from 'lucide-react';

interface Props {
  text: string;
  audioUrl?: string; // Polly pre-generated audio (course voice — optional)
  className?: string;
  adminMode?: boolean; // admin preview: show only Polly audio, no profile selector
}

// ── Voice profiles ─────────────────────────────────────────────────────────────
const PROFILES = [
  { id: 'sofia',  label: 'Sofía ♀',  gender: 'female' as const },
  { id: 'carlos', label: 'Carlos ♀', gender: 'female' as const },
  { id: 'jorge',  label: 'Jorge ♂',  gender: 'male'   as const },
  { id: 'miguel', label: 'Miguel ♂', gender: 'male'   as const },
] as const;

type ProfileId = (typeof PROFILES)[number]['id'];
type TTSState  = 'idle' | 'speaking' | 'paused';
type TTSSource = 'web' | 'polly';

// ── Female/male name patterns for Spanish TTS voices ───────────────────────────
const FEMALE_MARKERS = [
  'mónica','monica','paulina','lucía','lucia','sara','lupe','mia','marisol',
  'helena','sabina','sofía','sofia','isabella','valentina','camila','maria',
  'laura','ana','elena','rosa','isabel','andrea','diana','carlos',
  'female','mujer','femenin',
];
const MALE_MARKERS = [
  'jorge','pablo','enrique','diego','pedro','andrés','andres','miguel',
  'juan','sergio','raúl','raul','antonio','manuel','carlos','alberto',
  'male','hombre','masculin',
];

function isFemale(v: SpeechSynthesisVoice) {
  const n = v.name.toLowerCase();
  return FEMALE_MARKERS.some((m) => n.includes(m));
}
function isMale(v: SpeechSynthesisVoice) {
  const n = v.name.toLowerCase();
  return MALE_MARKERS.some((m) => n.includes(m));
}

// ── Async voice loader ─────────────────────────────────────────────────────────
function useSpanishVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const load = () => {
      const all = window.speechSynthesis.getVoices();
      // Prefer voices with a Spanish lang tag; fall back to all voices
      const es = all.filter((v) => v.lang.startsWith('es'));
      setVoices(es.length > 0 ? es : all);
    };

    load(); // synchronous attempt (works in Firefox/Safari)
    window.speechSynthesis.onvoiceschanged = load; // async for Chrome
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  return voices;
}

// ── Profile → actual voice mapping ────────────────────────────────────────────
// Returns the best Spanish voice for a given profile, or null.
function pickVoice(profileId: ProfileId, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const profile = PROFILES.find((p) => p.id === profileId);
  if (!profile) return voices[0];

  const females = voices.filter(isFemale);
  const males   = voices.filter(isMale);
  const unknowns = voices.filter((v) => !isFemale(v) && !isMale(v));

  if (profile.gender === 'female') {
    const pool = females.length > 0 ? females : (unknowns.length > 0 ? unknowns : voices);
    // carlos → try second female if available (different from sofia)
    return profileId === 'carlos' ? (pool[1] ?? pool[0]) : pool[0];
  } else {
    const pool = males.length > 0 ? males : (unknowns.length > 0 ? unknowns : voices);
    // miguel → try second male if available (different from jorge)
    return profileId === 'miguel' ? (pool[1] ?? pool[0]) : pool[0];
  }
}

// ── Strip HTML ─────────────────────────────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '. ').replace(/<\/h[1-6]>/gi, '. ')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Polly / HTML5 audio player ─────────────────────────────────────────────────
function PollyPlayer({ audioUrl, rate, onRateChange }: {
  audioUrl: string; rate: number; onRateChange: (r: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<TTSState>('idle');

  useEffect(() => { return () => { audioRef.current?.pause(); }; }, []);
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);

  const handlePlay = () => {
    const a = audioRef.current; if (!a) return;
    if (state === 'paused') { a.play(); return; }
    a.playbackRate = rate; a.currentTime = 0; a.play();
  };

  return (
    <>
      <audio ref={audioRef} src={audioUrl} preload="none"
        onPlay={() => setState('speaking')}
        onPause={() => setState(audioRef.current?.ended ? 'idle' : 'paused')}
        onEnded={() => setState('idle')} />

      {state === 'idle' && (
        <button onClick={handlePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white dark:bg-[#1A1A2E] text-gray-600 dark:text-gray-300 hover:border-cta-from hover:text-cta-from text-xs font-medium transition-colors">
          <Volume2 className="w-3.5 h-3.5" /> Escuchar
        </button>
      )}
      {state === 'speaking' && (
        <button onClick={() => audioRef.current?.pause()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cta-from bg-cta-from/10 text-cta-from text-xs font-medium transition-colors">
          <Pause className="w-3.5 h-3.5" /> Pausar
        </button>
      )}
      {state === 'paused' && (
        <button onClick={handlePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium transition-colors">
          <Play className="w-3.5 h-3.5" /> Continuar
        </button>
      )}
      {state !== 'idle' && (
        <button onClick={() => { audioRef.current?.pause(); if (audioRef.current) { audioRef.current.currentTime = 0; } setState('idle'); }}
          className="p-1.5 rounded-lg border border-border text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors">
          <Square className="w-3.5 h-3.5" />
        </button>
      )}
      <RateSelect value={rate} onChange={onRateChange} />
    </>
  );
}

// ── Shared rate selector ───────────────────────────────────────────────────────
function RateSelect({ value, onChange }: { value: number; onChange: (r: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(parseFloat(e.target.value))}
      className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
      title="Velocidad">
      <option value={0.75}>0.75×</option>
      <option value={1}>1×</option>
      <option value={1.25}>1.25×</option>
      <option value={1.5}>1.5×</option>
      <option value={2}>2×</option>
    </select>
  );
}

// ── Web Speech player ──────────────────────────────────────────────────────────
function WebSpeechPlayer({ text, rate, onRateChange, profileId, voices }: {
  text: string; rate: number; onRateChange: (r: number) => void;
  profileId: ProfileId; voices: SpeechSynthesisVoice[];
}) {
  const [state, setState] = useState<TTSState>('idle');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Cancel when profile or rate changes so next play picks the new settings
  useEffect(() => {
    window.speechSynthesis?.cancel();
    setState('idle');
  }, [profileId, rate]);

  useEffect(() => { return () => { window.speechSynthesis?.cancel(); }; }, []);

  const handlePlay = useCallback(() => {
    if (!window.speechSynthesis) return;
    if (state === 'paused') { window.speechSynthesis.resume(); setState('speaking'); return; }

    window.speechSynthesis.cancel();
    const plain = stripHtml(text);
    if (!plain.trim()) return;

    const utterance = new SpeechSynthesisUtterance(plain);
    // Always set Spanish lang so the engine applies Spanish phonology
    utterance.lang = 'es-ES';
    utterance.rate = rate;

    const voice = pickVoice(profileId, voices);
    if (voice) {
      utterance.voice = voice;
      // Override lang to match the selected voice's lang for correct phonology
      utterance.lang = voice.lang || 'es-ES';
    }

    utterance.onstart  = () => setState('speaking');
    utterance.onpause  = () => setState('paused');
    utterance.onresume = () => setState('speaking');
    utterance.onend    = () => setState('idle');
    utterance.onerror  = () => setState('idle');
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setState('speaking');
  }, [state, text, rate, profileId, voices]);

  const handlePause = useCallback(() => { window.speechSynthesis?.pause(); setState('paused'); }, []);
  const handleStop  = useCallback(() => { window.speechSynthesis?.cancel(); setState('idle'); }, []);

  if (typeof window !== 'undefined' && !window.speechSynthesis) return null;

  return (
    <>
      {state === 'idle' && (
        <button onClick={handlePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white dark:bg-[#1A1A2E] text-gray-600 dark:text-gray-300 hover:border-cta-from hover:text-cta-from text-xs font-medium transition-colors">
          <Volume2 className="w-3.5 h-3.5" /> Escuchar
        </button>
      )}
      {state === 'speaking' && (
        <button onClick={handlePause}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cta-from bg-cta-from/10 text-cta-from text-xs font-medium transition-colors">
          <Pause className="w-3.5 h-3.5" /> Pausar
        </button>
      )}
      {state === 'paused' && (
        <button onClick={handlePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium transition-colors">
          <Play className="w-3.5 h-3.5" /> Continuar
        </button>
      )}
      {state !== 'idle' && (
        <button onClick={handleStop}
          className="p-1.5 rounded-lg border border-border text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors">
          <Square className="w-3.5 h-3.5" />
        </button>
      )}
      <RateSelect value={rate} onChange={onRateChange} />
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function TextToSpeechButton({ text, audioUrl, className = '', adminMode = false }: Props) {
  const voices = useSpanishVoices();

  const [profileId, setProfileId] = useState<ProfileId>(() => {
    if (typeof window === 'undefined') return 'sofia';
    const saved = localStorage.getItem('tts-voice-profile');
    return (PROFILES.find((p) => p.id === saved)?.id ?? 'sofia') as ProfileId;
  });

  const [source, setSource] = useState<TTSSource>(() => {
    if (typeof window === 'undefined') return 'web';
    return localStorage.getItem('tts-source') === 'polly' ? 'polly' : 'web';
  });

  const [rate, setRate] = useState<number>(() =>
    typeof window !== 'undefined' ? parseFloat(localStorage.getItem('tts-rate') ?? '1') : 1
  );

  const handleProfileChange = (id: ProfileId) => {
    setProfileId(id);
    localStorage.setItem('tts-voice-profile', id);
    // Switching profile always goes back to web speech — Polly has a fixed voice
    if (source === 'polly') { setSource('web'); localStorage.setItem('tts-source', 'web'); }
  };

  const handleSourceChange = (s: TTSSource) => {
    setSource(s); localStorage.setItem('tts-source', s);
  };

  const handleRateChange = (r: number) => {
    setRate(r); localStorage.setItem('tts-rate', String(r));
  };

  // Admin mode: only show Polly player (no profile selector, no source switcher)
  if (adminMode && audioUrl) {
    return (
      <div className={`flex items-center gap-2 flex-wrap ${className}`}>
        <PollyPlayer audioUrl={audioUrl} rate={rate} onRateChange={handleRateChange} />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {/* Audio player */}
      {audioUrl && source === 'polly'
        ? <PollyPlayer audioUrl={audioUrl} rate={rate} onRateChange={handleRateChange} />
        : <WebSpeechPlayer text={text} rate={rate} onRateChange={handleRateChange}
            profileId={profileId} voices={voices} />
      }

      {/* Profile selector */}
      <select value={profileId} onChange={(e) => handleProfileChange(e.target.value as ProfileId)}
        className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
        title="Perfil de voz">
        {PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>

      {/* Source switcher — only when Polly audio exists */}
      {audioUrl && (
        <select value={source} onChange={(e) => handleSourceChange(e.target.value as TTSSource)}
          className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
          title="Fuente de audio">
          <option value="web">Mi voz preferida</option>
          <option value="polly">Voz del curso</option>
        </select>
      )}
    </div>
  );
}
