'use client';

import { useEffect, useState } from 'react';
import { UserPlus, BookOpen, Search, CheckCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

type Student = { username: string; email: string; name: string; role: string; enabled: boolean };
type Course = { id: string; title: string; isActive: boolean; modules?: any[] };

export default function AssignCoursesPage() {
  const [mode, setMode] = useState<'by-course' | 'by-student'>('by-course');

  // Data
  const [courses, setCourses] = useState<Course[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // By-course mode
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [enrolledUsernames, setEnrolledUsernames] = useState<Set<string>>(new Set());
  const [pendingCourse, setPendingCourse] = useState<Set<string>>(new Set());
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);

  // By-student mode
  const [selectedUsername, setSelectedUsername] = useState('');
  const [studentCourseIds, setStudentCourseIds] = useState<Set<string>>(new Set());
  const [pendingStudent, setPendingStudent] = useState<Set<string>>(new Set());
  const [loadingStudentEnrollments, setLoadingStudentEnrollments] = useState(false);

  // Saving
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Search
  const [searchStudent, setSearchStudent] = useState('');
  const [searchCourse, setSearchCourse] = useState('');

  useEffect(() => {
    Promise.all([
      api.admin.courses.list(),
      api.admin.users.list(),
    ]).then(([cRes, uRes]) => {
      const allCourses = ((cRes as any).data ?? []) as Course[];
      const allUsers = ((uRes as any).data ?? []) as Student[];
      setCourses(allCourses);
      setStudents(allUsers.filter((u) => u.role === 'STUDENT' && u.enabled));
      setLoading(false);
    }).catch((err: any) => { setLoadError(err.message ?? 'Error al cargar datos'); setLoading(false); });
  }, []);

  // Load enrollments when a course is selected
  useEffect(() => {
    if (!selectedCourseId) return;
    setLoadingEnrollments(true);
    setPendingCourse(new Set());
    setSaved(false);

    // For each student, check if they're enrolled
    const activeCourse = selectedCourseId;
    // Scan all students' enrollments for this course
    Promise.all(
      students.map(async (s) => {
        const res = await api.admin.users.getEnrollments(s.username).catch(() => ({ data: { courseIds: [] } }));
        const courseIds: string[] = (res as any).data?.courseIds ?? (res as any).courseIds ?? [];
        return { username: s.username, enrolled: courseIds.includes(activeCourse) };
      })
    ).then((results) => {
      const enrolled = new Set(results.filter((r) => r.enrolled).map((r) => r.username));
      setEnrolledUsernames(enrolled);
      setPendingCourse(new Set(enrolled)); // start with current state
      setLoadingEnrollments(false);
    }).catch(() => setLoadingEnrollments(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourseId]);

  // Load enrollments when a student is selected
  useEffect(() => {
    if (!selectedUsername) return;
    setLoadingStudentEnrollments(true);
    setPendingStudent(new Set());
    setSaved(false);

    api.admin.users.getEnrollments(selectedUsername)
      .then((res) => {
        const courseIds: string[] = (res as any).data?.courseIds ?? (res as any).courseIds ?? [];
        setStudentCourseIds(new Set(courseIds));
        setPendingStudent(new Set(courseIds));
        setLoadingStudentEnrollments(false);
      })
      .catch(() => setLoadingStudentEnrollments(false));
  }, [selectedUsername]);

  const handleSaveByCourse = async () => {
    if (!selectedCourseId) return;
    setSaving(true);
    setSaved(false);
    try {
      const toAdd = [...pendingCourse].filter((u) => !enrolledUsernames.has(u));
      const toRemove = [...enrolledUsernames].filter((u) => !pendingCourse.has(u));
      await Promise.all([
        ...toAdd.map((u) => api.admin.users.addEnrollment(u, selectedCourseId).catch(() => {})),
        ...toRemove.map((u) => api.admin.users.removeEnrollment(u, selectedCourseId).catch(() => {})),
      ]);
      setEnrolledUsernames(new Set(pendingCourse));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveByStudent = async () => {
    if (!selectedUsername) return;
    setSaving(true);
    setSaved(false);
    try {
      const toAdd = [...pendingStudent].filter((c) => !studentCourseIds.has(c));
      const toRemove = [...studentCourseIds].filter((c) => !pendingStudent.has(c));
      await Promise.all([
        ...toAdd.map((c) => api.admin.users.addEnrollment(selectedUsername, c).catch(() => {})),
        ...toRemove.map((c) => api.admin.users.removeEnrollment(selectedUsername, c).catch(() => {})),
      ]);
      setStudentCourseIds(new Set(pendingStudent));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const filteredStudents = students.filter((s) => {
    const q = searchStudent.toLowerCase();
    return !q || (s.name || s.email).toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
  });

  const filteredCourses = courses.filter((c) => {
    const q = searchCourse.toLowerCase();
    return !q || c.title.toLowerCase().includes(q);
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal flex items-center gap-2">
          <UserPlus className="w-6 h-6 text-cta-from" />
          Asignar Cursos
        </h1>
        <p className="text-gray-500 mt-1 text-sm">Inscribe estudiantes a cursos de forma individual o masiva</p>
      </div>

      {loadError && (
        <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          Error al cargar datos: {loadError}
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex bg-surface rounded-xl p-1 gap-1 w-fit">
        {([
          { key: 'by-course', label: '📋 Por Curso' },
          { key: 'by-student', label: '👤 Por Estudiante' },
        ] as const).map((m) => (
          <button
            key={m.key}
            onClick={() => { setMode(m.key); setSaved(false); }}
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
      ) : mode === 'by-course' ? (
        /* ── BY COURSE ── */
        <div className="space-y-4">
          <div className="card space-y-3">
            <label className="text-sm font-semibold text-charcoal">Selecciona un curso</label>
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="input-field"
            >
              <option value="">— Elige un curso —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}{c.isActive ? '' : ' (inactivo)'}</option>
              ))}
            </select>
          </div>

          {selectedCourseId && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-charcoal">
                  Estudiantes ({pendingCourse.size} inscritos)
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingCourse(new Set(students.map((s) => s.username)))}
                    className="text-xs text-cta-from font-medium hover:opacity-70"
                  >
                    Todos
                  </button>
                  <span className="text-xs text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => setPendingCourse(new Set())}
                    className="text-xs text-gray-400 font-medium hover:opacity-70"
                  >
                    Ninguno
                  </button>
                </div>
              </div>

              <Input
                placeholder="Buscar estudiante..."
                value={searchStudent}
                onChange={(e) => setSearchStudent(e.target.value)}
                leftIcon={<Search className="w-4 h-4" />}
              />

              {loadingEnrollments ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
                  {filteredStudents.map((s) => {
                    const checked = pendingCourse.has(s.username);
                    const wasEnrolled = enrolledUsernames.has(s.username);
                    return (
                      <label key={s.username} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setPendingCourse((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(s.username); else next.add(s.username);
                            return next;
                          })}
                          className="w-4 h-4 accent-cta-from"
                        />
                        <div className="w-8 h-8 rounded-full bg-cta-gradient flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {(s.name || s.email)[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-charcoal truncate">{s.name || s.email}</p>
                          <p className="text-xs text-gray-400 truncate">{s.email}</p>
                        </div>
                        {wasEnrolled && (
                          <span className="text-xs bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full font-medium shrink-0">Inscrito</span>
                        )}
                      </label>
                    );
                  })}
                  {filteredStudents.length === 0 && (
                    <p className="text-center text-sm text-gray-400 py-6">No se encontraron estudiantes</p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                {saved ? (
                  <span className="text-sm text-emerald-600 flex items-center gap-1.5 font-medium">
                    <CheckCircle className="w-4 h-4" /> Cambios guardados
                  </span>
                ) : <span />}
                <Button onClick={handleSaveByCourse} loading={saving}>
                  Guardar cambios
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── BY STUDENT ── */
        <div className="space-y-4">
          <div className="card space-y-3">
            <label className="text-sm font-semibold text-charcoal">Selecciona un estudiante</label>
            <Input
              placeholder="Buscar estudiante..."
              value={searchStudent}
              onChange={(e) => setSearchStudent(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
            />
            <div className="max-h-48 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
              {filteredStudents.map((s) => (
                <button
                  key={s.username}
                  onClick={() => setSelectedUsername(s.username)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors text-left ${
                    selectedUsername === s.username
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-surface'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-cta-gradient flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {(s.name || s.email)[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-charcoal truncate">{s.name || s.email}</p>
                    <p className="text-xs text-gray-400 truncate">{s.email}</p>
                  </div>
                  {selectedUsername === s.username && <CheckCircle className="w-4 h-4 text-cta-from shrink-0" />}
                </button>
              ))}
              {filteredStudents.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-4">No se encontraron estudiantes</p>
              )}
            </div>
          </div>

          {selectedUsername && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-charcoal">
                  Cursos ({pendingStudent.size} asignados)
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingStudent(new Set(courses.map((c) => c.id)))}
                    className="text-xs text-cta-from font-medium hover:opacity-70"
                  >
                    Todos
                  </button>
                  <span className="text-xs text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => setPendingStudent(new Set())}
                    className="text-xs text-gray-400 font-medium hover:opacity-70"
                  >
                    Ninguno
                  </button>
                </div>
              </div>

              <Input
                placeholder="Buscar curso..."
                value={searchCourse}
                onChange={(e) => setSearchCourse(e.target.value)}
                leftIcon={<Search className="w-4 h-4" />}
              />

              {loadingStudentEnrollments ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
                  {filteredCourses.map((c) => {
                    const checked = pendingStudent.has(c.id);
                    const wasEnrolled = studentCourseIds.has(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setPendingStudent((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(c.id); else next.add(c.id);
                            return next;
                          })}
                          className="w-4 h-4 accent-cta-from"
                        />
                        <div className="w-8 h-8 rounded-xl bg-cta-gradient flex items-center justify-center shrink-0">
                          <BookOpen className="w-4 h-4 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-charcoal truncate">{c.title}</p>
                          <p className="text-xs text-gray-400">{c.modules?.length ?? 0} módulos</p>
                        </div>
                        {wasEnrolled && (
                          <span className="text-xs bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full font-medium shrink-0">Inscrito</span>
                        )}
                      </label>
                    );
                  })}
                  {filteredCourses.length === 0 && (
                    <p className="text-center text-sm text-gray-400 py-4">No hay cursos activos</p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                {saved ? (
                  <span className="text-sm text-emerald-600 flex items-center gap-1.5 font-medium">
                    <CheckCircle className="w-4 h-4" /> Cambios guardados
                  </span>
                ) : <span />}
                <Button onClick={handleSaveByStudent} loading={saving}>
                  Guardar cambios
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
