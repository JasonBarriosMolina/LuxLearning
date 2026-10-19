'use client';

import { useState } from 'react';
import { CheckCircle, Clock, AlertCircle, Loader2, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
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

function relativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

type Urgency = 'graded' | 'urgent' | 'warning' | 'fresh';

function getUrgency(s: ClassSessionRow): Urgency {
  if (s.grade != null) return 'graded';
  const ref = s.completedAt ?? s.createdAt;
  const hrs = (Date.now() - new Date(ref).getTime()) / 3600000;
  if (hrs > 48) return 'urgent';
  if (hrs > 24) return 'warning';
  return 'fresh';
}

const urgencyStyles: Record<Urgency, { ring: string; icon: string; label: string; badge: string }> = {
  graded:  { ring: 'ring-emerald-200', icon: 'bg-emerald-100', label: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' },
  urgent:  { ring: 'ring-red-300',     icon: 'bg-red-100',     label: 'text-red-600',     badge: 'bg-red-100 text-red-700' },
  warning: { ring: 'ring-amber-300',   icon: 'bg-amber-100',   label: 'text-amber-600',   badge: 'bg-amber-100 text-amber-700' },
  fresh:   { ring: 'ring-gray-200',    icon: 'bg-gray-100',    label: 'text-gray-500',    badge: 'bg-gray-100 text-gray-600' },
};

export function ClassReviewPanel({ sessions, onGraded }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [grading, setGrading] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pending = sessions.filter((s) => s.grade == null);
  const urgent = pending.filter((s) => getUrgency(s) === 'urgent').length;
  const warning = pending.filter((s) => getUrgency(s) === 'warning').length;

  const handleGrade = async (s: ClassSessionRow) => {
    const grade = Number(grades[s.sessionId]);
    if (isNaN(grade) || grade < 0 || grade > 100) {
      setErrors((p) => ({ ...p, [s.sessionId]: 'Nota debe ser 0–100' }));
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
      <div className="text-center py-16">
        <Clock className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-gray-400 text-sm">No hay sesiones completadas para este curso.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      {pending.length > 0 && (
        <div className={`rounded-2xl p-4 flex flex-wrap items-center gap-4 ${urgent > 0 ? 'bg-red-50 border border-red-100' : 'bg-amber-50 border border-amber-100'}`}>
          <div className="flex items-center gap-2">
            <AlertCircle className={`w-5 h-5 ${urgent > 0 ? 'text-red-500' : 'text-amber-500'}`} />
            <span className={`font-semibold text-sm ${urgent > 0 ? 'text-red-700' : 'text-amber-700'}`}>
              {pending.length} sesión{pending.length !== 1 ? 'es' : ''} pendiente{pending.length !== 1 ? 's' : ''} de calificación
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {urgent > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-red-100 text-red-700 text-xs font-semibold">
                {urgent} urgente{urgent !== 1 ? 's' : ''} (+48h)
              </span>
            )}
            {warning > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 text-xs font-semibold">
                {warning} de atención (+24h)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Sessions list */}
      <div className="space-y-2.5">
        {sessions.map((s) => {
          const urgency = getUrgency(s);
          const style = urgencyStyles[urgency];
          const timeRef = s.completedAt ?? s.createdAt;

          return (
            <div key={s.sessionId} className={`border rounded-2xl overflow-hidden ring-2 ${style.ring} transition-all`}>
              {/* Header */}
              <div className="px-4 py-3 bg-white flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${style.icon}`}>
                  {urgency === 'graded'
                    ? <CheckCircle className="w-5 h-5 text-emerald-600" />
                    : urgency === 'urgent'
                    ? <AlertCircle className="w-5 h-5 text-red-500" />
                    : <Clock className={`w-5 h-5 ${style.label}`} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-charcoal text-sm">{s.displayName ?? s.userId}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.badge}`}>
                      {urgency === 'graded' ? `${s.grade}%` : relativeTime(timeRef)}
                    </span>
                    {s.aiScore != null && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                        IA {s.aiScore}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {s.className && `${s.className} · `}
                    {s.durationSeconds != null && `${Math.round(s.durationSeconds / 60)} min · `}
                    {urgency === 'graded' ? 'Calificada' : 'Pendiente de calificación'}
                  </p>
                </div>
                <button
                  onClick={() => setExpandedId((p) => p === s.sessionId ? null : s.sessionId)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                >
                  {expandedId === s.sessionId ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>

              {/* Expanded */}
              {expandedId === s.sessionId && (
                <div className="p-4 border-t border-gray-100 space-y-4 bg-gray-50/50">
                  {/* AI Analysis */}
                  {s.aiAnalysis && (
                    <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                      <p className="text-xs font-semibold text-blue-700 mb-1">Análisis IA{s.aiScore != null ? ` · ${s.aiScore}%` : ''}</p>
                      <p className="text-xs text-blue-600">{s.aiAnalysis}</p>
                    </div>
                  )}

                  {/* Bot messages */}
                  {botMessages(s).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" /> Respuestas de Lux Mentor
                      </p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {botMessages(s).map((msg: any, i: number) => (
                          <div key={i} className="bg-white rounded-lg p-2.5 border border-gray-100">
                            <p className="text-xs text-charcoal">{msg.message ?? msg.content ?? ''}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Full transcript */}
                  {s.transcript && (
                    <details>
                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 select-none">Ver transcripción completa</summary>
                      <pre className="mt-2 text-xs text-gray-600 whitespace-pre-wrap bg-white rounded-lg p-3 max-h-48 overflow-y-auto border border-gray-100">{s.transcript}</pre>
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
                        min="0"
                        max="100"
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
          );
        })}
      </div>
    </div>
  );
}
