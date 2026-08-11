'use client';

import { useEffect, useState, useCallback } from 'react';
import { BookOpen, Plus, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { ClassWizard } from './_components/ClassWizard';
import { ClassList } from './_components/ClassList';
import { ClassReviewPanel } from './_components/ClassReviewPanel';
import { useLanguage } from '@/lib/i18n';

type Tab = 'gestionar' | 'revisar';

interface Course { id: string; title: string; isActive: boolean; modules: any[]; }
interface ClassDef {
  id: string; courseId: string; moduleId: string | null; name: string;
  dueDate: string | null; weight: number; vapiPrompt: string | null;
  vapiObjectives: string | null; lessonVideoUrl: string | null; lessonScript: string | null;
  targetStudentIds: string[]; submissionCount?: number; pendingCount?: number;
  moduleTitle?: string | null; isDraft?: boolean; isArchived?: boolean;
}

export default function ClasesPage() {
  const { lang } = useLanguage();
  const isEN = lang === 'en';

  const [tab, setTab] = useState<Tab>('gestionar');
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [classes, setClasses] = useState<ClassDef[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    api.admin.classes.listCourses().then((res: any) => {
      setCourses((res as any).data ?? []);
    }).catch(() => {}).finally(() => setLoadingCourses(false));

    api.profile.get().then((res: any) => {
      const role: string = (res as any).data?.role ?? (res as any).role ?? '';
      setCanDelete(role === 'ADMIN' || role === 'SUPER_ADMIN');
    }).catch(() => {});
  }, []);

  const loadClasses = useCallback(async (cId: string) => {
    if (!cId) { setClasses([]); return; }
    setLoadingClasses(true);
    try {
      const res = await api.admin.classes.list(cId, true);
      setClasses((res as any).data ?? []);
    } catch { setClasses([]); } finally { setLoadingClasses(false); }
  }, []);

  const loadSessions = useCallback(async (cId: string) => {
    if (!cId) { setSessions([]); return; }
    setLoadingSessions(true);
    try {
      const res = await api.admin.classes.submissions(cId, 'completed');
      setSessions((res as any).data ?? []);
    } catch { setSessions([]); } finally { setLoadingSessions(false); }
  }, []);

  useEffect(() => {
    loadClasses(selectedCourseId);
    loadSessions(selectedCourseId);
  }, [selectedCourseId, loadClasses, loadSessions]);

  function handleCreated() {
    setShowWizard(false);
    loadClasses(selectedCourseId);
  }

  const s = (es: string, en: string) => isEN ? en : es;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{s('Lux Mentor — Clases', 'Lux Mentor — Classes')}</h1>
            <p className="text-xs text-gray-400 mt-0.5">{s('Crea y gestiona clases interactivas · Revisa y califica sesiones', 'Create and manage interactive classes · Review and grade sessions')}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
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

      {/* Course selector */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">{s('Curso', 'Course')}</label>
        {loadingCourses ? (
          <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-64" />
        ) : (
          <select
            value={selectedCourseId}
            onChange={(e) => setSelectedCourseId(e.target.value)}
            className="input w-64"
          >
            <option value="">{s('Selecciona un curso', 'Select a course')}</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </div>

      {/* Gestionar tab */}
      {tab === 'gestionar' && (
        <div className="space-y-5">
          <button
            onClick={() => setShowWizard((p) => !p)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
              showWizard
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-dashed border-gray-200 text-gray-500 hover:border-indigo-400 hover:text-indigo-600'
            }`}
          >
            <Plus className="w-4 h-4" />
            {showWizard ? s('Cancelar', 'Cancel') : s('Nueva clase', 'New class')}
          </button>

          {showWizard && (
            <div className="bg-white border border-indigo-100 rounded-2xl shadow-sm p-5">
              <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-500" />
                {s('Crear nueva clase', 'Create new class')}
              </h2>
              <ClassWizard courses={courses} onCreated={handleCreated} />
            </div>
          )}

          {loadingClasses ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>
          ) : (
            <ClassList
              classes={classes}
              courses={courses}
              canDelete={canDelete}
              onDeleted={() => loadClasses(selectedCourseId)}
              onUpdated={() => loadClasses(selectedCourseId)}
            />
          )}
        </div>
      )}

      {/* Revisar tab */}
      {tab === 'revisar' && (
        <div>
          {loadingSessions ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>
          ) : (
            <ClassReviewPanel
              sessions={sessions}
              onGraded={() => loadSessions(selectedCourseId)}
            />
          )}
        </div>
      )}
    </div>
  );
}
