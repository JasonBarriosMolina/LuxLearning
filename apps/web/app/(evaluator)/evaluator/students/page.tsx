'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Users, ChevronDown, ChevronRight, CheckCircle, Clock, XCircle, Lock, BookOpen, Search, Wifi, Activity, WifiOff, UserCheck, X, BookMarked, AlertTriangle, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Input } from '@/components/ui/Input';
import { useLanguage, type Translations } from '@/lib/i18n';

type ModuleStat = {
  moduleId: string; title: string; order: number;
  totalLessons: number; completedLessons: number;
  quizPassed: boolean; reflectionStatus: string | null;
};

type CourseStat = {
  courseId: string; title: string;
  totalLessons: number; completedLessons: number;
  progressPct: number; modulesApproved: number;
  modules: ModuleStat[];
};

type Student = { userId: string; studentName?: string; studentEmail?: string | null; courses: CourseStat[]; lastSeen?: string | null; presenceStatus?: 'online' | 'active' | 'inactive'; taskCounts?: { pending: number; overdue: number; completed: number } | null };

function formatReminderAge(sentAt: Date): string {
  const mins = Math.round((Date.now() - sentAt.getTime()) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

function getCurrentModule(modules: ModuleStat[]): ModuleStat | null {
  const sorted = [...modules].sort((a, b) => a.order - b.order);
  for (const mod of sorted) {
    if (mod.completedLessons < mod.totalLessons) return mod;
    if (!mod.quizPassed) return mod;
    if (mod.reflectionStatus === null) return mod;
  }
  return null;
}

type SP = Translations['studentsPage'];

function riskLevel(presenceStatus?: string, overallPct?: number): 'critical' | 'high' | 'medium' | 'low' {
  const inactive = presenceStatus === 'inactive';
  const pct = overallPct ?? 0;
  if (inactive && pct < 20) return 'critical';
  if (inactive || pct < 25) return 'high';
  if (pct < 50) return 'medium';
  return 'low';
}

function RiskBadge({ level }: { level: 'critical' | 'high' | 'medium' | 'low' }) {
  if (level === 'low') return null;
  const cfg = {
    critical: { label: 'Riesgo crítico', cls: 'bg-red-100 text-red-700 border-red-200' },
    high:     { label: 'En riesgo',      cls: 'bg-orange-100 text-orange-700 border-orange-200' },
    medium:   { label: 'Atención',       cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  }[level];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      <AlertTriangle className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function PresenceBadge({ status, ts }: { status?: string; ts: SP }) {
  if (status === 'online') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />{ts.presenceOnline}
    </span>
  );
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />{ts.presenceActive}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />{ts.presenceInactive}
    </span>
  );
}

function formatLastSeen(lastSeen: string | null | undefined, ts: SP): string {
  if (!lastSeen) return ts.lastSeenNever;
  const diff = Date.now() - new Date(lastSeen).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return ts.lastSeenMoment;
  if (mins < 60) return ts.lastSeenMins(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return ts.lastSeenHours(hours);
  const days = Math.floor(hours / 24);
  return ts.lastSeenDays(days);
}

function ModuleStatusIcon({ mod }: { mod: ModuleStat }) {
  if (mod.reflectionStatus === 'APPROVED') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
  if (mod.reflectionStatus === 'PENDING_EVAL') return <Clock className="w-4 h-4 text-amber-500" />;
  if (mod.reflectionStatus === 'REJECTED') return <XCircle className="w-4 h-4 text-red-400" />;
  if (mod.completedLessons === 0) return <Lock className="w-4 h-4 text-gray-300" />;
  return <BookOpen className="w-4 h-4 text-cta-from" />;
}

function StudentCard({ student, courses, ts, onSendReminder, sendingReminderId, reminderSentIds, onOpenChat, openingChatId, selectedCourseId }: {
  student: Student; courses: { id: string; title: string }[]; ts: SP;
  onSendReminder?: (student: Student) => void;
  sendingReminderId?: string | null;
  reminderSentIds?: Map<string, Date>;
  onOpenChat?: (student: Student) => void;
  openingChatId?: string | null;
  selectedCourseId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeCourse, setActiveCourse] = useState(0);

  const overallPct = student.courses.length > 0
    ? Math.round(student.courses.reduce((s, c) => s + c.progressPct, 0) / student.courses.length)
    : 0;
  const totalApproved = student.courses.reduce((s, c) => s + c.modulesApproved, 0);
  const totalPending = student.courses.reduce((s, c) =>
    s + c.modules.filter((m) => m.reflectionStatus === 'PENDING_EVAL').length, 0);
  const totalModules = student.courses.reduce((s, c) => s + c.modules.length, 0);

  return (
    <div className="card overflow-hidden p-0">
      {/* Student header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }}
        className="w-full flex items-center gap-4 p-4 hover:bg-surface transition-colors text-left cursor-pointer"
      >
        <div className="w-10 h-10 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-sm shrink-0">
          {(student.studentName ?? student.userId)[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-charcoal text-sm truncate">{student.studentName ?? student.userId}</p>
            <PresenceBadge status={student.presenceStatus} ts={ts} />
            <RiskBadge level={riskLevel(student.presenceStatus, overallPct)} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{formatLastSeen(student.lastSeen, ts)}</p>
          <div className="mt-1.5">
            <ProgressBar value={overallPct} size="sm" />
          </div>
        </div>
        {/* Quick stats */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            {student.presenceStatus === 'inactive' && onSendReminder && (() => {
              const sentAt = reminderSentIds?.get(student.userId);
              return (
                <div className="flex flex-col items-center gap-0.5">
                  <button
                    onClick={() => onSendReminder(student)}
                    disabled={sendingReminderId === student.userId || !!sentAt}
                    title={ts.sendReminderTitle2}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
                      sentAt
                        ? 'bg-emerald-100 text-emerald-600 cursor-default'
                        : 'bg-red-100 text-red-600 hover:bg-red-200'
                    }`}
                  >
                    {sentAt ? ts.reminderSent : ts.sendReminderBtn}
                  </button>
                  {sentAt && (
                    <span className="text-[10px] text-gray-400 leading-none">{formatReminderAge(sentAt)}</span>
                  )}
                </div>
              );
            })()}
            {onOpenChat && (
              <button
                onClick={() => onOpenChat(student)}
                disabled={openingChatId === student.userId}
                title="Abrir chat con este estudiante"
                className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Chat
              </button>
            )}
          </div>
          <div className="text-center hidden sm:block">
            <p className="font-bold text-lg text-charcoal">{overallPct}%</p>
            <p className="text-xs text-gray-400">{ts.progressLabel}</p>
          </div>
          <div className="text-center hidden sm:block">
            <p className="font-bold text-lg text-emerald-600">{totalApproved}</p>
            <p className="text-xs text-gray-400">{ts.approvedLabel}</p>
          </div>
          {totalPending > 0 && (
            <div className="text-center">
              <p className="font-bold text-lg text-amber-500">{totalPending}</p>
              <p className="text-xs text-gray-400">{ts.pendingLabel}</p>
            </div>
          )}
          <div className="text-center hidden md:block">
            <p className="font-bold text-lg text-charcoal">{totalModules}</p>
            <p className="text-xs text-gray-400">{ts.modulesLabel}</p>
          </div>
          {selectedCourseId && (() => {
            const cs = student.courses.find((c) => c.courseId === selectedCourseId);
            if (!cs) return null;
            const cur = getCurrentModule(cs.modules);
            return (
              <div className="text-center hidden sm:block max-w-[110px]">
                <p className="font-semibold text-xs text-charcoal truncate" title={cur?.title ?? '—'}>
                  {cur ? `${cur.order}. ${cur.title}` : '✓ Completo'}
                </p>
                <p className="text-xs text-gray-400">Módulo actual</p>
              </div>
            );
          })()}
          {student.taskCounts && selectedCourseId && (
            <div className="text-center hidden sm:block">
              <div className="flex gap-1 text-xs font-semibold">
                {student.taskCounts.overdue > 0 && (
                  <span className="bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{student.taskCounts.overdue} venc.</span>
                )}
                {student.taskCounts.pending > 0 && (
                  <span className="bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">{student.taskCounts.pending} pend.</span>
                )}
                {student.taskCounts.completed > 0 && (
                  <span className="bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full">{student.taskCounts.completed} comp.</span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">Tareas</p>
            </div>
          )}
          {expanded
            ? <ChevronDown className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border bg-surface">
          {/* Course tabs */}
          {student.courses.length > 1 && (
            <div className="flex gap-1 px-4 pt-3 pb-0 overflow-x-auto">
              {student.courses.map((c, i) => (
                <button
                  key={c.courseId}
                  onClick={() => setActiveCourse(i)}
                  className={`px-3 py-1.5 rounded-t-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    activeCourse === i
                      ? 'bg-white text-charcoal border border-b-white border-border'
                      : 'text-gray-500 hover:text-charcoal'
                  }`}
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}

          <div className="p-4 space-y-3">
            {student.courses[activeCourse] && (() => {
              const course = student.courses[activeCourse]!;
              return (
                <>
                  {/* Course progress summary */}
                  <div className="flex items-center gap-4 p-3 bg-white rounded-xl border border-border">
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-gray-500 mb-1">{ts.courseProgress}</p>
                      <ProgressBar
                        value={course.progressPct}
                        label={ts.lessonsLabel(course.completedLessons, course.totalLessons)}
                        showPercent
                      />
                    </div>
                    <div className="flex gap-4 text-center shrink-0">
                      <div>
                        <p className="font-bold text-emerald-600">{course.modulesApproved}</p>
                        <p className="text-xs text-gray-400 whitespace-pre-line">{ts.completedModules}</p>
                      </div>
                      <div>
                        <p className="font-bold text-charcoal">{course.modules.length}</p>
                        <p className="text-xs text-gray-400 whitespace-pre-line">{ts.totalModules}</p>
                      </div>
                    </div>
                  </div>

                  {/* Module breakdown */}
                  <div className="space-y-2">
                    {course.modules.map((mod) => {
                      const modPct = mod.totalLessons > 0
                        ? Math.round((mod.completedLessons / mod.totalLessons) * 100)
                        : 0;
                      return (
                        <div
                          key={mod.moduleId}
                          className={`p-3 rounded-xl border bg-white ${
                            mod.reflectionStatus === 'APPROVED' ? 'border-emerald-200' :
                            mod.reflectionStatus === 'PENDING_EVAL' ? 'border-amber-200' :
                            mod.reflectionStatus === 'REJECTED' ? 'border-red-200' :
                            'border-border'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <ModuleStatusIcon mod={mod} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <p className="text-sm font-medium text-charcoal truncate">
                                  {mod.order}. {mod.title}
                                </p>
                                <div className="flex items-center gap-2 shrink-0">
                                  {mod.quizPassed && (
                                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                      Quiz ✓
                                    </span>
                                  )}
                                  {mod.reflectionStatus && (
                                    <ReflectionStatusBadge status={mod.reflectionStatus as any} />
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex-1">
                                  <ProgressBar value={modPct} size="sm" />
                                </div>
                                <span className="text-xs text-gray-400 shrink-0 font-medium w-16 text-right">
                                  {mod.completedLessons}/{mod.totalLessons} lecc.
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Course-level overview card ───────────────────────────────────────────────

function CourseOverview({ students, course }: { students: Student[]; course: { id: string; title: string } }) {
  const { t } = useLanguage();
  const ts = t.studentsPage;
  const courseStats = students
    .map((s) => s.courses.find((c) => c.courseId === course.id))
    .filter(Boolean) as CourseStat[];

  if (courseStats.length === 0) return null;

  const avgProgress = Math.round(courseStats.reduce((s, c) => s + c.progressPct, 0) / courseStats.length);
  const completed = courseStats.filter((c) => c.progressPct === 100).length;
  const totalApproved = courseStats.reduce((s, c) => s + c.modulesApproved, 0);
  const totalModules = courseStats.reduce((s, c) => s + c.modules.length, 0);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-heading font-bold text-base text-charcoal">{course.title}</h3>
        <span className="text-xs text-gray-400">{ts.studentsCount(courseStats.length)}</span>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: ts.statAvgProgress, value: `${avgProgress}%`, color: 'text-cta-from' },
          { label: ts.statCompleted, value: completed, color: 'text-emerald-600' },
          { label: ts.statModulesApproved, value: totalApproved, color: 'text-purple-600' },
          { label: ts.statTotalModules, value: totalModules, color: 'text-charcoal' },
        ].map((stat) => (
          <div key={stat.label} className="text-center p-2 bg-surface rounded-xl">
            <p className={`font-bold text-xl ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-400 mt-0.5 leading-tight">{stat.label}</p>
          </div>
        ))}
      </div>
      <ProgressBar value={avgProgress} label={ts.avgProgressLabel} showPercent />
    </div>
  );
}

// ─── Admin view: all registered students (no activity required) ───────────────

function AdminStudentList({ courses, initialPresenceFilter }: { courses: { id: string; title: string; evaluatorName?: string }[]; initialPresenceFilter?: PresenceFilter }) {
  const { t } = useLanguage();
  const ts = t.studentsPage;
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedCourses, setExpandedCourses] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<Record<string, string[]>>({});
  const [profileModal, setProfileModal] = useState<any | null>(null);
  const [presenceMap, setPresenceMap] = useState<Record<string, { presenceStatus?: string; lastSeen?: string | null; studentEmail?: string | null }>>({});
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>(initialPresenceFilter ?? 'all');
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [reminderSent, setReminderSent] = useState<Map<string, Date>>(new Map());
  const [openingChat, setOpeningChat] = useState<string | null>(null);

  useEffect(() => {
    api.admin.users.list().then((res) => {
      const all: any[] = (res as any).data ?? [];
      setUsers(all.filter((u) => u.role === 'STUDENT'));
      setLoading(false);
    }).catch(() => setLoading(false));
    api.evaluator.students().then((res: any) => {
      const students: Student[] = res?.data?.students ?? [];
      const map: Record<string, { presenceStatus?: string; lastSeen?: string | null; studentEmail?: string | null }> = {};
      students.forEach((s) => { map[s.userId] = { presenceStatus: s.presenceStatus, lastSeen: s.lastSeen, studentEmail: s.studentEmail }; });
      setPresenceMap(map);
    }).catch((err) => { console.warn('[Students] presenceMap load failed:', err); });
  }, []);

  const handleSendReminder = async (u: any) => {
    setSendingReminder(u.username);
    try {
      const presence = presenceMap[u.sub ?? u.username];
      const hoursInactive = presence?.lastSeen
        ? Math.round((Date.now() - new Date(presence.lastSeen).getTime()) / 3600000)
        : 72;
      const tasks: Promise<any>[] = [];
      const email = presence?.studentEmail ?? u.email;
      if (email) {
        tasks.push(api.evaluator.sendReminder({ userId: u.username, studentEmail: email, studentName: u.name, hoursInactive }));
      }
      tasks.push(
        api.messages.chats.create({ type: 'DIRECT', targetUserId: u.username }).then((res: any) => {
          const chatId = res?.data?.chatId;
          if (!chatId) return;
          const name = u.name ? `, ${u.name}` : '';
          return api.messages.send(chatId, t.evaluator.reminderMessageText(name, ''));
        })
      );
      const results = await Promise.allSettled(tasks);
      if (results.some((r) => r.status === 'fulfilled')) {
        setReminderSent((prev) => new Map([...prev, [u.username, new Date()]]));
      }
    } catch { /* non-fatal */ } finally {
      setSendingReminder(null);
    }
  };

  const handleOpenChat = async (u: any) => {
    setOpeningChat(u.username);
    try {
      const res = await api.messages.chats.create({ type: 'DIRECT', targetUserId: u.username });
      const chatId = (res as any)?.data?.chatId;
      if (chatId) router.push(`/evaluator/communications?chatId=${chatId}`);
    } catch { /* non-fatal */ } finally {
      setOpeningChat(null);
    }
  };

  const loadEnrollments = async (username: string): Promise<string[]> => {
    if (enrollments[username] !== undefined) return enrollments[username];
    try {
      const res = await api.admin.users.getEnrollments(username);
      const ids: string[] = (res as any).data?.courseIds ?? (res as any).data ?? [];
      setEnrollments((prev) => ({ ...prev, [username]: ids }));
      return ids;
    } catch {
      setEnrollments((prev) => ({ ...prev, [username]: [] }));
      return [];
    }
  };

  const toggleCourses = async (username: string) => {
    if (expandedCourses === username) { setExpandedCourses(null); return; }
    setExpandedCourses(username);
    await loadEnrollments(username);
  };

  const openProfile = async (e: React.MouseEvent, u: any) => {
    e.stopPropagation();
    const ids = await loadEnrollments(u.username);
    setProfileModal({ ...u, enrolledIds: ids });
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const matchSearch = !q || (u.name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchPresence = presenceFilter === 'all' || presenceMap[u.sub ?? u.username]?.presenceStatus === presenceFilter;
    return matchSearch && matchPresence;
  });

  const presenceCounts = {
    online: users.filter((u) => presenceMap[u.sub ?? u.username]?.presenceStatus === 'online').length,
    active: users.filter((u) => presenceMap[u.sub ?? u.username]?.presenceStatus === 'active').length,
    inactive: users.filter((u) => presenceMap[u.sub ?? u.username]?.presenceStatus === 'inactive').length,
  };

  if (loading) return (
    <div className="space-y-2">
      {[1, 2, 3].map((n) => <div key={n} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{ts.registeredCount(users.length)}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {([
          { key: 'all', label: ts.all, count: users.length, color: 'bg-gray-100 text-gray-600' },
          { key: 'online', label: ts.online, count: presenceCounts.online, color: 'bg-emerald-100 text-emerald-700' },
          { key: 'active', label: ts.active, count: presenceCounts.active, color: 'bg-amber-100 text-amber-700' },
          { key: 'inactive', label: ts.inactive, count: presenceCounts.inactive, color: 'bg-red-100 text-red-600' },
        ] as { key: PresenceFilter; label: string; count: number; color: string }[]).map((f) => (
          <button
            key={f.key}
            onClick={() => setPresenceFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              presenceFilter === f.key
                ? f.color + ' ring-2 ring-offset-1 ring-current'
                : 'bg-surface text-gray-500 hover:bg-gray-100'
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>
      <Input
        placeholder={ts.searchByName}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        leftIcon={<Search className="w-4 h-4" />}
      />
      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{ts.noStudentsFound}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{ts.colName}</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 hidden sm:table-cell">{ts.colDate}</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{ts.colStatus}</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{ts.colPresence}</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{ts.colCourses}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((u) => {
                const userEnrollments = enrollments[u.username] ?? [];
                const enrolledCourses = courses.filter((c) => userEnrollments.includes(c.id));
                const coursesOpen = expandedCourses === u.username;
                return (
                  <tr key={u.username} className="hover:bg-surface/60 transition-colors">
                    {/* Nombre */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-xs shrink-0">
                          {(u.name || u.email)[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-charcoal truncate max-w-[180px]">{u.name || ts.noName}</p>
                          <p className="text-xs text-gray-400 truncate max-w-[180px]">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    {/* Fecha */}
                    <td className="px-4 py-3 text-gray-500 text-xs hidden sm:table-cell whitespace-nowrap">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    {/* Estado */}
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                        {u.enabled ? ts.statusActive : ts.statusInactive}
                      </span>
                    </td>
                    {/* Presencia */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <PresenceBadge status={presenceMap[u.sub ?? u.username]?.presenceStatus} ts={ts} />
                        <span className="text-xs text-gray-400">{formatLastSeen(presenceMap[u.sub ?? u.username]?.lastSeen, ts)}</span>
                      </div>
                    </td>
                    {/* Cursos */}
                    <td className="px-4 py-3">
                      <div>
                        <button
                          onClick={() => toggleCourses(u.username)}
                          className="flex items-center gap-1.5 text-xs text-cta-from font-medium hover:underline"
                        >
                          {enrollments[u.username] === undefined ? (
                            <span className="text-gray-400">{ts.viewCourses2}</span>
                          ) : (
                            <span>{enrolledCourses.length > 0 ? ts.coursesCount(enrolledCourses.length) : ts.noCourses}</span>
                          )}
                          {coursesOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                        {coursesOpen && (
                          <div className="mt-2 space-y-1 max-w-xs">
                            {enrolledCourses.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">{ts.noCoursesAssigned}</p>
                            ) : (
                              enrolledCourses.map((c) => (
                                <div key={c.id} className="flex items-center gap-1.5 text-xs text-charcoal">
                                  <BookOpen className="w-3 h-3 text-cta-from shrink-0" />
                                  <span className="truncate max-w-[160px]">{c.title}</span>
                                  {c.evaluatorName && <span className="text-gray-400 shrink-0">· {c.evaluatorName}</span>}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    {/* Acciones */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {presenceMap[u.sub ?? u.username]?.presenceStatus === 'inactive' && (() => {
                          const sentAt = reminderSent.get(u.username);
                          return (
                            <div className="flex flex-col items-center gap-0.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSendReminder(u); }}
                                disabled={sendingReminder === u.username || !!sentAt}
                                title={ts.sendReminderTitle2}
                                className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors shrink-0 whitespace-nowrap ${
                                  sentAt
                                    ? 'bg-emerald-100 text-emerald-600 cursor-default'
                                    : 'bg-red-100 text-red-600 hover:bg-red-200'
                                }`}
                              >
                                {sentAt ? ts.reminderSent : ts.sendReminderBtn}
                              </button>
                              {sentAt && (
                                <span className="text-[10px] text-gray-400 leading-none">{formatReminderAge(sentAt)}</span>
                              )}
                            </div>
                          );
                        })()}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenChat(u); }}
                          disabled={openingChat === u.username}
                          title="Abrir chat con este estudiante"
                          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors shrink-0"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Chat
                        </button>
                        <button
                          onClick={(e) => openProfile(e, u)}
                          className="text-xs text-cta-from font-semibold hover:underline px-2 py-1 rounded-lg hover:bg-purple-50 transition-colors whitespace-nowrap"
                        >
                          {ts.viewProfile}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Profile Modal */}
      {profileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setProfileModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-xl shrink-0">
                {(profileModal.name || profileModal.email)[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-heading font-bold text-lg text-charcoal truncate">{profileModal.name || ts.noName}</p>
                <p className="text-sm text-gray-400 truncate">{profileModal.email}</p>
              </div>
              <button onClick={() => setProfileModal(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-gray-500">{ts.modalStatus}</span>
                <span className={`font-medium ${profileModal.enabled ? 'text-emerald-600' : 'text-red-500'}`}>
                  {profileModal.enabled ? ts.statusActive : ts.statusInactive}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-gray-500">{ts.modalRegDate}</span>
                <span className="font-medium text-charcoal">
                  {profileModal.createdAt ? new Date(profileModal.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                </span>
              </div>
              <div className="pt-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{ts.modalCourses}</p>
                {(profileModal.enrolledIds ?? []).length === 0 ? (
                  <p className="text-gray-400 italic text-xs">{ts.noCoursesAssigned}</p>
                ) : (
                  <div className="space-y-1.5">
                    {courses.filter((c) => (profileModal.enrolledIds ?? []).includes(c.id)).map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-sm text-charcoal">
                        <BookOpen className="w-3.5 h-3.5 text-cta-from shrink-0" />
                        <span>{c.title}</span>
                        {c.evaluatorName && <span className="text-xs text-gray-400">— {c.evaluatorName}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type PresenceFilter = 'all' | 'online' | 'active' | 'inactive';

function StudentsPageInner() {
  const { role, isLoading: authLoading } = useAuth();
  const { t } = useLanguage();
  const ts = t.studentsPage;
  const router = useRouter();
  const searchParams = useSearchParams();
  const courseIdParam = searchParams.get('courseId') ?? '';
  const initialPresenceFilter = (() => {
    const fromQuery = searchParams.get('presence');
    const valid: PresenceFilter[] = ['all', 'online', 'active', 'inactive'];
    return (valid.includes(fromQuery as PresenceFilter) ? fromQuery : 'all') as PresenceFilter;
  })();
  const [data, setData] = useState<{ students: Student[]; courses: { id: string; title: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'students' | 'courses'>(courseIdParam ? 'courses' : 'students');
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>(initialPresenceFilter);
  const [selectedCourseId, setSelectedCourseId] = useState(courseIdParam);
  const [expandedCourseStudents, setExpandedCourseStudents] = useState<Set<string>>(new Set());
  const [adminCourses, setAdminCourses] = useState<{ id: string; title: string; evaluatorName?: string }[]>([]);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [reminderSent, setReminderSent] = useState<Map<string, Date>>(new Map());
  const [openingChat, setOpeningChat] = useState<string | null>(null);

  const handleSendReminder = async (student: Student) => {
    setSendingReminder(student.userId);
    try {
      const hoursInactive = student.lastSeen
        ? Math.round((Date.now() - new Date(student.lastSeen).getTime()) / 3600000)
        : 72;
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
        setReminderSent((prev) => new Map([...prev, [student.userId, new Date()]]));
      }
    } catch { /* non-fatal */ } finally {
      setSendingReminder(null);
    }
  };

  const handleOpenChat = async (student: Student) => {
    setOpeningChat(student.userId);
    try {
      const res = await api.messages.chats.create({ type: 'DIRECT', targetUserId: student.userId });
      const chatId = (res as any)?.data?.chatId;
      if (chatId) router.push(`/evaluator/communications?chatId=${chatId}`);
    } catch { /* non-fatal */ } finally {
      setOpeningChat(null);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
      api.admin.courses.list().then((res) => {
        setAdminCourses(((res as any).data ?? []).map((c: any) => ({ id: c.id, title: c.title, evaluatorName: c.evaluatorName ?? undefined })));
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      api.evaluator.students(courseIdParam ? { courseId: courseIdParam } : undefined).then((res) => {
        setData((res as any).data ?? null);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [authLoading, role]);

  const allStudents = data?.students ?? [];

  const filtered = allStudents.filter((s) => {
    const matchSearch = search === '' || (s.studentName ?? s.userId).toLowerCase().includes(search.toLowerCase());
    const matchPresence = presenceFilter === 'all' || s.presenceStatus === presenceFilter;
    return matchSearch && matchPresence;
  });

  const presenceCounts = {
    online: allStudents.filter((s) => s.presenceStatus === 'online').length,
    active: allStudents.filter((s) => s.presenceStatus === 'active').length,
    inactive: allStudents.filter((s) => s.presenceStatus === 'inactive').length,
  };

  // For course view: students enrolled in selected course
  const courseStudents = selectedCourseId
    ? allStudents.filter((s) => s.courses.some((c) => c.courseId === selectedCourseId))
    : allStudents;

  const filteredCourseStudents = courseStudents.filter((s) => {
    const matchPresence = presenceFilter === 'all' || s.presenceStatus === presenceFilter;
    return matchPresence;
  });

  // Admin view: full list with enrollments, no activity indicators
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <UserCheck className="w-6 h-6 text-cta-from" />
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">{ts.title}</h1>
            <p className="text-gray-500 mt-1 text-sm">{ts.adminSubtitle}</p>
          </div>
        </div>
        <AdminStudentList courses={adminCourses} initialPresenceFilter={initialPresenceFilter} />
      </div>
    );
  }

  const activeCourseTitle = selectedCourseId
    ? data?.courses.find((c) => c.id === selectedCourseId)?.title
    : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">{ts.title}</h1>
        <p className="text-gray-500 mt-1 text-sm">{ts.subtitle}</p>
      </div>

      {/* Course filter badge */}
      {courseIdParam && activeCourseTitle && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold">
            <BookMarked className="w-3.5 h-3.5" />
            {activeCourseTitle}
            <a href="/evaluator/students" className="ml-1 hover:text-purple-900">
              <X className="w-3.5 h-3.5" />
            </a>
          </span>
        </div>
      )}

      {/* View toggle */}
      <div className="flex flex-wrap gap-3">
        <div className="flex bg-surface rounded-xl p-1 gap-1 shrink-0">
          {(['students', 'courses'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                view === v ? 'bg-white shadow-sm text-charcoal' : 'text-gray-500 hover:text-charcoal'
              }`}
            >
              {v === 'students' ? ts.byStudent : ts.byCourse}
            </button>
          ))}
        </div>

        {/* Presence filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            { key: 'all', label: ts.all, count: allStudents.length, color: 'bg-gray-100 text-gray-600' },
            { key: 'online', label: ts.online, count: presenceCounts.online, color: 'bg-emerald-100 text-emerald-700' },
            { key: 'active', label: ts.active, count: presenceCounts.active, color: 'bg-amber-100 text-amber-700' },
            { key: 'inactive', label: ts.inactive, count: presenceCounts.inactive, color: 'bg-red-100 text-red-600' },
          ] as { key: PresenceFilter; label: string; count: number; color: string }[]).map((f) => (
            <button
              key={f.key}
              onClick={() => setPresenceFilter(f.key as PresenceFilter)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                presenceFilter === f.key
                  ? f.color + ' ring-2 ring-offset-1 ring-current'
                  : 'bg-surface text-gray-500 hover:bg-gray-100'
              }`}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <div key={n} className="card h-20 animate-pulse" />)}
        </div>
      ) : !data || allStudents.length === 0 ? (
        <div className="card text-center py-16">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">{ts.noActivity}</p>
          <p className="text-gray-500 text-sm mt-1">{ts.noActivityHint}</p>
        </div>
      ) : view === 'students' ? (
        <div className="space-y-3">
          {/* Search bar */}
          <Input
            placeholder={ts.searchStudent}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
          {filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-8">{ts.noStudentFound}</p>
          ) : (
            filtered.map((student) => (
              <StudentCard
                key={student.userId} student={student} courses={data.courses} ts={ts}
                onSendReminder={handleSendReminder} sendingReminderId={sendingReminder} reminderSentIds={reminderSent}
                onOpenChat={handleOpenChat} openingChatId={openingChat}
                selectedCourseId={selectedCourseId || undefined}
              />
            ))
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Course selector */}
          <div className="card">
            <select
              value={selectedCourseId}
              onChange={(e) => { setSelectedCourseId(e.target.value); setExpandedCourseStudents(new Set()); }}
              className="input-field"
            >
              <option value="">{ts.allCourses}</option>
              {(data.courses ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>

          {/* Students in selected course */}
          {filteredCourseStudents.length === 0 ? (
            <p className="text-center text-gray-400 py-8">{ts.noStudentsInFilter}</p>
          ) : (
            <div className="space-y-2">
              {filteredCourseStudents.map((student) => {
                const isExpanded = expandedCourseStudents.has(student.userId);
                return (
                  <div key={student.userId} className="card overflow-hidden p-0">
                    <button
                      onClick={() => setExpandedCourseStudents((prev) => {
                        const next = new Set(prev);
                        if (isExpanded) next.delete(student.userId); else next.add(student.userId);
                        return next;
                      })}
                      className="w-full flex items-center gap-4 p-4 hover:bg-surface transition-colors text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {(student.studentName ?? student.userId)[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-charcoal text-sm">{student.studentName ?? student.userId}</p>
                          <PresenceBadge status={student.presenceStatus} ts={ts} />
                        </div>
                        <p className="text-xs text-gray-400">{formatLastSeen(student.lastSeen, ts)}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {student.courses.find((c) => c.courseId === selectedCourseId || !selectedCourseId) && (() => {
                          const course = student.courses.find((c) => selectedCourseId ? c.courseId === selectedCourseId : true);
                          if (!course) return null;
                          return (
                            <div className="text-center hidden sm:block">
                              <p className="font-bold text-sm text-charcoal">{course.progressPct}%</p>
                              <p className="text-xs text-gray-400">{ts.progressLabel2}</p>
                            </div>
                          );
                        })()}
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border">
                        <StudentCard
                          student={student} courses={data.courses} ts={ts}
                          onSendReminder={handleSendReminder} sendingReminderId={sendingReminder} reminderSentIds={reminderSent}
                          onOpenChat={handleOpenChat} openingChatId={openingChat}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function StudentsPage() {
  return (
    <Suspense>
      <StudentsPageInner />
    </Suspense>
  );
}
