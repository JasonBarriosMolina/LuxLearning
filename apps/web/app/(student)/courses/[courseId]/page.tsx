'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Lock, CheckCircle, ChevronRight, Trophy, Star, Download, BookOpen, User, UserCog, MessageSquare, Library, PlayCircle, FolderOpen, Link2, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge, ReflectionStatusBadge } from '@/components/ui/Badge';
import { cn, formatCourseDuration } from '@/lib/utils';
import type { Certificate } from '@lux/types';
import { useLanguage } from '@/lib/i18n';

export default function CoursePage() {
  const { t, lang } = useLanguage();
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<any>(null);
  const [cert, setCert] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatUnread, setChatUnread] = useState(0);
  const [contactingEvaluator, setContactingEvaluator] = useState(false);
  const [resources, setResources] = useState<any[]>([]);

  useEffect(() => {
    setLoading(true);
    api.courses.get(courseId).then((res) => {
      const c = (res as any).data;
      setCourse(c);
      setLoading(false);

      // Check completion from course data, then handle certificate
      const isComplete = (c?.modules?.length ?? 0) > 0 &&
        c.modules?.every((m: any) => m.reflectionStatus === 'APPROVED');

      api.certificates.mine().then((res: any) => {
        const certs: Certificate[] = res?.data ?? [];
        const found = certs.find((cert) => cert.courseId === courseId);
        if (found) {
          setCert(found);
        } else if (isComplete) {
          // Auto-generate only when all reflections are APPROVED
          api.certificates.generate(courseId)
            .then((r: any) => { if (r?.data) setCert(r.data); })
            .catch(() => {});
        }
      }).catch(() => {});

      // Load course resources
      api.courses.resources(courseId).then((res: any) => {
        setResources((res as any)?.data ?? []);
      }).catch(() => {});

      // Load chat unread count for group chat
      api.messages.chats.list().then((res: any) => {
        const chats: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        const groupChat = chats.find((ch: any) => ch.chatId === `group_${courseId}` || ch.sk === `group_${courseId}`);
        setChatUnread(groupChat?.unread ?? 0);
      }).catch(() => {});
    });
  }, [courseId, lang]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/2" />
        {[1, 2, 3].map((n) => <div key={n} className="card h-32" />)}
      </div>
    );
  }

  if (!course) return null;

  const allLessons = course.modules?.flatMap((m: any) =>
    (m.lessons ?? []).map((l: any) => ({ ...l, moduleId: m.id }))
  ) ?? [];
  const completedLessons = allLessons.filter((l: any) => l.completed).length;
  const overallProgress = allLessons.length > 0
    ? Math.round((completedLessons / allLessons.length) * 100)
    : 0;

  const isCourseComplete = (course.modules?.length ?? 0) > 0 &&
    course.modules?.every((m: any) => m.reflectionStatus === 'APPROVED');

  // "Continue where you left off" — respects module gate order:
  // lessons → quiz → reflection must all be complete before advancing to the next module.
  const continueUrl = (() => {
    for (const mod of (course.modules ?? [])) {
      const firstIncompleteLesson = (mod.lessons ?? []).find((l: any) => !l.completed);
      if (firstIncompleteLesson) {
        return `/courses/${courseId}/modules/${mod.id}/lessons/${firstIncompleteLesson.id}`;
      }
      if (!mod.quizPassed) {
        return `/courses/${courseId}/modules/${mod.id}`;
      }
      if (mod.reflectionStatus !== 'APPROVED') {
        return `/courses/${courseId}/modules/${mod.id}`;
      }
    }
    return null; // all modules complete
  })();

  const handleContactEvaluator = async () => {
    if (!course.evaluatorId) return;
    setContactingEvaluator(true);
    try {
      const res = await api.messages.chats.create({ type: 'DIRECT', targetUserId: course.evaluatorId });
      const chatId = (res as any)?.data?.chatId ?? (res as any)?.chatId;
      if (chatId) router.push(`/communications?chatId=${chatId}`);
    } catch { }
    finally { setContactingEvaluator(false); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <Link href="/courses" className="flex items-center gap-1 text-sm text-gray-500 hover:text-charcoal">
        <ArrowLeft className="w-4 h-4" /> {t.courseDetail.breadcrumb}
      </Link>

      {/* Course header */}
      <div className="rounded-2xl overflow-hidden h-48 shadow-card">
        {course.imageUrl
          ? <img src={course.imageUrl} alt={course.title} className="w-full h-full object-cover" />
          : (
            <div className="w-full h-full bg-cta-gradient flex items-center justify-center">
              <div className="text-center text-white">
                <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-80" />
                <p className="font-heading font-bold text-lg opacity-90">{course.title}</p>
              </div>
            </div>
          )
        }
      </div>

      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">{course.title}</h1>
            <p className="text-gray-500 mt-1 text-sm">{course.description}</p>
            {/* Creator / Evaluator */}
            {(course.createdByName || course.evaluatorName) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {course.createdByName && (
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <User className="w-3.5 h-3.5" />
                    {t.courseDetail.createdBy(course.createdByName)}
                  </span>
                )}
                {course.evaluatorName && course.evaluatorName !== course.createdByName && (
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <UserCog className="w-3.5 h-3.5" />
                    {t.courseDetail.evaluatorLabel(course.evaluatorName)}
                  </span>
                )}
              </div>
            )}
          </div>
          {course.isPilot && <Badge variant="info">{t.courseDetail.pilotBadge}</Badge>}
        </div>
        {/* Dates */}
        {(course.startDate || course.closeDate) && (
          <div className="flex flex-wrap gap-4 mt-3 mb-3">
            {course.startDate && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Clock className="w-3.5 h-3.5" />
                <span className="font-medium text-gray-600">{t.courseDetail.startDate(new Date(course.startDate).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-CO', { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
              </span>
            )}
            {course.closeDate && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                <span className="font-medium text-amber-600">{t.courseDetail.closeDate(new Date(course.closeDate).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-CO', { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
              </span>
            )}
          </div>
        )}
        <ProgressBar value={overallProgress} label={t.courseDetail.lessonsProgress(completedLessons, allLessons.length)} showPercent />
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        {/* Continue where left off */}
        {continueUrl && !isCourseComplete && (
          <Link
            href={continueUrl}
            className="flex-1 min-w-[180px] flex items-center justify-center gap-2 bg-cta-gradient text-white font-semibold text-sm px-5 py-3 rounded-xl hover:opacity-90 transition-opacity shadow-sm"
          >
            <PlayCircle className="w-4 h-4" />
            {t.courseDetail.continueBtn}
          </Link>
        )}

        {/* Chat del Curso */}
        <Link
          href={`/communications?chatId=group_${courseId}`}
          className="flex items-center gap-2 bg-white border border-border text-charcoal font-semibold text-sm px-4 py-3 rounded-xl hover:bg-surface transition-colors relative"
        >
          <MessageSquare className="w-4 h-4 text-cta-from" />
          {t.courseDetail.courseChat}
          {chatUnread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
              {chatUnread > 9 ? '9+' : chatUnread}
            </span>
          )}
        </Link>

        {/* Contactar Evaluador */}
        {course.evaluatorId ? (
          <button
            onClick={handleContactEvaluator}
            disabled={contactingEvaluator}
            className="flex items-center gap-2 bg-white border border-border text-charcoal font-semibold text-sm px-4 py-3 rounded-xl hover:bg-surface transition-colors disabled:opacity-60"
          >
            <UserCog className="w-4 h-4 text-purple-500" />
            {contactingEvaluator ? t.courseDetail.openingChat : t.courseDetail.contactEvaluator}
          </button>
        ) : (
          <div className="flex items-center gap-2 border border-border text-gray-400 font-medium text-sm px-4 py-3 rounded-xl bg-surface">
            <UserCog className="w-4 h-4" />
            {t.courseDetail.adminLabel}
          </div>
        )}

        {/* Recursos del curso */}
        {resources.length > 0 ? (
          <button
            onClick={() => document.getElementById('course-resources')?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center gap-2 border border-indigo-200 bg-indigo-50 text-indigo-700 font-medium text-sm px-4 py-3 rounded-xl hover:bg-indigo-100 transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            {t.courseDetail.resources(resources.length)}
          </button>
        ) : (
          <div className="relative flex items-center gap-2 border border-border text-gray-400 font-medium text-sm px-4 py-3 rounded-xl bg-surface cursor-not-allowed group" title={t.courseDetail.comingSoon}>
            <Library className="w-4 h-4" />
            {t.courseDetail.library}
            <span className="absolute -top-2 -right-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">{t.courseDetail.comingSoon}</span>
          </div>
        )}
      </div>

      {/* Resources section */}
      {resources.length > 0 && (
        <div id="course-resources" className="card p-5 space-y-3">
          <h3 className="font-heading font-bold text-base text-charcoal flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-indigo-500" /> {t.courseDetail.resourcesSection}
          </h3>
          <div className="space-y-2">
            {resources.map((r: any) => (
              <a
                key={r.resourceId}
                href={r.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-indigo-200 hover:bg-indigo-50/50 transition-colors"
              >
                <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-charcoal truncate">{r.title}</p>
                  {r.description && <p className="text-xs text-gray-500 truncate">{r.description}</p>}
                </div>
                <Link2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Course completion banner */}
      {isCourseComplete && (
        <div className="relative overflow-hidden rounded-2xl bg-cta-gradient p-6 text-white shadow-lg">
          <div className="absolute -top-6 -right-6 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
          <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
          <div className="relative flex items-start gap-4">
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
              <Trophy className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-heading font-bold text-xl">{t.courseDetail.courseComplete}</h2>
                <Star className="w-5 h-5 text-yellow-300 fill-yellow-300" />
              </div>
              <p className="text-white/80 text-sm mb-3">
                {t.courseDetail.courseCompleteMsg}
              </p>
              {cert && (
                <a
                  href={`/certificado/${cert.certId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-white text-purple-700 font-semibold text-sm px-4 py-2 rounded-xl hover:bg-yellow-50 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  {t.courseDetail.downloadCert}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Evaluation events / grades section */}
      {(course.evaluationEvents?.length ?? 0) > 0 && (
        <div className="card space-y-3">
          <h3 className="font-heading font-bold text-base text-charcoal flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" /> {t.courseGrades.title}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-2 font-semibold">{t.evaluatorSubmissions.student.replace('Estudiante', 'Evaluación').replace('Student', 'Evaluation')}</th>
                  <th className="text-center pb-2 font-semibold">{t.courseGrades.weight(0).replace('0%', '%')}</th>
                  <th className="text-center pb-2 font-semibold">{t.courseDetail.startDate('').replace(': ', '').trim() || 'Entrega'}</th>
                  <th className="text-right pb-2 font-semibold">{t.courseGrades.gradeValue(0).replace('0%', 'Nota')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(() => {
                  const allSubs = course.modules?.flatMap((m: any) => m.submissions ?? []) ?? [];
                  const gradedSubs = allSubs.filter((s: any) => s.status === 'graded');
                  const evidenceEventCount = course.evaluationEvents?.filter((e: any) => e.type === 'EVIDENCE').length ?? 0;
                  const avgGrade = evidenceEventCount === 1 && gradedSubs.length > 0
                    ? Math.round(gradedSubs.reduce((sum: number, s: any) => sum + (s.grade ?? 0), 0) / gradedSubs.length)
                    : null;
                  const typeColor: Record<string, string> = { QUIZ: 'bg-amber-100 text-amber-700', EVIDENCE: 'bg-orange-100 text-orange-700', INTERVIEW: 'bg-purple-100 text-purple-700', ATTENDANCE: 'bg-blue-100 text-blue-700' };
                  return course.evaluationEvents?.map((ev: any) => (
                    <tr key={ev.id} className="py-2">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-charcoal">{ev.name}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${typeColor[ev.type] ?? 'bg-gray-100 text-gray-600'}`}>{ev.type}</span>
                      </td>
                      <td className="py-2.5 text-center text-gray-600">{ev.weight}%</td>
                      <td className="py-2.5 text-center text-gray-500 text-xs">
                        {ev.dueDate ? new Date(ev.dueDate).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short' }) : '—'}
                      </td>
                      <td className="py-2.5 text-right">
                        {ev.type === 'EVIDENCE' && avgGrade !== null
                          ? <Badge variant="success">{t.courseGrades.gradeValue(avgGrade)}</Badge>
                          : <span className="text-xs text-gray-400">{t.courseGrades.pending}</span>
                        }
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modules */}
      <div className="space-y-3">
        <h2 className="font-heading font-bold text-xl text-charcoal">{t.courseDetail.modulesTitle}</h2>
        {course.modules?.map((mod: any) => {
          const modLessons = mod.lessons ?? [];
          const modCompleted = modLessons.filter((l: any) => l.completed).length;
          const modProgress = modLessons.length > 0 ? Math.round((modCompleted / modLessons.length) * 100) : 0;
          const isLocked = !mod.unlocked;
          const isDone = mod.reflectionStatus === 'APPROVED';

          return (
            <Link
              key={mod.id}
              href={isLocked ? '#' : `/courses/${courseId}/modules/${mod.id}`}
              className={cn(
                'card-hover flex items-center gap-4 p-5',
                isLocked && 'opacity-60 cursor-not-allowed hover:shadow-card'
              )}
            >
              {/* Order indicator */}
              <div className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center shrink-0 font-heading font-bold text-lg',
                isDone ? 'bg-emerald-100 text-emerald-600'
                  : mod.unlocked ? 'bg-cta-gradient text-white'
                  : 'bg-gray-100 text-gray-400'
              )}>
                {isDone ? <CheckCircle className="w-6 h-6" /> : isLocked ? <Lock className="w-5 h-5" /> : mod.order}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-semibold text-charcoal truncate">{mod.title}</p>
                  {mod.reflectionStatus && <ReflectionStatusBadge status={mod.reflectionStatus} />}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {formatCourseDuration(mod.duration)}
                  </span>
                  <span>{t.courseDetail.lessons(modLessons.length)}</span>
                </div>
                <ProgressBar value={modProgress} size="sm" />
              </div>

              {!isLocked && <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
