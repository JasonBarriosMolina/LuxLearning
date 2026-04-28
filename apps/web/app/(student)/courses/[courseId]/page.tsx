'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Lock, CheckCircle, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge, ReflectionStatusBadge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export default function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.courses.get(courseId).then((res) => {
      setCourse((res as any).data);
      setLoading(false);
    });
  }, [courseId]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/2" />
        {[1, 2, 3].map((n) => <div key={n} className="card h-32" />)}
      </div>
    );
  }

  if (!course) return null;

  const allLessons = course.modules?.flatMap((m: any) => m.lessons ?? []) ?? [];
  const completedLessons = allLessons.filter((l: any) => l.completed).length;
  const overallProgress = allLessons.length > 0
    ? Math.round((completedLessons / allLessons.length) * 100)
    : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <Link href="/courses" className="flex items-center gap-1 text-sm text-gray-500 hover:text-charcoal">
        <ArrowLeft className="w-4 h-4" /> Mis Cursos
      </Link>

      {/* Course header */}
      {course.imageUrl && (
        <div className="rounded-2xl overflow-hidden h-48 shadow-card">
          <img src={course.imageUrl} alt={course.title} className="w-full h-full object-cover" />
        </div>
      )}

      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">{course.title}</h1>
            <p className="text-gray-500 mt-1 text-sm">{course.description}</p>
          </div>
          {course.isPilot && <Badge variant="info">Curso Piloto</Badge>}
        </div>
        <ProgressBar value={overallProgress} label={`${completedLessons} de ${allLessons.length} lecciones completadas`} showPercent />
      </div>

      {/* Modules */}
      <div className="space-y-3">
        <h2 className="font-heading font-bold text-xl text-charcoal">Módulos del curso</h2>
        {course.modules?.map((mod: any) => {
          const modLessons = mod.lessons ?? [];
          const modCompleted = modLessons.filter((l: any) => l.completed).length;
          const modProgress = modLessons.length > 0 ? Math.round((modCompleted / modLessons.length) * 100) : 0;
          const isLocked = !mod.unlocked;
          const isDone = mod.reflectionStatus === 'APPROVED';

          return (
            <Link
              key={mod.id}
              href={isLocked ? '#' : `/courses/${courseId}/modules/${mod.id}`}
              className={cn(
                'card-hover flex items-center gap-4 p-5',
                isLocked && 'opacity-60 cursor-not-allowed hover:shadow-card'
              )}
            >
              {/* Order indicator */}
              <div className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center shrink-0 font-heading font-bold text-lg',
                isDone ? 'bg-emerald-100 text-emerald-600'
                  : mod.unlocked ? 'bg-cta-gradient text-white'
                  : 'bg-gray-100 text-gray-400'
              )}>
                {isDone ? <CheckCircle className="w-6 h-6" /> : isLocked ? <Lock className="w-5 h-5" /> : mod.order}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-semibold text-charcoal truncate">{mod.title}</p>
                  {mod.reflectionStatus && <ReflectionStatusBadge status={mod.reflectionStatus} />}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {mod.duration}
                  </span>
                  <span>{modLessons.length} lecciones</span>
                </div>
                <ProgressBar value={modProgress} size="sm" />
              </div>

              {!isLocked && <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
