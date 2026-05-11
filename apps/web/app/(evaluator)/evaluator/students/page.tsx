'use client';

import { useEffect, useState } from 'react';
import { Users, ChevronDown, ChevronRight, CheckCircle, Clock, XCircle, Lock, BookOpen, Search, Wifi, Activity, WifiOff } from 'lucide-react';
import { api } from '@/lib/api';
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

// ─── Main page ────────────────────────────────────────────────────────────────

type PresenceFilter = 'all' | 'online' | 'active' | 'inactive';

export default function StudentsPage() {
  const [data, setData] = useState<{ students: Student[]; courses: { id: string; title: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'students' | 'courses'>('students');
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>('all');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [expandedCourseStudents, setExpandedCourseStudents] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.evaluator.students().then((res) => {
      setData((res as any).data ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

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
