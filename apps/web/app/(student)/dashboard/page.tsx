'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { BookOpen, TrendingUp, CheckCircle, Clock, ArrowRight, Lock, Award, Flame, X, ClipboardList, Calendar, AlertCircle, ChevronDown, ChevronUp, Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge, ReflectionStatusBadge } from '@/components/ui/Badge';
import type { Course, Certificate } from '@lux/types';
import { useLanguage } from '@/lib/i18n';

interface EnrichedModule {
  id: string;
  order: number;
  title: string;
  duration: string;
  unlocked: boolean;
  quizPassed: boolean;
  reflectionStatus: string | null;
  lessons: Array<{ id: string; completed: boolean }>;
}

type EnrichedCourse = Omit<Course, 'modules'> & { modules: EnrichedModule[] };

export default function StudentDashboardPage() {
  const { email } = useAuth();
  const { t, lang } = useLanguage();
  const [courses, setCourses] = useState<EnrichedCourse[]>([]);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [studyPlan, setStudyPlan] = useState<{ plan: string; generatedAt: string } | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);

  useEffect(() => {
    // Welcome banner: show unless hidden within the last 8 days
    const hiddenUntil = localStorage.getItem('lux-welcome-hidden-until');
    if (!hiddenUntil || Date.now() > Number(hiddenUntil)) {
      setShowWelcome(true);
    }
  }, []);

  const dismissWelcome = () => {
    const eightDays = Date.now() + 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('lux-welcome-hidden-until', String(eightDays));
    setShowWelcome(false);
  };

  useEffect(() => {
    setLoading(true);
    api.courses.list().then((res) => {
      setCourses((res as any).data ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
    api.certificates.mine().then((res: any) => {
      setCerts(res?.data ?? []);
    }).catch(() => {});
    api.tasks.list().then((res: any) => {
      setTasks(res?.data ?? []);
    }).catch(() => {});
    api.studyPlan.get().then((res: any) => {
      const d = res?.data ?? res;
      if (d?.plan) setStudyPlan(d);
    }).catch(() => {});
  }, [lang]);

  const loadStudyPlan = async (forceRefresh = false) => {
    setPlanLoading(true);
    try {
      if (forceRefresh) await api.studyPlan.refresh();
      const res: any = await api.studyPlan.get();
      const d = res?.data ?? res;
      if (d?.plan) setStudyPlan(d);
    } catch { /* non-fatal */ } finally {
      setPlanLoading(false);
    }
  };

  const firstName = email?.split('@')[0] ?? t.roles.student;

  // Calculate overall stats across all courses
  const stats = courses.reduce((acc, course) => {
    const allLessons = course.modules?.flatMap((m) => m.lessons ?? []) ?? [];
    const completedLessons = allLessons.filter((l) => l.completed);
    const passedModules = course.modules?.filter((m) => m.quizPassed) ?? [];
    const approvedReflections = course.modules?.filter((m) => m.reflectionStatus === 'APPROVED') ?? [];

    return {
      totalLessons: acc.totalLessons + allLessons.length,
      completedLessons: acc.completedLessons + completedLessons.length,
      passedModules: acc.passedModules + passedModules.length,
      approvedReflections: acc.approvedReflections + approvedReflections.length,
    };
  }, { totalLessons: 0, completedLessons: 0, passedModules: 0, approvedReflections: 0 });

  const overallProgress = stats.totalLessons > 0
    ? Math.round((stats.completedLessons / stats.totalLessons) * 100)
    : 0;

  // Calculate streak from lesson completedAt dates
  const streak = (() => {
    const allDates = courses
      .flatMap((c) => c.modules?.flatMap((m) => m.lessons ?? []) ?? [])
      .filter((l: any) => l.completed && l.completedAt)
      .map((l: any) => new Date(l.completedAt).toDateString());
    const uniqueDays = [...new Set(allDates)].sort().reverse();
    if (!uniqueDays.length) return 0;
    const todayStr = new Date().toDateString();
    const yesterdayStr = new Date(Date.now() - 86400000).toDateString();
    if (uniqueDays[0] !== todayStr && uniqueDays[0] !== yesterdayStr) return 0;
    let s = 1;
    for (let i = 1; i < uniqueDays.length; i++) {
      const diff = Math.round((new Date(uniqueDays[i-1]!).getTime() - new Date(uniqueDays[i]!).getTime()) / 86400000);
      if (diff === 1) s++; else break;
    }
    return s;
  })();

  const motivational = (progress: number) => {
    const m = lang === 'en'
      ? ['Start your learning journey! 🚀', 'Great start! Keep going 💪', "Halfway there! Don't stop 🔥", 'Almost done! One more push ⚡', 'Course completed! 🎉']
      : ['¡Comienza tu viaje de aprendizaje! 🚀', '¡Buen comienzo! Sigue así 💪', '¡Vas a la mitad! No te detengas 🔥', '¡Casi lo logras! Un esfuerzo más ⚡', '¡Curso completado! 🎉'];
    if (progress === 0) return m[0];
    if (progress <= 30) return m[1];
    if (progress <= 70) return m[2];
    if (progress < 100) return m[3];
    return m[4];
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in">
      {/* Welcome */}
      <div>
        <h1 className="font-heading font-bold text-2xl lg:text-3xl text-charcoal">
          {t.studentDashboard.greeting(firstName)} 👋
        </h1>
        <p className="text-gray-500 mt-1">{t.studentDashboard.continuelearning}</p>
      </div>

      {/* Dismissible welcome banner */}
      {showWelcome && (
        <div className="relative flex items-start gap-4 p-4 rounded-2xl bg-gradient-to-r from-[#00B4D8]/10 to-[#7B2FBE]/10 border border-[#00B4D8]/20">
          <div className="flex-1 min-w-0">
            <p className="font-heading font-bold text-sm text-charcoal">{t.studentDashboard.welcomeMsg}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {t.studentDashboard.welcomeHint}
            </p>
          </div>
          <button
            onClick={dismissWelcome}
            title={t.studentDashboard.hideStreak(8)}
            className="shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap"
          >
            <X className="w-3.5 h-3.5" />
            {t.studentDashboard.hideStreak(8)}
          </button>
        </div>
      )}

      {/* Stats row — clickeable */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          {
            label: t.studentDashboard.totalProgress,
            value: `${overallProgress}%`,
            icon: <TrendingUp className="w-5 h-5 text-cta-from" />,
            bg: 'bg-blue-50',
            href: '/courses',
          },
          {
            label: t.studentDashboard.lessonsCompleted,
            value: `${stats.completedLessons}/${stats.totalLessons}`,
            icon: <CheckCircle className="w-5 h-5 text-emerald-500" />,
            bg: 'bg-emerald-50',
            href: '/courses',
          },
          {
            label: t.studentDashboard.modulesApproved,
            value: stats.passedModules,
            icon: <BookOpen className="w-5 h-5 text-purple-500" />,
            bg: 'bg-purple-50',
            href: '/courses',
          },
          {
            label: t.studentDashboard.reflectionsApproved,
            value: stats.approvedReflections,
            icon: <Clock className="w-5 h-5 text-amber-500" />,
            bg: 'bg-amber-50',
            href: '/courses',
          },
          {
            label: streak > 1 ? `🔥 ${t.studentDashboard.activeStreak}` : t.studentDashboard.streakDays,
            value: `${streak}d`,
            icon: <Flame className={`w-5 h-5 ${streak > 0 ? 'text-orange-500' : 'text-gray-400'}`} />,
            bg: streak > 0 ? 'bg-orange-50' : 'bg-gray-50',
            href: '/activity',
          },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href} className="card hover:shadow-card hover:border-cta-from/30 transition-all cursor-pointer block">
            <div className={`w-10 h-10 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>
              {stat.icon}
            </div>
            <p className="font-heading font-bold text-2xl text-charcoal">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </Link>
        ))}
      </div>

      {/* Courses */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((n) => (
            <div key={n} className="card animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
              <div className="h-2 bg-gray-100 rounded w-full mb-2" />
              <div className="h-2 bg-gray-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Tasks widget */}
          {tasks.length > 0 && (() => {
            const today = new Date().toISOString().split('T')[0];
            const pending = tasks.filter((tk) => tk.status !== 'COMPLETED').slice(0, 5);
            const getColor = (tk: any) => tk.status === 'OVERDUE' || tk.dueDate < today ? 'text-red-500' : (new Date(tk.dueDate + 'T00:00:00').getTime() - Date.now()) / 86400000 <= 3 ? 'text-amber-500' : 'text-emerald-500';
            return (
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-heading font-semibold text-base text-charcoal flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-cta-from" /> {t.studentDashboard.myTasks}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => { const url = await api.tasks.calendarUrl(); window.open(url, '_blank'); }}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-cta-from transition-colors"
                      title={t.studentTasks.exportIcs}
                    >
                      <Calendar className="w-3.5 h-3.5" /> {t.studentDashboard.export}
                    </button>
                    <Link href="/tasks" className="text-xs text-cta-from font-medium hover:underline">{t.studentDashboard.viewAll}</Link>
                  </div>
                </div>
                <div className="space-y-2">
                  {pending.map((tk) => (
                    <div key={tk.taskId} className="flex items-center gap-3 py-1.5">
                      <AlertCircle className={`w-3.5 h-3.5 shrink-0 ${getColor(tk)}`} />
                      <span className="flex-1 text-sm text-charcoal truncate">{tk.title}</span>
                      <span className="text-xs text-gray-400 shrink-0">{tk.dueDate}</span>
                    </div>
                  ))}
                  {tasks.filter((tk) => tk.status !== 'COMPLETED').length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-2">✅ {t.studentDashboard.noTasks}</p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Study Planner widget */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-heading font-semibold text-base text-charcoal flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                {lang === 'en' ? 'My Weekly Study Plan' : 'Mi plan de estudio semanal'}
              </h2>
              <button
                onClick={() => studyPlan ? loadStudyPlan(true) : loadStudyPlan(false)}
                disabled={planLoading}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-cta-from transition-colors disabled:opacity-50"
              >
                {planLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {lang === 'en' ? 'Regenerate' : 'Regenerar'}
              </button>
            </div>
            {planLoading && !studyPlan ? (
              <div className="flex items-center gap-2 py-6 justify-center text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">{lang === 'en' ? 'Generating your plan…' : 'Generando tu plan…'}</span>
              </div>
            ) : studyPlan?.plan ? (
              <div className="text-sm text-charcoal whitespace-pre-line leading-relaxed">{studyPlan.plan}</div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-sm text-gray-400">{lang === 'en' ? 'Get a personalized 5-day study plan powered by AI.' : 'Obtén un plan de 5 días personalizado con IA.'}</p>
                <button onClick={() => loadStudyPlan(false)} className="btn-primary text-xs px-4 py-2">
                  {lang === 'en' ? 'Generate plan' : 'Generar plan'}
                </button>
              </div>
            )}
          </div>

          <h2 className="font-heading font-bold text-xl text-charcoal">{t.courses.myCourses}</h2>
          {courses.map((course) => {
            const allLessons = course.modules?.flatMap((m) => m.lessons ?? []) ?? [];
            const completedLessons = allLessons.filter((l) => l.completed).length;
            const progress = allLessons.length > 0
              ? Math.round((completedLessons / allLessons.length) * 100)
              : 0;

            const isCourseComplete = (course.modules?.length ?? 0) > 0 &&
              course.modules?.every((m) => m.reflectionStatus === 'APPROVED');
            const courseCert = certs.find((c) => c.courseId === course.id);

            // Find current module (first unlocked, not fully completed)
            const currentModule = course.modules?.find(
              (m) => m.unlocked && m.reflectionStatus !== 'APPROVED'
            );

            const isExpanded = expandedCourse === course.id;

            return (
              <div key={course.id} className="card space-y-4">
                {/* Course header — click to expand */}
                <button
                  onClick={() => setExpandedCourse(isExpanded ? null : course.id)}
                  className="w-full text-left flex items-start justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-heading font-bold text-lg text-charcoal truncate">
                        {course.title}
                      </h3>
                    </div>
                    <p className="text-sm text-gray-500 line-clamp-1">{motivational(progress)}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span className="text-sm font-bold text-cta-from">{progress}%</span>
                    {isExpanded
                      ? <ChevronUp className="w-4 h-4 text-gray-400" />
                      : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </button>

                {/* Overall progress bar always visible */}
                <ProgressBar value={progress} showPercent={false} />

                {/* Collapsible: modules + actions */}
                {isExpanded && (
                  <div className="space-y-4 pt-1 border-t border-border">
                    <div className="flex justify-end">
                      <Link
                        href={`/courses/${course.id}`}
                        className="flex items-center gap-1.5 text-sm font-semibold text-cta-from hover:opacity-80 transition-opacity"
                      >
                        {t.studentDashboard.viewCourse} <ArrowRight className="w-4 h-4" />
                      </Link>
                    </div>

                {/* Modules mini-list */}
                {course.modules && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {course.modules.slice(0, 6).map((mod) => {
                      const modProgress = mod.lessons?.length
                        ? Math.round((mod.lessons.filter((l) => l.completed).length / mod.lessons.length) * 100)
                        : 0;

                      // Smart navigation: go to the pending state of the module
                      const getModuleHref = () => {
                        if (!mod.unlocked) return '#';
                        if (!mod.quizPassed) return `/courses/${course.id}/modules/${mod.id}`;
                        // Reflection pending review — send to module page (not /reflection, already submitted)
                        if (mod.reflectionStatus === 'PENDING_EVAL' || mod.reflectionStatus === 'PENDING_AI') return `/courses/${course.id}/modules/${mod.id}`;
                        if (mod.reflectionStatus !== 'APPROVED') return `/courses/${course.id}/modules/${mod.id}/reflection`;
                        return `/courses/${course.id}/modules/${mod.id}`;
                      };

                      return (
                        <Link
                          key={mod.id}
                          href={getModuleHref()}
                          className={`p-3 rounded-xl border transition-all duration-200 ${
                            mod.unlocked
                              ? 'border-border hover:border-cta-from hover:shadow-card cursor-pointer'
                              : 'border-border opacity-50 cursor-not-allowed'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-400">
                              {t.studentDashboard.moduleN(mod.order)}
                            </span>
                            {!mod.unlocked ? (
                              <Lock className="w-3.5 h-3.5 text-gray-400" />
                            ) : mod.reflectionStatus === 'APPROVED' ? (
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                            ) : mod.quizPassed ? (
                              <Clock className="w-3.5 h-3.5 text-amber-500" />
                            ) : null}
                          </div>
                          <p className="text-sm font-medium text-charcoal line-clamp-1">{mod.title}</p>
                          <div className="mt-2">
                            <ProgressBar value={modProgress} size="sm" />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}

                {/* Certificate mini-card — course complete */}
                {isCourseComplete && courseCert && (
                  <div className="rounded-xl overflow-hidden border border-purple-200 shadow-sm">
                    {/* Gradient header strip */}
                    <div className="h-2 w-full" style={{ background: 'linear-gradient(90deg, #00B4D8, #7B2FBE)' }} />
                    <div className="p-4 flex items-center gap-4 bg-white">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #00B4D8, #7B2FBE)' }}>
                        <Award className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">{t.studentDashboard.certTitle}</p>
                        <p className="font-bold text-charcoal text-sm truncate">{courseCert.courseTitle ?? course.title}</p>
                        {courseCert.studentName && (
                          <p className="text-xs text-gray-500 mt-0.5">{courseCert.studentName}</p>
                        )}
                        {courseCert.issuedAt && (
                          <p className="text-xs text-gray-400">{new Date(courseCert.issuedAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                        )}
                      </div>
                      <a
                        href={`/certificado/${courseCert.certId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white shrink-0 transition-opacity hover:opacity-90"
                        style={{ background: 'linear-gradient(135deg, #00B4D8, #7B2FBE)' }}
                      >
                        {t.studentDashboard.viewCert} <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                )}

                {/* Continue CTA */}
                {currentModule && (() => {
                  const rs = currentModule.reflectionStatus;
                  const isPending = rs === 'PENDING_EVAL' || rs === 'PENDING_AI';
                  const isRejected = rs === 'REJECTED';
                  if (isPending) {
                    return (
                      <div className="flex flex-col gap-1.5">
                        <Link
                          href={`/courses/${course.id}/modules/${currentModule.id}`}
                          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-700 text-sm font-semibold hover:bg-amber-100 transition-colors"
                        >
                          <Clock className="w-4 h-4" />
                          {t.studentDashboard.reflectionPending}
                        </Link>
                        <p className="text-xs text-gray-400 text-center">{t.studentDashboard.reflectionPendingHint}</p>
                      </div>
                    );
                  }
                  if (isRejected) {
                    return (
                      <Link
                        href={`/courses/${course.id}/modules/${currentModule.id}`}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-300 bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100 transition-colors w-full"
                      >
                        <AlertCircle className="w-4 h-4" />
                        {t.studentDashboard.reflectionRejected}
                      </Link>
                    );
                  }
                  return (
                    <Link
                      href={`/courses/${course.id}/modules/${currentModule.id}`}
                      className="btn-primary text-sm w-full justify-center"
                    >
                      {t.studentDashboard.continueBtn(currentModule.title)}
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  );
                })()}
                  </div>
                )}
              </div>
            );
          })}

          {courses.length === 0 && (
            <div className="card text-center py-12">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="font-heading font-bold text-charcoal">{t.studentDashboard.noCourses}</p>
              <p className="text-gray-500 text-sm mt-1">{t.studentDashboard.noCoursesHint}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
