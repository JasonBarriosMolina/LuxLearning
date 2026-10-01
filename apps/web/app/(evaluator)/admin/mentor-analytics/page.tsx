'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Users, TrendingUp, BookOpen, Loader2, BarChart2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';

type LessonStat = {
  lessonId: string;
  lessonTitle: string;
  moduleId: string;
  totalMessages: number;
  uniqueStudents: number;
  avgMsgsPerStudent: number;
  singleMsgStudents: number;
  deepDiveStudents: number;
  peakHour: number | null;
};

type Summary = {
  totalMessages: number;
  activeLessons: number;
  totalLessons: number;
  usageRate: number;
};

type AnalyticsData = {
  lessons: LessonStat[];
  summary: Summary;
};

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-indigo-50 rounded-lg"><Icon className="w-5 h-5 text-indigo-600" /></div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function DifficultyBadge({ msgs }: { msgs: number }) {
  if (msgs === 0) return <span className="text-xs text-gray-400">Sin actividad</span>;
  if (msgs >= 15) return <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Alta dificultad</span>;
  if (msgs >= 6) return <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Dificultad media</span>;
  return <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Baja dificultad</span>;
}

export default function MentorAnalyticsPage() {
  const { t } = useLanguage();
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  const [courseId, setCourseId] = useState('');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.admin.courses.list().then((res: any) => {
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      setCourses(list);
      if (list.length > 0) setCourseId(list[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);
    setError('');
    api.evaluator.mentorAnalytics(courseId)
      .then((res: any) => setData(res))
      .catch(() => setError('No se pudieron cargar las estadísticas'))
      .finally(() => setLoading(false));
  }, [courseId]);

  const activeLessons = data?.lessons.filter((l) => l.totalMessages > 0) ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mentor Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Actividad del mentor socrático por lección</p>
        </div>
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none"
        >
          {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard icon={MessageSquare} label="Total mensajes" value={data.summary.totalMessages} />
            <StatCard icon={BookOpen} label="Lecciones activas" value={`${data.summary.activeLessons} / ${data.summary.totalLessons}`} />
            <StatCard icon={TrendingUp} label="Tasa de uso" value={`${data.summary.usageRate}%`} sub="lecciones con ≥1 interacción" />
            <StatCard
              icon={BarChart2}
              label="Avg msgs / lección activa"
              value={activeLessons.length > 0 ? Math.round(data.summary.totalMessages / activeLessons.length * 10) / 10 : 0}
            />
          </div>

          {data.lessons.length === 0 ? (
            <div className="text-center py-12 text-gray-400">No hay datos de actividad para este curso</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-800">Por lección — ordenadas por actividad</h2>
                <p className="text-xs text-gray-400 mt-0.5">Lecciones con más preguntas = mayor dificultad percibida</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                      <th className="text-left px-6 py-3">Lección</th>
                      <th className="text-center px-4 py-3">Mensajes</th>
                      <th className="text-center px-4 py-3">Estudiantes</th>
                      <th className="text-center px-4 py-3">Avg msgs/est.</th>
                      <th className="text-center px-4 py-3">Consulta única</th>
                      <th className="text-center px-4 py-3">Deep dive (3+)</th>
                      <th className="text-center px-4 py-3">Dificultad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.lessons.map((lesson) => (
                      <tr key={lesson.lessonId} className={`hover:bg-gray-50 transition-colors ${lesson.totalMessages === 0 ? 'opacity-40' : ''}`}>
                        <td className="px-6 py-3">
                          <p className="font-medium text-gray-800 truncate max-w-xs">{lesson.lessonTitle}</p>
                        </td>
                        <td className="text-center px-4 py-3 font-semibold text-indigo-700">{lesson.totalMessages}</td>
                        <td className="text-center px-4 py-3">
                          <span className="flex items-center justify-center gap-1 text-gray-600">
                            <Users className="w-3.5 h-3.5" />{lesson.uniqueStudents}
                          </span>
                        </td>
                        <td className="text-center px-4 py-3 text-gray-600">{lesson.avgMsgsPerStudent}</td>
                        <td className="text-center px-4 py-3 text-gray-500">{lesson.singleMsgStudents}</td>
                        <td className="text-center px-4 py-3 text-gray-500">{lesson.deepDiveStudents}</td>
                        <td className="text-center px-4 py-3">
                          <DifficultyBadge msgs={lesson.totalMessages} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeLessons.length > 0 && (
            <div className="bg-indigo-50 rounded-xl p-5 text-sm text-indigo-800 space-y-1">
              <p className="font-semibold">Cómo interpretar los datos</p>
              <ul className="list-disc list-inside space-y-0.5 text-indigo-700">
                <li><strong>Alta dificultad</strong> (≥15 msgs): el contenido puede necesitar más ejemplos o una presentación más clara.</li>
                <li><strong>Deep dive (3+ msgs)</strong>: estudiantes con preguntas profundas — buenos candidatos para reflexiones de calidad.</li>
                <li><strong>Consulta única</strong>: verificación rápida — probablemente sin dificultad real.</li>
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
