'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, TrendingUp, CheckCircle, Clock, ArrowRight, Lock, Award, Flame, X, ClipboardList, Calendar, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge, ReflectionStatusBadge } from '@/components/ui/Badge';
import type { Course, Certificate } from '@lux/types';

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
  const [courses, setCourses] = useState<EnrichedCourse[]>([]);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);

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

  }, []);

  const firstName = email?.split('@')[0] ?? 'Estudiante';

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

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in">
      {/* Welcome */}
      <div>
        <h1 className="font-heading font-bold text-2xl lg:text-3xl text-charcoal">
          Hola, {firstName} 👋
        </h1>
        <p className="text-gray-500 mt-1">Continúa tu aprendizaje. Claridad que transforma.</p>
      </div>

      {/* Dismissible welcome banner */}
      {showWelcome && (
        <div className="relative flex items-start gap-4 p-4 rounded-2xl bg-gradient-to-r from-[#00B4D8]/10 to-[#7B2FBE]/10 border border-[#00B4D8]/20">
          <div className="flex-1 min-w-0">
            <p className="font-heading font-bold text-sm text-charcoal">¡Bienvenido a Lux Learning!</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Completa las lecciones, pasa los quizzes y envía tus reflexiones para desbloquear nuevos módulos.
            </p>
          </div>
          <button
            onClick={dismissWelcome}
            title="Ocultar por 8 días"
            className="shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap"
          >
            <X className="w-3.5 h-3.5" />
            Ocultar 8 días
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          {
            label: 'Progreso total',
            value: `${overallProgress}%`,
            icon: <TrendingUp className="w-5 h-5 text-cta-from" />,
            bg: 'bg-blue-50',
          },
          {
            label: 'Lecciones completadas',
            value: `${stats.completedLessons}/${stats.totalLessons}`,
            icon: <CheckCircle className="w-5 h-5 text-emerald-500" />,
            bg: 'bg-emerald-50',
          },
          {
            label: 'Módulos aprobados',
            value: stats.passedModules,
            icon: <BookOpen className="w-5 h-5 text-purple-500" />,
            bg: 'bg-purple-50',
          },
          {
            label: 'Reflexiones aprobadas',
            value: stats.approvedReflections,
            icon: <Clock className="w-5 h-5 text-amber-500" />,
            bg: 'bg-amber-50',
          },
          {
            label: streak > 1 ? `🔥 Racha activa` : 'Racha de días',
            value: `${streak}d`,
            icon: <Flame className={`w-5 h-5 ${streak > 0 ? 'text-orange-500' : 'text-gray-400'}`} />,
            bg: streak > 0 ? 'bg-orange-50' : 'bg-gray-50',
          },
        ].map((stat) => (
          <div key={stat.label} className="card">
            <div className={`w-10 h-10 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>
              {stat.icon}
            </div>
            <p className="font-heading font-bold text-2xl text-charcoal">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </div>
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
            const pending = tasks.filter((t) => t.status !== 'COMPLETED').slice(0, 5);
            const getColor = (t: any) => t.status === 'OVERDUE' || t.dueDate < today ? 'text-red-500' : (new Date(t.dueDate + 'T00:00:00').getTime() - Date.now()) / 86400000 <= 3 ? 'text-amber-500' : 'text-emerald-500';
            return (
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-heading font-semibold text-base text-charcoal flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-cta-from" /> Mis tareas
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => { const url = await api.tasks.calendarUrl(); window.open(url, '_blank'); }}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-cta-from transition-colors"
                      title="Descargar calendario .ics"
                    >
                      <Calendar className="w-3.5 h-3.5" /> Exportar
                    </button>
                    <Link href="/tasks" className="text-xs text-cta-from font-medium hover:underline">Ver todas</Link>
                  </div>
                </div>
                <div className="space-y-2">
                  {pending.map((t) => (
                    <div key={t.taskId} className="flex items-center gap-3 py-1.5">
                      <AlertCircle className={`w-3.5 h-3.5 shrink-0 ${getColor(t)}`} />
                      <span className="flex-1 text-sm text-charcoal truncate">{t.title}</span>
                      <span className="text-xs text-gray-400 shrink-0">{t.dueDate}</span>
                    </div>
                  ))}
                  {tasks.filter((t) => t.status !== 'COMPLETED').length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-2">✅ Sin tareas pendientes</p>
                  )}
                </div>
              </div>
            );
          })()}

          <h2 className="font-heading font-bold text-xl text-charcoal">Mis cursos</h2>
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

            return (
              <div key={course.id} className="card space-y-4">
                {/* Course header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-heading font-bold text-lg text-charcoal truncate">
                        {course.title}
                      </h3>
                    </div>
                    <p className="text-sm text-gray-500 line-clamp-2">{course.description}</p>
                  </div>
                  <Link
                    href={`/courses/${course.id}`}
                    className="shrink-0 flex items-center gap-1.5 text-sm font-semibold text-cta-from hover:opacity-80 transition-opacity"
                  >
                    Ver curso <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>

                {/* Overall progress */}
                <ProgressBar value={progress} label="Progreso general" showPercent />

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
                              Módulo {mod.order}
                            </span>
                            {!mod.unlocked ? (
                              <Lock className="w-3.5 h-3.5 text-gray-400" />
                            ) : mod.reflectionStatus === 'APPROVED' ? (
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                            ) : mod.quizPassed ? (
                              <Clock className="w-3.5 h-3.5 text-amber-500" title="Reflexión pendiente" />
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

                {/* Certificate banner — course complete */}
                {isCourseComplete && courseCert && (
                  <a
                    href={`/certificado/${courseCert.certId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-4 rounded-xl text-white font-semibold text-sm transition-opacity hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #00B4D8, #7B2FBE)' }}
                  >
                    <Award className="w-5 h-5 shrink-0" />
                    <div className="flex-1">
                      <p className="font-bold">¡Curso completado!</p>
                      <p className="text-white/80 text-xs font-normal">Haz clic para ver y descargar tu certificado</p>
                    </div>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </a>
                )}

                {/* Continue CTA */}
                {currentModule && (
                  <Link
                    href={`/courses/${course.id}/modules/${currentModule.id}`}
                    className="btn-primary text-sm w-full justify-center"
                  >
                    Continuar — {currentModule.title}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                )}
              </div>
            );
          })}

          {courses.length === 0 && (
            <div className="card text-center py-12">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="font-heading font-bold text-charcoal">No hay cursos disponibles</p>
              <p className="text-gray-500 text-sm mt-1">Los cursos aparecerán aquí cuando estén activos.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
