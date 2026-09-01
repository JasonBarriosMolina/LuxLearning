'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { PlayCircle, CheckCircle, Mic, MicOff, Volume2, BookOpen, Loader2, AlertCircle, WifiOff, Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import { LuxMentorClassReview } from './LuxMentorClassReview';
import { buildSystemPrompt, extractYouTubeId, computeSilenceAction } from './LuxMentorClass.helpers';
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
  lessonAudioUrl?: string | null;
  closingScript?: string | null;
  closingAudioUrl?: string | null;
  transcript?: string | null;
  messages?: any[];
}

interface Props {
  courseId: string;
  moduleId: string;
  sessions: ClassSession[];
  onCompleted: () => void;
}

type Phase = 'idle' | 'loading' | 'content' | 'narrating' | 'connecting' | 'active' | 'closing' | 'ended' | 'review' | 'error';

// Restructured (Trello DmPpbrff, 2026-08-31 04:01): the exposition is now narrated by
// Amazon Polly ('narrating' phase, plain <audio>) BEFORE Vapi ever connects — Vapi
// handles ONLY the live Q&A. This is also what fixes the class hanging after the old
// "microphone will be deactivated" message: that whole monologue/mic-mute mechanism is
// gone, replaced by a linear content → narration → Q&A call → Polly closing flow.
const QA_TARGET_SECONDS = 300;      // ~5 min target Q&A length
const QA_GRACE_SECONDS = 60;        // +1 min grace if no natural close by the target
const QA_HARD_LIMIT_SECONDS = QA_TARGET_SECONDS + QA_GRACE_SECONDS;
const QA_WARNING_AT_REMAINING = 120; // send the wrap-up cue with 2 min of the target left
// Silence handling (Trello DmPpbrff item 7, 2026-08-30 20:28) — unchanged logic, now
// active for the WHOLE call since there's no more separate monologue phase.
const SILENCE_CHECKIN_SECONDS = 12;
const SILENCE_END_SECONDS = 10;

export function LuxMentorClass({ courseId, moduleId, sessions, onCompleted }: Props) {
  const { lang } = useLanguage();
  const s = useCallback((es: string, en: string) => lang === 'en' ? en : es, [lang]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [startData, setStartData] = useState<StartData | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const systemMsgSentRef = useRef(false);
  const callStartTimeRef = useRef<number>(0);
  const sessionCompletedRef = useRef(false); // guard: prevent double-update when timer + call-end both fire
  const lastUserSpeechAtRef = useRef<number>(0);
  const silenceCheckinSentRef = useRef(false);
  const silenceCheckinAtRef = useRef<number>(0);
  const silenceEndingRef = useRef(false); // guards the end-the-call sequence from re-firing

  const vapiRef = useRef<Vapi | null>(null);
  const sessionIdRef = useRef<string>('');
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const closingAudioRef = useRef<HTMLAudioElement | null>(null);

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

  // ── Q&A countdown: warn near the target, hard-cutoff after the grace period ──
  useEffect(() => {
    if (phase !== 'active') {
      systemMsgSentRef.current = false;
      silenceCheckinSentRef.current = false;
      silenceEndingRef.current = false;
      return;
    }
    callStartTimeRef.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTimeRef.current) / 1000);

      // Silence handling — active for the whole call now (no separate monologue phase).
      if (vapiRef.current && !silenceEndingRef.current) {
        const silenceAction = computeSilenceAction({
          inQA: true,
          silenceSeconds: (Date.now() - lastUserSpeechAtRef.current) / 1000,
          checkinSent: silenceCheckinSentRef.current,
          secondsSinceCheckin: silenceCheckinSentRef.current ? (Date.now() - silenceCheckinAtRef.current) / 1000 : 0,
          checkinThreshold: SILENCE_CHECKIN_SECONDS,
          endThreshold: SILENCE_END_SECONDS,
        });
        if (silenceAction === 'checkin') {
          silenceCheckinSentRef.current = true;
          silenceCheckinAtRef.current = Date.now();
          try {
            (vapiRef.current as any).send({
              type: 'add-message',
              message: {
                role: 'system',
                content: lang === 'en'
                  ? 'The student has been silent for a while. Ask if they are still there — a short, direct check-in question.'
                  : 'El estudiante ha estado en silencio un momento. Pregunta si sigue ahí — una pregunta corta y directa de verificación.',
              },
            });
          } catch { /* non-fatal */ }
        } else if (silenceAction === 'end') {
          silenceEndingRef.current = true;
          try {
            (vapiRef.current as any).send({
              type: 'add-message',
              message: {
                role: 'system',
                content: lang === 'en'
                  ? 'There has been no response. Say: "It looks like you\'re not here, so we\'ll end the class here." Then stop — the Q&A section is now closed.'
                  : 'No ha habido respuesta. Di: "Parece que no estás aquí, así que vamos a cerrar la clase aquí." Luego detente — la sección de preguntas queda cerrada.',
              },
            });
          } catch { /* non-fatal */ }
          setTimeout(() => {
            cleanup();
            if (sessionIdRef.current && !sessionCompletedRef.current) {
              sessionCompletedRef.current = true;
              api.classes.update(sessionIdRef.current, { status: 'completed', hasCompletedQA: true } as any).catch(() => {});
            }
            setPhase('closing');
          }, 6000);
        }
      }

      // Wrap-up cue — invisible to the student (no countdown UI), 2 min before the target.
      if (elapsed >= QA_TARGET_SECONDS - QA_WARNING_AT_REMAINING && !systemMsgSentRef.current && vapiRef.current) {
        systemMsgSentRef.current = true;
        try {
          (vapiRef.current as any).send({
            type: 'add-message',
            message: {
              role: 'system',
              content: lang === 'en'
                ? 'The session is wrapping up soon. Start moving toward a natural close of the conversation.'
                : 'La sesión está por terminar pronto. Empieza a dirigir la conversación hacia un cierre natural.',
            },
          });
        } catch { /* non-fatal */ }
      }

      // Hard cutoff — target + grace period, in case no natural close happened.
      if (elapsed >= QA_HARD_LIMIT_SECONDS) {
        cleanup();
        if (sessionIdRef.current && !sessionCompletedRef.current) {
          sessionCompletedRef.current = true;
          api.classes.update(sessionIdRef.current, { status: 'completed', hasCompletedQA: true } as any).catch(() => {});
        }
        setPhase('closing');
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

  // Plays the pre-narrated exposition (lessonScript read aloud + "ask your questions
  // now" transition line, one clip). Falls back straight to the Q&A call when no
  // narration audio exists (e.g. a class generated before this feature existed).
  const startNarration = () => {
    if (!startData?.lessonAudioUrl) { connectVapi(); return; }
    setPhase('narrating');
  };

  const connectVapi = async () => {
    if (!startData) return;
    setPhase('connecting');
    const VapiClass = (await import('@vapi-ai/web')).default;
    const vapi = new VapiClass(startData.vapiPublicKey);
    vapiRef.current = vapi;

    vapi.on('call-start', async () => {
      setPhase('active');
      systemMsgSentRef.current = false;
      sessionCompletedRef.current = false;
      silenceEndingRef.current = false;
      lastUserSpeechAtRef.current = Date.now(); // Q&A starts immediately — no monologue phase to wait out
      silenceCheckinSentRef.current = false;
      const callId = (vapi as any).callId ?? '';
      if (callId && sessionIdRef.current) {
        await api.classes.update(sessionIdRef.current, { vapiCallId: callId, status: 'qa_started' }).catch(() => {});
      }
    });

    vapi.on('call-end', async () => {
      cleanup();
      // Guard: if the timer already sent the update, skip to avoid a duplicate write
      if (sessionIdRef.current && !sessionCompletedRef.current) {
        sessionCompletedRef.current = true;
        await api.classes.update(sessionIdRef.current, { status: 'completed', hasCompletedQA: true } as any).catch(() => {});
      }
      setPhase('closing');
    });

    vapi.on('speech-start', () => setIsSpeaking(true));
    vapi.on('speech-end', () => setIsSpeaking(false));
    vapi.on('volume-level', (v: number) => setVolume(v));
    // Resets the silence clock whenever the student actually speaks — cancels a pending
    // check-in if they answer in time (item 7 silence-timeout, see constants above).
    vapi.on('message', (msg: any) => {
      if (msg?.role === 'user') {
        lastUserSpeechAtRef.current = Date.now();
        silenceCheckinSentRef.current = false;
      }
    });
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
      maxDurationSeconds: QA_HARD_LIMIT_SECONDS + 30, // absolute Vapi-side safety net above the client-side cutoff
      firstMessage: lang === 'en'
        ? 'Hi again! I\'m ready for your questions about today\'s lesson.'
        : '¡Hola de nuevo! Estoy listo para tus preguntas sobre la lección de hoy.',
      endCallMessage: lang === 'en'
        ? 'Thank you for our conversation today. Keep up the great work!'
        : 'Gracias por nuestra conversación de hoy. ¡Sigue adelante con tu aprendizaje!',
    });
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

  // ── CLOSING — plays the Polly module recap after the Q&A call ends ──────────
  if (phase === 'closing') {
    const closingAudioUrl = startData?.closingAudioUrl;
    if (!closingAudioUrl) {
      setPhase('ended');
      return null;
    }
    return (
      <div className="border border-border rounded-xl p-6 text-center space-y-4">
        <audio
          ref={closingAudioRef}
          src={closingAudioUrl}
          autoPlay
          onEnded={() => setPhase('ended')}
          // Found in code review (2026-09-01): same stuck-forever risk as the narration
          // audio above — a failed closing clip must still let the student finish.
          onError={() => setPhase('ended')}
        />
        <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto">
          <Volume2 className="w-7 h-7 text-blue-600" />
        </div>
        <div>
          <p className="font-semibold text-charcoal">{s('Cerrando la clase…', 'Wrapping up the class…')}</p>
          <p className="text-sm text-gray-500 mt-1">{s('Lux Mentor está resumiendo lo visto en el módulo.', 'Lux Mentor is recapping what the module covered.')}</p>
        </div>
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

  // ── NARRATING — Polly reads the exposition before the Q&A call ──────────────
  if (phase === 'narrating' && startData?.lessonAudioUrl) {
    return (
      <div className="border border-border rounded-xl overflow-hidden">
        <audio
          ref={narrationAudioRef}
          src={startData.lessonAudioUrl}
          autoPlay
          onEnded={connectVapi}
          // Found in code review (2026-09-01): a 404/CORS/blocked-autoplay failure left
          // the student stuck on this screen forever (onEnded never fires). Same
          // graceful degradation as having no lessonAudioUrl at all — just proceed to
          // the Q&A call.
          onError={connectVapi}
        />
        <div className="bg-gradient-to-br from-[#17527E] to-[#7B2FBE] px-4 py-8 flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 border border-white/40 flex items-center justify-center">
            <Volume2 className="w-5 h-5 text-white" />
          </div>
          <p className="text-white font-semibold text-sm">{s('Lux Mentor está exponiendo la clase…', 'Lux Mentor is presenting the class…')}</p>
          <p className="text-white/70 text-xs">{s('Al terminar, se abrirá la sesión de preguntas.', 'When it finishes, the Q&A session will open.')}</p>
        </div>
      </div>
    );
  }

  // ── ACTIVE / CONNECTING — animated logo, no visible countdown ────────────────
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
                : isSpeaking ? s('Hablando…', 'Speaking…') : s('Escuchando…', 'Listening…')}
            </p>
          </div>
          {phase === 'active' && (
            <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1 text-xs text-white/80">
              <Mic className="w-3 h-3" />
              {s('Sesión de preguntas — tu micrófono está activo', 'Q&A session — your mic is active')}
            </div>
          )}
        </div>
        <div className="p-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">{s('Sesión con Lux Mentor en curso', 'Lux Mentor session in progress')}</p>
          {phase === 'active' && (
            <button
              onClick={() => { cleanup(); if (sessionIdRef.current) api.classes.update(sessionIdRef.current, { status: 'completed' }).catch(() => {}); setPhase('closing'); }}
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

  // ── CONTENT phase — static material, then narration + Q&A ────────────────────
  if (phase === 'content' && startData) {
    return (
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-surface px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
            <Volume2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-charcoal">{s('Contenido de la lección', 'Lesson Content')}</p>
            <p className="text-xs text-gray-500">{s('Lux Mentor te la leerá en voz alta y luego podrás hacer preguntas', 'Lux Mentor will read it aloud, then you can ask questions')}</p>
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
          <button onClick={startNarration} className="btn-primary w-full flex items-center justify-center gap-2">
            <Volume2 className="w-4 h-4" />
            {s('Iniciar clase con Lux Mentor', 'Start class with Lux Mentor')}
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
