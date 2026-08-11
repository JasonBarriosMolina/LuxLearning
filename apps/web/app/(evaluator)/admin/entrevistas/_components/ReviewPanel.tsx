'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mic, ChevronDown, Star, FileText, CheckCircle, Clock, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Submission {
  userId: string;
  displayName?: string;
  interviewId: string;
  courseId: string;
  moduleId: string;
  interviewName?: string;
  status: string;
  transcript?: string;
  aiAnalysis?: string;
  aiScore?: number;
  grade?: number;
  feedback?: string;
  durationSeconds?: number;
  questionsAsked?: number;
  createdAt: string;
}

interface Course { id: string; title: string; }

interface GradeState { grade: string; feedback: string; saving: boolean; saved: boolean; error: string; }

function fmtDuration(sec?: number) {
  if (!sec) return '—';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

interface Props { courses: Course[]; }

export function ReviewPanel({ courses }: Props) {
  const [courseId, setCourseId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<string, GradeState>>({});

  const load = useCallback(async (cId: string, st: string) => {
    if (!cId) return;
    setLoading(true);
    setSubmissions([]);
    try {
      const res = await api.admin.interviews.submissions(cId, st || undefined);
      const list: Submission[] = (res as any).data ?? [];
      setSubmissions(list);
      const init: Record<string, GradeState> = {};
      for (const s of list) {
        init[s.interviewId] = {
          grade: s.grade != null ? String(s.grade) : '',
          feedback: s.feedback ?? '',
          saving: false, saved: false, error: '',
        };
      }
      setGrades(init);
    } catch {
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(courseId, statusFilter); }, [courseId, statusFilter, load]);

  async function handleGrade(sub: Submission) {
    const st = grades[sub.interviewId];
    if (!st) return;
    const num = parseFloat(st.grade);
    if (isNaN(num) || num < 0 || num > 100) return;
    setGrades((p) => ({ ...p, [sub.interviewId]: { ...p[sub.interviewId]!, saving: true, saved: false, error: '' } }));
    try {
      await api.evaluator.interviews.grade(sub.interviewId, {
        studentUserId: sub.userId, grade: num, feedback: st.feedback,
      });
      setGrades((p) => ({ ...p, [sub.interviewId]: { ...p[sub.interviewId]!, saving: false, saved: true } }));
      setSubmissions((p) => p.map((s) =>
        s.interviewId === sub.interviewId ? { ...s, grade: num, feedback: st.feedback } : s,
      ));
      setTimeout(() => setGrades((p) => ({ ...p, [sub.interviewId]: { ...p[sub.interviewId]!, saved: false } })), 2500);
    } catch (e: any) {
      setGrades((p) => ({ ...p, [sub.interviewId]: { ...p[sub.interviewId]!, saving: false, error: e?.message ?? 'Error al guardar' } }));
    }
  }

  const statusBadge = (sub: Submission) => {
    if (sub.grade != null) return <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">{sub.grade}%</span>;
    if (sub.status === 'completed') return <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">Pendiente calificación</span>;
    if (sub.status === 'in_progress') return <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">En progreso</span>;
    if (sub.status === 'pending') return <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">No completada</span>;
    return <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{sub.status}</span>;
  };

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Curso</label>
          <div className="relative">
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">— Selecciona un curso —</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
        <div className="w-40">
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Estado</label>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">Todos</option>
              <option value="completed">Completadas</option>
              <option value="in_progress">En progreso</option>
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* List */}
      {!courseId ? (
        <div className="text-center py-12">
          <Mic className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Selecciona un curso para ver las entrevistas</p>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-12">
          <Mic className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No hay entrevistas para este filtro</p>
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map((sub) => {
            const gs = grades[sub.interviewId] ?? { grade: '', feedback: '', saving: false, saved: false };
            const isExpanded = expandedId === sub.interviewId;
            return (
              <div key={sub.interviewId} className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm bg-white">
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                    <Mic className="w-4 h-4 text-rose-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{sub.displayName ?? sub.userId}</p>
                    <p className="text-xs text-gray-400">
                      {sub.interviewName && <span className="text-blue-600 mr-1">{sub.interviewName} ·</span>}
                      {new Date(sub.createdAt).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}
                      {sub.durationSeconds ? ` · ${fmtDuration(sub.durationSeconds)}` : ''}
                      {sub.questionsAsked ? ` · ${sub.questionsAsked} preg.` : ''}
                      {sub.aiScore != null ? ` · IA: ${sub.aiScore}%` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {statusBadge(sub)}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : sub.interviewId)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-50"
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 py-4 bg-gray-50 space-y-4">
                    {sub.aiAnalysis && (
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 mb-1">
                          <Star className="w-3.5 h-3.5" /> Análisis IA
                          {sub.aiScore != null && <span className="ml-auto">{sub.aiScore}/100</span>}
                        </div>
                        <div className="bg-purple-50 border border-purple-100 rounded-xl px-3 py-2 text-xs text-purple-800 whitespace-pre-wrap leading-relaxed">
                          {sub.aiAnalysis}
                        </div>
                      </div>
                    )}

                    {sub.transcript && (
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 mb-1">
                          <FileText className="w-3.5 h-3.5" /> Transcripción
                        </div>
                        <details>
                          <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-700">Ver transcripción completa</summary>
                          <div className="mt-2 bg-white border border-gray-100 rounded-xl px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                            {sub.transcript}
                          </div>
                        </details>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-600">Calificación final</p>
                      <div className="flex gap-3">
                        <div className="w-28">
                          <label className="text-xs text-gray-400 mb-1 block">Nota (0–100)</label>
                          <input
                            type="number" min={0} max={100}
                            value={gs.grade}
                            onChange={(e) => setGrades((p) => ({ ...p, [sub.interviewId]: { ...p[sub.interviewId]!, grade: e.target.value } }))}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-gray-400 mb-1 block">Comentarios</label>
                          <textarea
                            rows={2} value={gs.feedback}
                            onChange={(e) => setGrades((p) => ({ ...p, [sub.interviewId]: { ...p[sub.interviewId]!, feedback: e.target.value } }))}
                            placeholder="Retroalimentación…"
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        {gs.error && (
                          <p className="text-xs text-red-600 font-medium">{gs.error}</p>
                        )}
                        <div className="ml-auto">
                          <button
                            onClick={() => handleGrade(sub)}
                            disabled={gs.saving || !gs.grade}
                            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 flex items-center gap-2"
                          >
                            {gs.saved
                              ? <><CheckCircle className="w-4 h-4" /> Guardado</>
                              : gs.saving
                              ? <><Clock className="w-4 h-4 animate-spin" /> Guardando…</>
                              : 'Guardar calificación'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
