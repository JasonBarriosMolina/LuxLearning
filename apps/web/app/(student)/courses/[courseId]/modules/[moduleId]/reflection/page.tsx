'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Send, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { countWords } from '@/lib/utils';
import type { Reflection } from '@lux/types';

const MIN_WORDS = 80;

export default function ReflectionPage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const router = useRouter();

  const [course, setCourse] = useState<any>(null);
  const [existingReflection, setExistingReflection] = useState<Reflection | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.courses.get(courseId),
      api.reflection.get(moduleId),
    ]).then(([courseRes, reflectionRes]) => {
      setCourse((courseRes as any).data);
      const ref = (reflectionRes as any).data;
      if (ref) {
        setExistingReflection(ref);
        if (ref.status === 'REJECTED') {
          setText(''); // Let them rewrite
        }
      }
      setLoading(false);
    });
  }, [courseId, moduleId]);

  const module = course?.modules?.find((m: any) => m.id === moduleId);
  const wordCount = countWords(text);
  const wordsRemaining = Math.max(0, MIN_WORDS - wordCount);
  const isReady = wordCount >= MIN_WORDS;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isReady) return;

    setError('');
    setSubmitting(true);
    try {
      await api.reflection.submit({ moduleId, text });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? 'Error al enviar la reflexión');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="card h-64" />
      </div>
    );
  }

  // Submitted screen
  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto animate-slide-up">
        <div className="card text-center py-12 space-y-4">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
            <Clock className="w-10 h-10 text-cta-from" />
          </div>
          <h2 className="font-heading font-bold text-2xl text-charcoal">Reflexión enviada</h2>
          <p className="text-gray-500 text-sm max-w-sm mx-auto">
            Tu reflexión está siendo analizada. Recibirás una notificación cuando el evaluador la revise.
          </p>
          <Link href={`/courses/${courseId}/modules/${moduleId}`} className="btn-primary inline-flex">
            Volver al módulo
          </Link>
        </div>
      </div>
    );
  }

  // Show existing non-rejected reflection
  if (existingReflection && existingReflection.status !== 'REJECTED') {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <Link href={`/courses/${courseId}/modules/${moduleId}`} className="p-2 rounded-lg hover:bg-surface">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <h1 className="font-heading font-bold text-xl text-charcoal">Mi Reflexión</h1>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-charcoal">{module?.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {existingReflection.wordCount} palabras • Enviada {new Date(existingReflection.submittedAt).toLocaleDateString('es')}
              </p>
            </div>
            <ReflectionStatusBadge status={existingReflection.status} />
          </div>

          <div className="bg-surface rounded-xl p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {existingReflection.text}
          </div>

          {existingReflection.evaluatorFeedback && (
            <div className="border-l-4 border-cta-to pl-4">
              <p className="text-xs font-semibold text-gray-400 mb-1">FEEDBACK DEL EVALUADOR</p>
              <p className="text-sm text-gray-700">{existingReflection.evaluatorFeedback}</p>
            </div>
          )}

          {existingReflection.aiResult && existingReflection.status !== 'APPROVED' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
              <p className="font-semibold text-amber-800 mb-1">Análisis de IA</p>
              <p className="text-amber-700">
                Veredicto: {existingReflection.aiResult.verdict} • Confianza: {existingReflection.aiResult.confidence}%
              </p>
            </div>
          )}
        </div>

        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="btn-secondary inline-flex">
          <ArrowLeft className="w-4 h-4" /> Volver al módulo
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="p-2 rounded-lg hover:bg-surface">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="font-heading font-bold text-xl text-charcoal">
            {existingReflection?.status === 'REJECTED' ? 'Reescribir Reflexión' : 'Reflexión del Módulo'}
          </h1>
          <p className="text-sm text-gray-500">{module?.title}</p>
        </div>
      </div>

      {/* Rejected notice */}
      {existingReflection?.status === 'REJECTED' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-700 text-sm">Reflexión rechazada</p>
              {existingReflection.evaluatorFeedback && (
                <p className="text-sm text-red-600 mt-1">{existingReflection.evaluatorFeedback}</p>
              )}
              <p className="text-sm text-red-600 mt-1">Por favor escribe una nueva reflexión auténtica.</p>
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="card bg-blue-50 border border-blue-200">
        <h2 className="font-heading font-semibold text-base text-blue-800 mb-2">
          Cómo escribir tu reflexión
        </h2>
        <ul className="text-sm text-blue-700 space-y-1.5">
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            Escribe en primera persona sobre tu experiencia real con este módulo
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            Incluye qué aprendiste, cómo lo aplicarás y qué fue lo más valioso
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            Mínimo {MIN_WORDS} palabras. Sé auténtico — el contenido generado por IA es detectado automáticamente
          </li>
        </ul>
      </div>

      {/* Text area */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card p-0 overflow-hidden">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Escribe tu reflexión sobre "${module?.title}"...\n\nComparte qué aprendiste, cómo lo aplicarás en tu práctica musical, y qué aspecto te resultó más desafiante o revelador.`}
            className="w-full min-h-[280px] p-6 text-sm text-charcoal placeholder-gray-400 resize-y focus:outline-none font-sans leading-relaxed"
            autoFocus
          />
          <div className={`flex items-center justify-between px-6 py-3 border-t border-border ${
            isReady ? 'bg-emerald-50' : 'bg-surface'
          }`}>
            <span className={`text-sm font-medium ${isReady ? 'text-emerald-600' : 'text-gray-500'}`}>
              {wordCount} palabras
              {!isReady && wordsRemaining > 0 && ` • faltan ${wordsRemaining}`}
            </span>
            {isReady && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                <CheckCircle className="w-3.5 h-3.5" /> Listo para enviar
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button
          type="submit"
          loading={submitting}
          disabled={!isReady}
          className="w-full"
          leftIcon={<Send className="w-4 h-4" />}
        >
          Enviar reflexión
        </Button>
      </form>
    </div>
  );
}
