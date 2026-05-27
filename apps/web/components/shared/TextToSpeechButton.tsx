'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Pause, Play, Square } from 'lucide-react';

interface Props {
  text: string;
  audioUrl?: string;  // Polly pre-generated audio (preferred over Web Speech)
  className?: string;
}

// ── Web Speech fallback — Voice profiles (2 options, Polly is preferred) ────
const VOICE_PROFILES = [
  { id: 'masculino', label: '♂ Masculino', gender: 'male',   lang: 'es-ES',
    hints: ['pablo', 'raul', 'jorge', 'juan', 'carlos', 'miguel', 'diego', 'martin', 'gabriel', 'male'] },
  { id: 'femenino',  label: '♀ Femenino',  gender: 'female', lang: 'es-ES',
    hints: ['helena', 'sabina', 'monica', 'paulina', 'lucia', 'laura', 'sofia', 'maria', 'female'] },
] as const;

type VoiceProfileId = (typeof VOICE_PROFILES)[number]['id'];

const FEMALE_HINTS = ['helena', 'sabina', 'monica', 'paulina', 'lucia', 'laura',
  'sofia', 'maria', 'camila', 'isabella', 'valentina', 'diana', 'female', 'mujer'];
const MALE_HINTS   = ['pablo', 'raul', 'jorge', 'juan', 'carlos', 'miguel',
  'diego', 'martin', 'gabriel', 'male'];

function resolveVoice(profileId: VoiceProfileId): SpeechSynthesisVoice | null {
  const profile = VOICE_PROFILES.find((p) => p.id === profileId);
  if (!profile) return null;
  const voices = window.speechSynthesis.getVoices();
  const spanish = voices.filter((v) => v.lang.startsWith('es'));
  if (spanish.length === 0) return voices[0] ?? null;
  const byHint = spanish.find((v) => profile.hints.some((h) => v.name.toLowerCase().includes(h)));
  if (byHint) return byHint;
  const byGender = spanish.find((v) => {
    const name = v.name.toLowerCase();
    return profile.gender === 'female'
      ? FEMALE_HINTS.some((h) => name.includes(h))
      : MALE_HINTS.some((h) => name.includes(h));
  });
  if (byGender) return byGender;
  return spanish.find((v) => v.lang === profile.lang) ?? spanish[0] ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '. ').replace(/<\/h[1-6]>/gi, '. ')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

type TTSState = 'idle' | 'speaking' | 'paused';

// ── Polly / HTML5 Audio Player ───────────────────────────────────────────────
function PollyPlayer({ audioUrl, className = '' }: { audioUrl: string; className?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<TTSState>('idle');
  const [rate, setRate] = useState<number>(() =>
    typeof window !== 'undefined' ? parseFloat(localStorage.getItem('tts-rate') ?? '1') : 1
  );

  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  // Sync playbackRate when rate changes mid-play
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  const handlePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (state === 'paused') { audio.play(); return; }
    audio.playbackRate = rate;
    audio.currentTime = 0;
    audio.play();
  };

  const handlePause = () => { audioRef.current?.pause(); };
  const handleStop  = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setState('idle');
  };

  const handleRateChange = (newRate: number) => {
    setRate(newRate);
    localStorage.setItem('tts-rate', String(newRate));
    if (audioRef.current) audioRef.current.playbackRate = newRate;
  };

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="none"
        onPlay={() => setState('speaking')}
        onPause={() => setState(audioRef.current?.ended ? 'idle' : 'paused')}
        onEnded={() => setState('idle')}
      />

      {state === 'idle' && (
        <button onClick={handlePlay} title="Escuchar (Polly)"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white dark:bg-[#1A1A2E] text-gray-600 dark:text-gray-300 hover:border-cta-from hover:text-cta-from text-xs font-medium transition-colors">
          <Volume2 className="w-3.5 h-3.5" /> Escuchar
        </button>
      )}
      {state === 'speaking' && (
        <button onClick={handlePause} title="Pausar"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cta-from bg-cta-from/10 text-cta-from text-xs font-medium transition-colors hover:bg-cta-from/20">
          <Pause className="w-3.5 h-3.5" /> Pausar
        </button>
      )}
      {state === 'paused' && (
        <button onClick={handlePlay} title="Continuar"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium transition-colors hover:bg-amber-100">
          <Play className="w-3.5 h-3.5" /> Continuar
        </button>
      )}
      {state !== 'idle' && (
        <button onClick={handleStop} title="Detener"
          className="p-1.5 rounded-lg border border-border text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors">
          <Square className="w-3.5 h-3.5" />
        </button>
      )}

      <select value={rate} onChange={(e) => handleRateChange(parseFloat(e.target.value))}
        className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
        title="Velocidad">
        <option value={0.75}>0.75×</option>
        <option value={1}>1×</option>
        <option value={1.25}>1.25×</option>
        <option value={1.5}>1.5×</option>
        <option value={2}>2×</option>
      </select>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function TextToSpeechButton({ text, audioUrl, className = '' }: Props) {
  // If Polly audio is available, use it directly
  if (audioUrl) return <PollyPlayer audioUrl={audioUrl} className={className} />;

  // ── Fallback: Web Speech API ─────────────────────────────────────────────
  return <WebSpeechPlayer text={text} className={className} />;
}

function WebSpeechPlayer({ text, className = '' }: { text: string; className?: string }) {
  const [state, setState] = useState<TTSState>('idle');
  const [supported, setSupported] = useState(true);
  const [rate, setRate] = useState<number>(() =>
    typeof window !== 'undefined' ? parseFloat(localStorage.getItem('tts-rate') ?? '1') : 1
  );
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfileId>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tts-voice-profile');
      return (VOICE_PROFILES.find((p) => p.id === saved)?.id ?? 'masculino') as VoiceProfileId;
    }
    return 'carlos';
  });
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) setSupported(false);
  }, []);

  useEffect(() => { return () => { window.speechSynthesis?.cancel(); }; }, []);

  const handleVoiceChange = (profileId: VoiceProfileId) => {
    setVoiceProfile(profileId);
    localStorage.setItem('tts-voice-profile', profileId);
    if (state === 'speaking') { window.speechSynthesis?.cancel(); setState('idle'); }
  };

  const handlePlay = useCallback(() => {
    if (!window.speechSynthesis) return;
    if (state === 'paused') { window.speechSynthesis.resume(); setState('speaking'); return; }
    window.speechSynthesis.cancel();
    const plain = stripHtml(text);
    if (!plain.trim()) return;
    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.lang = 'es-ES';
    utterance.rate = rate;
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

  const handlePause = useCallback(() => { window.speechSynthesis?.pause(); setState('paused'); }, []);
  const handleStop  = useCallback(() => { window.speechSynthesis?.cancel(); setState('idle'); }, []);

  const handleRateChange = (newRate: number) => {
    setRate(newRate);
    localStorage.setItem('tts-rate', String(newRate));
    if (state === 'speaking') { window.speechSynthesis?.cancel(); setState('idle'); }
  };

  if (!supported) return null;

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {state === 'idle' && (
        <button onClick={handlePlay} title="Escuchar"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white dark:bg-[#1A1A2E] text-gray-600 dark:text-gray-300 hover:border-cta-from hover:text-cta-from text-xs font-medium transition-colors">
          <Volume2 className="w-3.5 h-3.5" /> Escuchar
        </button>
      )}
      {state === 'speaking' && (
        <button onClick={handlePause} title="Pausar"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cta-from bg-cta-from/10 text-cta-from text-xs font-medium transition-colors hover:bg-cta-from/20">
          <Pause className="w-3.5 h-3.5" /> Pausar
        </button>
      )}
      {state === 'paused' && (
        <button onClick={handlePlay} title="Continuar"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium transition-colors hover:bg-amber-100">
          <Play className="w-3.5 h-3.5" /> Continuar
        </button>
      )}
      {state !== 'idle' && (
        <button onClick={handleStop} title="Detener"
          className="p-1.5 rounded-lg border border-border text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors">
          <Square className="w-3.5 h-3.5" />
        </button>
      )}
      <select value={voiceProfile} onChange={(e) => handleVoiceChange(e.target.value as VoiceProfileId)}
        className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer" title="Perfil de voz">
        {VOICE_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <select value={rate} onChange={(e) => handleRateChange(parseFloat(e.target.value))}
        className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer" title="Velocidad">
        <option value={0.75}>0.75×</option>
        <option value={1}>1×</option>
        <option value={1.25}>1.25×</option>
        <option value={1.5}>1.5×</option>
        <option value={2}>2×</option>
      </select>
    </div>
  );
}
