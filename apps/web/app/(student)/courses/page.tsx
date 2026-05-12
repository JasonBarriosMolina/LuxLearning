'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ArrowRight, Clock } from 'lucide-react';
import { api } from '@/lib/api';

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
          <p className="text-gray-500 text-sm mt-1">Aún no tienes cursos asignados.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {courses.map((course) => {
            const totalModules = course.modules?.length ?? 0;
            const totalDuration = course.modules?.reduce(
              (acc: number, m: any) => acc + parseInt(m.duration ?? '0', 10), 0
            ) ?? 0;
            return (
              <Link key={course.id} href={`/courses/${course.id}`} className="card-hover flex flex-col gap-4">
                {course.imageUrl ? (
                  <div className="rounded-xl overflow-hidden h-40">
                    <img src={course.imageUrl} alt={course.title} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="rounded-xl h-40 bg-cta-gradient flex items-center justify-center">
                    <BookOpen className="w-10 h-10 text-white opacity-80" />
                  </div>
                )}
                <div className="flex-1">
                  <h2 className="font-heading font-bold text-lg text-charcoal mb-1">{course.title}</h2>
                  <p className="text-sm text-gray-500 line-clamp-2 mb-3">{course.description}</p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <BookOpen className="w-3.5 h-3.5" /> {totalModules} módulos
                    </span>
                    {totalDuration > 0 && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Clock className="w-3.5 h-3.5" /> {totalDuration} min
                      </span>
                    )}
                    {course.startDate && new Date(course.startDate) > new Date() && (
                      <span className="text-xs text-blue-600 font-medium">
                        Inicia: {new Date(course.startDate).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                    {course.closeDate && (
                      <span className="text-xs text-amber-600 font-medium">
                        Cierra: {new Date(course.closeDate).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    )}
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
