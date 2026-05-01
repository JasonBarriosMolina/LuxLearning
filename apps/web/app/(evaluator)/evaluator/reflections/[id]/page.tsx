'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle, XCircle, User, BookOpen,
  Clock, AlertCircle, Brain, Copy, Check, Trash2, Plus,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';

const MIN_FEEDBACK_LEN = 20;
const STORAGE_KEY = 'lux_frequent_comments';

const DEFAULT_COMMENTS = [
  'Reflexión bien estructurada. Demuestra comprensión del tema.',
  'Necesita mayor profundidad en el análisis personal.',
  'Buen uso de ejemplos concretos de la vida real.',
  'La reflexión es muy corta. Desarrolla más tus ideas.',
  'Excelente conexión entre el contenido y tu experiencia.',
];

function useFrequentComments() {
  const [comments, setComments] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setComments(stored ? JSON.parse(stored) : DEFAULT_COMMENTS);
    } catch {
      setComments(DEFAULT_COMMENTS);
    }
  }, []);

  const save = (updated: string[]) => {
    setComments(updated);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
  };

  const add = (text: string) => {
    if (!text.trim() || comments.includes(text.trim())) return;
    save([...comments, text.trim()]);
  };

  const remove = (idx: number) => {
    save(comments.filter((_, i) => i !== idx));
  };

  return { comments, add, remove };
}

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
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [newComment, setNewComment] = useState('');
  const [showAddComment, setShowAddComment] = useState(false);

  const { comments, add: addComment, remove: removeComment } = useFrequentComments();

  useEffect(() => {
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
      await api.evaluator.review({ userId, moduleId, action, feedback });
      setDoneAction(action);
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? 'Error al procesar la revisión');
    } finally {
      setSubmitting(null);
    }
  };

  const insertComment = (text: string, idx: number) => {
    setFeedback((prev) => (prev ? `${prev}\n\n${text}` : text));
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="grid grid-cols-2 gap-6">
          <div className="card h-96" />
          <div className="card h-96" />
        </div>
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
              : <XCircle className="w-10 h-10 text-red-500" />}
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
              Ver más evaluaciones
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
  const studentDisplay = (reflection as any).studentName ?? reflection.userId;

  return (
    <div className="max-w-6xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/evaluator/reflections" className="p-2 rounded-lg hover:bg-surface">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <h1 className="font-heading font-bold text-xl text-charcoal">Evaluación de Reflexión</h1>
          <p className="text-gray-500 text-sm mt-0.5">{studentDisplay} · {reflection.moduleTitle ?? reflection.moduleId}</p>
        </div>
        <ReflectionStatusBadge status={reflection.status} />
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: <User className="w-4 h-4 text-gray-400" />, label: 'Estudiante', value: studentDisplay },
          { icon: <BookOpen className="w-4 h-4 text-gray-400" />, label: 'Módulo', value: reflection.moduleTitle ?? reflection.moduleId },
          { icon: <Clock className="w-4 h-4 text-gray-400" />, label: 'Enviado', value: formatDate(reflection.submittedAt) },
          { icon: null, label: 'Palabras', value: `${reflection.wordCount} palabras` },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-xl border border-border px-4 py-3">
            <p className="text-xs text-gray-400 font-medium mb-0.5">{item.label}</p>
            <div className="flex items-center gap-1.5">
              {item.icon}
              <p className="text-sm font-semibold text-charcoal truncate">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* AI Analysis (compact) */}
      {reflection.aiResult && (
        <div className={`rounded-xl border-2 px-4 py-3 flex items-center gap-3 ${
          reflection.aiResult.isAI && reflection.aiResult.confidence >= 60
            ? 'border-red-200 bg-red-50'
            : 'border-emerald-200 bg-emerald-50'
        }`}>
          <Brain className={`w-4 h-4 shrink-0 ${reflection.aiResult.isAI ? 'text-red-500' : 'text-emerald-600'}`} />
          <span className="text-sm font-semibold text-charcoal">Análisis IA:</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            reflection.aiResult.verdict === 'HUMANO' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
          }`}>
            {reflection.aiResult.verdict}
          </span>
          <span className="text-xs text-gray-500">Confianza: <strong>{reflection.aiResult.confidence}%</strong></span>
          {reflection.aiResult.signals?.length > 0 && (
            <span className="text-xs text-gray-500 truncate hidden sm:block">
              {reflection.aiResult.signals[0]}
            </span>
          )}
        </div>
      )}

      {/* Main two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5 items-start">
        {/* LEFT: Reflection text */}
        <div className="card space-y-3 sticky top-6">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-bold text-base text-charcoal">Reflexión del estudiante</h2>
            <span className="text-xs text-gray-400">{reflection.wordCount} palabras</span>
          </div>
          <div className="bg-surface rounded-xl p-5 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-[520px] scrollbar-thin">
            {reflection.text}
          </div>
        </div>

        {/* RIGHT: Feedback + frequent comments */}
        <div className="space-y-4">
          {canReview ? (
            <div className="card space-y-4">
              <h2 className="font-heading font-bold text-base text-charcoal">Feedback para el estudiante</h2>
              <p className="text-xs text-gray-400">Será enviado por correo. Mínimo {MIN_FEEDBACK_LEN} caracteres.</p>

              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Escribe tu feedback..."
                className="input-field min-h-[180px] resize-y text-sm"
              />

              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{feedback.trim().length} / {MIN_FEEDBACK_LEN} mín.</span>
                {feedback.trim().length >= MIN_FEEDBACK_LEN && (
                  <span className="text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Listo
                  </span>
                )}
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

          {/* Frequent comments */}
          {canReview && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-charcoal">Comentarios frecuentes</h3>
                <button
                  onClick={() => setShowAddComment(!showAddComment)}
                  className="p-1.5 rounded-lg hover:bg-surface text-gray-400 hover:text-cta-from transition-colors"
                  title="Agregar comentario"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {showAddComment && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newComment.trim()) {
                        addComment(newComment);
                        setNewComment('');
                        setShowAddComment(false);
                      }
                    }}
                    placeholder="Escribe y presiona Enter..."
                    className="input-field text-sm py-2 flex-1"
                    autoFocus
                  />
                </div>
              )}

              <div className="space-y-2">
                {comments.map((c, i) => (
                  <div
                    key={i}
                    className="group flex items-start gap-2 p-2.5 rounded-xl border border-border hover:border-cta-from hover:bg-blue-50/30 transition-all cursor-pointer"
                    onClick={() => insertComment(c, i)}
                  >
                    <p className="text-xs text-gray-600 flex-1 leading-relaxed">{c}</p>
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {copiedIdx === i ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-gray-400" />
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeComment(i); }}
                        className="text-gray-300 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-gray-400">Haz clic en cualquier comentario para insertarlo en el feedback.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
