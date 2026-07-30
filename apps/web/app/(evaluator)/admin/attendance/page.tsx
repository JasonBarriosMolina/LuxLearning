'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, ShieldAlert, TrendingDown } from 'lucide-react';
import { api } from '@/lib/api';

type CourseSummary = {
  courseId: string;
  courseTitle: string;
  attendanceRate: number;
  studentsHigh: number;
  studentsModerate: number;
  totalStudents: number;
};

type Overview = {
  totalCourses: number;
  globalAttendanceRate: number;
  studentsAtRisk: number;
  studentsWarning: number;
  coursesSummary: CourseSummary[];
};

function Semaphore({ rate }: { rate: number }) {
  if (rate >= 80) return <span className="text-lg">🟢</span>;
  if (rate >= 65) return <span className="text-lg">🟡</span>;
  return <span className="text-lg">🔴</span>;
}

export default function AttendanceOverviewPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.attendance.adminOverview().then((res: any) => {
      setOverview(res.data ?? res);
    }).catch((err: any) => {
      setError(err?.message ?? 'Error al cargar datos');
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="animate-spin text-blue-500" size={36} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <ShieldAlert className="mx-auto mb-3 text-red-400" size={40} />
        <p className="text-gray-600">{error}</p>
        <button onClick={() => router.back()} className="mt-4 text-sm text-blue-600 hover:underline">
          Volver
        </button>
      </div>
    );
  }

  const courses = overview?.coursesSummary ?? [];
  const problemCourses = courses.filter((c) => c.attendanceRate < 80).length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Asistencia Global</h1>
          <p className="text-xs text-gray-500 mt-0.5">Visión general de todos los cursos activos</p>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Asistencia Global</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{overview?.globalAttendanceRate ?? '—'}%</p>
          <p className="text-xs text-gray-400 mt-1">{overview?.totalCourses ?? 0} cursos activos</p>
        </div>
        <div className="bg-red-50 rounded-2xl border border-red-100 shadow-sm p-5">
          <p className="text-xs text-red-600 font-medium uppercase tracking-wide">Alumnos en Riesgo</p>
          <p className="text-3xl font-bold text-red-700 mt-1">{overview?.studentsAtRisk ?? 0}</p>
          <p className="text-xs text-red-400 mt-1">🚨 Riesgo alto</p>
        </div>
        <div className="bg-yellow-50 rounded-2xl border border-yellow-100 shadow-sm p-5">
          <p className="text-xs text-yellow-700 font-medium uppercase tracking-wide">Cursos con Problemas</p>
          <p className="text-3xl font-bold text-yellow-800 mt-1">{problemCourses}</p>
          <p className="text-xs text-yellow-500 mt-1">⚠️ Asistencia &lt; 80%</p>
        </div>
      </div>

      {/* Courses table */}
      {courses.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <TrendingDown size={40} className="mx-auto mb-3" />
          <p>Sin datos de asistencia disponibles</p>
          <p className="text-sm mt-1">El análisis nocturno genera los datos automáticamente</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-sm font-semibold text-gray-700">Cursos — ordenados por asistencia (peor primero)</p>
          </div>
          <div className="divide-y divide-gray-100">
            {courses.map((c) => (
              <button
                key={c.courseId}
                onClick={() => router.push(`/admin/attendance/${c.courseId}`)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition text-left"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Semaphore rate={c.attendanceRate} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{c.courseTitle}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{c.totalStudents} estudiantes</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0 ml-4">
                  {c.studentsHigh > 0 && (
                    <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">🚨 {c.studentsHigh}</span>
                  )}
                  {c.studentsModerate > 0 && (
                    <span className="text-xs font-semibold text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">⚠️ {c.studentsModerate}</span>
                  )}
                  <span className={`text-sm font-bold tabular-nums ${c.attendanceRate >= 80 ? 'text-green-600' : c.attendanceRate >= 65 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {c.attendanceRate}%
                  </span>
                  <span className="text-gray-300">›</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
