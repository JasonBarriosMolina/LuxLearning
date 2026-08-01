'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookCheck, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';

type Course = { courseId: string; title: string; status: string };

export default function EvaluatorAttendancePage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.evaluator.myCourses().then((res: any) => {
      const raw: any[] = res.data ?? res ?? [];
      setCourses(raw.map((c: any) => ({ courseId: c.id ?? c.courseId, title: c.title, status: c.status })));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const active = courses.filter((c) => c.status === 'ACTIVE');
  const others = courses.filter((c) => c.status !== 'ACTIVE');

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="animate-spin text-blue-500" size={36} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <BookCheck className="text-blue-600" size={24} />
          <h1 className="text-2xl font-bold text-gray-900">Lux Attendance</h1>
        </div>
        <p className="text-sm text-gray-500 ml-9">Selecciona un curso para pasar asistencia</p>
      </div>

      {courses.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <BookCheck size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin cursos asignados</p>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Cursos activos</p>
              <div className="space-y-2">
                {active.map((c) => (
                  <button
                    key={c.courseId}
                    onClick={() => router.push(`/admin/attendance/${c.courseId}`)}
                    className="w-full flex items-center justify-between bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm hover:shadow-md hover:border-blue-200 transition-all text-left group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-800 group-hover:text-blue-700 transition-colors">{c.title}</span>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {others.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Otros cursos</p>
              <div className="space-y-2">
                {others.map((c) => (
                  <button
                    key={c.courseId}
                    onClick={() => router.push(`/admin/attendance/${c.courseId}`)}
                    className="w-full flex items-center justify-between bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm hover:bg-gray-50 transition-all text-left group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-500">{c.title}</span>
                    </div>
                    <ChevronRight size={16} className="text-gray-300" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
