'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, PlayCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCourseDuration } from '@/lib/utils';

export default function CoursePreviewPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMods, setExpandedMods] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.admin.courses.get(courseId).then((res) => {
      setCourse((res as any).data);
    }).finally(() => setLoading(false));
  }, [courseId]);

  const toggleMod = (id: string) => {
    setExpandedMods((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-pulse pt-4">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        {[1, 2, 3].map((n) => <div key={n} className="h-20 bg-gray-100 rounded-2xl" />)}
      </div>
    );
  }

  if (!course) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Read-only banner */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800">
        <span className="font-semibold">📚 Vista de Estudiante — solo lectura</span>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Volver al editor
        </button>
      </div>

      {/* Course header */}
      <div className="card space-y-2">
        {course.imageUrl && (
          <img src={course.imageUrl} alt={course.title} className="w-full h-48 object-cover rounded-xl mb-3" />
        )}
        <h1 className="font-heading font-bold text-2xl text-charcoal">{course.title}</h1>
        {course.description && <p className="text-gray-500 text-sm">{course.description}</p>}
        <p className="text-xs text-gray-400">
          {course.modules?.length ?? 0} módulos •{' '}
          {course.modules?.reduce((s: number, m: any) => s + (m.lessons?.length ?? 0), 0) ?? 0} lecciones
        </p>
      </div>

      {/* Modules */}
      <div className="space-y-3">
        {(course.modules ?? []).map((mod: any) => (
          <div key={mod.id} className="border border-border rounded-2xl overflow-hidden">
            {/* Module header */}
            <button
              onClick={() => toggleMod(mod.id)}
              className="w-full flex items-center gap-3 p-4 bg-white text-left hover:bg-surface transition-colors"
            >
              {expandedMods.has(mod.id)
                ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 shrink-0">MÓD. {mod.order}</span>
                  <p className="font-semibold text-charcoal truncate">{mod.title}</p>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatCourseDuration(mod.duration)} • {mod.lessons?.length ?? 0} lecciones
                </p>
              </div>
            </button>

            {/* Lesson list */}
            {expandedMods.has(mod.id) && (
              <div className="border-t border-border bg-surface p-4 space-y-2">
                {mod.description && (
                  <p className="text-sm text-gray-500 mb-3">{mod.description}</p>
                )}
                {(mod.lessons ?? []).map((lesson: any, i: number) => (
                  <div key={lesson.id} className="flex items-center gap-2.5 p-3 bg-white rounded-xl border border-border">
                    <PlayCircle className="w-4 h-4 text-cta-from shrink-0" />
                    <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{i + 1}.</span>
                    <span className="text-sm text-charcoal flex-1 truncate">{lesson.title}</span>
                    {lesson.duration && (
                      <span className="text-xs text-gray-400 shrink-0">{formatCourseDuration(lesson.duration)}</span>
                    )}
                  </div>
                ))}
                {(!mod.lessons || mod.lessons.length === 0) && (
                  <p className="text-xs text-gray-400 text-center py-4">Sin lecciones</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
