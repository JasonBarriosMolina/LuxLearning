'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ArrowRight, Tag } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';

export default function CoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    api.courses.list().then((res) => {
      setCourses((res as any).data ?? []);
      setLoading(false);
    });
  }, []);

  // Collect all unique tags across courses
  const allTags = Array.from(new Set(courses.flatMap((c) => c.tags ?? [])));

  const filtered = activeTag
    ? courses.filter((c) => (c.tags ?? []).includes(activeTag))
    : courses;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">Mis Cursos</h1>
        <p className="text-gray-500 mt-1 text-sm">Todos los cursos disponibles para ti</p>
      </div>

      {/* Tag filters */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTag(null)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTag === null
                ? 'bg-cta-gradient text-white'
                : 'bg-surface text-gray-600 hover:bg-gray-100'
            }`}
          >
            Todos
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                activeTag === tag
                  ? 'bg-indigo-600 text-white'
                  : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
              }`}
            >
              <Tag className="w-3 h-3" />
              {tag}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((n) => (
            <div key={n} className="card animate-pulse h-64" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">No hay cursos disponibles</p>
          {activeTag && (
            <p className="text-gray-500 text-sm mt-1">
              No hay cursos con la etiqueta <strong>{activeTag}</strong>.{' '}
              <button onClick={() => setActiveTag(null)} className="text-cta-from underline">Ver todos</button>
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map((course) => {
            const totalModules = course.modules?.length ?? 0;
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
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h2 className="font-heading font-bold text-lg text-charcoal">{course.title}</h2>
                    {course.isPilot && <Badge variant="info">Piloto</Badge>}
                  </div>
                  <p className="text-sm text-gray-500 line-clamp-2 mb-3">{course.description}</p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <BookOpen className="w-3.5 h-3.5" /> {totalModules} módulos
                    </span>
                    {(course.tags ?? []).map((tag: string) => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-600 font-medium">
                        <Tag className="w-2.5 h-2.5" />{tag}
                      </span>
                    ))}
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
