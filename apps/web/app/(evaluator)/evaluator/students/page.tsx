'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Users, ChevronDown, ChevronRight, Search, UserCheck, BookMarked, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { Input } from '@/components/ui/Input';
import { useLanguage } from '@/lib/i18n';
import type { Student, PresenceFilter } from './_components/types';
import { formatLastSeen } from './_components/helpers';
import { PresenceBadge } from './_components/Badges';
import { StudentCard } from './_components/StudentCard';
import { AdminStudentList } from './_components/AdminStudentList';
import { StudyPlanModal } from './_components/StudyPlanModal';

// ─── Main page ────────────────────────────────────────────────────────────────

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
  const [planModal, setPlanModal] = useState<{ userId: string; studentName?: string } | null>(null);

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

  const handleGeneratePlan = (student: Student) => {
    setPlanModal({ userId: student.userId, studentName: student.studentName ?? undefined });
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
          ) : (() => {
            const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
            const isRecent = (iso: string | null | undefined) =>
              !!iso && Date.now() - new Date(iso).getTime() < RECENT_MS;
            const reminded = filtered.filter((s) =>
              reminderSent.has(s.userId) ||
              isRecent(s.lastManualReminder?.lastSent) ||
              isRecent(s.lastAutoReminder?.lastSent)
            );
            const pending = filtered.filter((s) => !reminded.includes(s));

            const reminderTypeLabel = (s: Student) => {
              const sessionSent = reminderSent.has(s.userId);
              const manual = sessionSent || isRecent(s.lastManualReminder?.lastSent);
              const auto = isRecent(s.lastAutoReminder?.lastSent);
              if (manual && auto) return { label: 'Manual + Sistema', cls: 'bg-violet-100 text-violet-700' };
              if (manual) return { label: sessionSent ? 'Enviado ahora' : 'Manual', cls: 'bg-emerald-100 text-emerald-700' };
              return { label: 'Sistema automático', cls: 'bg-blue-100 text-blue-700' };
            };

            return (
              <>
                {reminded.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wide whitespace-nowrap">
                        Recordatorio enviado recientemente
                      </span>
                      <div className="flex-1 h-px bg-emerald-200" />
                      <span className="text-xs text-gray-400 whitespace-nowrap">{reminded.length} estudiante{reminded.length > 1 ? 's' : ''}</span>
                    </div>
                    {reminded.map((student) => {
                      const tag = reminderTypeLabel(student);
                      return (
                        <div key={student.userId}>
                          <div className="px-4 pt-2 pb-0">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tag.cls}`}>{tag.label}</span>
                          </div>
                          <StudentCard
                            student={student} courses={data.courses} ts={ts}
                            onSendReminder={handleSendReminder} sendingReminderId={sendingReminder} reminderSentIds={reminderSent}
                            onOpenChat={handleOpenChat} openingChatId={openingChat}
                            onGeneratePlan={handleGeneratePlan}
                            selectedCourseId={selectedCourseId || undefined}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {pending.length > 0 && (
                  <div className="space-y-2">
                    {reminded.length > 0 && (
                      <div className="flex items-center gap-3 pt-1">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Pendiente</span>
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-xs text-gray-400 whitespace-nowrap">{pending.length} estudiante{pending.length > 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {pending.map((student) => (
                      <StudentCard
                        key={student.userId} student={student} courses={data.courses} ts={ts}
                        onSendReminder={handleSendReminder} sendingReminderId={sendingReminder} reminderSentIds={reminderSent}
                        onOpenChat={handleOpenChat} openingChatId={openingChat}
                        onGeneratePlan={handleGeneratePlan}
                        selectedCourseId={selectedCourseId || undefined}
                      />
                    ))}
                  </div>
                )}
              </>
            );
          })()}
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
                        {(student.studentName ?? 'Sin nombre')[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-charcoal text-sm">{student.studentName ?? 'Sin nombre'}</p>
                          <PresenceBadge status={student.presenceStatus} />
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

      {planModal && (
        <StudyPlanModal
          student={planModal}
          onClose={() => setPlanModal(null)}
          onSuccess={() => setPlanModal(null)}
        />
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
