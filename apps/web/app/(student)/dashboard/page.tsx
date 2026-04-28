'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, TrendingUp, CheckCircle, Clock, ArrowRight, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge, ReflectionStatusBadge } from '@/components/ui/Badge';
import type { Course } from '@lux/types';

interface EnrichedCourse extends Course {
  modules: Array<{
    id: string;
    order: number;
    title: string;
    duration: string;
    unlocked: boolean;
    quizPassed: boolean;
    reflectionStatus: string | null;
    lessons: Array<{ id: string; completed: boolean }>;
  }>;
}

export default function StudentDashboardPage() {
  const { email } = useAuth();
  const [courses, setCourses] = useState<EnrichedCourse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.courses.list().then((res) => {
      setCourses((res as any).data ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
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

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in">
      {/* Welcome */}
      <div>
        <h1 className="font-heading font-bold text-2xl lg:text-3xl text-charcoal">
          Hola, {firstName}
        </h1>
        <p className="text-gray-500 mt-1">Continúa tu aprendizaje. Claridad que transforma.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <h2 className="font-heading font-bold text-xl text-charcoal">Mis cursos</h2>
          {courses.map((course) => {
            const allLessons = course.modules?.flatMap((m) => m.lessons ?? []) ?? [];
            const completedLessons = allLessons.filter((l) => l.completed).length;
            const progress = allLessons.length > 0
              ? Math.round((completedLessons / allLessons.length) * 100)
              : 0;

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
                      {course.isPilot && (
                        <Badge variant="info">Piloto</Badge>
                      )}
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

                      return (
                        <Link
                          key={mod.id}
                          href={mod.unlocked ? `/courses/${course.id}/modules/${mod.id}` : '#'}
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
