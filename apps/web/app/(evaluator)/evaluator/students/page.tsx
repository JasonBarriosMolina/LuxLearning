'use client';

import { useEffect, useState } from 'react';
import { Users, ChevronDown, ChevronRight, CheckCircle, Clock, XCircle, Lock, BookOpen, Search, Wifi, Activity, WifiOff, UserCheck, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Input } from '@/components/ui/Input';

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

type Student = { userId: string; studentName?: string; courses: CourseStat[]; lastSeen?: string | null; presenceStatus?: 'online' | 'active' | 'inactive' };

function PresenceBadge({ status }: { status?: string }) {
  if (status === 'online') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />En línea
    </span>
  );
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Activo
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />Inactivo
    </span>
  );
}

function formatLastSeen(lastSeen?: string | null): string {
  if (!lastSeen) return 'Nunca';
  const diff = Date.now() - new Date(lastSeen).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'Hace un momento';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

function ModuleStatusIcon({ mod }: { mod: ModuleStat }) {
  if (mod.reflectionStatus === 'APPROVED') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
  if (mod.reflectionStatus === 'PENDING_EVAL') return <Clock className="w-4 h-4 text-amber-500" />;
  if (mod.reflectionStatus === 'REJECTED') return <XCircle className="w-4 h-4 text-red-400" />;
  if (mod.completedLessons === 0) return <Lock className="w-4 h-4 text-gray-300" />;
  return <BookOpen className="w-4 h-4 text-cta-from" />;
}

function StudentCard({ student, courses }: { student: Student; courses: { id: string; title: string }[] }) {
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
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 p-4 hover:bg-surface transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-sm shrink-0">
          {(student.studentName ?? student.userId)[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-charcoal text-sm truncate">{student.studentName ?? student.userId}</p>
            <PresenceBadge status={student.presenceStatus} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{formatLastSeen(student.lastSeen)}</p>
          <div className="mt-1.5">
            <ProgressBar value={overallPct} size="sm" />
          </div>
        </div>
        {/* Quick stats */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-center hidden sm:block">
            <p className="font-bold text-lg text-charcoal">{overallPct}%</p>
            <p className="text-xs text-gray-400">Progreso</p>
          </div>
          <div className="text-center hidden sm:block">
            <p className="font-bold text-lg text-emerald-600">{totalApproved}</p>
            <p className="text-xs text-gray-400">Aprobados</p>
          </div>
          {totalPending > 0 && (
            <div className="text-center">
              <p className="font-bold text-lg text-amber-500">{totalPending}</p>
              <p className="text-xs text-gray-400">Pendientes</p>
            </div>
          )}
          <div className="text-center hidden md:block">
            <p className="font-bold text-lg text-charcoal">{totalModules}</p>
            <p className="text-xs text-gray-400">Módulos</p>
          </div>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

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
                      <p className="text-xs font-semibold text-gray-500 mb-1">PROGRESO DEL CURSO</p>
                      <ProgressBar
                        value={course.progressPct}
                        label={`${course.completedLessons} de ${course.totalLessons} lecciones`}
                        showPercent
                      />
                    </div>
                    <div className="flex gap-4 text-center shrink-0">
                      <div>
                        <p className="font-bold text-emerald-600">{course.modulesApproved}</p>
                        <p className="text-xs text-gray-400">Módulos<br/>completados</p>
                      </div>
                      <div>
                        <p className="font-bold text-charcoal">{course.modules.length}</p>
                        <p className="text-xs text-gray-400">Total<br/>módulos</p>
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
        <span className="text-xs text-gray-400">{courseStats.length} estudiantes</span>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Progreso promedio', value: `${avgProgress}%`, color: 'text-cta-from' },
          { label: 'Completaron curso', value: completed, color: 'text-emerald-600' },
          { label: 'Módulos aprobados', value: totalApproved, color: 'text-purple-600' },
          { label: 'Total módulos', value: totalModules, color: 'text-charcoal' },
        ].map((stat) => (
          <div key={stat.label} className="text-center p-2 bg-surface rounded-xl">
            <p className={`font-bold text-xl ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-400 mt-0.5 leading-tight">{stat.label}</p>
          </div>
        ))}
      </div>
      <ProgressBar value={avgProgress} label="Progreso promedio del curso" showPercent />
    </div>
  );
}

// ─── Admin view: all registered students (no activity required) ───────────────

function AdminStudentList({ courses }: { courses: { id: string; title: string; evaluatorName?: string }[] }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedCourses, setExpandedCourses] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<Record<string, string[]>>({});
  const [profileModal, setProfileModal] = useState<any | null>(null);

  useEffect(() => {
    api.admin.users.list().then((res) => {
      const all: any[] = (res as any).data ?? [];
      setUsers(all.filter((u) => u.role === 'STUDENT'));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

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
    return !q || (u.name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  if (loading) return (
    <div className="space-y-2">
      {[1, 2, 3].map((n) => <div key={n} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{users.length} estudiante{users.length !== 1 ? 's' : ''} registrado{users.length !== 1 ? 's' : ''}</p>
      </div>
      <Input
        placeholder="Buscar por nombre o email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        leftIcon={<Search className="w-4 h-4" />}
      />
      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No se encontraron estudiantes.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Nombre</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 hidden sm:table-cell">Fecha de registro</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Estado</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Cursos inscritos</th>
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
                          <p className="font-semibold text-charcoal truncate max-w-[180px]">{u.name || '(sin nombre)'}</p>
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
                        {u.enabled ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    {/* Cursos */}
                    <td className="px-4 py-3">
                      <div>
                        <button
                          onClick={() => toggleCourses(u.username)}
                          className="flex items-center gap-1.5 text-xs text-cta-from font-medium hover:underline"
                        >
                          {enrollments[u.username] === undefined ? (
                            <span className="text-gray-400">Ver cursos</span>
                          ) : (
                            <span>{enrolledCourses.length > 0 ? `${enrolledCourses.length} curso${enrolledCourses.length !== 1 ? 's' : ''}` : 'Sin cursos'}</span>
                          )}
                          {coursesOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                        {coursesOpen && (
                          <div className="mt-2 space-y-1 max-w-xs">
                            {enrolledCourses.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">Sin cursos asignados</p>
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
                      <button
                        onClick={(e) => openProfile(e, u)}
                        className="text-xs text-cta-from font-semibold hover:underline px-2 py-1 rounded-lg hover:bg-purple-50 transition-colors whitespace-nowrap"
                      >
                        Ver perfil
                      </button>
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
                <p className="font-heading font-bold text-lg text-charcoal truncate">{profileModal.name || '(sin nombre)'}</p>
                <p className="text-sm text-gray-400 truncate">{profileModal.email}</p>
              </div>
              <button onClick={() => setProfileModal(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-gray-500">Estado</span>
                <span className={`font-medium ${profileModal.enabled ? 'text-emerald-600' : 'text-red-500'}`}>
                  {profileModal.enabled ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-gray-500">Fecha de registro</span>
                <span className="font-medium text-charcoal">
                  {profileModal.createdAt ? new Date(profileModal.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                </span>
              </div>
              <div className="pt-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Cursos inscritos</p>
                {(profileModal.enrolledIds ?? []).length === 0 ? (
                  <p className="text-gray-400 italic text-xs">Sin cursos asignados</p>
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

export default function StudentsPage() {
  const { role } = useAuth();
  const [data, setData] = useState<{ students: Student[]; courses: { id: string; title: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'students' | 'courses'>('students');
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>('all');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [expandedCourseStudents, setExpandedCourseStudents] = useState<Set<string>>(new Set());
  const [adminCourses, setAdminCourses] = useState<{ id: string; title: string; evaluatorName?: string }[]>([]);

  useEffect(() => {
    if (role === 'ADMIN') {
      api.admin.courses.list().then((res) => {
        setAdminCourses(((res as any).data ?? []).map((c: any) => ({ id: c.id, title: c.title, evaluatorName: c.evaluatorName ?? undefined })));
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      api.evaluator.students().then((res) => {
        setData((res as any).data ?? null);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [role]);

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
  if (role === 'ADMIN') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <UserCheck className="w-6 h-6 text-cta-from" />
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">Estudiantes</h1>
            <p className="text-gray-500 mt-1 text-sm">Todos los estudiantes registrados en la plataforma</p>
          </div>
        </div>
        <AdminStudentList courses={adminCourses} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">Estudiantes</h1>
        <p className="text-gray-500 mt-1 text-sm">Progreso detallado por estudiante y curso</p>
      </div>

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
              {v === 'students' ? 'Por estudiante' : 'Por curso'}
            </button>
          ))}
        </div>

        {/* Presence filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            { key: 'all', label: 'Todos', count: allStudents.length, color: 'bg-gray-100 text-gray-600' },
            { key: 'online', label: '🟢 En línea', count: presenceCounts.online, color: 'bg-emerald-100 text-emerald-700' },
            { key: 'active', label: '🟡 Activos', count: presenceCounts.active, color: 'bg-amber-100 text-amber-700' },
            { key: 'inactive', label: '🔴 Inactivos', count: presenceCounts.inactive, color: 'bg-red-100 text-red-600' },
          ] as const).map((f) => (
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
          <p className="font-heading font-bold text-charcoal">Sin actividad todavía</p>
          <p className="text-gray-500 text-sm mt-1">Los estudiantes aparecerán aquí cuando comiencen los cursos.</p>
        </div>
      ) : view === 'students' ? (
        <div className="space-y-3">
          {/* Search bar */}
          <Input
            placeholder="Buscar estudiante..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
          {filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No se encontró ningún estudiante.</p>
          ) : (
            filtered.map((student) => (
              <StudentCard key={student.userId} student={student} courses={data.courses} />
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
              <option value="">— Todos los cursos —</option>
              {(data.courses ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>

          {/* Students in selected course */}
          {filteredCourseStudents.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No hay estudiantes en este filtro.</p>
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
                          <PresenceBadge status={student.presenceStatus} />
                        </div>
                        <p className="text-xs text-gray-400">{formatLastSeen(student.lastSeen)}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {student.courses.find((c) => c.courseId === selectedCourseId || !selectedCourseId) && (() => {
                          const course = student.courses.find((c) => selectedCourseId ? c.courseId === selectedCourseId : true);
                          if (!course) return null;
                          return (
                            <div className="text-center hidden sm:block">
                              <p className="font-bold text-sm text-charcoal">{course.progressPct}%</p>
                              <p className="text-xs text-gray-400">Progreso</p>
                            </div>
                          );
                        })()}
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border">
                        <StudentCard student={student} courses={data.courses} />
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
