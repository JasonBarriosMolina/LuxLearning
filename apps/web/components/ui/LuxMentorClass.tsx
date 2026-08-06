'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { PlayCircle, CheckCircle, Mic, MicOff, Volume2, BookOpen, MessageSquare, ChevronRight, Loader2, AlertCircle, WifiOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
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
}

interface Props {
  courseId: string;
  moduleId: string;
  sessions: ClassSession[];
  onCompleted: () => void;
}

type Phase =
  | 'idle'         // no session yet or only voided sessions
  | 'loading'      // fetching config
  | 'content'      // Phase 1: watching/reading lesson
  | 'connecting'   // Vapi initializing
  | 'active'       // Phase 2: Q&A in progress
  | 'ended'        // session complete — show "received" screen
  | 'review'       // reviewing a past completed session
  | 'error';

export function LuxMentorClass({ courseId, moduleId, sessions, onCompleted }: Props) {
  const { lang } = useLanguage();
  const s = useCallback((es: string, en: string) => lang === 'en' ? en : es, [lang]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [config, setConfig] = useState<{
    sessionId: string;
    vapiPublicKey: string;
    vapiPrompt: string | null;
    vapiObjectives: string | null;
    lessonVideoUrl: string | null;
    lessonScript: string | null;
  } | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const [reviewMessages, setReviewMessages] = useState<any[]>([]);

  const vapiRef = useRef<Vapi | null>(null);
  const sessionIdRef = useRef<string>('');

  const cleanup = useCallback(() => {
    if (vapiRef.current) {
      try { vapiRef.current.stop(); } catch {}
      vapiRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // Determine initial display state from existing sessions
  const completedSession = sessions.find((s) => s.status === 'completed');
  const voidedOnly = sessions.length > 0 && sessions.every((s) => s.voided);

  const startFlow = async () => {
    setPhase('loading');
    setError('');
    try {
      const res = await api.classes.start({ courseId, moduleId });
      const data = (res as any).data;
      if (!data?.vapiPublicKey) {
        setError(s('Esta clase aún no está configurada. Contacta a tu evaluador.', 'This class is not configured yet. Contact your evaluator.'));
        setPhase('error');
        return;
      }
      setConfig(data);
      sessionIdRef.current = data.sessionId;
      // Mark as content_viewed
      await api.classes.update(data.sessionId, { status: 'content_viewed' }).catch(() => {});
      setPhase('content');
    } catch {
      setError(s('No se pudo iniciar la clase. Intenta de nuevo.', 'Could not start the class. Please try again.'));
      setPhase('error');
    }
  };

  const connectVapi = async () => {
    if (!config) return;
    setPhase('connecting');

    const VapiClass = (await import('@vapi-ai/web')).default;
    const vapi = new VapiClass(config.vapiPublicKey);
    vapiRef.current = vapi;

    vapi.on('call-start', async () => {
      setPhase('active');
      const callId = (vapi as any).callId ?? '';
      if (callId && sessionIdRef.current) {
        await api.classes.update(sessionIdRef.current, { vapiCallId: callId, status: 'qa_started' }).catch(() => {});
      }
    });

    vapi.on('call-end', async () => {
      cleanup();
      if (sessionIdRef.current) {
        await api.classes.update(sessionIdRef.current, { status: 'completed' }).catch(() => {});
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

    const systemPrompt = buildSystemPrompt(config.vapiPrompt, config.vapiObjectives, lang);
    await vapi.start({
      transcriber: { provider: 'deepgram', model: 'nova-2', language: lang === 'en' ? 'en' : 'es' },
      model: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'system', content: systemPrompt }],
      },
      voice: { provider: 'vapi', voiceId: 'Clara', version: 2, language: 'auto' },
      name: 'Lux Mentor',
      firstMessage: lang === 'en'
        ? 'Hello! I\'m Lux Mentor. You\'ve just reviewed the lesson content. Now I\'d like to chat with you about what you learned. Ready to begin?'
        : 'Hola, soy Lux Mentor. Acabas de revisar el contenido de la lección. Ahora me gustaría conversar contigo sobre lo que aprendiste. ¿Estás listo/a?',
      endCallMessage: lang === 'en'
        ? 'Thank you for sharing your thoughts. Your responses have been received. Your evaluator will review your results soon.'
        : 'Gracias por compartir tus ideas. Tus respuestas han sido recibidas. Tu evaluador revisará tu resultado pronto.',
    });
  };

  const endCallManually = () => {
    cleanup();
    if (sessionIdRef.current) {
      api.classes.update(sessionIdRef.current, { status: 'completed' }).catch(() => {});
    }
    setPhase('ended');
  };

  const openReview = (session: ClassSession) => {
    const botMessages = (session.messages ?? []).filter((m: any) => m.role === 'bot');
    setReviewMessages(botMessages);
    setPhase('review');
  };

  // ── Completed state ──────────────────────────────────────────────────────────
  if (completedSession && phase === 'idle') {
    return (
      <div className="border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-charcoal text-sm">{s('Clase con Lux Mentor', 'Lux Mentor Class')}</p>
            <p className="text-xs text-gray-500">
              {completedSession.grade != null
                ? s(`Calificada: ${completedSession.grade}%`, `Graded: ${completedSession.grade}%`)
                : s('Completada — pendiente de calificación', 'Completed — awaiting grading')}
            </p>
          </div>
          <button
            onClick={() => openReview(completedSession)}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium shrink-0"
          >
            <BookOpen className="w-3.5 h-3.5" />
            {s('Ver resumen', 'View summary')}
          </button>
        </div>
        {completedSession.feedback && (
          <p className="text-xs text-gray-500 border-t border-border pt-2">{completedSession.feedback}</p>
        )}
        {completedSession.aiAnalysis && (
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-xs font-semibold text-blue-700 mb-1">{s('Análisis IA', 'AI Analysis')}</p>
            <p className="text-xs text-blue-600">{completedSession.aiAnalysis}</p>
          </div>
        )}
      </div>
    );
  }

  // ── Review mode (Mentor messages only) ──────────────────────────────────────
  if (phase === 'review') {
    return (
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-surface px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-semibold text-charcoal">{s('Resumen — Lux Mentor', 'Summary — Lux Mentor')}</span>
          </div>
          <button onClick={() => setPhase('idle')} className="text-xs text-gray-500 hover:text-charcoal">
            {s('Cerrar', 'Close')}
          </button>
        </div>
        <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
          {reviewMessages.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">{s('No hay mensajes disponibles.', 'No messages available.')}</p>
          ) : reviewMessages.map((msg, i) => (
            <div key={i} className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs font-semibold text-blue-600 mb-1">Lux Mentor</p>
              <p className="text-sm text-charcoal">{msg.message ?? msg.content ?? ''}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Ended state — "received" screen ─────────────────────────────────────────
  if (phase === 'ended') {
    return (
      <div className="border border-border rounded-xl p-6 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto">
          <CheckCircle className="w-7 h-7 text-emerald-600" />
        </div>
        <div>
          <p className="font-semibold text-charcoal">{s('¡Tus respuestas fueron recibidas!', 'Your responses were received!')}</p>
          <p className="text-sm text-gray-500 mt-1">{s('La evaluación estará lista más tarde. Tu evaluador revisará tu sesión pronto.', 'The evaluation will be ready later. Your evaluator will review your session soon.')}</p>
        </div>
        <button
          onClick={() => { setPhase('idle'); onCompleted(); }}
          className="btn-primary inline-flex items-center gap-2 mx-auto"
        >
          {s('Continuar', 'Continue')} <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="border border-border rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-charcoal">{s('Error en la clase', 'Class error')}</p>
            <p className="text-xs text-gray-500 mt-0.5">{error}</p>
          </div>
          <button onClick={() => { setPhase('idle'); setError(''); }} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            {s('Reintentar', 'Retry')}
          </button>
        </div>
        {voidedOnly && (
          <div className="mt-3 flex items-start gap-2 bg-amber-50 rounded-lg p-3">
            <WifiOff className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">{s('Detectamos un fallo de red en tu sesión anterior. Puedes reintentar.', 'We detected a network failure in your previous session. You can retry.')}</p>
          </div>
        )}
      </div>
    );
  }

  // ── Active Q&A phase ─────────────────────────────────────────────────────────
  if (phase === 'active' || phase === 'connecting') {
    const bars = 5;
    return (
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center ${isSpeaking ? 'animate-pulse' : ''}`}>
            <Mic className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Lux Mentor</p>
            <p className="text-xs text-blue-100">{phase === 'connecting' ? s('Conectando…', 'Connecting…') : isSpeaking ? s('Hablando…', 'Speaking…') : s('Escuchando…', 'Listening…')}</p>
          </div>
          {phase === 'active' && (
            <div className="flex items-end gap-0.5 h-6">
              {Array.from({ length: bars }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-white/70 rounded-full transition-all duration-100"
                  style={{ height: isSpeaking ? `${Math.max(4, (volume * 24 * (0.5 + Math.random() * 0.5)))}px` : '4px' }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="p-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">{s('Fase 2 de 2 — Conversación con Mentor', 'Phase 2 of 2 — Mentor Conversation')}</p>
          <button
            onClick={endCallManually}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors"
          >
            <MicOff className="w-3.5 h-3.5" />
            {s('Terminar', 'End')}
          </button>
        </div>
      </div>
    );
  }

  // ── Content phase (Phase 1) ──────────────────────────────────────────────────
  if (phase === 'content' && config) {
    return (
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-surface px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
            <Volume2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-charcoal">{s('Fase 1 — Contenido de la lección', 'Phase 1 — Lesson Content')}</p>
            <p className="text-xs text-gray-500">{s('Revisa el material antes de conversar con Mentor', 'Review the material before talking with Mentor')}</p>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Video player */}
          {config.lessonVideoUrl && (
            <div className="rounded-xl overflow-hidden bg-black aspect-video">
              {config.lessonVideoUrl.includes('youtube.com') || config.lessonVideoUrl.includes('youtu.be') ? (
                <iframe
                  src={`https://www.youtube.com/embed/${extractYouTubeId(config.lessonVideoUrl)}`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video src={config.lessonVideoUrl} controls className="w-full h-full" />
              )}
            </div>
          )}

          {/* Text script (shown if no video, or as supplement) */}
          {config.lessonScript && !config.lessonVideoUrl && (
            <div className="bg-gray-50 rounded-xl p-4 max-h-60 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">{s('Contenido de la lección', 'Lesson Content')}</p>
              <p className="text-sm text-charcoal leading-relaxed whitespace-pre-wrap">{config.lessonScript}</p>
            </div>
          )}

          <button
            onClick={connectVapi}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Mic className="w-4 h-4" />
            {s('Iniciar conversación con Lux Mentor', 'Start conversation with Lux Mentor')}
          </button>
          <p className="text-xs text-gray-400 text-center">{s('Fase 2 de 2 — Habla sobre lo que aprendiste', 'Phase 2 of 2 — Talk about what you learned')}</p>
        </div>
      </div>
    );
  }

  // ── Idle / loading state ─────────────────────────────────────────────────────
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="bg-surface px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center">
          <Mic className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-charcoal">{s('Clase con Lux Mentor', 'Lux Mentor Class')}</p>
          <p className="text-xs text-gray-500">{s('Lección + Conversación con IA de voz', 'Lesson + Voice AI Conversation')}</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {voidedOnly && (
          <div className="flex items-start gap-2 bg-amber-50 rounded-lg p-3">
            <WifiOff className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">{s('Detectamos un fallo de red en tu sesión anterior. Puedes reintentar.', 'We detected a network failure in your previous session. You can retry.')}</p>
          </div>
        )}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />{s('Fase 1: Contenido', 'Phase 1: Content')}</span>
          <ChevronRight className="w-3 h-3" />
          <span className="flex items-center gap-1"><Mic className="w-3.5 h-3.5" />{s('Fase 2: Conversación', 'Phase 2: Conversation')}</span>
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
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSystemPrompt(vapiPrompt: string | null, vapiObjectives: string | null, lang: string): string {
  const base = vapiPrompt ?? (lang === 'en'
    ? 'You are Lux Mentor, a warm and knowledgeable educational voice assistant. You have just finished presenting the lesson content to the student. Now engage in a friendly conversation to verify their understanding. Ask 3 thoughtful questions, one at a time. Listen carefully to their answers. Be encouraging and give brief constructive feedback after each response. Keep the total conversation under 5 minutes.'
    : 'Eres Lux Mentor, un asistente educativo de voz cálido y conocedor. Acabas de terminar de presentar el contenido de la lección al estudiante. Ahora entabla una conversación amigable para verificar su comprensión. Haz 3 preguntas reflexivas, una a la vez. Escucha atentamente sus respuestas. Sé alentador y da retroalimentación constructiva breve después de cada respuesta. Mantén la conversación total en menos de 5 minutos.');

  let objectives = '';
  if (vapiObjectives) {
    try {
      const parsed = JSON.parse(vapiObjectives);
      if (Array.isArray(parsed)) {
        objectives = lang === 'en'
          ? `\n\nQuestion objectives:\n${parsed.map((o: string, i: number) => `${i + 1}. ${o}`).join('\n')}`
          : `\n\nObjetivos de preguntas:\n${parsed.map((o: string, i: number) => `${i + 1}. ${o}`).join('\n')}`;
      }
    } catch { /* ignore */ }
  }

  return base + objectives;
}

function extractYouTubeId(url: string): string {
  const match = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
  return match?.[1] ?? '';
}
