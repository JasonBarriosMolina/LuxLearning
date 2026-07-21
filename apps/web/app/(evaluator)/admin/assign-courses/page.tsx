'use client';

import { useEffect, useState } from 'react';
import {
  UserPlus, BookOpen, Search, CheckCircle, Loader2, ChevronRight, ChevronLeft,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/i18n';
import { useAuth } from '@/lib/hooks/useAuth';

type Student = { username: string; email: string; name: string; role: string; enabled: boolean };
type Course  = { id: string; title: string; isActive: boolean; modules?: any[] };

export default function AssignCoursesPage() {
  const { t } = useLanguage();
  const { role } = useAuth();
  const isEvaluator = role === 'EVALUATOR';
  const [mode, setMode] = useState<'by-course' | 'by-student'>('by-course');

  // Data
  const [courses, setCourses]   = useState<Course[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');

  // Group filter (evaluator only)
  const [myGroups, setMyGroups] = useState<{ id: string; name: string; color?: string }[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [groupMemberIds, setGroupMemberIds] = useState<Set<string> | null>(null);

  // By-course mode
  const [selectedCourseId, setSelectedCourseId]     = useState('');
  const [enrolledUsernames, setEnrolledUsernames]   = useState<Set<string>>(new Set());
  const [pendingCourse, setPendingCourse]           = useState<Set<string>>(new Set());
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);

  // By-student mode
  const [selectedUsername, setSelectedUsername]               = useState('');
  const [studentCourseIds, setStudentCourseIds]               = useState<Set<string>>(new Set());
  const [pendingStudent, setPendingStudent]                   = useState<Set<string>>(new Set());
  const [loadingStudentEnrollments, setLoadingStudentEnrollments] = useState(false);
  const [searchStudentPicker, setSearchStudentPicker]         = useState('');

  // Saving
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  // Search per column
  const [searchLeft, setSearchLeft]   = useState('');
  const [searchRight, setSearchRight] = useState('');

  // Selection per column (for button-based transfer)
  const [selectedLeft, setSelectedLeft]   = useState<Set<string>>(new Set());
  const [selectedRight, setSelectedRight] = useState<Set<string>>(new Set());

  // Drag state
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<'left' | 'right' | null>(null);
  const [dragOver, setDragOver] = useState<'left' | 'right' | null>(null);

  // ── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([api.admin.courses.list(), api.admin.users.list()])
      .then(([cRes, uRes]) => {
        setCourses(((cRes as any).data ?? []) as Course[]);
        setStudents(
          (((uRes as any).data ?? []) as Student[]).filter((u) => u.role === 'STUDENT' && u.enabled),
        );
        setLoading(false);
      })
      .catch((err: any) => { setLoadError(err.message ?? t.admin.loadError); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!isEvaluator) return;
    api.evaluator.groups.list().then((res: any) => {
      const list: any[] = Array.isArray(res) ? res : (res?.groups ?? []);
      setMyGroups(list.map((g: any) => ({ id: g.id, name: g.name, color: g.color })));
    }).catch(() => {});
  }, [isEvaluator]);

  useEffect(() => {
    if (!isEvaluator || selectedGroupId === 'all') { setGroupMemberIds(null); return; }
    api.evaluator.groups.members(selectedGroupId).then((res: any) => {
      const members: any[] = res.members ?? res ?? [];
      setGroupMemberIds(new Set(members.map((m: any) => m.userId)));
    }).catch(() => setGroupMemberIds(null));
  }, [isEvaluator, selectedGroupId]);

  useEffect(() => {
    if (!selectedCourseId) return;
    setLoadingEnrollments(true);
    setPendingCourse(new Set());
    setSelectedLeft(new Set());
    setSelectedRight(new Set());
    setSaved(false);
    const activeCourse = selectedCourseId;
    Promise.all(
      students.map(async (s) => {
        const res = await api.admin.users.getEnrollments(s.username).catch(() => ({ data: { courseIds: [] } }));
        const ids: string[] = (res as any).data?.courseIds ?? (res as any).courseIds ?? [];
        return { username: s.username, enrolled: ids.includes(activeCourse) };
      }),
    ).then((results) => {
      const enrolled = new Set(results.filter((r) => r.enrolled).map((r) => r.username));
      setEnrolledUsernames(enrolled);
      setPendingCourse(new Set(enrolled));
      setLoadingEnrollments(false);
    }).catch(() => setLoadingEnrollments(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourseId]);

  useEffect(() => {
    if (!selectedUsername) return;
    setLoadingStudentEnrollments(true);
    setPendingStudent(new Set());
    setSelectedLeft(new Set());
    setSelectedRight(new Set());
    setSaved(false);
    api.admin.users.getEnrollments(selectedUsername)
      .then((res) => {
        const ids: string[] = (res as any).data?.courseIds ?? (res as any).courseIds ?? [];
        setStudentCourseIds(new Set(ids));
        setPendingStudent(new Set(ids));
        setLoadingStudentEnrollments(false);
      })
      .catch(() => setLoadingStudentEnrollments(false));
  }, [selectedUsername]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSaveByCourse = async () => {
    if (!selectedCourseId) return;
    setSaving(true); setSaved(false);
    try {
      const toAdd    = [...pendingCourse].filter((u) => !enrolledUsernames.has(u));
      const toRemove = [...enrolledUsernames].filter((u) => !pendingCourse.has(u));
      await Promise.all([
        ...toAdd.map((u)    => api.admin.users.addEnrollment(u, selectedCourseId).catch(() => {})),
        ...toRemove.map((u) => api.admin.users.removeEnrollment(u, selectedCourseId).catch(() => {})),
      ]);
      setEnrolledUsernames(new Set(pendingCourse));
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  const handleSaveByStudent = async () => {
    if (!selectedUsername) return;
    setSaving(true); setSaved(false);
    try {
      const toAdd    = [...pendingStudent].filter((c) => !studentCourseIds.has(c));
      const toRemove = [...studentCourseIds].filter((c) => !pendingStudent.has(c));
      await Promise.all([
        ...toAdd.map((c)    => api.admin.users.addEnrollment(selectedUsername, c).catch(() => {})),
        ...toRemove.map((c) => api.admin.users.removeEnrollment(selectedUsername, c).catch(() => {})),
      ]);
      setStudentCourseIds(new Set(pendingStudent));
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  // ── Transfer helpers ──────────────────────────────────────────────────────

  const moveToRight = () => {
    if (mode === 'by-course') {
      setPendingCourse((prev) => { const n = new Set(prev); selectedLeft.forEach((id) => n.add(id)); return n; });
    } else {
      setPendingStudent((prev) => { const n = new Set(prev); selectedLeft.forEach((id) => n.add(id)); return n; });
    }
    setSelectedLeft(new Set()); setSaved(false);
  };

  const moveToLeft = () => {
    if (mode === 'by-course') {
      setPendingCourse((prev) => { const n = new Set(prev); selectedRight.forEach((id) => n.delete(id)); return n; });
    } else {
      setPendingStudent((prev) => { const n = new Set(prev); selectedRight.forEach((id) => n.delete(id)); return n; });
    }
    setSelectedRight(new Set()); setSaved(false);
  };

  const toggleLeft  = (id: string) => setSelectedLeft((p)  => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleRight = (id: string) => setSelectedRight((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Drag handlers ─────────────────────────────────────────────────────────

  const onDragStart = (id: string, from: 'left' | 'right') => { setDragItem(id); setDragFrom(from); };
  const onDragEnd   = () => { setDragItem(null); setDragFrom(null); setDragOver(null); };

  const onDropLeft = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(null);
    if (!dragItem || dragFrom !== 'right') return;
    if (mode === 'by-course') {
      setPendingCourse((p) => { const n = new Set(p); n.delete(dragItem); return n; });
    } else {
      setPendingStudent((p) => { const n = new Set(p); n.delete(dragItem); return n; });
    }
    setDragItem(null); setDragFrom(null); setSaved(false);
  };

  const onDropRight = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(null);
    if (!dragItem || dragFrom !== 'left') return;
    if (mode === 'by-course') {
      setPendingCourse((p) => { const n = new Set(p); n.add(dragItem); return n; });
    } else {
      setPendingStudent((p) => { const n = new Set(p); n.add(dragItem); return n; });
    }
    setDragItem(null); setDragFrom(null); setSaved(false);
  };

  // ── Derived lists ─────────────────────────────────────────────────────────

  const matchesSearch = (text: string, q: string) => !q || text.toLowerCase().includes(q.toLowerCase());

  const visibleStudents = isEvaluator && groupMemberIds !== null
    ? students.filter((s) => groupMemberIds.has(s.username))
    : students;

  const availableStudents = visibleStudents.filter((s) =>
    !pendingCourse.has(s.username) && matchesSearch(s.name || s.email, searchLeft),
  );
  const assignedStudents = visibleStudents.filter((s) =>
    pendingCourse.has(s.username) && matchesSearch(s.name || s.email, searchRight),
  );
  const availableCourses = courses.filter((c) =>
    !pendingStudent.has(c.id) && matchesSearch(c.title, searchLeft),
  );
  const assignedCourses = courses.filter((c) =>
    pendingStudent.has(c.id) && matchesSearch(c.title, searchRight),
  );

  const pickerStudents = students.filter((s) =>
    matchesSearch(s.name || s.email, searchStudentPicker),
  );

  const isLoadingContent = mode === 'by-course' ? loadingEnrollments : loadingStudentEnrollments;
  const showTransfer     = mode === 'by-course' ? !!selectedCourseId : !!selectedUsername;

  // ── Shared row components ─────────────────────────────────────────────────

  const StudentRow = ({
    s, side, isSelected, wasEnrolled,
  }: { s: Student; side: 'left' | 'right'; isSelected: boolean; wasEnrolled?: boolean }) => (
    <div
      draggable
      onDragStart={() => onDragStart(s.username, side)}
      onDragEnd={onDragEnd}
      onClick={() => side === 'left' ? toggleLeft(s.username) : toggleRight(s.username)}
      className={`flex items-center gap-2 p-2 rounded-lg cursor-grab active:cursor-grabbing select-none transition-colors ${
        isSelected
          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-300'
          : side === 'right' ? 'hover:bg-white dark:hover:bg-white/5' : 'hover:bg-surface'
      }`}
    >
      <div className="w-7 h-7 rounded-full bg-cta-gradient flex items-center justify-center text-white text-[10px] font-bold shrink-0">
        {(s.name || s.email)[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-charcoal truncate">{s.name || s.email}</p>
        <p className="text-[10px] text-gray-400 truncate">{s.email}</p>
      </div>
      {wasEnrolled && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
    </div>
  );

  const CourseRow = ({
    c, side, isSelected, wasEnrolled,
  }: { c: Course; side: 'left' | 'right'; isSelected: boolean; wasEnrolled?: boolean }) => (
    <div
      draggable
      onDragStart={() => onDragStart(c.id, side)}
      onDragEnd={onDragEnd}
      onClick={() => side === 'left' ? toggleLeft(c.id) : toggleRight(c.id)}
      className={`flex items-center gap-2 p-2 rounded-lg cursor-grab active:cursor-grabbing select-none transition-colors ${
        isSelected
          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-300'
          : side === 'right' ? 'hover:bg-white dark:hover:bg-white/5' : 'hover:bg-surface'
      }`}
    >
      <div className="w-7 h-7 rounded-xl bg-cta-gradient flex items-center justify-center shrink-0">
        <BookOpen className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-charcoal truncate">{c.title}</p>
        <p className="text-[10px] text-gray-400">{c.modules?.length ?? 0} módulos</p>
      </div>
      {wasEnrolled && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal flex items-center gap-2">
          <UserPlus className="w-6 h-6 text-cta-from" />
          {t.admin.assignCoursesTitle}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">{t.admin.assignCoursesSubtitle}</p>
      </div>

      {loadError && (
        <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {t.admin.loadError}: {loadError}
        </div>
      )}

      {/* Group filter — evaluator only, by-course mode */}
      {isEvaluator && mode === 'by-course' && myGroups.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400 flex-shrink-0">Filtrar por grupo:</span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedGroupId('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${selectedGroupId === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
            >
              Todos
            </button>
            {myGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${selectedGroupId === g.id ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
              >
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: g.color ?? '#17527E' }} />
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex bg-surface rounded-xl p-1 gap-1 w-fit">
        {([
          { key: 'by-course',  label: `📋 ${t.admin.byCourse}` },
          { key: 'by-student', label: `👤 ${t.admin.byStudent}` },
        ] as const).map((m) => (
          <button
            key={m.key}
            onClick={() => {
              setMode(m.key); setSaved(false);
              setSelectedLeft(new Set()); setSelectedRight(new Set());
              setSearchLeft(''); setSearchRight('');
            }}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === m.key ? 'bg-white shadow-sm text-charcoal' : 'text-gray-500 hover:text-charcoal'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-gray-300" />
        </div>
      ) : (
        <div className="space-y-4">

          {/* Selector card */}
          <div className="card">
            {mode === 'by-course' ? (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-charcoal">{t.admin.selectCourseLabel}</label>
                <select
                  value={selectedCourseId}
                  onChange={(e) => {
                    setSelectedCourseId(e.target.value);
                    setSearchLeft(''); setSearchRight('');
                  }}
                  className="input-field"
                >
                  <option value="">{t.admin.chooseCourse}</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}{c.isActive ? '' : ` ${t.admin.inactive}`}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-charcoal">{t.admin.selectStudentLabel}</label>
                {selectedUsername ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-900/20">
                    <div className="w-8 h-8 rounded-full bg-cta-gradient flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {(students.find((s) => s.username === selectedUsername)?.name || selectedUsername)[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-charcoal truncate">
                        {students.find((s) => s.username === selectedUsername)?.name || selectedUsername}
                      </p>
                    </div>
                    <button
                      onClick={() => { setSelectedUsername(''); setSearchStudentPicker(''); }}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder={t.admin.searchStudent}
                      value={searchStudentPicker}
                      onChange={(e) => setSearchStudentPicker(e.target.value)}
                      leftIcon={<Search className="w-4 h-4" />}
                    />
                    <div className="max-h-40 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
                      {pickerStudents.map((s) => (
                        <button
                          key={s.username}
                          onClick={() => { setSelectedUsername(s.username); setSearchStudentPicker(''); setSearchLeft(''); setSearchRight(''); }}
                          className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface transition-colors text-left"
                        >
                          <div className="w-7 h-7 rounded-full bg-cta-gradient flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                            {(s.name || s.email)[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-charcoal truncate">{s.name || s.email}</p>
                            <p className="text-xs text-gray-400 truncate">{s.email}</p>
                          </div>
                        </button>
                      ))}
                      {pickerStudents.length === 0 && (
                        <p className="text-center text-sm text-gray-400 py-4">{t.admin.noStudentsFound}</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Dual-column transfer list */}
          {showTransfer && (
            <div className="card">
              {isLoadingContent ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-300" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-[1fr_80px_1fr] gap-4 items-start">

                    {/* LEFT column — Available */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between h-6">
                        <p className="text-sm font-semibold text-charcoal">
                          Disponibles
                          <span className="ml-1.5 text-xs font-normal text-gray-400">
                            ({mode === 'by-course' ? availableStudents.length : availableCourses.length})
                          </span>
                        </p>
                        {selectedLeft.size > 0 && (
                          <span className="text-xs text-cta-from font-medium">{selectedLeft.size} selec.</span>
                        )}
                      </div>
                      <Input
                        placeholder="Buscar…"
                        value={searchLeft}
                        onChange={(e) => setSearchLeft(e.target.value)}
                        leftIcon={<Search className="w-3.5 h-3.5" />}
                      />
                      <div
                        onDragOver={(e) => { e.preventDefault(); setDragOver('left'); }}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={onDropLeft}
                        className={`h-72 overflow-y-auto space-y-1 border-2 border-dashed rounded-xl p-2 transition-colors ${
                          dragOver === 'left' && dragFrom === 'right'
                            ? 'border-red-300 bg-red-50/40 dark:bg-red-900/10'
                            : 'border-border'
                        }`}
                      >
                        {mode === 'by-course' ? (
                          availableStudents.length === 0 ? (
                            <p className="text-center text-xs text-gray-400 py-10">
                              {searchLeft ? 'Sin resultados' : 'Todos los estudiantes están asignados'}
                            </p>
                          ) : availableStudents.map((s) => (
                            <StudentRow
                              key={s.username} s={s} side="left"
                              isSelected={selectedLeft.has(s.username)}
                            />
                          ))
                        ) : (
                          availableCourses.length === 0 ? (
                            <p className="text-center text-xs text-gray-400 py-10">
                              {searchLeft ? 'Sin resultados' : 'Todos los cursos están asignados'}
                            </p>
                          ) : availableCourses.map((c) => (
                            <CourseRow
                              key={c.id} c={c} side="left"
                              isSelected={selectedLeft.has(c.id)}
                            />
                          ))
                        )}
                      </div>
                    </div>

                    {/* CENTER buttons */}
                    <div className="flex flex-col items-center justify-center gap-3 pt-14">
                      <button
                        onClick={moveToRight}
                        disabled={selectedLeft.size === 0}
                        title="Agregar seleccionados"
                        className="w-full flex items-center justify-center gap-1 px-2 py-2.5 rounded-xl bg-cta-gradient text-white text-xs font-semibold disabled:opacity-30 hover:opacity-90 transition-opacity shadow-sm"
                      >
                        Agregar <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={moveToLeft}
                        disabled={selectedRight.size === 0}
                        title="Quitar seleccionados"
                        className="w-full flex items-center justify-center gap-1 px-2 py-2.5 rounded-xl border border-border text-gray-500 text-xs font-semibold disabled:opacity-30 hover:bg-surface transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" /> Quitar
                      </button>
                    </div>

                    {/* RIGHT column — Assigned */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between h-6">
                        <p className="text-sm font-semibold text-charcoal">
                          Asignados
                          <span className="ml-1.5 text-xs font-normal text-gray-400">
                            ({mode === 'by-course' ? pendingCourse.size : pendingStudent.size})
                          </span>
                        </p>
                        {selectedRight.size > 0 && (
                          <span className="text-xs text-cta-from font-medium">{selectedRight.size} selec.</span>
                        )}
                      </div>
                      <Input
                        placeholder="Buscar…"
                        value={searchRight}
                        onChange={(e) => setSearchRight(e.target.value)}
                        leftIcon={<Search className="w-3.5 h-3.5" />}
                      />
                      <div
                        onDragOver={(e) => { e.preventDefault(); setDragOver('right'); }}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={onDropRight}
                        className={`h-72 overflow-y-auto space-y-1 border-2 border-dashed rounded-xl p-2 transition-colors ${
                          dragOver === 'right' && dragFrom === 'left'
                            ? 'border-emerald-400 bg-emerald-50/60 dark:bg-emerald-900/20'
                            : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/20 dark:bg-emerald-900/5'
                        }`}
                      >
                        {mode === 'by-course' ? (
                          assignedStudents.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400 py-4">
                              <UserPlus className="w-6 h-6" />
                              <p className="text-xs text-center">
                                {searchRight ? 'Sin resultados' : 'Arrastra aquí o selecciona y haz clic en Agregar'}
                              </p>
                            </div>
                          ) : assignedStudents.map((s) => (
                            <StudentRow
                              key={s.username} s={s} side="right"
                              isSelected={selectedRight.has(s.username)}
                              wasEnrolled={enrolledUsernames.has(s.username)}
                            />
                          ))
                        ) : (
                          assignedCourses.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400 py-4">
                              <BookOpen className="w-6 h-6" />
                              <p className="text-xs text-center">
                                {searchRight ? 'Sin resultados' : 'Arrastra aquí o selecciona y haz clic en Agregar'}
                              </p>
                            </div>
                          ) : assignedCourses.map((c) => (
                            <CourseRow
                              key={c.id} c={c} side="right"
                              isSelected={selectedRight.has(c.id)}
                              wasEnrolled={studentCourseIds.has(c.id)}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Save bar */}
                  <div className="flex items-center justify-between pt-4 mt-2 border-t border-border">
                    {saved ? (
                      <span className="text-sm text-emerald-600 flex items-center gap-1.5 font-medium">
                        <CheckCircle className="w-4 h-4" /> {t.admin.changesSaved}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">
                        Tip: haz clic para seleccionar, arrastra para mover uno a uno
                      </span>
                    )}
                    <Button
                      onClick={mode === 'by-course' ? handleSaveByCourse : handleSaveByStudent}
                      loading={saving}
                    >
                      {t.admin.saveChanges}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
