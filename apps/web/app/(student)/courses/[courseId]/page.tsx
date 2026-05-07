'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Lock, CheckCircle, ChevronRight, Trophy, Star, Download, BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge, ReflectionStatusBadge } from '@/components/ui/Badge';
import { cn, formatCourseDuration } from '@/lib/utils';
import type { Certificate } from '@lux/types';

export default function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const [course, setCourse] = useState<any>(null);
  const [cert, setCert] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.courses.get(courseId).then((res) => {
      const c = (res as any).data;
      setCourse(c);
      setLoading(false);

      // Check completion from course data, then handle certificate
      const isComplete = (c?.modules?.length ?? 0) > 0 &&
        c.modules?.every((m: any) => m.reflectionStatus === 'APPROVED');

      api.certificates.mine().then((res: any) => {
        const certs: Certificate[] = res?.data ?? [];
        const found = certs.find((cert) => cert.courseId === courseId);
        if (found) {
          setCert(found);
        } else if (isComplete) {
          // Auto-generate only when all reflections are APPROVED
          api.certificates.generate(courseId)
            .then((r: any) => { if (r?.data) setCert(r.data); })
            .catch(() => {});
        }
      }).catch(() => {});
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

  const isCourseComplete = (course.modules?.length ?? 0) > 0 &&
    course.modules?.every((m: any) => m.reflectionStatus === 'APPROVED');

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <Link href="/courses" className="flex items-center gap-1 text-sm text-gray-500 hover:text-charcoal">
        <ArrowLeft className="w-4 h-4" /> Mis Cursos
      </Link>

      {/* Course header */}
      <div className="rounded-2xl overflow-hidden h-48 shadow-card">
        {course.imageUrl
          ? <img src={course.imageUrl} alt={course.title} className="w-full h-full object-cover" />
          : (
            <div className="w-full h-full bg-cta-gradient flex items-center justify-center">
              <div className="text-center text-white">
                <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-80" />
                <p className="font-heading font-bold text-lg opacity-90">{course.title}</p>
              </div>
            </div>
          )
        }
      </div>

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

      {/* Course completion banner */}
      {isCourseComplete && (
        <div className="relative overflow-hidden rounded-2xl bg-cta-gradient p-6 text-white shadow-lg">
          <div className="absolute -top-6 -right-6 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
          <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
          <div className="relative flex items-start gap-4">
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
              <Trophy className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-heading font-bold text-xl">¡Curso completado!</h2>
                <Star className="w-5 h-5 text-yellow-300 fill-yellow-300" />
              </div>
              <p className="text-white/80 text-sm mb-3">
                Has completado todos los módulos y tus reflexiones fueron aprobadas. ¡Felicitaciones!
              </p>
              {cert && (
                <a
                  href={`/certificado/${cert.certId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-white text-purple-700 font-semibold text-sm px-4 py-2 rounded-xl hover:bg-yellow-50 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Descargar certificado
                </a>
              )}
            </div>
          </div>
        </div>
      )}

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
                    <Clock className="w-3 h-3" /> {formatCourseDuration(mod.duration)}
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
