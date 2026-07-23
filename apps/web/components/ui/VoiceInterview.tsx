'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, PhoneCall, PhoneOff, CheckCircle, Clock, AlertCircle, Volume2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/i18n';
import type Vapi from '@vapi-ai/web';

interface Props {
  courseId: string;
  moduleId: string;
  interviews: any[];
  onCompleted: () => void;
}

type InterviewPhase = 'idle' | 'loading' | 'ready' | 'calling' | 'active' | 'ended' | 'error';

export function VoiceInterview({ courseId, moduleId, interviews, onCompleted }: Props) {
  const { t, lang } = useLanguage();
  const [phase, setPhase] = useState<InterviewPhase>('idle');
  const [error, setError] = useState('');
  const [vapiConfig, setVapiConfig] = useState<{ interviewId: string; vapiPublicKey: string; vapiAssistantId: string; vapiPrompt: string | null; vapiObjectives: string | null } | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const vapiRef = useRef<Vapi | null>(null);
  const interviewIdRef = useRef<string>('');

  const s = useCallback((es: string, en: string) => lang === 'en' ? en : es, [lang]);

  const latestInterview = interviews[0];
  const isCompleted = latestInterview?.status === 'completed';
  const isInProgress = latestInterview?.status === 'in_progress' || latestInterview?.status === 'pending';

  const cleanup = useCallback(() => {
    if (vapiRef.current) {
      try { vapiRef.current.stop(); } catch {}
      vapiRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const startInterview = async () => {
    setPhase('loading');
    setError('');
    try {
      const res = await api.interviews.start({ courseId, moduleId });
      const config = (res as any).data;
      if (!config?.vapiPublicKey || !config?.vapiAssistantId) {
        setError(s('La entrevista aún no está configurada. Contacta a tu evaluador.', 'Interview is not configured yet. Contact your evaluator.'));
        setPhase('error');
        return;
      }
      setVapiConfig(config);
      interviewIdRef.current = config.interviewId;
      setPhase('ready');
    } catch {
      setError(s('No se pudo iniciar la entrevista. Intenta de nuevo.', 'Could not start the interview. Please try again.'));
      setPhase('error');
    }
  };

  const connectCall = async () => {
    if (!vapiConfig) return;
    setPhase('calling');

    const VapiClass = (await import('@vapi-ai/web')).default;
    const vapi = new VapiClass(vapiConfig.vapiPublicKey);
    vapiRef.current = vapi;

    vapi.on('call-start', async () => {
      setPhase('active');
      const callId = (vapi as any).callId ?? '';
      if (callId && interviewIdRef.current) {
        await api.interviews.update(interviewIdRef.current, { vapiCallId: callId, status: 'in_progress' }).catch(() => {});
      }
    });

    vapi.on('call-end', async () => {
      setPhase('ended');
      cleanup();
      if (interviewIdRef.current) {
        await api.interviews.update(interviewIdRef.current, { status: 'completed' }).catch(() => {});
      }
      setTimeout(() => { onCompleted(); }, 1500);
    });

    vapi.on('speech-start', () => setIsSpeaking(true));
    vapi.on('speech-end', () => setIsSpeaking(false));
    vapi.on('volume-level', (v: number) => setVolume(v));
    vapi.on('error', (e: any) => {
      console.error('[vapi]', e);
      setError(s('Ocurrió un error durante la llamada.', 'An error occurred during the call.'));
      setPhase('error');
      cleanup();
    });

    const systemPrompt = buildSystemPrompt(vapiConfig.vapiPrompt, vapiConfig.vapiObjectives, lang);
    await vapi.start({
      transcriber: { provider: 'deepgram', model: 'nova-2', language: lang === 'en' ? 'en' : 'es' },
      model: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'system', content: systemPrompt }],
      },
      voice: { provider: 'playht', voiceId: lang === 'en' ? 'jennifer' : 'maria' },
      name: 'Lux Entrevistador',
      firstMessage: lang === 'en'
        ? 'Hello! I am your oral evaluator. I will ask you 3 questions about this module. Are you ready to begin?'
        : 'Hola, soy tu evaluador oral. Te haré exactamente 3 preguntas sobre este módulo. ¿Estás listo/a para comenzar?',
      endCallMessage: lang === 'en'
        ? 'Thank you for your responses. The interview is now complete. Your evaluator will review your results shortly.'
        : 'Gracias por tus respuestas. La entrevista ha concluido. Tu evaluador revisará tu resultado en breve.',
    });
  };

  const endCall = () => {
    cleanup();
    setPhase('ended');
    if (interviewIdRef.current) {
      api.interviews.update(interviewIdRef.current, { status: 'completed' }).catch(() => {});
    }
    setTimeout(() => { onCompleted(); }, 1000);
  };

  if (isCompleted) {
    return (
      <div className="border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="font-semibold text-charcoal text-sm">{s('Entrevista Oral', 'Oral Interview')}</p>
            <p className="text-xs text-gray-500">{s('Completada — pendiente de calificación', 'Completed — awaiting grading')}</p>
          </div>
          <div className="ml-auto">
            {latestInterview.grade != null
              ? <Badge variant="success">{latestInterview.grade}%</Badge>
              : <Badge variant="pending">{s('En revisión', 'Under review')}</Badge>
            }
          </div>
        </div>
        {latestInterview.feedback && (
          <p className="text-xs text-gray-500 border-t border-border pt-2">{latestInterview.feedback}</p>
        )}
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-surface px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
          <Mic className="w-5 h-5 text-rose-600" />
        </div>
        <div>
          <p className="font-semibold text-charcoal text-sm">{s('Entrevista Oral por Voz', 'Oral Voice Interview')}</p>
          <p className="text-xs text-gray-500">
            {s('3 preguntas · Evaluación formativa en tiempo real', '3 questions · Real-time formative assessment')}
          </p>
        </div>
        {isInProgress && <Badge variant="warning" className="ml-auto">{s('Pendiente', 'Pending')}</Badge>}
      </div>

      {/* Body */}
      <div className="px-4 py-4 space-y-4">
        {phase === 'idle' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 leading-relaxed">
              {s(
                'La IA te hará exactamente 3 preguntas orales sobre el contenido del módulo. La sesión es grabada y transcrita para que tu evaluador revise tu desempeño.',
                'The AI will ask you exactly 3 oral questions about the module content. The session is recorded and transcribed so your evaluator can review your performance.',
              )}
            </p>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Clock className="w-3.5 h-3.5" />
              <span>{s('Duración estimada: 5–10 minutos', 'Estimated duration: 5–10 minutes')}</span>
            </div>
            <Button onClick={startInterview} className="w-full">
              <Mic className="w-4 h-4 mr-2" />
              {s('Iniciar Entrevista', 'Start Interview')}
            </Button>
          </div>
        )}

        {phase === 'loading' && (
          <div className="text-center py-4 space-y-2">
            <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-500">{s('Preparando entrevista…', 'Preparing interview…')}</p>
          </div>
        )}

        {phase === 'ready' && (
          <div className="space-y-3">
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-1.5">
              <p className="text-xs font-semibold text-rose-700">{s('Antes de comenzar:', 'Before you begin:')}</p>
              <ul className="text-xs text-rose-600 space-y-1 list-disc list-inside">
                <li>{s('Asegúrate de estar en un lugar tranquilo', 'Make sure you are in a quiet place')}</li>
                <li>{s('Activa tu micrófono cuando el navegador lo solicite', 'Enable your microphone when the browser requests it')}</li>
                <li>{s('La IA te hará exactamente 3 preguntas y luego cerrará la sesión', 'The AI will ask exactly 3 questions then end the session')}</li>
              </ul>
            </div>
            <Button onClick={connectCall} className="w-full bg-rose-600 hover:bg-rose-700">
              <PhoneCall className="w-4 h-4 mr-2" />
              {s('Conectar y comenzar', 'Connect and begin')}
            </Button>
          </div>
        )}

        {phase === 'calling' && (
          <div className="text-center py-4 space-y-2">
            <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-500">{s('Conectando…', 'Connecting…')}</p>
          </div>
        )}

        {phase === 'active' && (
          <div className="space-y-4">
            {/* Voice visualizer */}
            <div className="flex items-center justify-center gap-1.5 h-12">
              {Array.from({ length: 9 }).map((_, i) => {
                const barH = isSpeaking ? Math.max(6, Math.min(40, volume * 40)) : 6;
                return (
                  <div
                    key={i}
                    className="w-1.5 rounded-full bg-rose-500 transition-all duration-75"
                    style={{ height: barH + 'px', opacity: isSpeaking ? 1 : 0.3 }}
                  />
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
              {isSpeaking
                ? <><Volume2 className="w-3.5 h-3.5 text-rose-500" />{s('La IA está hablando…', 'AI is speaking…')}</>
                : <><MicOff className="w-3.5 h-3.5" />{s('Escuchando tu respuesta…', 'Listening to your response…')}</>
              }
            </div>
            <p className="text-xs text-center text-gray-400">
              {s('La entrevista finalizará automáticamente después de las 3 preguntas.', 'The interview will end automatically after 3 questions.')}
            </p>
            <button
              onClick={endCall}
              className="w-full flex items-center justify-center gap-2 py-2 text-sm text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors"
            >
              <PhoneOff className="w-4 h-4" />
              {s('Finalizar llamada', 'End call')}
            </button>
          </div>
        )}

        {phase === 'ended' && (
          <div className="text-center py-4 space-y-2">
            <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="text-sm font-semibold text-charcoal">{s('¡Entrevista completada!', 'Interview completed!')}</p>
            <p className="text-xs text-gray-500">{s('Procesando tu respuesta…', 'Processing your response…')}</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
            <button
              onClick={() => { setPhase('idle'); setError(''); }}
              className="text-xs text-gray-500 hover:text-charcoal underline"
            >
              {s('Intentar de nuevo', 'Try again')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function buildSystemPrompt(vapiPrompt: string | null, vapiObjectives: string | null, lang: string): string {
  const objectives = vapiObjectives
    ? vapiObjectives.split('\n').filter(Boolean).slice(0, 3).map((o, i) => `${i + 1}. ${o.trim()}`).join('\n')
    : lang === 'en'
      ? '1. Understand the main concepts of the module\n2. Apply knowledge to a practical example\n3. Reflect on lessons learned'
      : '1. Comprender los conceptos principales del módulo\n2. Aplicar el conocimiento a un ejemplo práctico\n3. Reflexionar sobre lo aprendido';

  if (vapiPrompt) return `${vapiPrompt}\n\nObjetivos de las preguntas:\n${objectives}`;

  return lang === 'en'
    ? `You are an oral evaluator for an online course. Your task is to assess the student with exactly 3 questions.

Rules:
- Ask exactly 3 questions, one at a time.
- Wait for the student's full response before asking the next question.
- After the 3rd question and the student's response, thank them and end the call using the endCall function.
- Be professional, encouraging, and concise.

Question objectives:
${objectives}`
    : `Eres un evaluador oral para un curso en línea. Tu tarea es evaluar al estudiante con exactamente 3 preguntas.

Reglas:
- Haz exactamente 3 preguntas, una a la vez.
- Espera la respuesta completa del estudiante antes de hacer la siguiente pregunta.
- Después de la 3ª pregunta y la respuesta del estudiante, agradéceles y cierra la llamada usando la función endCall.
- Sé profesional, alentador y conciso.

Objetivos de las preguntas:
${objectives}`;
}
