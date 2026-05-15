'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, ScatterChart, Scatter, Cell,
} from 'recharts';
import { BarChart2, Clock, Flame, BookOpen, TrendingUp, CheckCircle2, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { TASK_TYPE_COLORS, TASK_TYPE_LABELS } from '@/lib/constants/task-colors';

interface Session {
  sessionId: string;
  startedAt: string;
  durationSeconds: number;
  endedAt?: string;
}

interface QuizAttempt {
  moduleId: string;
  score: number;
  passed: boolean;
  submittedAt: string;
  attemptNumber?: number;
}

interface CompletedTask {
  taskId: string;
  title: string;
  type: string;
  courseTitle?: string;
  completedAt?: string;
}

interface ActivitySummary {
  totalHours: number;
  byDay: Record<string, number>; // { "YYYY-MM-DD": durationSeconds }
  streak?: number;
  sessionsCount?: number;
  sessions?: Session[];
  quizAttempts?: QuizAttempt[];
  completedTasks?: CompletedTask[];
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function getLast30Days(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function buildChartData(byDay: Record<string, number>) {
  // byDay values are in seconds from the API; convert to hours
  return getLast30Days().map((date) => ({
    date,
    label: date.slice(5), // MM-DD
    hours: Math.round(((byDay[date] ?? 0) / 3600) * 10) / 10,
  }));
}

function buildCumulativeData(chartData: { date: string; hours: number }[]) {
  let cumulative = 0;
  return chartData.map((d) => {
    cumulative += d.hours;
    return { ...d, cumulative: Math.round(cumulative * 10) / 10 };
  });
}

function calculateStreak(byDay: Record<string, number>): number {
  // byDay values are seconds; any day with > 0 seconds counts as active
  const activeDates = new Set(Object.entries(byDay).filter(([, secs]) => secs > 0).map(([date]) => date));
  let streak = 0;
  let current = new Date();

  for (let i = 0; i < 60; i++) {
    const d = current.toISOString().slice(0, 10);
    if (activeDates.has(d)) {
      streak++;
    } else if (i > 0) {
      break;
    }
    current.setDate(current.getDate() - 1);
  }
  return streak;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-border rounded-xl px-3 py-2 shadow-lg text-xs">
        <p className="font-semibold text-charcoal">{label}</p>
        <p className="text-cta-from">{payload[0].value} h</p>
      </div>
    );
  }
  return null;
};

const CumulativeTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-border rounded-xl px-3 py-2 shadow-lg text-xs">
        <p className="font-semibold text-charcoal">{label}</p>
        <p className="text-emerald-600">Acumulado: {payload[0].value} h</p>
      </div>
    );
  }
  return null;
};

const QuizTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <div className="bg-white border border-border rounded-xl px-3 py-2 shadow-lg text-xs">
        <p className="font-semibold text-charcoal">{new Date(d.submittedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</p>
        <p className={d.passed ? 'text-emerald-600' : 'text-red-500'}>Score: {d.score}% — {d.passed ? 'Aprobado' : 'Reprobado'}</p>
      </div>
    );
  }
  return null;
};

export default function ActivityPage() {
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.student.activity.get(30)
      .then((res: any) => {
        setSummary(res?.data ?? res ?? null);
      })
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => <div key={n} className="card h-24" />)}
        </div>
        <div className="card h-64" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card text-center py-16">
          <BarChart2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="font-heading font-bold text-charcoal">Sin datos de actividad</p>
          <p className="text-sm text-gray-400 mt-1">Navega por la plataforma para generar tu historial.</p>
        </div>
      </div>
    );
  }

  const byDay = summary.byDay ?? {};
  const chartData = buildChartData(byDay);
  const cumulativeData = buildCumulativeData(chartData);
  const streak = summary.streak ?? calculateStreak(byDay);
  const totalHoursThisMonth = summary.totalHours ?? 0;
  const activeDays = Object.values(byDay).filter((secs) => secs > 0).length;
  const peakDay = chartData.reduce((max, d) => d.hours > max.hours ? d : max, chartData[0] ?? { hours: 0, label: '-' });

  // Sessions (sorted desc)
  const sessions: Session[] = [...(summary.sessions ?? [])].sort(
    (a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')
  ).slice(0, 20); // show last 20

  // Quiz attempts (sorted asc by date for chart)
  const quizAttempts: QuizAttempt[] = [...(summary.quizAttempts ?? [])].sort(
    (a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '')
  );

  // Completed tasks (sorted desc)
  const completedTasks: CompletedTask[] = [...(summary.completedTasks ?? [])].sort(
    (a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
  ).slice(0, 20);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart2 className="w-6 h-6 text-cta-from" />
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">Mi Actividad</h1>
          <p className="text-sm text-gray-400">Últimos 30 días</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">Horas este mes</p>
            <p className="text-xl font-bold text-charcoal">{formatHours(totalHoursThisMonth)}</p>
          </div>
        </div>

        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">Racha actual</p>
            <p className="text-xl font-bold text-charcoal">{streak} {streak === 1 ? 'día' : 'días'}</p>
          </div>
        </div>

        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">Días activos</p>
            <p className="text-xl font-bold text-charcoal">{activeDays}</p>
          </div>
        </div>

        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">Día pico</p>
            <p className="text-xl font-bold text-charcoal">{peakDay.hours > 0 ? `${peakDay.hours}h` : '—'}</p>
          </div>
        </div>
      </div>

      {/* Bar chart — hours per day */}
      <div className="card space-y-3">
        <h2 className="font-heading font-semibold text-base text-charcoal">Horas por día</h2>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="hours" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366F1" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.6} />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Line chart — cumulative progress */}
      <div className="card space-y-3">
        <h2 className="font-heading font-semibold text-base text-charcoal">Progreso acumulado</h2>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip content={<CumulativeTooltip />} />
              <Line
                type="monotone"
                dataKey="cumulative"
                stroke="#10B981"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#10B981' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-gray-400 text-right">Total acumulado: <strong>{formatHours(totalHoursThisMonth)}</strong></p>
      </div>

      {/* Streak motivational note */}
      {streak >= 3 && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
          <Flame className="w-6 h-6 text-amber-500 shrink-0" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-300 text-sm">
              🔥 ¡{streak} días seguidos! Mantén el ritmo.
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              La constancia es la clave del aprendizaje.
            </p>
          </div>
        </div>
      )}

      {/* Quiz grades chart */}
      {quizAttempts.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-heading font-semibold text-base text-charcoal">Calificaciones de Quiz</h2>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="index"
                  type="number"
                  tick={false}
                  tickLine={false}
                  axisLine={false}
                  domain={[-0.5, quizAttempts.length - 0.5]}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: '#9CA3AF' }}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip content={<QuizTooltip />} />
                <Scatter
                  data={quizAttempts.map((a, i) => ({ ...a, index: i }))}
                  dataKey="score"
                >
                  {quizAttempts.map((a, i) => (
                    <Cell key={i} fill={a.passed ? '#10B981' : '#EF4444'} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />Aprobado</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />Reprobado</span>
            <span className="ml-auto">{quizAttempts.filter((a) => a.passed).length} / {quizAttempts.length} aprobados</span>
          </div>
        </div>
      )}

      {/* Session history */}
      {sessions.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-heading font-semibold text-base text-charcoal">Historial de Sesiones</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2">Fecha</th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2">Hora</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2">Duración</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {sessions.map((s) => {
                  const d = new Date(s.startedAt);
                  return (
                    <tr key={s.sessionId} className="hover:bg-surface/50 transition-colors">
                      <td className="py-2 text-charcoal">
                        {d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </td>
                      <td className="py-2 text-gray-500 text-xs">
                        {d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2 text-right font-medium text-charcoal">
                        {formatDuration(s.durationSeconds ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(summary.sessions?.length ?? 0) > 20 && (
            <p className="text-xs text-gray-400 text-center">Mostrando las últimas 20 sesiones</p>
          )}
        </div>
      )}

      {/* Completed tasks */}
      {completedTasks.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-cta-from" />
            <h2 className="font-heading font-semibold text-base text-charcoal">Tareas Completadas</h2>
            <span className="ml-auto text-xs text-gray-400">{summary.completedTasks?.length ?? 0} en total</span>
          </div>
          <div className="space-y-2">
            {completedTasks.map((t) => (
              <div key={t.taskId} className="flex items-center gap-3 p-3 rounded-xl bg-surface">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-charcoal truncate">{t.title}</p>
                  {t.courseTitle && <p className="text-xs text-gray-400">{t.courseTitle}</p>}
                </div>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full text-white shrink-0"
                  style={{ backgroundColor: TASK_TYPE_COLORS[t.type] ?? '#6B7280' }}
                >
                  {TASK_TYPE_LABELS[t.type] ?? t.type}
                </span>
                {t.completedAt && (
                  <span className="text-xs text-gray-400 shrink-0 hidden sm:block">
                    {new Date(t.completedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </div>
            ))}
          </div>
          {(summary.completedTasks?.length ?? 0) > 20 && (
            <p className="text-xs text-gray-400 text-center">Mostrando las últimas 20 tareas</p>
          )}
        </div>
      )}
    </div>
  );
}
