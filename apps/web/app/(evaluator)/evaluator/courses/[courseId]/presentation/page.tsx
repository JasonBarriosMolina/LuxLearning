'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Presentation, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Module {
  id: string;
  title: string;
  order: number;
}

interface Course {
  id: string;
  title: string;
  modules: Module[];
}

export default function CoursePresentation() {
  const { courseId } = useParams<{ courseId: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.courses.get(courseId)
      .then((res) => { setCourse((res as any).data ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [courseId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/evaluator/my-courses" className="hover:text-charcoal flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Mis cursos
        </Link>
        <span>/</span>
        <span className="text-charcoal font-medium">{course?.title ?? 'Diapositivas'}</span>
      </div>

      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">{course?.title}</h1>
        <p className="text-sm text-gray-500 mt-1">Selecciona un módulo para ver o generar su presentación</p>
      </div>

      <div className="space-y-2">
        {course?.modules.sort((a, b) => a.order - b.order).map((mod) => (
          <Link
            key={mod.id}
            href={`/evaluator/courses/${courseId}/modules/${mod.id}/presentation`}
            className="flex items-center gap-4 p-4 rounded-xl border border-border hover:border-cta-from/40 hover:bg-surface transition-all group"
          >
            <div className="w-9 h-9 rounded-full bg-cta-from/10 flex items-center justify-center shrink-0">
              <Presentation className="w-4 h-4 text-cta-from" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-charcoal text-sm">{mod.title}</p>
              <p className="text-xs text-gray-400">Módulo {mod.order}</p>
            </div>
            <ArrowLeft className="w-4 h-4 text-gray-300 group-hover:text-cta-from rotate-180 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  );
}
