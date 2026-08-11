'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, ChevronDown, ChevronRight, Search, BookOpen, MessageSquare, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import { Input } from '@/components/ui/Input';
import type { Student, PresenceFilter } from './types';
import { formatReminderAge, formatLastSeen } from './helpers';
import { PresenceBadge } from './Badges';

export function AdminStudentList({
  courses,
  initialPresenceFilter,
}: {
  courses: { id: string; title: string; evaluatorName?: string }[];
  initialPresenceFilter?: PresenceFilter;
}) {
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
                        <PresenceBadge status={presenceMap[u.sub ?? u.username]?.presenceStatus} />
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
