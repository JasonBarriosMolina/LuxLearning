'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare, ListTodo } from 'lucide-react';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { Student, SP } from './types';
import { formatReminderAge, formatLastSeen, riskLevel, getCurrentModule } from './helpers';
import { PresenceBadge, RiskBadge, ModuleStatusIcon } from './Badges';
import { ReminderHistory } from './ReminderHistory';

export function StudentCard({
  student, courses, ts, onSendReminder, sendingReminderId, reminderSentIds, onOpenChat, openingChatId, onGeneratePlan, planGeneratingId, selectedCourseId,
}: {
  student: Student;
  courses: { id: string; title: string }[];
  ts: SP;
  onSendReminder?: (student: Student) => void;
  sendingReminderId?: string | null;
  reminderSentIds?: Map<string, Date>;
  onOpenChat?: (student: Student) => void;
  openingChatId?: string | null;
  onGeneratePlan?: (student: Student) => void;
  planGeneratingId?: string | null;
  selectedCourseId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeCourse, setActiveCourse] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

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
          {(student.studentName ?? 'Sin nombre')[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-charcoal text-sm truncate">{student.studentName ?? 'Sin nombre'}</p>
            <PresenceBadge status={student.presenceStatus} />
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
            {(student.presenceStatus === 'inactive' || student.presenceStatus === 'never_active') && onSendReminder && (() => {
              // Optimistic update takes precedence; server data persists across refresh
              const optimistic = reminderSentIds?.get(student.userId);
              const serverSent = student.lastManualReminder?.lastSent;
              const sentAt: string | Date | undefined = optimistic ?? (serverSent ? serverSent : undefined);
              return (
                <div className="flex flex-col items-center gap-0.5">
                  <button
                    onClick={() => onSendReminder(student)}
                    disabled={sendingReminderId === student.userId || !!sentAt}
                    title={ts.sendReminderTitle2}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors ${
                      sentAt
                        ? 'bg-emerald-100 text-emerald-600 cursor-default'
                        : 'bg-red-100 text-red-600 hover:bg-red-200'
                    }`}
                  >
                    <span className="hidden sm:inline">{sentAt ? ts.reminderSent : ts.sendReminderBtn}</span>
                    <span className="sm:hidden">{sentAt ? '✓' : '🔔'}</span>
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
                className="flex items-center gap-1.5 text-xs font-semibold px-2 sm:px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Chat</span>
              </button>
            )}
            {onGeneratePlan && (
              <button
                onClick={() => onGeneratePlan(student)}
                disabled={planGeneratingId === student.userId}
                title="Generar plan de estudio semanal"
                className="flex items-center gap-1.5 text-xs font-semibold px-2 sm:px-2.5 py-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
              >
                <ListTodo className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Plan</span>
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

          {/* Reminder history section */}
          {(student.lastManualReminder || student.lastAutoReminder) && (
            <div className="border-t border-border">
              <button
                onClick={(e) => { e.stopPropagation(); setHistoryOpen((o) => !o); }}
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 hover:bg-surface transition-colors"
              >
                <span>Historial de recordatorios</span>
                {historyOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {historyOpen && (
                <div className="px-4 pb-3">
                  <ReminderHistory userId={student.userId} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
