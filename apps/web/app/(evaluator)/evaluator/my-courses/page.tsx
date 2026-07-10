'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Users, ClipboardList, MessageSquare, Loader2, BookMarked, FolderOpen, Pencil, GraduationCap, MoreVertical, Pin, Archive } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';

interface MyCourse {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  isActive: boolean;
  enrollmentCount: number;
  pendingReflections: number;
  groupChatId: string;
  modules: Array<{ id: string; title: string; order: number }>;
}

export default function MyCoursesPage() {
  const { t, lang } = useLanguage();
  const [courses, setCourses] = useState<MyCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.evaluator.myCourses()
      .then((res: any) => setCourses(Array.isArray(res) ? res : (res.data ?? [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [lang]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    if (openMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenu]);

  const togglePin = (id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setOpenMenu(null);
  };

  const sortedCourses = [...courses].sort((a, b) => {
    const aPin = pinnedIds.has(a.id) ? 0 : 1;
    const bPin = pinnedIds.has(b.id) ? 0 : 1;
    return aPin - bPin;
  });

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-cta-from" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center gap-3">
        <BookMarked className="w-6 h-6 text-cta-from" />
        <h1 className="font-heading font-bold text-2xl text-charcoal">{t.nav.myCourses}</h1>
      </div>
      <p className="text-sm text-gray-500">{t.evaluator.myCoursesSubtitle}</p>

      {courses.length === 0 ? (
        <div className="card text-center py-16">
          <BookOpen className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">{t.evaluator.noCoursesAssigned}</p>
          <p className="text-sm text-gray-400 mt-1">{t.evaluator.noCoursesAdminHint}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {sortedCourses.map((course) => (
            <div key={course.id} className="card space-y-4">
              {/* Header */}
              <div className="flex items-start gap-4">
                {course.imageUrl ? (
                  <img src={course.imageUrl} alt={course.title} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-cta-gradient flex items-center justify-center shrink-0">
                    <BookOpen className="w-7 h-7 text-white" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {pinnedIds.has(course.id) && <Pin className="w-3.5 h-3.5 text-cta-from shrink-0" />}
                    <h2 className="font-heading font-bold text-base text-charcoal truncate">{course.title}</h2>
                  </div>
                  <p className="text-sm text-gray-500 line-clamp-2 mt-0.5">{course.description}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${course.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {course.isActive ? t.evaluator.active2 : t.evaluator.inactive2}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-charcoal">{course.enrollmentCount}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t.evaluator.statStudents}</p>
                </div>
                <div className="bg-surface rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-charcoal">{course.modules.length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t.evaluator.statModules}</p>
                </div>
                <div className={`rounded-xl p-3 text-center ${course.pendingReflections > 0 ? 'bg-amber-50' : 'bg-surface'}`}>
                  <p className={`text-xl font-bold ${course.pendingReflections > 0 ? 'text-amber-600' : 'text-charcoal'}`}>
                    {course.pendingReflections}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{t.evaluator.statPending2}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-border" ref={openMenu === course.id ? menuRef : undefined}>
                <Link
                  href={`/evaluator/reflections?courseId=${course.id}`}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-cta-from text-white text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  {t.evaluator.viewReflections}
                  {course.pendingReflections > 0 && (
                    <span className="ml-1 bg-white/20 px-1.5 py-0.5 rounded-full text-[10px]">{course.pendingReflections}</span>
                  )}
                </Link>

                {/* 3-dot menu */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => setOpenMenu(openMenu === course.id ? null : course.id)}
                    className="p-2 rounded-xl hover:bg-surface text-gray-500 hover:text-charcoal transition-colors border border-border"
                    title="Más opciones"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {openMenu === course.id && (
                    <div className="absolute right-0 bottom-full mb-1 z-20 bg-white dark:bg-[#1A1A2E] border border-border rounded-xl shadow-lg py-1 w-52">
                      <Link
                        href={`/admin/courses/${course.id}`}
                        onClick={() => setOpenMenu(null)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-charcoal hover:bg-surface transition-colors"
                      >
                        <Pencil className="w-4 h-4 text-gray-400" />
                        {t.evaluator.editCourse ?? 'Editar curso'}
                      </Link>
                      <Link
                        href={`/admin/courses/${course.id}/preview`}
                        onClick={() => setOpenMenu(null)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-charcoal hover:bg-surface transition-colors"
                      >
                        <GraduationCap className="w-4 h-4 text-gray-400" />
                        {t.evaluator.viewAsStudent ?? 'Ver como estudiante'}
                      </Link>
                      <Link
                        href={`/evaluator/students?courseId=${course.id}`}
                        onClick={() => setOpenMenu(null)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-charcoal hover:bg-surface transition-colors"
                      >
                        <Users className="w-4 h-4 text-gray-400" />
                        {t.nav.students}
                      </Link>
                      <Link
                        href={`/evaluator/communications?chatId=${course.groupChatId}`}
                        onClick={() => setOpenMenu(null)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-charcoal hover:bg-surface transition-colors"
                      >
                        <MessageSquare className="w-4 h-4 text-gray-400" />
                        {t.evaluator.groupChat}
                      </Link>
                      <Link
                        href={`/evaluator/my-resources?courseId=${course.id}`}
                        onClick={() => setOpenMenu(null)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-charcoal hover:bg-surface transition-colors"
                      >
                        <FolderOpen className="w-4 h-4 text-gray-400" />
                        {t.evaluator.resources}
                      </Link>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => togglePin(course.id)}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-charcoal hover:bg-surface transition-colors"
                      >
                        <Pin className={`w-4 h-4 ${pinnedIds.has(course.id) ? 'text-cta-from' : 'text-gray-400'}`} />
                        {pinnedIds.has(course.id) ? 'Desfijar curso' : 'Fijar curso'}
                      </button>
                      <button
                        onClick={() => setOpenMenu(null)}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-400 hover:bg-surface transition-colors cursor-not-allowed opacity-50"
                        disabled
                        title="Disponible pronto"
                      >
                        <Archive className="w-4 h-4" />
                        Archivar curso
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
