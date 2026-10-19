'use client';

import { useEffect, useState, useCallback } from 'react';
import { BookOpen, Plus, Loader2, LayoutGrid, Star } from 'lucide-react';
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
  const s = (es: string, en: string) => isEN ? en : es;

  const [tab, setTab] = useState<Tab>('gestionar');
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [classes, setClasses] = useState<ClassDef[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassDef | null>(null);
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
    setEditingClass(null);
    loadClasses(selectedCourseId);
  }

  function handleEdit(c: ClassDef) {
    setEditingClass(c);
    setShowWizard(true);
  }

  function handleCloseWizard() {
    setShowWizard(false);
    setEditingClass(null);
  }

  const pendingCount = sessions.filter((s: any) => s.grade == null).length;
  const totalSubmissions = sessions.length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* Header card */}
      <div className="bg-gradient-to-br from-[#17527E] via-[#1A6494] to-[#0F3F62] rounded-3xl p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{s('Lux Mentor — Clases', 'Lux Mentor — Classes')}</h1>
              <p className="text-blue-200 text-sm mt-0.5">{s('Crea y gestiona clases interactivas', 'Create and manage interactive classes')}</p>
            </div>
          </div>
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#17527E] font-semibold text-sm hover:bg-blue-50 transition-all shrink-0"
          >
            <Plus className="w-4 h-4" />
            {s('Nueva clase', 'New class')}
          </button>
        </div>

        {/* Stats row */}
        <div className="flex gap-3 mt-5 flex-wrap">
          <div className="bg-white/15 rounded-2xl px-4 py-2.5 flex items-center gap-2.5">
            <LayoutGrid className="w-4 h-4 text-blue-200" />
            <div>
              <p className="text-lg font-bold leading-none">{classes.length}</p>
              <p className="text-xs text-blue-300 mt-0.5">{s('Clases', 'Classes')}</p>
            </div>
          </div>
          <div className="bg-white/15 rounded-2xl px-4 py-2.5 flex items-center gap-2.5">
            <Star className="w-4 h-4 text-blue-200" />
            <div>
              <p className="text-lg font-bold leading-none">{totalSubmissions}</p>
              <p className="text-xs text-blue-300 mt-0.5">{s('Sesiones', 'Sessions')}</p>
            </div>
          </div>
          {pendingCount > 0 && (
            <div className="bg-amber-400/25 border border-amber-300/30 rounded-2xl px-4 py-2.5 flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" />
              <div>
                <p className="text-lg font-bold leading-none text-amber-200">{pendingCount}</p>
                <p className="text-xs text-amber-300 mt-0.5">{s('Por calificar', 'Pending review')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Course selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold text-gray-600 shrink-0">{s('Curso:', 'Course:')}</label>
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

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-2xl w-fit">
        <button
          onClick={() => setTab('gestionar')}
          className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all ${tab === 'gestionar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {s('Gestionar', 'Manage')}
          {classes.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === 'gestionar' ? 'bg-[#17527E]/10 text-[#17527E]' : 'bg-gray-200 text-gray-500'}`}>
              {classes.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('revisar')}
          className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all ${tab === 'revisar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {s('Revisar', 'Review')}
          {pendingCount > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === 'revisar' ? 'bg-amber-100 text-amber-700' : 'bg-amber-200 text-amber-700'}`}>
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* Gestionar tab */}
      {tab === 'gestionar' && (
        <div>
          {loadingClasses ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            </div>
          ) : (
            <ClassList
              classes={classes}
              courses={courses}
              canDelete={canDelete}
              onDeleted={() => loadClasses(selectedCourseId)}
              onUpdated={() => loadClasses(selectedCourseId)}
              onEdit={handleEdit}
            />
          )}
        </div>
      )}

      {/* Revisar tab */}
      {tab === 'revisar' && (
        <div>
          {loadingSessions ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            </div>
          ) : (
            <ClassReviewPanel
              sessions={sessions}
              onGraded={() => loadSessions(selectedCourseId)}
            />
          )}
        </div>
      )}

      {/* Wizard modal */}
      {showWizard && (
        <ClassWizard
          courses={courses}
          onCreated={handleCreated}
          editingClass={editingClass}
          onClose={handleCloseWizard}
        />
      )}
    </div>
  );
}
