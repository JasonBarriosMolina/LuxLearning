'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle, Lightbulb, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCourseDuration } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

export default function LessonPage() {
  const { courseId, moduleId, lessonId } = useParams<{
    courseId: string; moduleId: string; lessonId: string;
  }>();
  const router = useRouter();

  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [markingDone, setMarkingDone] = useState(false);
  const [completed, setCompleted] = useState(false);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    api.courses.get(courseId).then((res) => {
      setCourse((res as any).data);
      setLoading(false);
    });
    startTimeRef.current = Date.now();
  }, [courseId]);

  const module = course?.modules?.find((m: any) => m.id === moduleId);
  const lesson = module?.lessons?.find((l: any) => l.id === lessonId);
  const lessonIndex = module?.lessons?.findIndex((l: any) => l.id === lessonId) ?? -1;
  const prevLesson = lessonIndex > 0 ? module?.lessons[lessonIndex - 1] : null;
  const nextLesson = lessonIndex < (module?.lessons?.length - 1) ? module?.lessons[lessonIndex + 1] : null;

  useEffect(() => {
    if (lesson?.completed) setCompleted(true);
  }, [lesson]);

  const handleMarkComplete = async () => {
    setMarkingDone(true);
    try {
      const durationMs = Date.now() - startTimeRef.current;
      await api.lessons.complete({ courseId, moduleId, lessonId, durationMs });
      setCompleted(true);

      // Navigate to next lesson or back to module
      setTimeout(() => {
        if (nextLesson) {
          router.push(`/courses/${courseId}/modules/${moduleId}/lessons/${nextLesson.id}`);
        } else {
          router.push(`/courses/${courseId}/modules/${moduleId}`);
        }
      }, 800);
    } catch (err) {
      console.error(err);
    } finally {
      setMarkingDone(false);
    }
  };

  if (loading || !lesson) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="aspect-video bg-gray-200 rounded-2xl" />
        <div className="h-4 bg-gray-100 rounded" />
        <div className="h-4 bg-gray-100 rounded w-3/4" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="hover:text-charcoal flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> {module?.title}
        </Link>
        <span>/</span>
        <span className="text-charcoal font-medium truncate">{lesson.title}</span>
      </div>

      {/* Lesson header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-gray-400">LECCIÓN {lesson.order}</span>
          {completed && (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
              <CheckCircle className="w-3.5 h-3.5" /> Completada
            </span>
          )}
        </div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">{lesson.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{formatCourseDuration(lesson.duration)}</p>
      </div>

      {/* YouTube embed */}
      <div className="aspect-video rounded-2xl overflow-hidden shadow-card bg-black">
        <iframe
          className="w-full h-full"
          src={`https://www.youtube.com/embed/${lesson.youtubeId}?rel=0&modestbranding=1`}
          title={lesson.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>

      {/* Lesson image */}
      {lesson.imageUrl && (
        <div className="rounded-2xl overflow-hidden shadow-card">
          <img
            src={lesson.imageUrl}
            alt={lesson.title}
            className="w-full h-auto object-cover"
          />
        </div>
      )}

      {/* Key points */}
      {lesson.points?.length > 0 && (
        <div className="card">
          <h2 className="font-heading font-bold text-base text-charcoal mb-3">
            Puntos clave
          </h2>
          <ul className="space-y-2">
            {lesson.points.map((point: string, i: number) => (
              <li key={i} className="flex items-start gap-3 text-sm text-gray-600">
                <ChevronRight className="w-4 h-4 text-cta-from mt-0.5 shrink-0" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tip */}
      {lesson.tip && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <Lightbulb className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Consejo: </span>{lesson.tip}
          </p>
        </div>
      )}

      {/* Navigation + Complete */}
      <div className="flex items-center justify-between gap-4 pb-8">
        <div>
          {prevLesson && (
            <Link
              href={`/courses/${courseId}/modules/${moduleId}/lessons/${prevLesson.id}`}
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Anterior
            </Link>
          )}
        </div>

        <div className="flex items-center gap-3">
          {!completed && (
            <Button
              onClick={handleMarkComplete}
              loading={markingDone}
              className="flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Marcar completada
            </Button>
          )}

          {nextLesson && (
            <Link
              href={`/courses/${courseId}/modules/${moduleId}/lessons/${nextLesson.id}`}
              className={`btn-${completed ? 'primary' : 'secondary'} text-sm flex items-center gap-2`}
            >
              Siguiente <ArrowRight className="w-4 h-4" />
            </Link>
          )}

          {!nextLesson && completed && (
            <Link
              href={`/courses/${courseId}/modules/${moduleId}`}
              className="btn-primary text-sm flex items-center gap-2"
            >
              Volver al módulo <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
