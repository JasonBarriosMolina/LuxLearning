'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Clock, CheckCircle, XCircle, ArrowRight, AlertTriangle,
  Users, ClipboardList, BookOpen, MoreVertical,
  ChevronRight, Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import type { Reflection } from '@lux/types';

type EnrichedReflection = Reflection & {
  moduleTitle?: string;
  courseTitle?: string;
  studentName?: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const DEADLINE_HOURS = 48;

function getTimeRemaining(submittedAt: string, deadlineIso?: string): { label: string; urgent: boolean; overdue: boolean } {
  const deadline = deadlineIso
    ? new Date(deadlineIso).getTime()
    : new Date(submittedAt).getTime() + DEADLINE_HOURS * 3600 * 1000;
  const diff = deadline - Date.now();
  if (diff <= 0) return { label: 'Vencido', urgent: true, overdue: true };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h < 6) return { label: `${h}h ${m}m`, urgent: true, overdue: false };
  if (h < 24) return { label: `${h}h restantes`, urgent: false, overdue: false };
  const d = Math.floor(h / 24);
  return { label: `${d}d restantes`, urgent: false, overdue: false };
}

// ── Bar Chart ──────────────────────────────────────────────────────────────────

function StatusBarChart({ approved, rejected, pending }: { approved: number; rejected: number; pending: number }) {
  const total = approved + rejected + pending || 1;
  const bars = [
    { label: 'Aprobadas', value: approved, color: '#10b981', pct: Math.round((approved / total) * 100) },
    { label: 'Rechazadas', value: rejected, color: '#ef4444', pct: Math.round((rejected / total) * 100) },
    { label: 'Pendientes', value: pending, color: '#f59e0b', pct: Math.round((pending / total) * 100) },
  ];
  const maxVal = Math.max(approved, rejected, pending, 1);

  return (
    <div className="space-y-3">
      {bars.map((b) => (
        <div key={b.label}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500 font-medium">{b.label}</span>
            <span className="font-bold text-charcoal">{b.value}</span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${(b.value / maxVal) * 100}%`, backgroundColor: b.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function EvaluatorDashboardPage() {
  const { email, name } = useAuth() as any;
  const [reflections, setReflections] = useState<EnrichedReflection[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'course' | 'student'>('course');
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const displayName = name || email?.split('@')[0] || 'Evaluador';

  useEffect(() => {
    Promise.all([
      api.evaluator.reflections(),
      api.evaluator.students(),
    ]).then(([refRes, studRes]) => {
      setReflections((refRes as any).data ?? []);
      setStudents((studRes as any).data?.students ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const pending = useMemo(() => reflections.filter((r) => r.status === 'PENDING_EVAL'), [reflections]);
  const approved = useMemo(() => reflections.filter((r) => r.status === 'APPROVED'), [reflections]);
  const rejected = useMemo(() => reflections.filter((r) => r.status === 'REJECTED'), [reflections]);

  // Urgent = submitted > 36h ago but not yet reviewed
  const urgent = useMemo(() =>
    pending.filter((r) => {
      const age = Date.now() - new Date(r.submittedAt).getTime();
      return age > 36 * 3600 * 1000;
    }), [pending]);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl lg:text-3xl text-charcoal">
            Panel del Evaluador
          </h1>
          <p className="text-gray-500 mt-1 text-sm">Hola, <strong>{displayName}</strong>. Aquí está tu carga de trabajo.</p>
        </div>

        {/* Toggle Curso / Estudiante */}
        <div className="flex bg-surface rounded-xl p-1 gap-1 shrink-0">
          {[
            { key: 'course', label: '📋 Por Curso', icon: <BookOpen className="w-4 h-4" /> },
            { key: 'student', label: '👤 Por Estudiante', icon: <Users className="w-4 h-4" /> },
          ].map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key as any)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                view === v.key ? 'bg-white shadow-sm text-charcoal' : 'text-gray-500 hover:text-charcoal'
              }`}
            >
              {v.icon} {v.key === 'course' ? 'Por Curso' : 'Por Estudiante'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Pendientes',
            value: pending.length,
            icon: <Clock className="w-5 h-5 text-amber-500" />,
            bg: 'bg-amber-50',
            ring: pending.length > 0 ? 'ring-2 ring-amber-300' : '',
          },
          {
            label: 'Aprobadas',
            value: approved.length,
            icon: <CheckCircle className="w-5 h-5 text-emerald-500" />,
            bg: 'bg-emerald-50',
            ring: '',
          },
          {
            label: 'Rechazadas',
            value: rejected.length,
            icon: <XCircle className="w-5 h-5 text-red-500" />,
            bg: 'bg-red-50',
            ring: '',
          },
          {
            label: 'Estudiantes activos',
            value: students.length,
            icon: <Users className="w-5 h-5 text-purple-500" />,
            bg: 'bg-purple-50',
            ring: '',
          },
        ].map((s) => {
          const inner = (
            <>
              <div className={`w-10 h-10 ${s.bg} rounded-xl flex items-center justify-center mb-3`}>
                {s.icon}
              </div>
              <p className="font-heading font-bold text-2xl text-charcoal">{loading ? '—' : s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </>
          );
          return s.label === 'Pendientes' ? (
            <Link key={s.label} href="/evaluator/reflections" className={`card ${s.ring} block hover:shadow-card-hover transition-shadow`}>
              {inner}
            </Link>
          ) : (
            <div key={s.label} className={`card ${s.ring}`}>
              {inner}
            </div>
          );
        })}
      </div>

      {/* ── Urgent alerts ── */}
      {!loading && urgent.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h2 className="font-heading font-bold text-base text-red-700">
              Acción Inmediata — {urgent.length} reflexión{urgent.length > 1 ? 'es' : ''} con tiempo crítico
            </h2>
          </div>
          <div className="space-y-2">
            {urgent.map((r) => {
              const tr = getTimeRemaining(r.submittedAt, (r as any).deadline);
              return (
                <Link
                  key={`${r.userId}-${r.moduleId}`}
                  href={`/evaluator/reflections/${encodeURIComponent(r.userId)}?moduleId=${r.moduleId}`}
                  className="flex items-center gap-3 bg-white rounded-xl p-3 hover:shadow-sm transition-shadow"
                >
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-charcoal truncate">
                      {(r as any).studentName ?? r.userId}
                    </p>
                    <p className="text-xs text-gray-500">{r.moduleTitle ?? r.moduleId}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                    tr.overdue ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'
                  }`}>
                    {tr.label}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Main content split ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — Work queue */}
        <div className="lg:col-span-2 space-y-4">
          {view === 'course' ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-heading font-bold text-lg text-charcoal flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-cta-from" />
                  Carga de trabajo
                </h2>
                <Link href="/evaluator/reflections" className="text-sm text-cta-from font-semibold flex items-center gap-1 hover:opacity-70">
                  Ver todas <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((n) => <div key={n} className="card h-16 animate-pulse" />)}
                </div>
              ) : pending.length === 0 ? (
                <div className="card text-center py-12">
                  <CheckCircle className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
                  <p className="font-heading font-bold text-charcoal">¡Todo al día!</p>
                  <p className="text-gray-500 text-sm mt-1">No hay reflexiones pendientes.</p>
                </div>
              ) : (
                <div className="card p-0 overflow-hidden">
                  {/* Table header */}
                  <div className="grid grid-cols-[1fr_1fr_100px_90px_40px] gap-3 px-4 py-3 bg-surface border-b border-border text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    <span>Estudiante</span>
                    <span>Módulo / Curso</span>
                    <span>Enviado</span>
                    <span>Tiempo</span>
                    <span />
                  </div>
                  {pending.map((r) => {
                    const tr = getTimeRemaining(r.submittedAt, (r as any).deadline);
                    const key = `${r.userId}-${r.moduleId}`;
                    const detailHref = `/evaluator/reflections/${encodeURIComponent(r.userId)}?moduleId=${r.moduleId}`;
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[1fr_1fr_100px_90px_40px] gap-3 px-4 py-3 items-center border-b border-border last:border-0 hover:bg-surface transition-colors cursor-pointer group"
                        onClick={(e) => {
                          // Don't navigate if clicking the action menu
                          if ((e.target as HTMLElement).closest('[data-menu]')) return;
                          window.location.href = detailHref;
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-cta-gradient flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {((r as any).studentName ?? r.userId)[0]?.toUpperCase()}
                          </div>
                          <p className="text-sm font-medium text-charcoal truncate group-hover:text-cta-from transition-colors">
                            {(r as any).studentName ?? r.userId}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-charcoal truncate">{r.moduleTitle ?? r.moduleId}</p>
                          <p className="text-xs text-gray-400 truncate">{(r as any).courseTitle ?? ''}</p>
                        </div>
                        <span className="text-xs text-gray-500">{formatDate(r.submittedAt)}</span>
                        <span className={`text-xs font-semibold px-2 py-1 rounded-lg w-fit ${
                          tr.overdue
                            ? 'bg-red-100 text-red-600'
                            : tr.urgent
                            ? 'bg-orange-100 text-orange-600'
                            : 'bg-emerald-50 text-emerald-600'
                        }`}>
                          {tr.label}
                        </span>
                        {/* Action menu */}
                        <div className="relative" data-menu>
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === key ? null : key); }}
                            className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-charcoal transition-colors"
                            title="Acciones"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          {openMenu === key && (
                            <div className="absolute right-0 top-8 z-20 bg-white dark:bg-[#1A1A2E] border border-border rounded-xl shadow-lg py-1 w-44">
                              <Link
                                href={detailHref}
                                className="flex items-center gap-2 px-4 py-2 text-sm text-charcoal hover:bg-surface"
                                onClick={() => setOpenMenu(null)}
                              >
                                <ClipboardList className="w-4 h-4 text-cta-from" />
                                Ver reflexión
                              </Link>
                              <Link
                                href={`/evaluator/students`}
                                className="flex items-center gap-2 px-4 py-2 text-sm text-charcoal hover:bg-surface"
                                onClick={() => setOpenMenu(null)}
                              >
                                <Users className="w-4 h-4 text-purple-500" />
                                Ver estudiante
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            // ── Student view ──
            <>
              <h2 className="font-heading font-bold text-lg text-charcoal flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-500" />
                Progreso de estudiantes
              </h2>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => <div key={n} className="card h-20 animate-pulse" />)}
                </div>
              ) : (
                <div className="space-y-3">
                  {students.slice(0, 8).map((s: any) => {
                    const totalMods = s.courses?.reduce((acc: number, c: any) => acc + c.modules.length, 0) ?? 0;
                    const approvedMods = s.courses?.reduce((acc: number, c: any) => acc + c.modulesApproved, 0) ?? 0;
                    const pendingMods = s.courses?.reduce((acc: number, c: any) =>
                      acc + c.modules.filter((m: any) => m.reflectionStatus === 'PENDING_EVAL').length, 0) ?? 0;
                    const avgPct = s.courses?.length > 0
                      ? Math.round(s.courses.reduce((acc: number, c: any) => acc + c.progressPct, 0) / s.courses.length)
                      : 0;

                    return (
                      <div key={s.userId} className="card p-4 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-sm shrink-0">
                          {(s.studentName ?? s.userId)[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <p className="text-sm font-semibold text-charcoal truncate">
                              {s.studentName ?? s.userId}
                            </p>
                            {pendingMods > 0 && (
                              <span className="text-xs bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">
                                {pendingMods} pendiente{pendingMods > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mb-1.5">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-cta-gradient"
                                style={{ width: `${avgPct}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 font-medium w-8 text-right">{avgPct}%</span>
                          </div>
                          <p className="text-xs text-gray-400">
                            {approvedMods}/{totalMods} módulos aprobados
                          </p>
                        </div>
                        <Link
                          href="/evaluator/students"
                          className="p-2 rounded-xl hover:bg-surface text-gray-300 hover:text-cta-from transition-colors shrink-0"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </Link>
                      </div>
                    );
                  })}
                  {students.length > 8 && (
                    <Link href="/evaluator/students" className="btn-secondary text-sm w-full justify-center">
                      Ver todos los estudiantes ({students.length})
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right sidebar — Chart + Frequent comments */}
        <div className="space-y-4">
          {/* Status bar chart */}
          <div className="card">
            <h2 className="font-heading font-bold text-base text-charcoal mb-4 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Estado de evaluaciones
            </h2>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((n) => <div key={n} className="h-4 bg-gray-100 rounded animate-pulse" />)}
              </div>
            ) : (
              <StatusBarChart
                approved={approved.length}
                rejected={rejected.length}
                pending={pending.length}
              />
            )}
            {!loading && reflections.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-gray-400 text-center">
                  Tasa de aprobación:{' '}
                  <strong className="text-emerald-600">
                    {Math.round((approved.length / (approved.length + rejected.length || 1)) * 100)}%
                  </strong>
                </p>
              </div>
            )}
          </div>

          {/* Quick link to evaluations */}
          <div className="card">
            <p className="text-xs text-gray-400 mb-3 font-semibold uppercase tracking-wide">Accesos rápidos</p>
            <div className="space-y-2">
              <Link href="/evaluator/reflections" className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface transition-colors group">
                <ClipboardList className="w-4 h-4 text-cta-from shrink-0" />
                <span className="text-sm font-medium text-charcoal group-hover:text-cta-from transition-colors">Lista de evaluaciones</span>
                <ArrowRight className="w-3.5 h-3.5 text-gray-300 ml-auto group-hover:text-cta-from transition-colors" />
              </Link>
              <Link href="/evaluator/students" className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface transition-colors group">
                <Users className="w-4 h-4 text-purple-500 shrink-0" />
                <span className="text-sm font-medium text-charcoal group-hover:text-purple-600 transition-colors">Mis estudiantes</span>
                <ArrowRight className="w-3.5 h-3.5 text-gray-300 ml-auto group-hover:text-purple-400 transition-colors" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
