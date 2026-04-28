'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle, XCircle, User, BookOpen,
  Clock, AlertCircle, Brain
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import type { Reflection } from '@lux/types';

const MIN_FEEDBACK_LEN = 20;

export default function ReflectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const moduleId = searchParams.get('moduleId') ?? '';
  const router = useRouter();

  const userId = decodeURIComponent(id);

  const [reflection, setReflection] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [doneAction, setDoneAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');

  useEffect(() => {
    // Load all pending reflections and find this one
    api.evaluator.reflections().then((res) => {
      const all = (res as any).data ?? [];
      const found = all.find((r: any) => r.userId === userId && r.moduleId === moduleId);
      setReflection(found ?? null);
      setLoading(false);
    });
  }, [userId, moduleId]);

  const handleReview = async (action: 'APPROVE' | 'REJECT') => {
    if (feedback.trim().length < MIN_FEEDBACK_LEN) {
      setError(`El feedback debe tener al menos ${MIN_FEEDBACK_LEN} caracteres.`);
      return;
    }

    setError('');
    setSubmitting(action);
    try {
      await api.evaluator.review({
        userId,
        moduleId,
        action,
        feedback,
      });
      setDoneAction(action);
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? 'Error al procesar la revisión');
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="card h-64" />
        <div className="card h-48" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-2xl mx-auto animate-slide-up">
        <div className="card text-center py-12 space-y-4">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto ${
            doneAction === 'APPROVE' ? 'bg-emerald-100' : 'bg-red-100'
          }`}>
            {doneAction === 'APPROVE'
              ? <CheckCircle className="w-10 h-10 text-emerald-600" />
              : <XCircle className="w-10 h-10 text-red-500" />
            }
          </div>
          <h2 className="font-heading font-bold text-2xl text-charcoal">
            Reflexión {doneAction === 'APPROVE' ? 'aprobada' : 'rechazada'}
          </h2>
          <p className="text-gray-500 text-sm">
            {doneAction === 'APPROVE'
              ? 'El estudiante ha sido notificado. El siguiente módulo está desbloqueado.'
              : 'El estudiante ha sido notificado y puede reescribir su reflexión.'}
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/evaluator/reflections" className="btn-primary">
              Ver más reflexiones
            </Link>
            <Link href="/evaluator/dashboard" className="btn-secondary">
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!reflection) {
    return (
      <div className="max-w-2xl mx-auto card text-center py-16">
        <p className="font-heading font-bold text-charcoal">Reflexión no encontrada</p>
        <Link href="/evaluator/reflections" className="btn-secondary mt-4 inline-flex">
          <ArrowLeft className="w-4 h-4" /> Volver
        </Link>
      </div>
    );
  }

  const canReview = reflection.status === 'PENDING_EVAL';

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/evaluator/reflections" className="p-2 rounded-lg hover:bg-surface">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <h1 className="font-heading font-bold text-xl text-charcoal">
            Revisión de Reflexión
          </h1>
        </div>
        <ReflectionStatusBadge status={reflection.status} />
      </div>

      {/* Metadata */}
      <div className="card grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
        <div className="flex items-center gap-2 text-gray-600">
          <User className="w-4 h-4 text-gray-400" />
          <span className="truncate">{reflection.userId}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-600">
          <BookOpen className="w-4 h-4 text-gray-400" />
          <span>{reflection.moduleTitle ?? reflection.moduleId}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-600">
          <Clock className="w-4 h-4 text-gray-400" />
          <span>{formatDate(reflection.submittedAt)}</span>
        </div>
      </div>

      {/* AI Analysis */}
      {reflection.aiResult && (
        <div className={`card border-2 ${
          reflection.aiResult.isAI && reflection.aiResult.confidence >= 60
            ? 'border-red-200 bg-red-50'
            : 'border-emerald-200 bg-emerald-50'
        }`}>
          <div className="flex items-start gap-3">
            <Brain className={`w-5 h-5 shrink-0 mt-0.5 ${
              reflection.aiResult.isAI ? 'text-red-500' : 'text-emerald-600'
            }`} />
            <div className="flex-1">
              <p className="font-semibold text-sm text-charcoal mb-1">
                Análisis de IA — Veredicto: {reflection.aiResult.verdict}
              </p>
              <p className="text-xs text-gray-600 mb-2">
                Confianza: <strong>{reflection.aiResult.confidence}%</strong>
              </p>
              {reflection.aiResult.signals?.length > 0 && (
                <ul className="text-xs text-gray-600 space-y-1">
                  {reflection.aiResult.signals.map((s: string, i: number) => (
                    <li key={i} className="flex items-start gap-1">
                      <span className="shrink-0 mt-0.5">•</span> {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reflection text */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-bold text-lg text-charcoal">Texto de la reflexión</h2>
          <span className="text-xs text-gray-500 font-medium">{reflection.wordCount} palabras</span>
        </div>
        <div className="bg-surface rounded-xl p-5 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto scrollbar-thin">
          {reflection.text}
        </div>
      </div>

      {/* Review form */}
      {canReview ? (
        <div className="card space-y-4">
          <h2 className="font-heading font-bold text-lg text-charcoal">Feedback para el estudiante</h2>
          <p className="text-sm text-gray-500">
            Tu feedback es obligatorio y será enviado al estudiante. Sé específico y constructivo.
          </p>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Escribe tu feedback para el estudiante (mínimo 20 caracteres)..."
            className="input-field min-h-[120px] resize-y"
          />
          <div className="text-xs text-gray-400 text-right">
            {feedback.trim().length}/{MIN_FEEDBACK_LEN} caracteres mínimos
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => handleReview('APPROVE')}
              loading={submitting === 'APPROVE'}
              disabled={submitting !== null}
              leftIcon={<CheckCircle className="w-4 h-4" />}
              className="flex-1"
            >
              Aprobar
            </Button>
            <Button
              onClick={() => handleReview('REJECT')}
              loading={submitting === 'REJECT'}
              disabled={submitting !== null}
              variant="danger"
              leftIcon={<XCircle className="w-4 h-4" />}
              className="flex-1"
            >
              Rechazar
            </Button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="font-heading font-bold text-base text-charcoal">Estado final</h2>
            <ReflectionStatusBadge status={reflection.status} />
          </div>
          {reflection.evaluatorFeedback && (
            <div className="bg-surface rounded-xl p-4 text-sm text-gray-700">
              <p className="text-xs font-semibold text-gray-400 mb-1">FEEDBACK ENVIADO</p>
              {reflection.evaluatorFeedback}
            </div>
          )}
          {reflection.reviewedAt && (
            <p className="text-xs text-gray-400 mt-2">Revisada el {formatDate(reflection.reviewedAt)}</p>
          )}
        </div>
      )}
    </div>
  );
}
