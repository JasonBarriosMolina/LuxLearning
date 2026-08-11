'use client';

import { useEffect, useState, useCallback } from 'react';
import { Upload, FileCheck, Download, CheckCircle, Clock, ChevronDown } from 'lucide-react';
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

export default function EvaluatorSubmissionsPage() {
  const { t, lang } = useLanguage();
  const tS = t.evaluatorSubmissions;

  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedModule, setSelectedModule] = useState('');
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [gradeStates, setGradeStates] = useState<Record<string, GradeState>>({});
  const [expandedSub, setExpandedSub] = useState<string | null>(null);

  useEffect(() => {
    api.evaluator.myCourses().then((res: any) => {
      const list: any[] = (res as any).data ?? [];
      setCourses(list);
    }).catch(() => {});
  }, [lang]);

  const course = courses.find((c) => c.id === selectedCourse);
  const modules: any[] = course?.modules ?? [];

  const loadSubmissions = useCallback(async (moduleId: string) => {
    if (!moduleId) return;
    setLoadingSubs(true);
    setSubmissions([]);
    try {
      const res = await api.evaluator.submissions.list(moduleId);
      const list: any[] = (res as any).data ?? [];
      setSubmissions(list);
      const init: Record<string, GradeState> = {};
      for (const sub of list) {
        init[sub.submissionId] = {
          grade: sub.grade != null ? String(sub.grade) : '',
          feedback: sub.feedback ?? '',
          saving: false,
          saved: false,
        };
      }
      setGradeStates(init);
    } catch {
      setSubmissions([]);
    } finally {
      setLoadingSubs(false);
    }
  }, []);

  useEffect(() => {
    if (selectedModule) loadSubmissions(selectedModule);
  }, [selectedModule, loadSubmissions]);

  const handleGrade = async (sub: any) => {
    const st = gradeStates[sub.submissionId];
    if (!st) return;
    const gradeNum = parseFloat(st.grade);
    if (isNaN(gradeNum) || gradeNum < 0 || gradeNum > 100) return;
    setGradeStates((prev) => ({ ...prev, [sub.submissionId]: { ...prev[sub.submissionId]!, saving: true, saved: false } }));
    try {
      await api.evaluator.submissions.grade(sub.submissionId, {
        studentUserId: sub.userId,
        grade: gradeNum,
        feedback: st.feedback,
      });
      setGradeStates((prev) => ({ ...prev, [sub.submissionId]: { ...prev[sub.submissionId]!, saving: false, saved: true } }));
      setSubmissions((prev) => prev.map((s) =>
        s.submissionId === sub.submissionId
          ? { ...s, status: 'graded', grade: gradeNum, feedback: st.feedback }
          : s
      ));
      setTimeout(() => setGradeStates((prev) => ({ ...prev, [sub.submissionId]: { ...prev[sub.submissionId]!, saved: false } })), 2500);
    } catch {
      setGradeStates((prev) => ({ ...prev, [sub.submissionId]: { ...prev[sub.submissionId]!, saving: false } }));
    }
  };

  const handleDownload = async (sub: any) => {
    try {
      const res = await api.evaluator.submissions.downloadUrl(sub.submissionId, sub.s3Key);
      const url = (res as any).data?.url;
      if (url) window.open(url, '_blank');
    } catch {}
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">{tS.title}</h1>
        <p className="text-gray-500 mt-1 text-sm">{tS.subtitle}</p>
      </div>

      {/* Selectors */}
      <div className="card flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 mb-1 block">{tS.selectCourse}</label>
          <div className="relative">
            <select
              value={selectedCourse}
              onChange={(e) => { setSelectedCourse(e.target.value); setSelectedModule(''); setSubmissions([]); }}
              className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-charcoal bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-cta-from/30"
            >
              <option value="">—</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 mb-1 block">{tS.selectModule}</label>
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

      {/* Submissions list */}
      {selectedModule && (
        loadingSubs ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => <div key={n} className="card h-20 animate-pulse" />)}
          </div>
        ) : submissions.length === 0 ? (
          <div className="card text-center py-12">
            <Upload className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">{tS.noSubmissions}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.map((sub) => {
              const gs = gradeStates[sub.submissionId] ?? { grade: '', feedback: '', saving: false, saved: false };
              const isExpanded = expandedSub === sub.submissionId;
              return (
                <div key={sub.submissionId} className="card space-y-3">
                  {/* Header row */}
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                      <FileCheck className="w-4 h-4 text-orange-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-charcoal truncate">{sub.fileName}</p>
                      <p className="text-xs text-gray-400">
                        {tS.fileSize(sub.fileSize ?? 0)} · {new Date(sub.createdAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {sub.userId && <span className="ml-2 text-gray-500">· {sub.userId}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {sub.status === 'graded'
                        ? <Badge variant="success">{tS.gradeLabel(sub.grade ?? 0)}</Badge>
                        : <Badge variant="pending">{tS.pending}</Badge>
                      }
                      <button
                        onClick={() => handleDownload(sub)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-cta-from hover:bg-blue-50 transition-colors"
                        title={tS.download}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setExpandedSub(isExpanded ? null : sub.submissionId)}
                        className={`p-1.5 rounded-lg transition-colors ${isExpanded ? 'text-cta-from bg-blue-50' : 'text-gray-400 hover:text-cta-from hover:bg-blue-50'}`}
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Grade form (expanded) */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 pt-3 space-y-3">
                      <div className="flex gap-3">
                        <div className="w-28">
                          <label className="text-xs font-semibold text-gray-500 mb-1 block">{tS.grade} (0–100)</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={gs.grade}
                            onChange={(e) => setGradeStates((prev) => ({ ...prev, [sub.submissionId]: { ...prev[sub.submissionId]!, grade: e.target.value } }))}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cta-from/30"
                            placeholder="0"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs font-semibold text-gray-500 mb-1 block">{tS.feedback}</label>
                          <textarea
                            rows={2}
                            value={gs.feedback}
                            onChange={(e) => setGradeStates((prev) => ({ ...prev, [sub.submissionId]: { ...prev[sub.submissionId]!, feedback: e.target.value } }))}
                            placeholder={tS.gradePlaceholder}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cta-from/30"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          onClick={() => handleGrade(sub)}
                          disabled={gs.saving || gs.grade === ''}
                        >
                          {gs.saved
                            ? <><CheckCircle className="w-4 h-4 mr-1" />{tS.saved}</>
                            : gs.saving
                            ? <><Clock className="w-4 h-4 mr-1 animate-spin" />{tS.saving}</>
                            : tS.saveGrade
                          }
                        </Button>
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
