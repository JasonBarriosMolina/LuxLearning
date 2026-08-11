'use client';

import { useEffect, useState, useCallback } from 'react';
import { Mic, ChevronDown, CheckCircle, Clock, FileText, AlertCircle, Star } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/i18n';

interface GradeState {
  grade: string;
  feedback: string;
  saving: boolean;
  saved: boolean;
}

export default function EvaluatorInterviewsPage() {
  const { t, lang } = useLanguage();
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedModule, setSelectedModule] = useState('');
  const [interviews, setInterviews] = useState<any[]>([]);
  const [loadingInts, setLoadingInts] = useState(false);
  const [gradeStates, setGradeStates] = useState<Record<string, GradeState>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const s = (es: string, en: string) => lang === 'en' ? en : es;

  useEffect(() => {
    api.evaluator.myCourses().then((res: any) => {
      setCourses((res as any).data ?? []);
    }).catch(() => {});
  }, [lang]);

  const course = courses.find((c) => c.id === selectedCourse);
  const modules: any[] = course?.modules ?? [];

  const loadInterviews = useCallback(async (moduleId: string) => {
    if (!moduleId) return;
    setLoadingInts(true);
    setInterviews([]);
    try {
      const res = await api.evaluator.interviews.list(moduleId);
      const list: any[] = (res as any).data ?? [];
      setInterviews(list);
      const init: Record<string, GradeState> = {};
      for (const iv of list) {
        init[iv.interviewId] = {
          grade: iv.grade != null ? String(iv.grade) : '',
          feedback: iv.feedback ?? '',
          saving: false,
          saved: false,
        };
      }
      setGradeStates(init);
    } catch {
      setInterviews([]);
    } finally {
      setLoadingInts(false);
    }
  }, []);

  useEffect(() => {
    if (selectedModule) loadInterviews(selectedModule);
  }, [selectedModule, loadInterviews]);

  const handleGrade = async (iv: any) => {
    const st = gradeStates[iv.interviewId];
    if (!st) return;
    const gradeNum = parseFloat(st.grade);
    if (isNaN(gradeNum) || gradeNum < 0 || gradeNum > 100) return;
    setGradeStates((prev) => ({ ...prev, [iv.interviewId]: { ...prev[iv.interviewId]!, saving: true, saved: false } }));
    try {
      await api.evaluator.interviews.grade(iv.interviewId, {
        studentUserId: iv.userId,
        grade: gradeNum,
        feedback: st.feedback,
      });
      setGradeStates((prev) => ({ ...prev, [iv.interviewId]: { ...prev[iv.interviewId]!, saving: false, saved: true } }));
      setInterviews((prev) => prev.map((i) =>
        i.interviewId === iv.interviewId ? { ...i, grade: gradeNum, feedback: st.feedback } : i
      ));
      setTimeout(() => setGradeStates((prev) => ({ ...prev, [iv.interviewId]: { ...prev[iv.interviewId]!, saved: false } })), 2500);
    } catch {
      setGradeStates((prev) => ({ ...prev, [iv.interviewId]: { ...prev[iv.interviewId]!, saving: false } }));
    }
  };

  const statusBadge = (iv: any) => {
    if (iv.grade != null) return <Badge variant="success">{iv.grade}%</Badge>;
    if (iv.status === 'completed') return <Badge variant="warning">{s('Pendiente calificación', 'Pending grade')}</Badge>;
    if (iv.status === 'in_progress') return <Badge variant="info">{s('En progreso', 'In progress')}</Badge>;
    return <Badge variant="default">{s('Iniciada', 'Started')}</Badge>;
  };

  const formatDuration = (sec?: number) => {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s2 = sec % 60;
    return `${m}:${String(s2).padStart(2, '0')}`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">{s('Entrevistas Orales', 'Oral Interviews')}</h1>
        <p className="text-gray-500 mt-1 text-sm">{s('Revisa transcripciones, análisis de IA y califica las entrevistas de tus estudiantes.', 'Review transcripts, AI analysis and grade your students\' interviews.')}</p>
      </div>

      {/* Selectors */}
      <div className="card flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 mb-1 block">{s('Selecciona un curso', 'Select a course')}</label>
          <div className="relative">
            <select
              value={selectedCourse}
              onChange={(e) => { setSelectedCourse(e.target.value); setSelectedModule(''); setInterviews([]); }}
              className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-charcoal bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-cta-from/30"
            >
              <option value="">—</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 mb-1 block">{s('Selecciona un módulo', 'Select a module')}</label>
          <div className="relative">
            <select
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              disabled={!selectedCourse}
              className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-charcoal bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-cta-from/30 disabled:opacity-50"
            >
              <option value="">—</option>
              {modules.map((m: any) => <option key={m.id} value={m.id}>{m.order}. {m.title}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Interviews list */}
      {selectedModule && (
        loadingInts ? (
          <div className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="card h-24 animate-pulse" />)}</div>
        ) : interviews.length === 0 ? (
          <div className="card text-center py-12">
            <Mic className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">{s('No hay entrevistas para este módulo', 'No interviews for this module')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {interviews.map((iv) => {
              const gs = gradeStates[iv.interviewId] ?? { grade: '', feedback: '', saving: false, saved: false };
              const isExpanded = expandedId === iv.interviewId;
              return (
                <div key={iv.interviewId} className="card space-y-3">
                  {/* Header row */}
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                      <Mic className="w-4 h-4 text-rose-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-charcoal truncate">{iv.userId}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(iv.createdAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {iv.durationSeconds ? ` · ${formatDuration(iv.durationSeconds)}` : ''}
                        {iv.questionsAsked ? ` · ${iv.questionsAsked} ${s('preguntas', 'questions')}` : ''}
                        {iv.aiScore != null ? ` · IA: ${iv.aiScore}%` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {statusBadge(iv)}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : iv.interviewId)}
                        className={`p-1.5 rounded-lg transition-colors ${isExpanded ? 'text-cta-from bg-blue-50' : 'text-gray-400 hover:text-cta-from hover:bg-blue-50'}`}
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded: transcript + AI analysis + grade form */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 pt-3 space-y-4">
                      {/* AI Analysis */}
                      {iv.aiAnalysis && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-700">
                            <Star className="w-3.5 h-3.5" />
                            {s('Análisis Formativo (IA)', 'Formative Analysis (AI)')}
                            {iv.aiScore != null && <span className="ml-auto font-bold">{iv.aiScore}/100</span>}
                          </div>
                          <div className="bg-purple-50 border border-purple-100 rounded-xl px-3 py-2 text-xs text-purple-800 whitespace-pre-wrap leading-relaxed">
                            {iv.aiAnalysis}
                          </div>
                        </div>
                      )}

                      {/* Transcript */}
                      {iv.transcript && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                            <FileText className="w-3.5 h-3.5" />
                            {s('Transcripción', 'Transcript')}
                          </div>
                          <details>
                            <summary className="cursor-pointer text-xs text-gray-400 hover:text-charcoal">
                              {s('Ver transcripción completa', 'View full transcript')}
                            </summary>
                            <div className="mt-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                              {iv.transcript}
                            </div>
                          </details>
                        </div>
                      )}

                      {/* Grade form */}
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-600">{s('Calificación final', 'Final grade')}</p>
                        <div className="flex gap-3">
                          <div className="w-28">
                            <label className="text-xs text-gray-500 mb-1 block">{s('Nota', 'Grade')} (0–100)</label>
                            <input
                              type="number" min={0} max={100}
                              value={gs.grade}
                              onChange={(e) => setGradeStates((prev) => ({ ...prev, [iv.interviewId]: { ...prev[iv.interviewId]!, grade: e.target.value } }))}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cta-from/30"
                              placeholder="0"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-xs text-gray-500 mb-1 block">{s('Comentarios', 'Comments')}</label>
                            <textarea
                              rows={2}
                              value={gs.feedback}
                              onChange={(e) => setGradeStates((prev) => ({ ...prev, [iv.interviewId]: { ...prev[iv.interviewId]!, feedback: e.target.value } }))}
                              placeholder={s('Retroalimentación…', 'Feedback…')}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cta-from/30"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <Button size="sm" onClick={() => handleGrade(iv)} disabled={gs.saving || gs.grade === ''}>
                            {gs.saved
                              ? <><CheckCircle className="w-4 h-4 mr-1" />{s('Guardado', 'Saved')}</>
                              : gs.saving
                              ? <><Clock className="w-4 h-4 mr-1 animate-spin" />{s('Guardando…', 'Saving…')}</>
                              : s('Guardar calificación', 'Save grade')
                            }
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
