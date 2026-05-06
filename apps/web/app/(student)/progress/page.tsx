'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, CheckCircle, Lock, ArrowRight, Star, MessageSquare, Flame, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ReflectionStatusBadge } from '@/components/ui/Badge';

/** Calculate streak: consecutive days with at least one completed lesson */
function calcStreak(courses: any[]): number {
  const allDates = courses
    .flatMap((c) => c.modules?.flatMap((m: any) => m.lessons ?? []) ?? [])
    .filter((l: any) => l.completed && l.completedAt)
    .map((l: any) => new Date(l.completedAt).toDateString());

  const uniqueDays = [...new Set(allDates)].sort().reverse(); // newest first
  if (!uniqueDays.length) return 0;

  const todayStr = new Date().toDateString();
  const yesterdayStr = new Date(Date.now() - 86400000).toDateString();

  // Streak must include today or yesterday to be "active"
  if (uniqueDays[0] !== todayStr && uniqueDays[0] !== yesterdayStr) return 0;

  let streak = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    const prev = new Date(uniqueDays[i - 1]!);
    const curr = new Date(uniqueDays[i]!);
    const diff = Math.round((prev.getTime() - curr.getTime()) / 86400000);
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

export default function ProgressPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFeedback, setExpandedFeedback] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.courses.list().then((res) => {
      setCourses((res as any).data ?? []);
      setLoading(false);
    });
  }, []);

  const toggleFeedback = (moduleId: string) => {
    setExpandedFeedback((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  // Aggregate totals
  const totals = courses.reduce((acc, c) => {
    const lessons = c.modules?.flatMap((m: any) => m.lessons ?? []) ?? [];
    const completed = lessons.filter((l: any) => l.completed).length;
    const quizPassed = c.modules?.filter((m: any) => m.quizPassed).length ?? 0;
    const approved = c.modules?.filter((m: any) => m.reflectionStatus === 'APPROVED').length ?? 0;
    return {
      lessons: acc.lessons + lessons.length,
      completed: acc.completed + completed,
      quizPassed: acc.quizPassed + quizPassed,
      approved: acc.approved + approved,
    };
  }, { lessons: 0, completed: 0, quizPassed: 0, approved: 0 });

  const overallProgress = totals.lessons > 0 ? Math.round((totals.completed / totals.lessons) * 100) : 0;
  const streak = calcStreak(courses);

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">Mi Progreso</h1>
        <p className="text-gray-500 mt-1 text-sm">Seguimiento detallado de tu aprendizaje</p>
      </div>

      {/* Overall stats */}
      <div className="card">
        <h2 className="font-heading font-bold text-lg text-charcoal mb-4">Resumen global</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="text-center">
            <p className="font-heading font-bold text-3xl gradient-text">{totals.completed}</p>
            <p className="text-xs text-gray-500 mt-1">Lecciones<br />completadas</p>
          </div>
          <div className="text-center">
            <p className="font-heading font-bold text-3xl gradient-text">{totals.quizPassed}</p>
            <p className="text-xs text-gray-500 mt-1">Módulos con<br />quiz aprobado</p>
          </div>
          <div className="text-center">
            <p className="font-heading font-bold text-3xl gradient-text">{totals.approved}</p>
            <p className="text-xs text-gray-500 mt-1">Reflexiones<br />aprobadas</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              <Flame className={`w-7 h-7 ${streak > 0 ? 'text-orange-500' : 'text-gray-300'}`} />
              <p className={`font-heading font-bold text-3xl ${streak > 0 ? 'text-orange-500' : 'text-gray-400'}`}>{streak}</p>
            </div>
            <p className="text-xs text-gray-500 mt-1">Racha de<br />días activos</p>
          </div>
        </div>
        <ProgressBar value={overallProgress} label="Progreso general de cursos" showPercent size="lg" />
      </div>

      {/* Per-course breakdown */}
      {loading ? (
        <div className="space-y-4">
          {[1].map((n) => <div key={n} className="card animate-pulse h-64" />)}
        </div>
      ) : (
        courses.map((course) => {
          const allLessons = course.modules?.flatMap((m: any) => m.lessons ?? []) ?? [];
          const completedCount = allLessons.filter((l: any) => l.completed).length;
          const courseProgress = allLessons.length > 0
            ? Math.round((completedCount / allLessons.length) * 100)
            : 0;

          return (
            <div key={course.id} className="card space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-heading font-bold text-lg text-charcoal">{course.title}</h2>
                <Link href={`/courses/${course.id}`} className="text-sm text-cta-from flex items-center gap-1 font-semibold hover:opacity-80">
                  Ver curso <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              <ProgressBar value={courseProgress} label={`${completedCount} de ${allLessons.length} lecciones`} showPercent />

              <div className="space-y-2">
                {course.modules?.map((mod: any) => {
                  const modLessons = mod.lessons ?? [];
                  const modCompleted = modLessons.filter((l: any) => l.completed).length;
                  const modProgress = modLessons.length > 0
                    ? Math.round((modCompleted / modLessons.length) * 100)
                    : 0;
                  const hasFeedback = !!mod.evaluatorFeedback;
                  const isExpanded = expandedFeedback.has(mod.id);

                  return (
                    <div key={mod.id} className={`rounded-xl border transition-all ${
                      mod.unlocked ? 'border-border' : 'border-border bg-surface opacity-60'
                    }`}>
                      <div className="flex items-center gap-4 p-3">
                        {/* Status icon */}
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          mod.reflectionStatus === 'APPROVED' ? 'bg-emerald-100'
                            : mod.quizPassed ? 'bg-amber-100'
                            : mod.unlocked ? 'bg-blue-50'
                            : 'bg-gray-100'
                        }`}>
                          {mod.reflectionStatus === 'APPROVED' ? (
                            <CheckCircle className="w-5 h-5 text-emerald-600" />
                          ) : mod.unlocked ? (
                            <TrendingUp className="w-5 h-5 text-cta-from" />
                          ) : (
                            <Lock className="w-5 h-5 text-gray-400" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-sm font-medium text-charcoal truncate">
                              {mod.order}. {mod.title}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              {mod.reflectionStatus && (
                                <ReflectionStatusBadge status={mod.reflectionStatus} />
                              )}
                              {mod.reflectionStatus === 'APPROVED' && mod.qualityScore != null && (
                                <span className="inline-flex items-center gap-0.5 text-xs text-amber-500 font-semibold">
                                  <Star className="w-3 h-3 fill-amber-400" />
                                  {mod.qualityScore}/10
                                </span>
                              )}
                            </div>
                          </div>
                          <ProgressBar value={modProgress} size="sm" />
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-400 font-medium">
                            {modCompleted}/{modLessons.length}
                          </span>
                          {hasFeedback && (
                            <button
                              onClick={() => toggleFeedback(mod.id)}
                              className="p-1 rounded-lg hover:bg-surface text-cta-from"
                              title="Ver feedback del evaluador"
                            >
                              {isExpanded
                                ? <ChevronUp className="w-4 h-4" />
                                : <MessageSquare className="w-4 h-4" />
                              }
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Evaluator feedback panel */}
                      {hasFeedback && isExpanded && (
                        <div className="px-4 pb-4">
                          <div className="border-l-4 border-cta-to pl-4 bg-surface rounded-r-xl p-3">
                            <p className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Feedback del evaluador</p>
                            <p className="text-sm text-gray-700 leading-relaxed">{mod.evaluatorFeedback}</p>
                            {mod.reviewedAt && (
                              <p className="text-xs text-gray-400 mt-2">
                                {new Date(mod.reviewedAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
