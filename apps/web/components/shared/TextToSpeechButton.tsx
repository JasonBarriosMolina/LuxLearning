'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Pause, Play, Square } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

interface Props {
  text: string;
  audioUrl?: string;
  className?: string;
  adminMode?: boolean;
}

type Gender    = 'female' | 'male';
type TTSState  = 'idle' | 'speaking' | 'paused';
type TTSSource = 'web' | 'polly';

// ── Preferred voice names per lang+gender (most natural first) ─────────────────
// The browser picks the FIRST name it finds installed on the device.
const PREFERRED: Record<string, string[]> = {
  // English — Chrome/Mac natural voices first, then Windows Neural, then fallbacks
  'en-female': ['Danielle', 'Samantha', 'Microsoft Aria Online (Natural)', 'Google US English', 'Karen', 'Victoria', 'Zira'],
  'en-male':   ['Gregory',  'Alex',     'Microsoft Guy Online (Natural)',  'Google UK English Male', 'Daniel', 'Fred',   'David'],
  // Spanish MX — Mac natural voices first, then Windows Neural, then ES fallbacks
  'es-female': ['Mia',   'Mónica', 'Monica', 'Microsoft Dalia Online (Natural)', 'Paulina', 'Lucía', 'Lucia',  'Helena', 'Sabina'],
  'es-male':   ['Andrés','Andres', 'Jorge',  'Microsoft Jorge Online (Natural)', 'Pablo',   'Diego', 'Enrique','Juan'],
};

// ── Async voice loader ─────────────────────────────────────────────────────────
function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);
  return voices;
}

// ── Pick the best available voice ─────────────────────────────────────────────
// 1. Exact name match from preferred list (in priority order)
// 2. Partial name match from preferred list
// 3. Any voice matching the lang prefix
function pickVoice(gender: Gender, appLang: 'es' | 'en', voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  const key  = `${appLang}-${gender}`;
  const prefs = PREFERRED[key] ?? [];

  // 1 — exact name match (case-insensitive)
  for (const name of prefs) {
    const match = voices.find(v => v.name.toLowerCase() === name.toLowerCase());
    if (match) return match;
  }

  // 2 — partial name match (voice name CONTAINS preferred name)
  for (const name of prefs) {
    const match = voices.find(v => v.name.toLowerCase().includes(name.toLowerCase()));
    if (match) return match;
  }

  // 3 — any voice matching the language prefix, prefer online/natural voices
  const byLang = voices.filter(v => v.lang.toLowerCase().startsWith(appLang));
  if (byLang.length) {
    // Prefer voices with "Online" or "Natural" in the name (Windows Neural voices)
    const natural = byLang.find(v => /online|natural/i.test(v.name));
    if (natural) return natural;
    return byLang[gender === 'female' ? 0 : Math.min(1, byLang.length - 1)];
  }

  // 4 — absolute fallback: any voice
  return voices[gender === 'female' ? 0 : Math.min(1, voices.length - 1)];
}

// ── Profile labels per language ────────────────────────────────────────────────
function profileLabel(gender: Gender, appLang: 'es' | 'en'): string {
  if (appLang === 'en') return gender === 'female' ? 'Danielle ♀' : 'Gregory ♂';
  return gender === 'female' ? 'Mia ♀' : 'Andrés ♂';
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

// ── Speed selector ─────────────────────────────────────────────────────────────
function RateSelect({ value, onChange, appLang }: { value: number; onChange: (r: number) => void; appLang: 'es' | 'en' }) {
  return (
    <select value={value} onChange={e => onChange(parseFloat(e.target.value))}
      className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
      title={appLang === 'en' ? 'Speed' : 'Velocidad'}>
      <option value={0.75}>0.75×</option>
      <option value={1}>1×</option>
      <option value={1.25}>1.25×</option>
      <option value={1.5}>1.5×</option>
      <option value={2}>2×</option>
    </select>
  );
}

// ── Polly player ───────────────────────────────────────────────────────────────
function PollyPlayer({ audioUrl, rate, onRateChange, appLang }: {
  audioUrl: string; rate: number; onRateChange: (r: number) => void; appLang: 'es' | 'en';
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<TTSState>('idle');

  useEffect(() => () => { audioRef.current?.pause(); }, []);
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);

  const play = () => {
    const a = audioRef.current; if (!a) return;
    if (state === 'paused') { a.play(); return; }
    a.playbackRate = rate; a.currentTime = 0; a.play();
  };

  const listen = appLang === 'en' ? 'Listen'    : 'Escuchar';
  const pause  = appLang === 'en' ? 'Pause'     : 'Pausar';
  const cont   = appLang === 'en' ? 'Continue'  : 'Continuar';

  return (
    <>
      <audio ref={audioRef} src={audioUrl} preload="none"
        onPlay={() => setState('speaking')}
        onPause={() => setState(audioRef.current?.ended ? 'idle' : 'paused')}
        onEnded={() => setState('idle')} />
      {state === 'idle' && (
        <button onClick={play} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white dark:bg-[#1A1A2E] text-gray-600 dark:text-gray-300 hover:border-cta-from hover:text-cta-from text-xs font-medium transition-colors">
          <Volume2 className="w-3.5 h-3.5" /> {listen}
        </button>
      )}
      {state === 'speaking' && (
        <button onClick={() => audioRef.current?.pause()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cta-from bg-cta-from/10 text-cta-from text-xs font-medium transition-colors">
          <Pause className="w-3.5 h-3.5" /> {pause}
        </button>
      )}
      {state === 'paused' && (
        <button onClick={play} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium transition-colors">
          <Play className="w-3.5 h-3.5" /> {cont}
        </button>
      )}
      {state !== 'idle' && (
        <button onClick={() => { audioRef.current?.pause(); if (audioRef.current) audioRef.current.currentTime = 0; setState('idle'); }}
          className="p-1.5 rounded-lg border border-border text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors">
          <Square className="w-3.5 h-3.5" />
        </button>
      )}
      <RateSelect value={rate} onChange={onRateChange} appLang={appLang} />
    </>
  );
}

// ── Web Speech player ──────────────────────────────────────────────────────────
function WebSpeechPlayer({ text, rate, onRateChange, gender, appLang, voices }: {
  text: string; rate: number; onRateChange: (r: number) => void;
  gender: Gender; appLang: 'es' | 'en'; voices: SpeechSynthesisVoice[];
}) {
  const [state, setState] = useState<TTSState>('idle');

  // Cancel whenever the voice config changes so next play uses updated settings
  useEffect(() => { window.speechSynthesis?.cancel(); setState('idle'); }, [gender, appLang, rate]);
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  const handlePlay = useCallback(() => {
    if (!window.speechSynthesis) return;
    if (state === 'paused') { window.speechSynthesis.resume(); setState('speaking'); return; }

    window.speechSynthesis.cancel();
    const plain = stripHtml(text);
    if (!plain.trim()) return;

    const utt   = new SpeechSynthesisUtterance(plain);
    const voice = pickVoice(gender, appLang, voices);

    if (voice) {
      utt.voice = voice;
      utt.lang  = voice.lang;
    } else {
      // Force language so browser doesn't narrate Spanish text with English phonology
      utt.lang = appLang === 'es' ? 'es-MX' : 'en-US';
    }
    utt.rate    = rate;
    utt.onstart  = () => setState('speaking');
    utt.onpause  = () => setState('paused');
    utt.onresume = () => setState('speaking');
    utt.onend    = () => setState('idle');
    utt.onerror  = () => setState('idle');
    window.speechSynthesis.speak(utt);
    setState('speaking');
  }, [state, text, rate, gender, appLang, voices]);

  if (typeof window !== 'undefined' && !window.speechSynthesis) return null;

  const listen = appLang === 'en' ? 'Listen'   : 'Escuchar';
  const pause  = appLang === 'en' ? 'Pause'    : 'Pausar';
  const cont   = appLang === 'en' ? 'Continue' : 'Continuar';

  return (
    <>
      {state === 'idle' && (
        <button onClick={handlePlay} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white dark:bg-[#1A1A2E] text-gray-600 dark:text-gray-300 hover:border-cta-from hover:text-cta-from text-xs font-medium transition-colors">
          <Volume2 className="w-3.5 h-3.5" /> {listen}
        </button>
      )}
      {state === 'speaking' && (
        <button onClick={() => { window.speechSynthesis?.pause(); setState('paused'); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cta-from bg-cta-from/10 text-cta-from text-xs font-medium transition-colors">
          <Pause className="w-3.5 h-3.5" /> {pause}
        </button>
      )}
      {state === 'paused' && (
        <button onClick={handlePlay} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium transition-colors">
          <Play className="w-3.5 h-3.5" /> {cont}
        </button>
      )}
      {state !== 'idle' && (
        <button onClick={() => { window.speechSynthesis?.cancel(); setState('idle'); }} className="p-1.5 rounded-lg border border-border text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors">
          <Square className="w-3.5 h-3.5" />
        </button>
      )}
      <RateSelect value={rate} onChange={onRateChange} appLang={appLang} />
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function TextToSpeechButton({ text, audioUrl, className = '', adminMode = false }: Props) {
  const { lang } = useLanguage();
  const voices   = useVoices();

  const [gender, setGender] = useState<Gender>(() =>
    typeof window !== 'undefined' && localStorage.getItem('tts-gender') === 'male' ? 'male' : 'female'
  );
  const [source, setSource] = useState<TTSSource>(() =>
    typeof window !== 'undefined' && localStorage.getItem('tts-source') === 'polly' ? 'polly' : 'web'
  );
  const [rate, setRate] = useState<number>(() =>
    typeof window !== 'undefined' ? parseFloat(localStorage.getItem('tts-rate') ?? '1') : 1
  );

  const handleGenderChange = (g: Gender) => {
    setGender(g);
    localStorage.setItem('tts-gender', g);
    if (source === 'polly') { setSource('web'); localStorage.setItem('tts-source', 'web'); }
  };

  const handleRateChange = (r: number) => { setRate(r); localStorage.setItem('tts-rate', String(r)); };

  // Admin preview: only Polly audio, no controls
  if (adminMode && audioUrl) {
    return (
      <div className={`flex items-center gap-2 flex-wrap ${className}`}>
        <PollyPlayer audioUrl={audioUrl} rate={rate} onRateChange={handleRateChange} appLang={lang} />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {audioUrl && source === 'polly'
        ? <PollyPlayer audioUrl={audioUrl} rate={rate} onRateChange={handleRateChange} appLang={lang} />
        : <WebSpeechPlayer text={text} rate={rate} onRateChange={handleRateChange}
            gender={gender} appLang={lang} voices={voices} />
      }

      {/* Profile selector — always visible, labels change with app language */}
      <select value={gender} onChange={e => handleGenderChange(e.target.value as Gender)}
        className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
        title={lang === 'en' ? 'Voice profile' : 'Perfil de voz'}>
        <option value="female">{profileLabel('female', lang)}</option>
        <option value="male">{profileLabel('male', lang)}</option>
      </select>

      {/* Source switcher — only when Polly audio exists */}
      {audioUrl && (
        <select value={source} onChange={e => { const s = e.target.value as TTSSource; setSource(s); localStorage.setItem('tts-source', s); }}
          className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
          title={lang === 'en' ? 'Audio source' : 'Fuente de audio'}>
          <option value="web">{lang === 'en' ? 'My voice' : 'Mi voz preferida'}</option>
          <option value="polly">{lang === 'en' ? 'Course voice' : 'Voz del curso'}</option>
        </select>
      )}
    </div>
  );
}
