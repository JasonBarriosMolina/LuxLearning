'use client';

import { X, Mail, BookOpen, CheckCircle, Clock } from 'lucide-react';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { Student } from './types';

interface Props {
  student: Student;
  onClose: () => void;
}

const PRESENCE_LABEL: Record<string, { label: string; color: string }> = {
  online:        { label: 'En línea',     color: 'bg-emerald-100 text-emerald-700' },
  recent:        { label: 'Reciente',     color: 'bg-blue-100 text-blue-700' },
  inactive:      { label: 'Inactivo',     color: 'bg-amber-100 text-amber-700' },
  never_active:  { label: 'Sin actividad', color: 'bg-gray-100 text-gray-500' },
};

export function StudentProfileModal({ student, onClose }: Props) {
  const name = student.studentName ?? 'Sin nombre';
  const initial = name[0]?.toUpperCase() ?? '?';
  const presence = PRESENCE_LABEL[student.presenceStatus] ?? PRESENCE_LABEL.never_active!;

  const totalModules = student.courses.reduce((s, c) => s + c.modules.length, 0);
  const approvedModules = student.courses.reduce((s, c) => s + c.modulesApproved, 0);
  const overallPct = student.courses.length > 0
    ? Math.round(student.courses.reduce((s, c) => s + c.progressPct, 0) / student.courses.length)
    : 0;
  const pendingReflections = student.courses.reduce(
    (s, c) => s + c.modules.filter((m) => m.reflectionStatus === 'PENDING_EVAL').length, 0
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#1A1A2E] rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-2xl shrink-0">
              {initial}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{name}</h2>
              {student.studentEmail && (
                <a
                  href={`mailto:${student.studentEmail}`}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#17527E] dark:hover:text-blue-300 transition-colors mt-0.5"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {student.studentEmail}
                </a>
              )}
              <span className={`inline-block mt-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${presence.color}`}>
                {presence.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 px-6 pb-4 shrink-0">
          <div className="text-center p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10">
            <p className="text-2xl font-bold text-[#17527E] dark:text-blue-300">{overallPct}%</p>
            <p className="text-xs text-gray-500 mt-0.5">Progreso</p>
          </div>
          <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-800/20">
            <p className="text-2xl font-bold text-emerald-600">{approvedModules}</p>
            <p className="text-xs text-gray-500 mt-0.5">Módulos aprobados</p>
          </div>
          <div className="text-center p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10">
            <p className="text-2xl font-bold text-gray-700 dark:text-gray-300">{totalModules}</p>
            <p className="text-xs text-gray-500 mt-0.5">Total módulos</p>
          </div>
        </div>

        {pendingReflections > 0 && (
          <div className="mx-6 mb-4 px-3 py-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-700/30 rounded-lg flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              <strong>{pendingReflections}</strong> reflexión{pendingReflections !== 1 ? 'es' : ''} pendiente{pendingReflections !== 1 ? 's' : ''} de evaluación
            </p>
          </div>
        )}

        {/* Course breakdown */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
          {student.courses.map((course) => {
            const pending = course.modules.filter((m) => m.reflectionStatus === 'PENDING_EVAL').length;
            return (
              <div key={course.courseId} className="border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-white/5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <BookOpen className="w-4 h-4 text-[#17527E] dark:text-blue-300 shrink-0" />
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{course.title}</p>
                  </div>
                  <span className="text-xs font-bold text-[#17527E] dark:text-blue-300 shrink-0">{course.progressPct}%</span>
                </div>
                <div className="px-4 pt-2 pb-1">
                  <ProgressBar
                    value={course.progressPct}
                    label={`${course.completedLessons}/${course.totalLessons} lecciones`}
                    size="sm"
                  />
                </div>
                <div className="px-4 py-3 space-y-1.5">
                  {course.modules.map((mod) => {
                    const modPct = mod.totalLessons > 0
                      ? Math.round((mod.completedLessons / mod.totalLessons) * 100)
                      : 0;
                    const statusColor = mod.reflectionStatus === 'APPROVED'
                      ? 'text-emerald-600'
                      : mod.reflectionStatus === 'PENDING_EVAL'
                        ? 'text-amber-600'
                        : mod.reflectionStatus === 'REJECTED'
                          ? 'text-red-500'
                          : 'text-gray-400';
                    return (
                      <div key={mod.moduleId} className="flex items-center gap-3 text-xs">
                        <CheckCircle className={`w-3.5 h-3.5 shrink-0 ${modPct === 100 ? 'text-emerald-500' : 'text-gray-200 dark:text-white/20'}`} />
                        <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">
                          {mod.order}. {mod.title}
                        </span>
                        <span className="shrink-0 text-gray-400">{mod.completedLessons}/{mod.totalLessons}</span>
                        {mod.reflectionStatus && (
                          <span className={`shrink-0 font-semibold ${statusColor}`}>
                            {mod.reflectionStatus === 'APPROVED' ? '✓'
                              : mod.reflectionStatus === 'PENDING_EVAL' ? '⏳'
                              : mod.reflectionStatus === 'REJECTED' ? '✗' : ''}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {pending > 0 && (
                  <div className="px-4 py-2 border-t border-gray-100 dark:border-white/5">
                    <p className="text-xs text-amber-600 font-medium">⏳ {pending} reflexión{pending !== 1 ? 'es' : ''} pendiente{pending !== 1 ? 's' : ''}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
