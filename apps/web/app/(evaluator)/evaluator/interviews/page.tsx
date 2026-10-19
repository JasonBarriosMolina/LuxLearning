'use client';

import { useEffect, useState, useCallback } from 'react';
import { Mic, ChevronDown, CheckCircle, Clock, FileText, AlertTriangle, Star, Search, BookOpen } from 'lucide-react';
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

type ViewMode = 'pending' | 'browse';

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'hace menos de 1h';
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

function getUrgency(createdAt: string): 'urgent' | 'warning' | 'fresh' {
  const h = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  if (h > 48) return 'urgent';
  if (h > 24) return 'warning';
  return 'fresh';
}

const urgencyBadge: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  fresh: 'bg-emerald-100 text-emerald-700',
};

function formatDuration(sec?: number): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function EvaluatorInterviewsPage() {
  const { t, lang } = useLanguage();
  const s = (es: string, en: string) => lang === 'en' ? en : es;

  const [viewMode, setViewMode] = useState<ViewMode>('pending');
  const [pendingInterviews, setPendingInterviews] = useState<any[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);

  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedModule, setSelectedModule] = useState('');
  const [browseInterviews, setBrowseInterviews] = useState<any[]>([]);
  const [loadingBrowse, setLoadingBrowse] = useState(false);

  const [gradeStates, setGradeStates] = useState<Record<string, GradeState>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const initGradeStates = (list: any[]) => {
    const init: Record<string, GradeState> = {};
    for (const iv of list) {
      init[iv.interviewId] = {
        grade: iv.grade != null ? String(iv.grade) : '',
        feedback: iv.feedback ?? '',
        saving: false,
        saved: false,
      };
    }
    setGradeStates((prev) => ({ ...init, ...prev }));
  };

  useEffect(() => {
    api.evaluator.interviews.pending().then((res: any) => {
      const list = (res as any).data ?? [];
      setPendingInterviews(list);
      initGradeStates(list);
    }).catch(() => {}).finally(() => setLoadingPending(false));

    api.evaluator.myCourses().then((res: any) => {
      setCourses((res as any).data ?? []);
    }).catch(() => {});
  }, [lang]);

  const loadBrowse = useCallback(async (moduleId: string) => {
    if (!moduleId) { setBrowseInterviews([]); return; }
    setLoadingBrowse(true);
    try {
      const res = await api.evaluator.interviews.list(moduleId);
      const list = (res as any).data ?? [];
      setBrowseInterviews(list);
      initGradeStates(list);
    } catch { setBrowseInterviews([]); } finally { setLoadingBrowse(false); }
  }, []);

  useEffect(() => { if (selectedModule) loadBrowse(selectedModule); }, [selectedModule, loadBrowse]);

  const course = courses.find((c) => c.id === selectedCourse);
  const modules: any[] = course?.modules ?? [];

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
      setPendingInterviews((prev) => prev.filter((i) => i.interviewId !== iv.interviewId));
      setBrowseInterviews((prev) => prev.map((i) =>
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

  const activeList = viewMode === 'pending' ? pendingInterviews : browseInterviews;
  const isLoading = viewMode === 'pending' ? loadingPending : loadingBrowse;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="bg-gradient-to-br from-[#17527E] via-[#1A6494] to-[#0F3F62] rounded-3xl p-6 text-white">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{s('Entrevistas Orales', 'Oral Interviews')}</h1>
            <p className="text-blue-200 text-sm mt-0.5">{s('Transcripciones, análisis de IA y calificación', 'Transcripts, AI analysis and grading')}</p>
          </div>
        </div>

        <div className="flex gap-3 mt-5 flex-wrap">
          {loadingPending ? (
            <div className="bg-white/15 rounded-2xl px-4 py-2.5 animate-pulse w-28 h-14" />
          ) : (
            <div className={`rounded-2xl px-4 py-2.5 flex items-center gap-2.5 ${pendingInterviews.length > 0 ? 'bg-amber-400/25 border border-amber-300/30' : 'bg-white/15'}`}>
              {pendingInterviews.length > 0 && <div className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" />}
              <div>
                <p className={`text-lg font-bold leading-none ${pendingInterviews.length > 0 ? 'text-amber-200' : ''}`}>{pendingInterviews.length}</p>
                <p className={`text-xs mt-0.5 ${pendingInterviews.length > 0 ? 'text-amber-300' : 'text-blue-300'}`}>{s('Por calificar', 'Pending grade')}</p>
              </div>
            </div>
          )}
          <div className="bg-white/15 rounded-2xl px-4 py-2.5 flex items-center gap-2.5">
            <BookOpen className="w-4 h-4 text-blue-200" />
            <div>
              <p className="text-lg font-bold leading-none">{courses.length}</p>
              <p className="text-xs text-blue-300 mt-0.5">{s('Cursos asignados', 'Assigned courses')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* View mode tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-2xl w-fit">
        <button
          onClick={() => setViewMode('pending')}
          className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all ${viewMode === 'pending' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          {s('Por calificar', 'Pending')}
          {!loadingPending && pendingInterviews.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${viewMode === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-amber-200 text-amber-700'}`}>
              {pendingInterviews.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setViewMode('browse')}
          className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all ${viewMode === 'browse' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Search className="w-3.5 h-3.5" />
          {s('Buscar por módulo', 'Browse by module')}
        </button>
      </div>

      {/* Browse selectors */}
      {viewMode === 'browse' && (
        <div className="flex flex-col sm:flex-row gap-4 bg-white rounded-2xl p-4 shadow-card">
          <div className="flex-1">
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">{s('Selecciona un curso', 'Select a course')}</label>
            <div className="relative">
              <select
                value={selectedCourse}
                onChange={(e) => { setSelectedCourse(e.target.value); setSelectedModule(''); setBrowseInterviews([]); }}
                className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-charcoal bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-[#17527E]/30"
              >
                <option value="">—</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
          <div className="flex-1">
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">{s('Selecciona un módulo', 'Select a module')}</label>
            <div className="relative">
              <select
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
                disabled={!selectedCourse}
                className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-charcoal bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-[#17527E]/30 disabled:opacity-50"
              >
                <option value="">—</option>
                {modules.map((m: any) => <option key={m.id} value={m.id}>{m.order}. {m.title}</option>)}
              </select>
              <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {(viewMode === 'pending' || selectedModule) && (
        isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="bg-white rounded-2xl h-24 animate-pulse shadow-card" />)}</div>
        ) : activeList.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-card text-center py-14">
            <Mic className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm font-medium">
              {viewMode === 'pending' ? s('Sin entrevistas pendientes — al día', 'No pending interviews') : s('No hay entrevistas para este módulo', 'No interviews for this module')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeList.map((iv) => {
              const gs = gradeStates[iv.interviewId] ?? { grade: '', feedback: '', saving: false, saved: false };
              const isExpanded = expandedId === iv.interviewId;
              const urgency = (iv.status === 'completed' && iv.grade == null) ? getUrgency(iv.createdAt) : null;

              return (
                <div
                  key={iv.interviewId}
                  className={`bg-white rounded-2xl shadow-card p-4 space-y-3 ${urgency === 'urgent' ? 'ring-2 ring-red-300' : urgency === 'warning' ? 'ring-2 ring-amber-300' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                      <Mic className="w-4 h-4 text-rose-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-charcoal truncate">
                        {iv.studentName ?? iv.userId}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {iv.courseTitle && iv.moduleTitle ? `${iv.courseTitle} · ${iv.moduleTitle} · ` : ''}
                        {new Date(iv.createdAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {iv.durationSeconds ? ` · ${formatDuration(iv.durationSeconds)}` : ''}
                        {iv.aiScore != null ? ` · IA: ${iv.aiScore}%` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {urgency && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${urgencyBadge[urgency]}`}>
                          {relativeTime(iv.createdAt)}
                        </span>
                      )}
                      {statusBadge(iv)}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : iv.interviewId)}
                        className={`p-1.5 rounded-lg transition-colors ${isExpanded ? 'text-[#17527E] bg-blue-50' : 'text-gray-400 hover:text-[#17527E] hover:bg-blue-50'}`}
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100 pt-3 space-y-4">
                      {iv.aiAnalysis && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#17527E]">
                            <Star className="w-3.5 h-3.5" />
                            {s('Análisis Formativo (IA)', 'Formative Analysis (AI)')}
                            {iv.aiScore != null && <span className="ml-auto font-bold">{iv.aiScore}/100</span>}
                          </div>
                          <div className="bg-[#17527E]/5 border border-[#17527E]/15 rounded-xl px-3 py-2 text-xs text-[#0F3F62] whitespace-pre-wrap leading-relaxed">
                            {iv.aiAnalysis}
                          </div>
                        </div>
                      )}

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

                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-600">{s('Calificación final', 'Final grade')}</p>
                        <div className="flex gap-3">
                          <div className="w-28">
                            <label className="text-xs text-gray-500 mb-1 block">{s('Nota', 'Grade')} (0–100)</label>
                            <input
                              type="number" min={0} max={100}
                              value={gs.grade}
                              onChange={(e) => setGradeStates((prev) => ({ ...prev, [iv.interviewId]: { ...prev[iv.interviewId]!, grade: e.target.value } }))}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#17527E]/30"
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
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#17527E]/30"
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

      {viewMode === 'browse' && !selectedModule && (
        <div className="bg-white rounded-2xl shadow-card text-center py-14">
          <Search className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">{s('Selecciona un curso y módulo para ver las entrevistas', 'Select a course and module to view interviews')}</p>
        </div>
      )}
    </div>
  );
}
