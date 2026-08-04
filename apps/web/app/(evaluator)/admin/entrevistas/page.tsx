'use client';

import { useEffect, useState, useCallback } from 'react';
import { Mic, Plus, List, Loader2, AlertTriangle, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { InterviewWizard } from './_components/InterviewWizard';
import { InterviewList } from './_components/InterviewList';
import { ReviewPanel } from './_components/ReviewPanel';
import { useLanguage } from '@/lib/i18n';

type Tab = 'gestionar' | 'revisar';

interface Course { id: string; title: string; isActive: boolean; modules: any[]; }
interface InterviewDef {
  id: string; courseId: string; moduleId: string | null; name: string;
  dueDate: string | null; weight: number; vapiPrompt: string | null;
  vapiObjectives: string | null; targetStudentIds: string[];
  submissionCount?: number; pendingCount?: number; moduleTitle?: string | null;
  isDraft?: boolean; isArchived?: boolean;
}
interface Coverage { totalWeight: number; interviewWeight: number; interviewCount: number; isFull: boolean; }

export default function EntrevistasPage() {
  const { lang } = useLanguage();
  const isEN = lang === 'en';
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('gestionar');
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);

  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [interviews, setInterviews] = useState<InterviewDef[]>([]);
  const [loadingInterviews, setLoadingInterviews] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [coverage, setCoverage] = useState<Coverage | null>(null);

  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    api.admin.interviews.listCourses().then((res: any) => {
      setCourses((res as any).data ?? []);
    }).catch(() => {}).finally(() => setLoadingCourses(false));

    api.profile.get().then((res: any) => {
      const role: string = (res as any).data?.role ?? (res as any).role ?? '';
      setCanDelete(role === 'ADMIN' || role === 'SUPER_ADMIN');
    }).catch(() => {});
  }, []);

  const loadInterviews = useCallback(async (cId: string) => {
    if (!cId) { setInterviews([]); setCoverage(null); return; }
    setLoadingInterviews(true);
    try {
      const [ivRes, covRes] = await Promise.all([
        api.admin.interviews.list(cId, true),
        api.admin.interviews.coverage(cId),
      ]);
      setInterviews((ivRes as any).data ?? []);
      setCoverage((covRes as any).data ?? null);
    } catch {
      setInterviews([]);
      setCoverage(null);
    } finally {
      setLoadingInterviews(false);
    }
  }, []);

  useEffect(() => { loadInterviews(selectedCourseId); }, [selectedCourseId, loadInterviews]);

  function handleCreated() {
    setShowWizard(false);
    loadInterviews(selectedCourseId);
  }

  const s = (es: string, en: string) => isEN ? en : es;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center">
            <Mic className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{s('Entrevistas Orales', 'Oral Interviews')}</h1>
            <p className="text-xs text-gray-400 mt-0.5">{s('Crea y gestiona entrevistas IA · Revisa y califica', 'Create and manage AI interviews · Review and grade')}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-gray-100 rounded-2xl w-fit">
        {(['gestionar', 'revisar'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'gestionar' ? s('Gestionar', 'Manage') : s('Revisar', 'Review')}
          </button>
        ))}
      </div>

      {tab === 'gestionar' && (
        <div className="space-y-5">
          {loadingCourses ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
          ) : (
            <>
              <button
                onClick={() => setShowWizard((p) => !p)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
                  showWizard
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-dashed border-gray-200 text-gray-500 hover:border-blue-400 hover:text-blue-600'
                }`}
              >
                <Plus className="w-4 h-4" />
                {showWizard ? s('Cancelar', 'Cancel') : s('Nueva entrevista', 'New interview')}
              </button>

              {showWizard && (
                <div className="bg-white border border-blue-100 rounded-2xl shadow-sm p-5">
                  <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-blue-500" />
                    {s('Crear nueva entrevista', 'Create new interview')}
                  </h2>
                  <InterviewWizard courses={courses} onCreated={handleCreated} />
                </div>
              )}

              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
                  <List className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-semibold text-gray-700">{s('Entrevistas existentes', 'Existing interviews')}</span>
                  <div className="ml-auto">
                    <select
                      value={selectedCourseId}
                      onChange={(e) => setSelectedCourseId(e.target.value)}
                      className="appearance-none border border-gray-200 rounded-xl px-3 py-1.5 text-xs bg-white pr-6 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                      <option value="">— {s('Selecciona un curso', 'Select a course')} —</option>
                      {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </div>
                </div>

                {coverage?.isFull && selectedCourseId && (
                  <div className="mx-5 mt-4 flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-amber-800">
                        {s('Este curso ya tiene el 100% de evaluaciones asignadas', 'This course already has 100% of evaluations assigned')}
                      </p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        {s('Para agregar otra entrevista, redistribuye los porcentajes en Lux Planner.', 'To add another interview, redistribute the percentages in Lux Planner.')}
                      </p>
                    </div>
                    <button
                      onClick={() => router.push(`/admin/courses/lux-planner?courseId=${selectedCourseId}`)}
                      className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors"
                    >
                      Lux Planner <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                )}

                <div className="p-5">
                  {!selectedCourseId ? (
                    <p className="text-xs text-gray-400 text-center py-8">{s('Selecciona un curso para ver sus entrevistas', 'Select a course to see its interviews')}</p>
                  ) : loadingInterviews ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
                  ) : (
                    <InterviewList
                      interviews={interviews}
                      courses={courses}
                      canDelete={canDelete}
                      onDeleted={(id) => setInterviews((p) => p.filter((iv) => iv.id !== id))}
                      onUpdated={(updated) => setInterviews((p) => p.map((iv) => iv.id === updated.id ? updated : iv))}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'revisar' && (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
          <ReviewPanel courses={courses} />
        </div>
      )}
    </div>
  );
}
