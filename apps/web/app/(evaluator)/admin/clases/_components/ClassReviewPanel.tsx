'use client';

import { useState } from 'react';
import { CheckCircle, Clock, Loader2, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';

interface ClassSessionRow {
  sessionId: string;
  userId: string;
  courseId: string;
  displayName?: string;
  className?: string;
  status: string;
  grade?: number;
  feedback?: string;
  aiAnalysis?: string;
  aiScore?: number;
  durationSeconds?: number;
  messages?: any[];
  transcript?: string;
  completedAt?: string;
  createdAt: string;
}

interface Props {
  sessions: ClassSessionRow[];
  onGraded: () => void;
}

export function ClassReviewPanel({ sessions, onGraded }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [grading, setGrading] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleGrade = async (s: ClassSessionRow) => {
    const grade = Number(grades[s.sessionId]);
    if (isNaN(grade) || grade < 0 || grade > 100) {
      setErrors((p) => ({ ...p, [s.sessionId]: 'Nota debe ser 0-100' }));
      return;
    }
    setGrading(s.sessionId);
    setErrors((p) => ({ ...p, [s.sessionId]: '' }));
    try {
      await api.evaluator.classes.grade(s.sessionId, {
        studentUserId: s.userId,
        grade,
        feedback: feedbacks[s.sessionId] ?? '',
        courseId: s.courseId,
      } as any);
      onGraded();
    } catch {
      setErrors((p) => ({ ...p, [s.sessionId]: 'Error al guardar. Intenta de nuevo.' }));
    } finally {
      setGrading(null);
    }
  };

  const botMessages = (s: ClassSessionRow) =>
    (s.messages ?? []).filter((m: any) => m.role === 'bot');

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 text-sm">No hay sesiones completadas para este curso.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((s) => (
        <div key={s.sessionId} className="border border-border rounded-xl overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-surface flex items-center gap-3">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${s.grade != null ? 'bg-emerald-100' : 'bg-amber-100'}`}>
              {s.grade != null
                ? <CheckCircle className="w-4 h-4 text-emerald-600" />
                : <Clock className="w-4 h-4 text-amber-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-charcoal text-sm">{s.displayName ?? s.userId}</p>
              <p className="text-xs text-gray-400">
                {s.className && `${s.className} · `}
                {s.durationSeconds != null && `${Math.round(s.durationSeconds / 60)} min · `}
                {s.grade != null ? `Calificada: ${s.grade}%` : 'Pendiente de calificación'}
                {s.aiScore != null && ` · IA: ${s.aiScore}%`}
              </p>
            </div>
            <button
              onClick={() => setExpandedId((p) => p === s.sessionId ? null : s.sessionId)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
            >
              {expandedId === s.sessionId ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {/* Expanded */}
          {expandedId === s.sessionId && (
            <div className="p-4 border-t border-border space-y-4">
              {/* AI Analysis */}
              {s.aiAnalysis && (
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-blue-700 mb-1">Análisis IA {s.aiScore != null && `· ${s.aiScore}%`}</p>
                  <p className="text-xs text-blue-600">{s.aiAnalysis}</p>
                </div>
              )}

              {/* Mentor messages (review mode — bot only) */}
              {botMessages(s).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5" /> Respuestas de Lux Mentor
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {botMessages(s).map((msg: any, i: number) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-2.5">
                        <p className="text-xs text-charcoal">{msg.message ?? msg.content ?? ''}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Full transcript toggle */}
              {s.transcript && (
                <details>
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Ver transcripción completa</summary>
                  <pre className="mt-2 text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">{s.transcript}</pre>
                </details>
              )}

              {/* Grading form */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600">Calificación</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={grades[s.sessionId] ?? (s.grade != null ? String(s.grade) : '')}
                    onChange={(e) => setGrades((p) => ({ ...p, [s.sessionId]: e.target.value }))}
                    placeholder="0-100"
                    min="0" max="100"
                    className="input w-24"
                  />
                  <input
                    value={feedbacks[s.sessionId] ?? (s.feedback ?? '')}
                    onChange={(e) => setFeedbacks((p) => ({ ...p, [s.sessionId]: e.target.value }))}
                    placeholder="Retroalimentación (opcional)"
                    className="input flex-1"
                  />
                  <button
                    onClick={() => handleGrade(s)}
                    disabled={grading === s.sessionId}
                    className="btn-primary text-sm px-4 disabled:opacity-60 flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {grading === s.sessionId && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {s.grade != null ? 'Actualizar' : 'Calificar'}
                  </button>
                </div>
                {errors[s.sessionId] && <p className="text-xs text-red-500">{errors[s.sessionId]}</p>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
