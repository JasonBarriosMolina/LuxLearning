'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import { useAuth } from '@/lib/hooks/useAuth';
import { LuxMentorClassReview } from './LuxMentorClassReview';
import { LuxMentorClassNarration } from './LuxMentorClassNarration';
import { LuxMentorClassActive } from './LuxMentorClassActive';
import { LuxMentorClassContent } from './LuxMentorClassContent';
import { LuxMentorClassIdle } from './LuxMentorClassIdle';
import { LuxMentorClassClosing, LuxMentorClassEnded, LuxMentorClassError } from './LuxMentorClassEndStates';
import { buildSystemPrompt, computeSilenceAction, qaSecondsRemaining, type SpeechMark } from './LuxMentorClass.helpers';
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
  lessonSpeechMarks?: SpeechMark[] | null;
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
  const { userId } = useAuth();
  const s = useCallback((es: string, en: string) => lang === 'en' ? en : es, [lang]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [startData, setStartData] = useState<StartData | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  // Visible Q&A countdown (Trello q1yXHIob, 2026-08-29 — Mack): null until the last
  // QA_WARNING_AT_REMAINING seconds, then counts down — separate from the invisible
  // system-message cue sent to the AI at that same threshold (below).
  const [visibleCountdown, setVisibleCountdown] = useState<number | null>(null);
  const systemMsgSentRef = useRef(false);
  const callStartTimeRef = useRef<number>(0);
  const sessionCompletedRef = useRef(false); // guard: prevent double-update when timer + call-end both fire
  const lastUserSpeechAtRef = useRef<number>(0);
  const silenceCheckinSentRef = useRef(false);
  const silenceCheckinAtRef = useRef<number>(0);
  const silenceEndingRef = useRef(false); // guards the end-the-call sequence from re-firing

  const vapiRef = useRef<Vapi | null>(null);
  const sessionIdRef = useRef<string>('');
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
      setVisibleCountdown(null);
      return;
    }
    callStartTimeRef.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTimeRef.current) / 1000);

      // Visible countdown — same threshold as the invisible AI wrap-up cue below.
      const remaining = qaSecondsRemaining(elapsed, QA_TARGET_SECONDS);
      setVisibleCountdown(remaining <= QA_WARNING_AT_REMAINING ? remaining : null);

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
              {/* Trello DmPpbrff, 2026-09-02 00:53 (Mack): "¿Cuál calificación es
                  necesaria? Es solo una clase" — the Q&A session is never part of the
                  course's weighted grade (CLASS EvaluationEvent is always weight:0),
                  so "pendiente de calificación" wrongly implied a required, blocking
                  step. Feedback here is optional evaluator commentary, not grading. */}
              {completedSession?.grade != null
                ? s(`Calificada: ${completedSession.grade}%`, `Graded: ${completedSession.grade}%`)
                : s('Completada — tu evaluador puede dejarte retroalimentación', 'Completed — your evaluator may leave you feedback')}
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

  // ── CLOSING / ENDED / ERROR — extracted to LuxMentorClassEndStates.tsx
  // (code review, 2026-09-04, size limit) ──────────────────────────────────────
  if (phase === 'closing') {
    const closingAudioUrl = startData?.closingAudioUrl;
    if (!closingAudioUrl) {
      setPhase('ended');
      return null;
    }
    return (
      <LuxMentorClassClosing
        closingAudioUrl={closingAudioUrl}
        audioRef={closingAudioRef}
        onEnded={() => setPhase('ended')}
        s={s}
      />
    );
  }

  if (phase === 'ended') {
    return <LuxMentorClassEnded onContinue={() => { setPhase('idle'); onCompleted(); }} s={s} />;
  }

  if (phase === 'error') {
    return (
      <LuxMentorClassError
        error={error}
        voidedOnly={voidedOnly}
        onClose={() => { setPhase('idle'); setError(''); }}
        s={s}
      />
    );
  }

  // ── NARRATING — Polly reads the exposition before the Q&A call ──────────────
  // (Trello DmPpbrff, 2026-09-01 01:10) styled content + live captions + notes,
  // extracted to LuxMentorClassNarration.tsx to keep this file under the size limit.
  if (phase === 'narrating' && startData?.lessonAudioUrl) {
    return (
      <LuxMentorClassNarration
        lessonScript={startData.lessonScript ?? null}
        lessonAudioUrl={startData.lessonAudioUrl}
        lessonSpeechMarks={startData.lessonSpeechMarks ?? null}
        // Found in code review (2026-09-01): must be scoped per-student, not just per-module
        // — two students on the same device/browser would otherwise overwrite each other's notes.
        notesStorageKey={`lux-class-notes-${userId ?? 'anon'}-${moduleId}`}
        lang={lang}
        onEnded={connectVapi}
        onError={connectVapi}
      />
    );
  }

  // ── ACTIVE / CONNECTING — animated logo + visible wrap-up countdown ──────────
  // (extracted to LuxMentorClassActive.tsx — code review, 2026-09-04, size limit)
  if (phase === 'active' || phase === 'connecting') {
    return (
      <LuxMentorClassActive
        phase={phase}
        isSpeaking={isSpeaking}
        volume={volume}
        visibleCountdown={visibleCountdown}
        onEndClick={() => { cleanup(); if (sessionIdRef.current) api.classes.update(sessionIdRef.current, { status: 'completed' }).catch(() => {}); setPhase('closing'); }}
        s={s}
      />
    );
  }

  // ── CONTENT phase — static material, then narration + Q&A ────────────────────
  // (extracted to LuxMentorClassContent.tsx — code review, 2026-09-04, size limit)
  if (phase === 'content' && startData) {
    return (
      <LuxMentorClassContent
        lessonVideoUrl={startData.lessonVideoUrl}
        lessonScript={startData.lessonScript}
        attemptsMax={startData.attemptsMax}
        attemptsUsed={startData.attemptsUsed}
        onStart={startNarration}
        s={s}
      />
    );
  }

  // ── IDLE / LOADING ────────────────────────────────────────────────────────────
  // (extracted to LuxMentorClassIdle.tsx — code review, 2026-09-04, size limit)
  return (
    <LuxMentorClassIdle
      loading={phase === 'loading'}
      voidedOnly={voidedOnly}
      hasSessions={sessions.length > 0}
      onStart={startFlow}
      s={s}
    />
  );
}
