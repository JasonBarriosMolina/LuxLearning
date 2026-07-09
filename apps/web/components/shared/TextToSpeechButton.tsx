'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Pause, Play, Square } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

interface Props {
  text: string;
  audioUrl?: string;
  className?: string;
  adminMode?: boolean; // admin preview: only Polly audio, no profile selector
}

// ── Voice profile definition ───────────────────────────────────────────────────
type Gender  = 'female' | 'male';
type TTSState  = 'idle' | 'speaking' | 'paused';
type TTSSource = 'web' | 'polly';

interface Profile { id: string; labelEs: string; labelEn: string; gender: Gender; }

const PROFILES: Profile[] = [
  { id: 'f', labelEs: 'Voz femenina ♀', labelEn: 'Female voice ♀', gender: 'female' },
  { id: 'm', labelEs: 'Voz masculina ♂', labelEn: 'Male voice ♂',   gender: 'male'   },
];

// ── Comprehensive gender name lists ────────────────────────────────────────────
// Spanish feminine names found across macOS, Windows, iOS, Android
const ES_FEMALE = [
  'mónica','monica','paulina','lucía','lucia','lupe','marisol','helena','sabina',
  'sofía','sofia','isabella','valentina','camila','maria','laura','ana','elena',
  'rosa','isabel','andrea','diana','mia','penélope','penelope','dalia','pilar',
  'conchita','jorge'/* some OS label a neutral voice Jorge but it reads female */,
  'female','mujer','femenin',
  // Windows Neural voices (spanish)
  'abril','beatriz','candela','carlota','catalina','irene','laia','salome',
  'ximena','renata','nuria','paloma','clara','estrella','vera','raquel',
];
// Spanish masculine names
const ES_MALE = [
  'jorge','pablo','enrique','diego','pedro','andrés','andres','miguel',
  'juan','sergio','raúl','raul','antonio','manuel','alberto','ernesto',
  'male','hombre','masculin',
  // Windows Neural voices
  'alejandro','alvaro','armando','dario','gerardo','jacobo','lionel',
  'tomas','jorge','placido','rodrigo',
];

// English feminine names
const EN_FEMALE = [
  'samantha','karen','victoria','tessa','kate','fiona','moira','veena',
  'ava','allison','susan','zoe','emily','joanna','ivy','kendra','kimberly',
  'salli','female','woman','girl',
  // Windows Neural
  'aria','jenny','michelle','elizabeth','amber','ana','ashley','cora',
  'emma','jane','nancy','sara','steffan',
];
// English masculine names
const EN_MALE = [
  'alex','daniel','fred','lee','tom','gordon','rishi','oliver',
  'justin','matthew','joey','brian','eric',
  'male','man','guy',
  // Windows Neural
  'andrew','christopher','eric','guy','jacob','liam','ryan','tony',
  'davis','jason','brandon','derek','gabriel','james','logan','william',
];

function nameLower(v: SpeechSynthesisVoice) { return v.name.toLowerCase(); }

function isFemaleES(v: SpeechSynthesisVoice) { return ES_FEMALE.some((m) => nameLower(v).includes(m)); }
function isMaleES(v: SpeechSynthesisVoice)   { return ES_MALE.some((m) => nameLower(v).includes(m)); }
function isFemaleEN(v: SpeechSynthesisVoice) { return EN_FEMALE.some((m) => nameLower(v).includes(m)); }
function isMaleEN(v: SpeechSynthesisVoice)   { return EN_MALE.some((m) => nameLower(v).includes(m)); }

// ── Async voice loader (Chrome needs onvoiceschanged) ──────────────────────────
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

// ── Pick the best voice for a given lang + gender ─────────────────────────────
// Priority: exact lang-country match → lang prefix → fallback to any voice
function pickVoice(
  gender: Gender,
  appLang: 'es' | 'en',
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  const isFemale = appLang === 'es' ? isFemaleES : isFemaleEN;
  const isMale   = appLang === 'es' ? isMaleES   : isMaleEN;

  // Filter by language prefix
  const byLang = voices.filter((v) => v.lang.toLowerCase().startsWith(appLang));
  const pool   = byLang.length > 0 ? byLang : voices;

  const females = pool.filter(isFemale);
  const males   = pool.filter(isMale);
  const unknown = pool.filter((v) => !isFemale(v) && !isMale(v));

  if (gender === 'female') {
    // Prefer labelled female, then unknown (could be female), then male as last resort
    return females[0] ?? unknown[0] ?? males[0] ?? pool[0];
  } else {
    return males[0] ?? unknown[1] ?? unknown[0] ?? females[0] ?? pool[0];
  }
}

// ── Strip HTML for speech synthesis ───────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '. ').replace(/<\/h[1-6]>/gi, '. ')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Speed selector (shared) ───────────────────────────────────────────────────
function RateSelect({ value, onChange }: { value: number; onChange: (r: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
      title="Velocidad"
    >
      <option value={0.75}>0.75×</option>
      <option value={1}>1×</option>
      <option value={1.25}>1.25×</option>
      <option value={1.5}>1.5×</option>
      <option value={2}>2×</option>
    </select>
  );
}

// ── Polly (pre-generated audio) player ────────────────────────────────────────
function PollyPlayer({ audioUrl, rate, onRateChange }: {
  audioUrl: string; rate: number; onRateChange: (r: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<TTSState>('idle');

  useEffect(() => { return () => { audioRef.current?.pause(); }; }, []);
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);

  const play = () => {
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
        <button onClick={play}
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
        <button onClick={play}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium transition-colors">
          <Play className="w-3.5 h-3.5" /> Continuar
        </button>
      )}
      {state !== 'idle' && (
        <button onClick={() => { audioRef.current?.pause(); if (audioRef.current) audioRef.current.currentTime = 0; setState('idle'); }}
          className="p-1.5 rounded-lg border border-border text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors">
          <Square className="w-3.5 h-3.5" />
        </button>
      )}
      <RateSelect value={rate} onChange={onRateChange} />
    </>
  );
}

// ── Web Speech player ──────────────────────────────────────────────────────────
function WebSpeechPlayer({ text, rate, onRateChange, gender, appLang, voices }: {
  text: string; rate: number; onRateChange: (r: number) => void;
  gender: Gender; appLang: 'es' | 'en'; voices: SpeechSynthesisVoice[];
}) {
  const [state, setState] = useState<TTSState>('idle');

  // Cancel on voice setting change so next play picks new settings
  useEffect(() => {
    window.speechSynthesis?.cancel();
    setState('idle');
  }, [gender, appLang, rate]);

  useEffect(() => { return () => { window.speechSynthesis?.cancel(); }; }, []);

  const handlePlay = useCallback(() => {
    if (!window.speechSynthesis) return;
    if (state === 'paused') { window.speechSynthesis.resume(); setState('speaking'); return; }

    window.speechSynthesis.cancel();
    const plain = stripHtml(text);
    if (!plain.trim()) return;

    const utterance = new SpeechSynthesisUtterance(plain);
    const voice = pickVoice(gender, appLang, voices);

    if (voice) {
      utterance.voice = voice;
      utterance.lang  = voice.lang;
    } else {
      utterance.lang = appLang === 'es' ? 'es-ES' : 'en-US';
    }
    utterance.rate = rate;

    utterance.onstart  = () => setState('speaking');
    utterance.onpause  = () => setState('paused');
    utterance.onresume = () => setState('speaking');
    utterance.onend    = () => setState('idle');
    utterance.onerror  = () => setState('idle');

    window.speechSynthesis.speak(utterance);
    setState('speaking');
  }, [state, text, rate, gender, appLang, voices]);

  const handlePause = () => { window.speechSynthesis?.pause(); setState('paused'); };
  const handleStop  = () => { window.speechSynthesis?.cancel(); setState('idle'); };

  if (typeof window !== 'undefined' && !window.speechSynthesis) return null;

  return (
    <>
      {state === 'idle' && (
        <button onClick={handlePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white dark:bg-[#1A1A2E] text-gray-600 dark:text-gray-300 hover:border-cta-from hover:text-cta-from text-xs font-medium transition-colors">
          <Volume2 className="w-3.5 h-3.5" /> {appLang === 'es' ? 'Escuchar' : 'Listen'}
        </button>
      )}
      {state === 'speaking' && (
        <button onClick={handlePause}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cta-from bg-cta-from/10 text-cta-from text-xs font-medium transition-colors">
          <Pause className="w-3.5 h-3.5" /> {appLang === 'es' ? 'Pausar' : 'Pause'}
        </button>
      )}
      {state === 'paused' && (
        <button onClick={handlePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium transition-colors">
          <Play className="w-3.5 h-3.5" /> {appLang === 'es' ? 'Continuar' : 'Continue'}
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
  const { lang } = useLanguage();
  const voices   = useVoices();

  // Each preference is stored independently in localStorage (per user/browser)
  const [gender, setGender] = useState<Gender>(() => {
    if (typeof window === 'undefined') return 'female';
    return localStorage.getItem('tts-gender') === 'male' ? 'male' : 'female';
  });

  const [source, setSource] = useState<TTSSource>(() => {
    if (typeof window === 'undefined') return 'web';
    return localStorage.getItem('tts-source') === 'polly' ? 'polly' : 'web';
  });

  const [rate, setRate] = useState<number>(() =>
    typeof window !== 'undefined' ? parseFloat(localStorage.getItem('tts-rate') ?? '1') : 1
  );

  const handleGenderChange = (g: Gender) => {
    setGender(g);
    localStorage.setItem('tts-gender', g);
    // Switching voice profile → always use web speech so the new voice is heard
    if (source === 'polly') { setSource('web'); localStorage.setItem('tts-source', 'web'); }
  };

  const handleRateChange = (r: number) => {
    setRate(r);
    localStorage.setItem('tts-rate', String(r));
  };

  // Admin preview mode: only Polly audio, no controls for the editor
  if (adminMode && audioUrl) {
    return (
      <div className={`flex items-center gap-2 flex-wrap ${className}`}>
        <PollyPlayer audioUrl={audioUrl} rate={rate} onRateChange={handleRateChange} />
      </div>
    );
  }

  const profileLabel = (p: Profile) => lang === 'en' ? p.labelEn : p.labelEs;

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {/* Audio player */}
      {audioUrl && source === 'polly'
        ? <PollyPlayer audioUrl={audioUrl} rate={rate} onRateChange={handleRateChange} />
        : <WebSpeechPlayer
            text={text} rate={rate} onRateChange={handleRateChange}
            gender={gender} appLang={lang} voices={voices}
          />
      }

      {/* Profile selector — always visible to the user (student/evaluator/admin) */}
      <select
        value={gender}
        onChange={(e) => handleGenderChange(e.target.value as Gender)}
        className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
        title={lang === 'en' ? 'Voice profile' : 'Perfil de voz'}
      >
        {PROFILES.map((p) => (
          <option key={p.id} value={p.id}>{profileLabel(p)}</option>
        ))}
      </select>

      {/* Source switcher — only when Polly audio exists */}
      {audioUrl && (
        <select
          value={source}
          onChange={(e) => { const s = e.target.value as TTSSource; setSource(s); localStorage.setItem('tts-source', s); }}
          className="text-xs border border-border rounded-lg px-1.5 py-1 bg-white dark:bg-[#1A1A2E] text-gray-500 dark:text-gray-400 cursor-pointer"
          title={lang === 'en' ? 'Audio source' : 'Fuente de audio'}
        >
          <option value="web">{lang === 'en' ? 'My voice' : 'Mi voz preferida'}</option>
          <option value="polly">{lang === 'en' ? 'Course voice' : 'Voz del curso'}</option>
        </select>
      )}
    </div>
  );
}
