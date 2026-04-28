'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ArrowRight, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge } from '@/components/ui/Badge';

export default function CoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.courses.list().then((res) => {
      setCourses((res as any).data ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">Mis Cursos</h1>
        <p className="text-gray-500 mt-1 text-sm">Todos los cursos disponibles para ti</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((n) => (
            <div key={n} className="card animate-pulse h-64" />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="card text-center py-16">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">No hay cursos disponibles</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {courses.map((course) => {
            const totalModules = course.modules?.length ?? 0;
            return (
              <Link key={course.id} href={`/courses/${course.id}`} className="card-hover flex flex-col gap-4">
                {course.imageUrl && (
                  <div className="rounded-xl overflow-hidden h-40">
                    <img src={course.imageUrl} alt={course.title} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h2 className="font-heading font-bold text-lg text-charcoal">{course.title}</h2>
                    {course.isPilot && <Badge variant="info">Piloto</Badge>}
                  </div>
                  <p className="text-sm text-gray-500 line-clamp-2 mb-3">{course.description}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <BookOpen className="w-3.5 h-3.5" /> {totalModules} módulos
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-cta-from">
                  Ir al curso <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
