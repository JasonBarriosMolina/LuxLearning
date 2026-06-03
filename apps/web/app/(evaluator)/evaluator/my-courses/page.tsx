'use client';

// TODO FASE 6: agregar sección "Recursos" por curso (botón que lleva a recursos del evaluador asignados a ese curso)

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Users, ClipboardList, MessageSquare, Loader2, BookMarked, FolderOpen } from 'lucide-react';
import { api } from '@/lib/api';

interface MyCourse {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  isActive: boolean;
  enrollmentCount: number;
  pendingReflections: number;
  groupChatId: string;
  modules: Array<{ id: string; title: string; order: number }>;
}

export default function MyCoursesPage() {
  const [courses, setCourses] = useState<MyCourse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.evaluator.myCourses()
      .then((res: any) => setCourses(Array.isArray(res) ? res : (res.data ?? [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-cta-from" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center gap-3">
        <BookMarked className="w-6 h-6 text-cta-from" />
        <h1 className="font-heading font-bold text-2xl text-charcoal">Mis Cursos</h1>
      </div>
      <p className="text-sm text-gray-500">Cursos asignados a ti como evaluador.</p>

      {courses.length === 0 ? (
        <div className="card text-center py-16">
          <BookOpen className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">No tienes cursos asignados aún.</p>
          <p className="text-sm text-gray-400 mt-1">El administrador puede asignarte cursos desde la gestión de contenido.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {courses.map((course) => (
            <div key={course.id} className="card space-y-4">
              {/* Header */}
              <div className="flex items-start gap-4">
                {course.imageUrl ? (
                  <img src={course.imageUrl} alt={course.title} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-cta-gradient flex items-center justify-center shrink-0">
                    <BookOpen className="w-7 h-7 text-white" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="font-heading font-bold text-base text-charcoal truncate">{course.title}</h2>
                  <p className="text-sm text-gray-500 line-clamp-2 mt-0.5">{course.description}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${course.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {course.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-charcoal">{course.enrollmentCount}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Estudiantes</p>
                </div>
                <div className="bg-surface rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-charcoal">{course.modules.length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Módulos</p>
                </div>
                <div className={`rounded-xl p-3 text-center ${course.pendingReflections > 0 ? 'bg-amber-50' : 'bg-surface'}`}>
                  <p className={`text-xl font-bold ${course.pendingReflections > 0 ? 'text-amber-600' : 'text-charcoal'}`}>
                    {course.pendingReflections}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">Pendientes</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <Link
                  href="/evaluator/reflections"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cta-from text-white text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  Ver reflexiones
                  {course.pendingReflections > 0 && (
                    <span className="ml-1 bg-white/20 px-1.5 py-0.5 rounded-full text-[10px]">{course.pendingReflections}</span>
                  )}
                </Link>
                <Link
                  href={`/messages?chat=${course.groupChatId}`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-semibold text-gray-600 hover:bg-surface transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Chat del grupo
                </Link>
                <Link
                  href="/evaluator/students"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-semibold text-gray-600 hover:bg-surface transition-colors"
                >
                  <Users className="w-3.5 h-3.5" />
                  Estudiantes
                </Link>
                <Link
                  href="/evaluator/my-resources"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-semibold text-gray-600 hover:bg-surface transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Recursos
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
