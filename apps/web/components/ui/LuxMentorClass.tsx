'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { PlayCircle, CheckCircle, Mic, MicOff, Volume2, BookOpen, Loader2, AlertCircle, WifiOff, Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import { LuxMentorClassReview } from './LuxMentorClassReview';
import { buildSystemPrompt, extractYouTubeId } from './LuxMentorClass.helpers';
import type Vapi from '@vapi-ai/web';

interface ClassSession {
  sessionId: string;
  status: string;
  grade?: number;
  feedback?: string;
  messages?: any[];
  aiAnalysis?: string;
  aiScore?: number;
  voided?: boolean;
  hasCompletedQA?: boolean;
  transcript?: string;
}

interface StartData {
  sessionId: string | null;
  vapiPublicKey: string;
  hasCompletedQA: boolean;
  attemptsExhausted?: boolean;
  attemptsUsed?: number;
  attemptsMax?: number;
  vapiPrompt: string | null;
  vapiObjectives: string | null;
  lessonVideoUrl: string | null;
  lessonScript: string | null;
  transcript?: string | null;
  messages?: any[];
}

interface Props {
  courseId: string;
  moduleId: string;
  sessions: ClassSession[];
  onCompleted: () => void;
}

type Phase = 'idle' | 'loading' | 'content' | 'connecting' | 'active' | 'ended' | 'review' | 'error';

const TOTAL_SECONDS = 600;    // 10 minutes total
const MONOLOGUE_SECONDS = 300; // first 5 min = exposition, mic muted
const TIMER_REVEAL_AT = 120;  // reveal timer when 2 min remaining
const SYSTEM_MSG_AT = 60;     // send warning when 1 min remaining

export function LuxMentorClass({ courseId, moduleId, sessions, onCompleted }: Props) {
  const { lang } = useLanguage();
  const s = useCallback((es: string, en: string) => lang === 'en' ? en : es, [lang]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [subPhase, setSubPhase] = useState<'monologue' | 'qa'>('monologue');
  const [error, setError] = useState('');
  const [startData, setStartData] = useState<StartData | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  // Timer state
  const [remainingSeconds, setRemainingSeconds] = useState(TOTAL_SECONDS);
  const [timerVisible, setTimerVisible] = useState(false);
  const systemMsgSentRef = useRef(false);
  const monoTransitionSentRef = useRef(false);
  const callStartTimeRef = useRef<number>(0);

  const vapiRef = useRef<Vapi | null>(null);
  const sessionIdRef = useRef<string>('');

  const cleanup = useCallback(() => {
    if (vapiRef.current) {
      try { vapiRef.current.stop(); } catch {}
      vapiRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Auto-load startData when completedSession detected (for lessonScript + transcript) ──
  useEffect(() => {
    const completedSess = sessions.find((s) => s.hasCompletedQA || s.status === 'completed');
    if (!completedSess || startData) return;
    api.classes.start({ courseId, moduleId })
      .then((res) => setStartData((res as any).data as StartData))
      .catch(() => {});
  }, [sessions, courseId, moduleId, startData]);

  // ── 10-minute countdown: Fase 1 (monólogo, 0-5 min) → Fase 2 (Q&A, 5-10 min) ─
  useEffect(() => {
    if (phase !== 'active') {
      setTimerVisible(false);
      systemMsgSentRef.current = false;
      monoTransitionSentRef.current = false;
      return;
    }
    callStartTimeRef.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
      const remaining = Math.max(0, TOTAL_SECONDS - elapsed);
      setRemainingSeconds(remaining);

      // Monologue → Q&A transition at 5 min
      if (elapsed >= MONOLOGUE_SECONDS && !monoTransitionSentRef.current) {
        monoTransitionSentRef.current = true;
        try { (vapiRef.current as any)?.setMuted(false); } catch {}
        setSubPhase('qa');
        try {
          (vapiRef.current as any)?.send({
            type: 'add-message',
            message: {
              role: 'system',
              content: lang === 'en'
                ? 'The 5-minute exposition is complete. Transition now: say "I have finished the lesson content. I will now open the floor for questions." Then begin the interactive Q&A phase.'
                : 'Los 5 minutos de exposición están completos. Transiciona ahora: di "He concluido el contenido de la lección. Ahora abro el espacio para preguntas." Luego inicia el Q&A interactivo.',
            },
          });
        } catch { /* non-fatal */ }
      }

      // Timer reveal at 2 min remaining (Q&A phase only)
      if (remaining <= TIMER_REVEAL_AT) setTimerVisible(true);

      // 1-min warning
      if (remaining <= SYSTEM_MSG_AT && !systemMsgSentRef.current && vapiRef.current) {
        systemMsgSentRef.current = true;
        try {
          (vapiRef.current as any).send({
            type: 'add-message',
            message: {
              role: 'system',
              content: lang === 'en'
                ? 'One minute remaining. Please summarize the topics covered today and say a warm goodbye to the student.'
                : 'Queda 1 minuto. Por favor haz un resumen de los temas vistos hoy y despídete amablemente del estudiante.',
            },
          });
        } catch { /* non-fatal */ }
      }

      if (remaining <= 0) {
        cleanup();
        if (sessionIdRef.current) {
          api.classes.update(sessionIdRef.current, { status: 'completed', hasCompletedQA: true } as any).catch(() => {});
        }
        setPhase('ended');
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, lang, cleanup]);

  // Derived: check sessions prop for completed state (from parent)
  const completedSession = sessions.find((s) => s.hasCompletedQA || s.status === 'completed');
  const voidedOnly = sessions.length > 0 && sessions.every((s) => s.voided);

  const startFlow = async () => {
    setPhase('loading');
    setError('');
    try {
      const res = await api.classes.start({ courseId, moduleId });
      const data = (res as any).data as StartData;

      if (data?.hasCompletedQA) {
        setStartData(data);
        setPhase('review');
        return;
      }
      if (data?.attemptsExhausted) {
        setError(s('Has utilizado todos tus intentos disponibles para esta clase.', 'You have used all available attempts for this class.'));
        setPhase('error');
        return;
      }
      if (!data?.vapiPublicKey) {
        setError(s('Esta clase aún no está configurada. Contacta a tu evaluador.', 'This class is not configured yet. Contact your evaluator.'));
        setPhase('error');
        return;
      }
      setStartData(data);
      sessionIdRef.current = data.sessionId ?? '';
      await api.classes.update(sessionIdRef.current, { status: 'content_viewed' }).catch(() => {});
      setPhase('content');
    } catch {
      setError(s('No se pudo iniciar la clase. Intenta de nuevo.', 'Could not start the class. Please try again.'));
      setPhase('error');
    }
  };

  const connectVapi = async () => {
    if (!startData) return;
    setPhase('connecting');
    const VapiClass = (await import('@vapi-ai/web')).default;
    const vapi = new VapiClass(startData.vapiPublicKey);
    vapiRef.current = vapi;

    vapi.on('call-start', async () => {
      setPhase('active');
      setSubPhase('monologue');
      setRemainingSeconds(TOTAL_SECONDS);
      setTimerVisible(false);
      systemMsgSentRef.current = false;
      monoTransitionSentRef.current = false;
      // Mute student mic during Fase 1 (monologue)
      try { (vapi as any).setMuted(true); } catch {}
      const callId = (vapi as any).callId ?? '';
      if (callId && sessionIdRef.current) {
        await api.classes.update(sessionIdRef.current, { vapiCallId: callId, status: 'qa_started' }).catch(() => {});
      }
    });

    vapi.on('call-end', async () => {
      cleanup();
      if (sessionIdRef.current) {
        await api.classes.update(sessionIdRef.current, { status: 'completed', hasCompletedQA: true } as any).catch(() => {});
      }
      setPhase('ended');
    });

    vapi.on('speech-start', () => setIsSpeaking(true));
    vapi.on('speech-end', () => setIsSpeaking(false));
    vapi.on('volume-level', (v: number) => setVolume(v));
    vapi.on('error', (e: any) => {
      console.error('[vapi-class]', e);
      setError(s('Ocurrió un error durante la sesión.', 'An error occurred during the session.'));
      setPhase('error');
      cleanup();
    });

    await vapi.start({
      transcriber: { provider: 'deepgram', model: 'nova-2', language: lang === 'en' ? 'en' : 'es' },
      model: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'system', content: buildSystemPrompt(startData.vapiPrompt, startData.vapiObjectives, lang, startData.lessonScript) }],
      },
      voice: { provider: 'vapi', voiceId: 'Kai', version: 2, language: 'auto' } as any,
      name: 'Lux Mentor',
      firstMessage: lang === 'en'
        ? 'Hello! I\'m Lux Mentor. I\'ll now deliver today\'s lesson content. Please listen carefully — your microphone will activate for questions after the exposition.'
        : 'Hola, soy Lux Mentor. Voy a exponer el contenido de la lección de hoy. Por favor escucha con atención — tu micrófono se activará para preguntas después de la exposición.',
      endCallMessage: lang === 'en'
        ? 'Thank you for our conversation today. Keep up the great work!'
        : 'Gracias por nuestra conversación de hoy. ¡Sigue adelante con tu aprendizaje!',
    });
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s2 = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;
  };

  // ── REVIEW mode (post-class tabs) ────────────────────────────────────────────
  if (phase === 'review' || (completedSession && phase === 'idle')) {
    const review = startData ?? {
      transcript: completedSession?.transcript ?? null,
      messages: completedSession?.messages ?? [],
      lessonScript: null,
    };
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 p-3 border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800/20 rounded-xl">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-charcoal dark:text-gray-100 text-sm">{s('Clase con Lux Mentor', 'Lux Mentor Class')}</p>
            <p className="text-xs text-gray-500">
              {completedSession?.grade != null
                ? s(`Calificada: ${completedSession.grade}%`, `Graded: ${completedSession.grade}%`)
                : s('Completada — pendiente de calificación', 'Completed — awaiting grading')}
            </p>
          </div>
        </div>
        {completedSession?.aiAnalysis && (
          <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-3">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">{s('Análisis IA', 'AI Analysis')}</p>
            <p className="text-xs text-blue-600 dark:text-blue-400">{completedSession.aiAnalysis}</p>
          </div>
        )}
        <LuxMentorClassReview
          transcript={review.transcript ?? null}
          messages={review.messages ?? []}
          lessonScript={review.lessonScript ?? null}
        />
      </div>
    );
  }

  // ── ENDED — "received" screen ─────────────────────────────────────────────────
  if (phase === 'ended') {
    return (
      <div className="border border-border rounded-xl p-6 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto">
          <CheckCircle className="w-7 h-7 text-emerald-600" />
        </div>
        <div>
          <p className="font-semibold text-charcoal">{s('¡Clase completada!', 'Class completed!')}</p>
          <p className="text-sm text-gray-500 mt-1">{s('Tu evaluador revisará tu sesión pronto.', 'Your evaluator will review your session soon.')}</p>
        </div>
        <button onClick={() => { setPhase('idle'); onCompleted(); }} className="btn-primary inline-flex items-center gap-2 mx-auto">
          {s('Continuar', 'Continue')}
        </button>
      </div>
    );
  }

  // ── ERROR state ───────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-charcoal">{s('Error en la clase', 'Class error')}</p>
            <p className="text-xs text-gray-500 mt-0.5">{error}</p>
          </div>
          <button onClick={() => { setPhase('idle'); setError(''); }} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            {s('Cerrar', 'Close')}
          </button>
        </div>
        {voidedOnly && (
          <div className="flex items-start gap-2 bg-amber-50 rounded-lg p-3">
            <WifiOff className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">{s('Detectamos un fallo de red anterior. Puedes reintentar.', 'We detected a previous network failure. You can retry.')}</p>
          </div>
        )}
      </div>
    );
  }

  // ── ACTIVE / CONNECTING — animated logo + optional countdown ─────────────────
  if (phase === 'active' || phase === 'connecting') {
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
                : subPhase === 'monologue'
                  ? s('Exponiendo lección…', 'Delivering lesson…')
                  : isSpeaking ? s('Hablando…', 'Speaking…') : s('Escuchando…', 'Listening…')}
            </p>
          </div>
          {/* Phase badge */}
          {phase === 'active' && subPhase === 'monologue' && (
            <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1 text-xs text-white/80">
              <MicOff className="w-3 h-3" />
              {s('Tu micrófono se activará en la sesión de preguntas', 'Your mic activates in the Q&A session')}
            </div>
          )}
          {phase === 'active' && subPhase === 'qa' && (
            <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1 text-xs text-white/80">
              <Mic className="w-3 h-3" />
              {s('Modo preguntas — tu micrófono está activo', 'Q&A mode — your mic is active')}
            </div>
          )}
          {/* Countdown — only visible in last 2 min */}
          {timerVisible && phase === 'active' && (
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-1.5 animate-fade-in">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-white font-mono text-sm font-semibold">{formatTime(remainingSeconds)}</span>
              <span className="text-white/60 text-xs">{s('restantes', 'remaining')}</span>
            </div>
          )}
        </div>
        <div className="p-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">{s('Sesión con Lux Mentor en curso', 'Lux Mentor session in progress')}</p>
          {phase === 'active' && (
            <button
              onClick={() => { cleanup(); if (sessionIdRef.current) api.classes.update(sessionIdRef.current, { status: 'completed' }).catch(() => {}); setPhase('ended'); }}
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

  // ── CONTENT phase (Phase 1 — static material before Q&A) ─────────────────────
  if (phase === 'content' && startData) {
    return (
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-surface px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
            <Volume2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-charcoal">{s('Contenido de la lección', 'Lesson Content')}</p>
            <p className="text-xs text-gray-500">{s('Revisa el material antes de conversar con Mentor', 'Review the material before talking with Mentor')}</p>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {startData.lessonVideoUrl && (
            <div className="rounded-xl overflow-hidden bg-black aspect-video">
              {startData.lessonVideoUrl.includes('youtube.com') || startData.lessonVideoUrl.includes('youtu.be') ? (
                <iframe
                  src={`https://www.youtube.com/embed/${extractYouTubeId(startData.lessonVideoUrl)}`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video src={startData.lessonVideoUrl} controls className="w-full h-full" />
              )}
            </div>
          )}
          {startData.lessonScript && !startData.lessonVideoUrl && (
            <div className="bg-gray-50 rounded-xl p-4 max-h-56 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">{s('Contenido', 'Content')}</p>
              <p className="text-sm text-charcoal leading-relaxed whitespace-pre-wrap">{startData.lessonScript}</p>
            </div>
          )}
          <button onClick={connectVapi} className="btn-primary w-full flex items-center justify-center gap-2">
            <Mic className="w-4 h-4" />
            {s('Iniciar sesión con Lux Mentor', 'Start Lux Mentor session')}
          </button>
          <p className="text-xs text-gray-400 text-center">
            {s(`Sesión de voz · ${startData.attemptsMax ?? 2} intentos máx`, `Voice session · max ${startData.attemptsMax ?? 2} attempts`)}
            {(startData.attemptsUsed ?? 0) > 0
              ? s(` · ${startData.attemptsUsed} usado${(startData.attemptsUsed ?? 0) !== 1 ? 's' : ''}`, ` · ${startData.attemptsUsed} used`)
              : ''}
          </p>
        </div>
      </div>
    );
  }

  // ── IDLE / LOADING ────────────────────────────────────────────────────────────
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="bg-surface px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center">
          <Mic className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-charcoal">{s('Clase con Lux Mentor', 'Lux Mentor Class')}</p>
          <p className="text-xs text-gray-500">{s('Sesión de voz interactiva (10 min)', 'Interactive voice session (10 min)')}</p>
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
          <span>{s('Contenido → Conversación con Mentor (10 min máx)', 'Content → Mentor Conversation (10 min max)')}</span>
        </div>
        <button
          onClick={startFlow}
          disabled={phase === 'loading'}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {phase === 'loading' ? (
            <><Loader2 className="w-4 h-4 animate-spin" />{s('Cargando…', 'Loading…')}</>
          ) : (
            <><PlayCircle className="w-4 h-4" />{voidedOnly ? s('Reintentar clase', 'Retry class') : s('Iniciar clase', 'Start class')}</>
          )}
        </button>
        {sessions.length > 0 && !voidedOnly && (
          <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1">
            <Ban className="w-3 h-3" />
            {s('Esta clase puede tomarse una sola vez', 'This class can only be taken once')}
          </p>
        )}
      </div>
    </div>
  );
}

// helpers re-exported from LuxMentorClass.helpers.ts
