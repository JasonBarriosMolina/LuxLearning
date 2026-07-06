'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Clock, CheckCircle, XCircle, ArrowRight, AlertTriangle,
  Users, ClipboardList, BookOpen, MoreVertical,
  ChevronRight, Zap, WifiOff, Send, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import type { Reflection } from '@lux/types';
import { useLanguage } from '@/lib/i18n';

type EnrichedReflection = Reflection & {
  moduleTitle?: string;
  courseTitle?: string;
  studentName?: string;
};

type StudentPresence = {
  userId: string;
  studentName?: string;
  studentEmail?: string | null;
  lastSeen?: string | null;
  presenceStatus?: 'online' | 'active' | 'inactive';
  courses: { courseId: string; title: string; progressPct: number }[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const DEADLINE_HOURS = 48;

function getTimeRemaining(submittedAt: string, deadlineIso: string | undefined, te: typeof import('@/lib/i18n/translations').es.evaluator): { label: string; urgent: boolean; overdue: boolean } {
  const deadline = deadlineIso
    ? new Date(deadlineIso).getTime()
    : new Date(submittedAt).getTime() + DEADLINE_HOURS * 3600 * 1000;
  const diff = deadline - Date.now();
  if (diff <= 0) return { label: te.overdue, urgent: true, overdue: true };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h < 6) return { label: te.hoursLeft(h, m), urgent: true, overdue: false };
  if (h < 24) return { label: te.hoursRemaining(h), urgent: false, overdue: false };
  const d = Math.floor(h / 24);
  return { label: te.daysRemaining(d), urgent: false, overdue: false };
}

// ── Bar Chart ──────────────────────────────────────────────────────────────────

function StatusBarChart({ approved, rejected, pending, labels }: { approved: number; rejected: number; pending: number; labels: { approved: string; rejected: string; pending: string } }) {
  const total = approved + rejected + pending || 1;
  const bars = [
    { label: labels.approved, value: approved, color: '#10b981', pct: Math.round((approved / total) * 100) },
    { label: labels.rejected, value: rejected, color: '#ef4444', pct: Math.round((rejected / total) * 100) },
    { label: labels.pending,  value: pending,  color: '#f59e0b', pct: Math.round((pending / total) * 100) },
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
  const router = useRouter();
  const [reflections, setReflections] = useState<EnrichedReflection[]>([]);
  const [students, setStudents] = useState<StudentPresence[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'course' | 'student'>('course');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [reminderSent, setReminderSent] = useState<Set<string>>(new Set());

  const { t, lang } = useLanguage();
  const displayName = name || email?.split('@')[0] || t.roles.evaluator;

  useEffect(() => {
    Promise.all([
      api.evaluator.reflections(),
      api.evaluator.students(),
    ]).then(([refRes, studRes]) => {
      setReflections((refRes as any).data ?? []);
      const rawStudents = (studRes as any).data?.students ?? [];
      setStudents(rawStudents);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const pending = useMemo(() => reflections.filter((r) => r.status === 'PENDING_EVAL'), [reflections]);
  const approved = useMemo(() => reflections.filter((r) => r.status === 'APPROVED'), [reflections]);
  const rejected = useMemo(() => reflections.filter((r) => r.status === 'REJECTED'), [reflections]);

  const studentMap = useMemo(() => new Map(students.map((s) => [s.userId, s])), [students]);

  const pendingByStudent = useMemo(() => {
    const map = new Map<string, EnrichedReflection[]>();
    pending.forEach((r) => {
      if (!map.has(r.userId)) map.set(r.userId, []);
      map.get(r.userId)!.push(r);
    });
    return map;
  }, [pending]);

  // Urgent = submitted > 36h ago but not yet reviewed
  const urgent = useMemo(() =>
    pending.filter((r) => {
      const age = Date.now() - new Date(r.submittedAt).getTime();
      return age > 36 * 3600 * 1000;
    }), [pending]);

  // Presence counts
  const onlineStudents = useMemo(() => students.filter((s) => s.presenceStatus === 'online'), [students]);
  const activeStudents = useMemo(() => students.filter((s) => s.presenceStatus === 'active'), [students]);
  const inactiveStudents = useMemo(() => students.filter((s) => s.presenceStatus === 'inactive'), [students]);
  // Warning zone: active students with lastSeen between 48-72h (approaching inactive)
  const approachingInactive = useMemo(() => students.filter((s) => {
    if (!s.lastSeen) return false;
    const diff = Date.now() - new Date(s.lastSeen).getTime();
    return diff >= 48 * 3600 * 1000 && diff < 72 * 3600 * 1000;
  }), [students]);

  const formatHoursAgo = (lastSeen?: string | null) => {
    if (!lastSeen) return null;
    const diff = Date.now() - new Date(lastSeen).getTime();
    const h = Math.round(diff / 3600000);
    return h;
  };

  const handleSendReminder = async (student: StudentPresence) => {
    setSendingReminder(student.userId);
    try {
      const hoursInactive = formatHoursAgo(student.lastSeen) ?? 72;
      const courseTitle = student.courses?.[0]?.title;
      const tasks: Promise<any>[] = [];
      if (student.studentEmail) {
        tasks.push(api.evaluator.sendReminder({
          userId: student.userId,
          studentEmail: student.studentEmail,
          studentName: student.studentName,
          hoursInactive,
          courseTitle,
        }));
      }
      tasks.push(
        api.messages.chats.create({ type: 'DIRECT', targetUserId: student.userId }).then((res: any) => {
          const chatId = res?.data?.chatId;
          if (!chatId) return;
          const name = student.studentName ? `, ${student.studentName}` : '';
          return api.messages.send(chatId, t.evaluator.reminderMessageText(name, courseTitle ?? ''));
        })
      );
      const results = await Promise.allSettled(tasks);
      if (results.some((r) => r.status === 'fulfilled')) {
        setReminderSent((prev) => new Set([...prev, student.userId]));
      }
    } catch { /* non-fatal */ } finally {
      setSendingReminder(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl lg:text-3xl text-charcoal">
            {t.evaluator.dashboard}
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            {t.evaluator.greetingPrefix}<strong>{displayName}</strong>. {t.evaluator.greetingSuffix}
          </p>
        </div>

        {/* Toggle Curso / Estudiante */}
        <div className="flex bg-surface rounded-xl p-1 gap-1 shrink-0">
          {([
            { key: 'course', label: t.evaluator.byCourse, icon: <BookOpen className="w-4 h-4" /> },
            { key: 'student', label: t.evaluator.byStudent, icon: <Users className="w-4 h-4" /> },
          ] as const).map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key as any)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                view === v.key ? 'bg-white shadow-sm text-charcoal' : 'text-gray-500 hover:text-charcoal'
              }`}
            >
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: t.evaluator.statPending,
            value: pending.length,
            icon: <Clock className="w-5 h-5 text-amber-500" />,
            bg: 'bg-amber-50',
            ring: pending.length > 0 ? 'ring-2 ring-amber-300' : '',
            href: '/evaluator/reflections?status=PENDING_EVAL',
          },
          {
            label: t.evaluator.statApproved,
            value: approved.length,
            icon: <CheckCircle className="w-5 h-5 text-emerald-500" />,
            bg: 'bg-emerald-50',
            ring: '',
            href: '/evaluator/reflections?status=APPROVED',
          },
          {
            label: t.evaluator.statRejected,
            value: rejected.length,
            icon: <XCircle className="w-5 h-5 text-red-500" />,
            bg: 'bg-red-50',
            ring: '',
            href: '/evaluator/reflections?status=REJECTED',
          },
          {
            label: t.evaluator.statOnline,
            value: onlineStudents.length,
            icon: <Users className="w-5 h-5 text-emerald-500" />,
            bg: 'bg-emerald-50',
            ring: onlineStudents.length > 0 ? 'ring-2 ring-emerald-200' : '',
            href: '/evaluator/students?presence=online',
          },
        ].map((s) => (
          <Link key={s.label} href={s.href} className={`card ${s.ring} block hover:shadow-card-hover transition-shadow`}>
            <div className={`w-10 h-10 ${s.bg} rounded-xl flex items-center justify-center mb-3`}>
              {s.icon}
            </div>
            <p className="font-heading font-bold text-2xl text-charcoal">{loading ? '—' : s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </Link>
        ))}
      </div>

      {/* ── Urgent alerts ── */}
      {!loading && urgent.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h2 className="font-heading font-bold text-base text-red-700">
              {t.evaluator.urgentTitle(urgent.length)}
            </h2>
          </div>
          <div className="space-y-2">
            {urgent.map((r) => {
              const tr = getTimeRemaining(r.submittedAt, (r as any).deadline, t.evaluator);
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

      {/* ── Approaching inactive warning ── */}
      {!loading && approachingInactive.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <p className="text-sm font-bold text-amber-700">
              {t.evaluator.approachingInactiveMsg(approachingInactive.length)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {approachingInactive.map((s) => (
              <span key={s.userId} className="text-xs bg-white border border-amber-200 text-amber-700 px-2.5 py-1 rounded-full font-medium">
                {s.studentName ?? s.userId}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Inactive students panel ── */}
      {!loading && inactiveStudents.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <WifiOff className="w-5 h-5 text-red-500" />
              <h2 className="font-heading font-bold text-base text-red-700">
                {t.evaluator.inactivePanel(inactiveStudents.length)}
              </h2>
            </div>
            <Link href="/evaluator/students" className="text-xs text-red-600 font-semibold hover:opacity-70">
              {t.evaluator.viewAll2}
            </Link>
          </div>
          <div className="space-y-2">
            {inactiveStudents.slice(0, 5).map((s) => {
              const hoursAgo = formatHoursAgo(s.lastSeen);
              const timeLabel = hoursAgo != null
                ? hoursAgo >= 48 ? t.evaluator.daysAgo(Math.round(hoursAgo / 24)) : t.evaluator.hoursAgo(hoursAgo)
                : t.evaluator.noActivity;
              const alreadySent = reminderSent.has(s.userId);
              const isSending = sendingReminder === s.userId;
              return (
                <div key={s.userId} className="flex items-center gap-3 bg-white rounded-xl p-3">
                  <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-500 text-xs font-bold shrink-0">
                    {(s.studentName ?? s.userId)[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-charcoal truncate">{s.studentName ?? s.userId}</p>
                    <p className="text-xs text-red-500">{timeLabel}</p>
                  </div>
                  <button
                    onClick={() => !alreadySent && handleSendReminder(s)}
                    disabled={isSending || alreadySent}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shrink-0 ${
                      alreadySent
                        ? 'bg-emerald-100 text-emerald-600 cursor-default'
                        : 'bg-red-100 text-red-600 hover:bg-red-200'
                    }`}
                    title={t.evaluator.sendReminderTitle2}
                  >
                    {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : alreadySent ? <CheckCircle className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                    {alreadySent ? t.evaluator.reminderSent : t.evaluator.sendReminderBtn}
                  </button>
                </div>
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
                  {t.evaluator.workload}
                </h2>
                <Link href="/evaluator/reflections" className="text-sm text-cta-from font-semibold flex items-center gap-1 hover:opacity-70">
                  {t.evaluator.viewAll} <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((n) => <div key={n} className="card h-16 animate-pulse" />)}
                </div>
              ) : pending.length === 0 ? (
                <div className="card text-center py-12">
                  <CheckCircle className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
                  <p className="font-heading font-bold text-charcoal">{t.evaluator.allClear}</p>
                  <p className="text-gray-500 text-sm mt-1">{t.evaluator.noReflections}</p>
                </div>
              ) : (
                <div className="card p-0 overflow-hidden">
                  {/* Table header */}
                  <div className="grid grid-cols-[1fr_1fr_100px_90px_40px] gap-3 px-4 py-3 bg-surface border-b border-border text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    <span>{t.evaluator.colStudent}</span>
                    <span>{t.evaluator.colModuleCourse}</span>
                    <span>{t.evaluator.colSent}</span>
                    <span>{t.evaluator.colTime}</span>
                    <span />
                  </div>
                  {pending.map((r) => {
                    const tr = getTimeRemaining(r.submittedAt, (r as any).deadline, t.evaluator);
                    const key = `${r.userId}-${r.moduleId}`;
                    const detailHref = `/evaluator/reflections/${encodeURIComponent(r.userId)}?moduleId=${r.moduleId}`;
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[1fr_1fr_100px_90px_40px] gap-3 px-4 py-3 items-center border-b border-border last:border-0 hover:bg-surface transition-colors cursor-pointer group"
                        onClick={(e) => {
                          // Don't navigate if clicking the action menu
                          if ((e.target as HTMLElement).closest('[data-menu]')) return;
                          router.push(detailHref);
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
                                {t.evaluator.viewReflectionAction}
                              </Link>
                              <Link
                                href={`/evaluator/students`}
                                className="flex items-center gap-2 px-4 py-2 text-sm text-charcoal hover:bg-surface"
                                onClick={() => setOpenMenu(null)}
                              >
                                <Users className="w-4 h-4 text-purple-500" />
                                {t.evaluator.viewStudentAction}
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
            // ── Student view — all students with presence + pending count ──
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-heading font-bold text-lg text-charcoal flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-500" />
                  {t.evaluator.studentProgress}
                </h2>
                <Link href="/evaluator/students" className="text-sm text-cta-from font-semibold flex items-center gap-1 hover:opacity-70">
                  {t.evaluator.viewAll} <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => <div key={n} className="card h-16 animate-pulse" />)}
                </div>
              ) : students.length === 0 ? (
                <div className="card text-center py-12">
                  <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                  <p className="font-heading font-bold text-charcoal">{t.evaluator.noStudents ?? 'Sin estudiantes'}</p>
                  <p className="text-gray-500 text-sm mt-1">{t.evaluator.noStudentsHint ?? 'No hay estudiantes inscritos en tus cursos.'}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {students.map((s) => {
                    const studentPendingCount = pendingByStudent.get(s.userId)?.length ?? 0;
                    const hoursAgo = formatHoursAgo(s.lastSeen);
                    const timeLabel = hoursAgo != null
                      ? hoursAgo >= 48 ? t.evaluator.daysAgo(Math.round(hoursAgo / 24)) : t.evaluator.hoursAgo(hoursAgo)
                      : t.evaluator.noActivity;
                    const presenceColor =
                      s.presenceStatus === 'online' ? 'bg-emerald-400' :
                      s.presenceStatus === 'active'  ? 'bg-blue-400' :
                      'bg-gray-300';
                    return (
                      <Link
                        key={s.userId}
                        href="/evaluator/students"
                        className="card p-3 flex items-center gap-3 hover:shadow-card-hover transition-shadow group"
                      >
                        <div className="relative shrink-0">
                          <div className="w-9 h-9 rounded-full bg-cta-gradient flex items-center justify-center text-white text-xs font-bold">
                            {(s.studentName ?? s.userId)[0]?.toUpperCase()}
                          </div>
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${presenceColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-charcoal truncate group-hover:text-cta-from transition-colors">
                            {s.studentName ?? s.userId}
                          </p>
                          <p className="text-xs text-gray-400 truncate">{timeLabel}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {studentPendingCount > 0 && (
                            <span className="text-xs bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">
                              {t.evaluator.pendingBadge(studentPendingCount)}
                            </span>
                          )}
                          {s.courses?.length > 0 && (
                            <span className="text-xs text-gray-400">
                              {s.courses.length} {s.courses.length === 1 ? 'curso' : 'cursos'}
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-cta-from transition-colors" />
                        </div>
                      </Link>
                    );
                  })}
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
              {t.evaluator.evalStatus}
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
                labels={{ approved: t.evaluator.statApproved, rejected: t.evaluator.statRejected, pending: t.evaluator.statPending }}
              />
            )}
            {!loading && reflections.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-gray-400 text-center">
                  {t.evaluator.approvalRate}{' '}
                  <strong className="text-emerald-600">
                    {Math.round((approved.length / (approved.length + rejected.length || 1)) * 100)}%
                  </strong>
                </p>
              </div>
            )}
          </div>

          {/* Quick link to evaluations */}
          <div className="card">
            <p className="text-xs text-gray-400 mb-3 font-semibold uppercase tracking-wide">{t.evaluator.quickLinks}</p>
            <div className="space-y-2">
              <Link href="/evaluator/reflections" className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface transition-colors group">
                <ClipboardList className="w-4 h-4 text-cta-from shrink-0" />
                <span className="text-sm font-medium text-charcoal group-hover:text-cta-from transition-colors">{t.evaluator.evalList}</span>
                <ArrowRight className="w-3.5 h-3.5 text-gray-300 ml-auto group-hover:text-cta-from transition-colors" />
              </Link>
              <Link href="/evaluator/students" className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface transition-colors group">
                <Users className="w-4 h-4 text-purple-500 shrink-0" />
                <span className="text-sm font-medium text-charcoal group-hover:text-purple-600 transition-colors">{t.evaluator.myStudents}</span>
                <ArrowRight className="w-3.5 h-3.5 text-gray-300 ml-auto group-hover:text-purple-400 transition-colors" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
