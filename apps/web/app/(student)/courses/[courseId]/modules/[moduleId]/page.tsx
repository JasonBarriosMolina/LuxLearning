'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, PlayCircle, CheckCircle, Lock, Clock,
  BookOpen, ClipboardCheck, FileText, Star, Mic,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge, ReflectionStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { VoiceInterview } from '@/components/ui/VoiceInterview';
import { LuxMentorClass } from '@/components/ui/LuxMentorClass';
import { EvidenceCard } from '@/components/ui/EvidenceCard';
import { formatCourseDuration } from '@/lib/utils';
import type { ReflectionStatus } from '@lux/types';
import { useLanguage } from '@/lib/i18n';

export default function ModulePage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const { t, lang } = useLanguage();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [interviews, setInterviews] = useState<any[]>([]);
  const [classSessions, setClassSessions] = useState<any[]>([]);

  const loadInterviews = useCallback(async () => {
    try {
      const res = await api.interviews.list(moduleId);
      setInterviews((res as any).data ?? []);
    } catch {}
  }, [moduleId]);

  const loadClassSessions = useCallback(async () => {
    try {
      const res = await api.classes.list(moduleId);
      setClassSessions((res as any).data ?? []);
    } catch {}
  }, [moduleId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.courses.get(courseId),
      api.lessons.favorites(),
      api.interviews.list(moduleId).catch(() => ({ data: [] })),
      api.classes.list(moduleId).catch(() => ({ data: [] })),
    ]).then(([courseRes, favRes, intRes, classRes]) => {
      setCourse((courseRes as any).data);
      const favs: any[] = (favRes as any).data ?? [];
      setFavIds(new Set(favs.filter((f: any) => f?.type === 'lesson').map((f: any) => f?.id)));
      setInterviews((intRes as any).data ?? []);
      setClassSessions((classRes as any).data ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [courseId, moduleId, lang]);

  const toggleLessonFav = async (e: React.MouseEvent, lesson: any) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await api.lessons.toggleFavorite({ type: 'lesson', id: lesson.id, title: lesson.title, courseId, moduleId });
      const added = (res as any).data?.added ?? false;
      setFavIds((prev) => {
        const next = new Set(prev);
        added ? next.add(lesson.id) : next.delete(lesson.id);
        return next;
      });
    } catch {}
  };

  const module = course?.modules?.find((m: any) => m.id === moduleId);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/2" />
        <div className="h-4 bg-gray-100 rounded w-full" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="card h-16" />
          ))}
        </div>
      </div>
    );
  }

  if (!module) {
    return (
      <div className="max-w-3xl mx-auto card text-center py-16">
        <p className="font-heading font-bold text-xl text-charcoal">{t.moduleView.moduleNotFound}</p>
      </div>
    );
  }

  // Gate: module is locked until previous module's reflection is approved
  if (module.unlocked === false) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-fade-in">
        <Link href={`/courses/${courseId}`} className="flex items-center gap-1 text-sm text-gray-500 hover:text-charcoal">
          <ArrowLeft className="w-4 h-4" /> {course.title}
        </Link>
        <div className="card text-center py-16 space-y-4">
          <Lock className="w-12 h-12 text-gray-300 mx-auto" />
          <div>
            <p className="font-heading font-bold text-xl text-charcoal">{module.title}</p>
            <p className="text-sm text-gray-500 mt-2">{t.moduleView.lockedHint}</p>
          </div>
          <Link href={`/courses/${courseId}`} className="btn-secondary inline-flex items-center gap-2 mt-2">
            <ArrowLeft className="w-4 h-4" /> {t.moduleView.backToCourse}
          </Link>
        </div>
      </div>
    );
  }

  const completedLessons = module.lessons?.filter((l: any) => l.completed) ?? [];
  const totalLessons = module.lessons?.length ?? 0;
  const allLessonsDone = completedLessons.length === totalLessons;
  const progress = totalLessons > 0 ? Math.round((completedLessons.length / totalLessons) * 100) : 0;

  const reflectionStatus = module.reflectionStatus as ReflectionStatus | null;

  // Per-module planned flags — each feature only appears/gates when the evaluator
  // explicitly assigned it in Lux Planner (quizWeek/reflexWeek/interviewWeek selectors,
  // luxMentorWeeks checkboxes). Trello DmPpbrff comment 6a9269e2: "yo le seleccioné a ese
  // módulo un quiz y una clase... sin embargo el sistema asignó una reflexión y una
  // entrevista" — none of these used to be conditional on anything.
  const evEvents = course?.evaluationEvents ?? [];
  const hasClassPlanned = evEvents.some((e: any) => e.type === 'CLASS' && e.moduleId === moduleId);
  const hasQuizPlanned = evEvents.some((e: any) => e.type === 'QUIZ' && e.moduleId === moduleId);
  const hasReflectionPlanned = evEvents.some((e: any) => e.type === 'REFLECTION' && e.moduleId === moduleId);
  const hasInterviewPlanned = evEvents.some((e: any) => e.type === 'INTERVIEW' && e.moduleId === moduleId);

  const classCompleted = classSessions.some((s: any) => s.hasCompletedQA || s.status === 'completed');

  // Strict unlock chain requested (Trello DmPpbrff comments 6a9269e2, and the follow-up
  // 2026-08-30 clarifying the full hierarchy): Lecciones escritas → Clase Lux Mentor →
  // Quiz → Reflexión del módulo → Entrevista — only counting the steps actually planned
  // for THIS module; an unplanned step is skipped, not required.
  //
  // blockingStep names WHICH step is actually holding things up, so the UI can say the
  // right thing. Before this, the reflection card always said "aprueba el quiz primero"
  // even on modules with no quiz at all whose real blocker was the class — the gate
  // itself was correct (class before reflection, as requested), but the message lied
  // about why (Mack: "dice que me falta el quiz, pero no hay ningún quiz asociado").
  const blockingStep: 'lessons' | 'class' | 'quiz' | null =
    !allLessonsDone ? 'lessons'
    : (hasClassPlanned && !classCompleted) ? 'class'
    : (hasQuizPlanned && !module.quizPassed) ? 'quiz'
    : null;
  const quizGatePassed = blockingStep === null;
  const reflectionApproved = reflectionStatus === 'APPROVED';
  // interviewGate: passing the (possible) reflection step unlocks the (possible) interview.
  const interviewGate = hasReflectionPlanned ? reflectionApproved : quizGatePassed;

  const getModuleStatus = () => {
    if (reflectionStatus === 'APPROVED') return { label: t.moduleView.statusCompleted, variant: 'success' as const };
    if (reflectionStatus === 'PENDING_EVAL') return { label: t.moduleView.statusInReview, variant: 'pending' as const };
    if (reflectionStatus === 'PENDING_AI') return { label: t.moduleView.reflectionStatusPendingAi, variant: 'info' as const };
    if (reflectionStatus === 'REJECTED') return { label: t.moduleView.reflectionStatusRejected, variant: 'error' as const };
    if (blockingStep === 'lessons') return { label: t.moduleView.statusPendingLessons, variant: 'default' as const };
    if (blockingStep === 'class') return { label: t.moduleView.statusPendingClass, variant: 'default' as const };
    if (blockingStep === 'quiz') return { label: t.moduleView.statusPendingQuiz, variant: 'default' as const };
    // blockingStep === null — every planned prerequisite cleared
    if (hasReflectionPlanned) return { label: t.moduleView.statusPendingReflection, variant: 'warning' as const };
    return { label: t.moduleView.statusCompleted, variant: 'success' as const };
  };

  const status = getModuleStatus();

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/courses/${courseId}`} className="hover:text-charcoal flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> {course.title}
        </Link>
        <span>/</span>
        <span className="text-charcoal font-medium">{module.title}</span>
      </div>

      {/* Module header */}
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-400 font-semibold mb-1">{t.moduleView.moduleN(module.order)}</p>
            <h1 className="font-heading font-bold text-2xl text-charcoal">{module.title}</h1>
            <p className="text-gray-500 mt-1 text-sm">{module.description}</p>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>

        <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" /> {formatCourseDuration(module.duration)}
          </span>
          <span className="flex items-center gap-1">
            <BookOpen className="w-4 h-4" /> {totalLessons} {t.moduleView.lessons}
          </span>
          <span className="flex items-center gap-1">
            <ClipboardCheck className="w-4 h-4" /> {t.moduleView.minScore(module.passingScore)}
          </span>
        </div>

        <ProgressBar value={progress} label={t.moduleView.lessonsOf(completedLessons.length, totalLessons)} showPercent />
      </div>

      {/* Lessons */}
      <div className="space-y-2">
        <h2 className="font-heading font-semibold text-lg text-charcoal px-1">{t.moduleView.lessonsTitle}</h2>
        {module.lessons?.map((lesson: any) => {
          const fav = favIds.has(lesson.id);
          return (
            <Link
              key={lesson.id}
              href={`/courses/${courseId}/modules/${moduleId}/lessons/${lesson.id}`}
              className="card-hover flex items-center gap-4 p-4"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                lesson.completed ? 'bg-emerald-100' : 'bg-surface'
              }`}>
                {lesson.completed ? (
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                ) : (
                  <PlayCircle className="w-5 h-5 text-cta-from" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-charcoal text-sm truncate">
                  {lesson.order}. {lesson.title}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{formatCourseDuration(lesson.duration)}</p>
              </div>
              {lesson.completed && (
                <span className="text-xs text-emerald-600 font-semibold shrink-0">{t.moduleView.lessonCompleted}</span>
              )}
              <button
                onClick={(e) => toggleLessonFav(e, lesson)}
                title={fav ? t.moduleView.unfavorite : t.moduleView.favorite}
                className={`shrink-0 p-1.5 rounded-lg transition-colors ${
                  fav ? 'text-amber-500' : 'text-gray-200 hover:text-amber-400'
                }`}
              >
                <Star className={`w-4 h-4 ${fav ? 'fill-amber-500' : ''}`} />
              </button>
            </Link>
          );
        })}
      </div>

      {/* Quiz CTA — only rendered when a quiz was actually planned for this module
          (Trello DmPpbrff comment 6a9232ef: was showing "complete lessons first" +
          lock icon even for modules where no quiz was ever configured). */}
      {hasQuizPlanned && (
      <div className={`card ${!allLessonsDone ? 'opacity-60' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              module.quizPassed ? 'bg-emerald-100' : allLessonsDone ? 'bg-amber-100' : 'bg-gray-100'
            }`}>
              {module.quizPassed ? (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              ) : (
                <ClipboardCheck className={`w-5 h-5 ${allLessonsDone ? 'text-amber-600' : 'text-gray-400'}`} />
              )}
            </div>
            <div>
              <p className="font-semibold text-charcoal text-sm">{t.moduleView.quizTitle}</p>
              <p className="text-xs text-gray-500">
                {module.quizPassed
                  ? t.moduleView.quizPassed
                  : allLessonsDone
                  ? t.moduleView.quizAvailable
                  : t.moduleView.quizLocked}
              </p>
            </div>
          </div>
          {allLessonsDone && !module.quizPassed && (
            <Link href={`/courses/${courseId}/modules/${moduleId}/quiz`}>
              <Button size="sm">{t.moduleView.takeQuiz}</Button>
            </Link>
          )}
          {module.quizPassed && (
            <Badge variant="success">{t.moduleView.quizPassed}</Badge>
          )}
          {!allLessonsDone && <Lock className="w-5 h-5 text-gray-300" />}
        </div>
      </div>
      )}

      {/* Reflection CTA — gated on quizGatePassed, NOT raw module.quizPassed: a module
          with no quiz planned can never have quizPassed===true, which used to lock
          reflection forever. quizGatePassed falls back to allLessonsDone when no quiz
          was planned. Trello DmPpbrff comment 6a9232ef.
          Only rendered at all when reflection was actually planned for this module —
          was unconditional before (Trello DmPpbrff comment 6a9269e2). */}
      {hasReflectionPlanned && (
      <div className={`card ${!quizGatePassed ? 'opacity-60' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              reflectionStatus === 'APPROVED' ? 'bg-emerald-100'
                : reflectionStatus ? 'bg-purple-100'
                : quizGatePassed ? 'bg-blue-100'
                : 'bg-gray-100'
            }`}>
              {reflectionStatus === 'APPROVED' ? (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              ) : (
                <FileText className={`w-5 h-5 ${quizGatePassed ? 'text-blue-600' : 'text-gray-400'}`} />
              )}
            </div>
            <div>
              <p className="font-semibold text-charcoal text-sm">{t.moduleView.reflectionTitle}</p>
              <p className="text-xs text-gray-500">
                {reflectionStatus
                  ? { PENDING_AI: t.moduleView.reflectionPendingAi, PENDING_EVAL: t.moduleView.reflectionPendingEval, APPROVED: t.moduleView.reflectionApproved, REJECTED: t.moduleView.reflectionRejected }[reflectionStatus]
                  : quizGatePassed
                  ? t.moduleView.writeReflectionHint
                  : blockingStep === 'lessons'
                  ? t.moduleView.finishLessonsFirst
                  : blockingStep === 'class'
                  ? t.moduleView.finishClassFirst
                  : t.moduleView.passQuizFirst}
              </p>
            </div>
          </div>
          {quizGatePassed && (!reflectionStatus || reflectionStatus === 'REJECTED') && (
            <Link href={`/courses/${courseId}/modules/${moduleId}/reflection`}>
              <Button size="sm" variant={reflectionStatus === 'REJECTED' ? 'secondary' : 'primary'}>
                {reflectionStatus === 'REJECTED' ? t.moduleView.rewrite : t.moduleView.write}
              </Button>
            </Link>
          )}
          {reflectionStatus && reflectionStatus !== 'REJECTED' && (
            <ReflectionStatusBadge status={reflectionStatus} />
          )}
          {!quizGatePassed && <Lock className="w-5 h-5 text-gray-300" />}
        </div>
      </div>
      )}

      {/* Evidence submissions — one card per EVIDENCE eval event linked to this module */}
      {course?.evaluationEvents
        ?.filter((e: any) => e.type === 'EVIDENCE' && e.moduleId === moduleId)
        .map((e: any) => (
          <EvidenceCard
            key={e.id}
            courseId={courseId}
            moduleId={moduleId}
            evalName={e.name}
            instructions={e.instructions}
          />
        ))}

      {/* Interview with Lux Mentor — shown ONLY when planned for THIS exact module and
          only unlocked once the prior planned steps clear (lessons → class → quiz →
          reflection approved → interview). Was showing on EVERY module whenever ANY
          interview existed anywhere in the course (no moduleId check at all), and with
          no lock/order at all — Trello DmPpbrff comment 6a9269e2. */}
      {hasInterviewPlanned && (
        interviewGate ? (
          <VoiceInterview
            courseId={courseId}
            moduleId={moduleId}
            interviews={interviews}
            onCompleted={loadInterviews}
          />
        ) : (
          <div className="card opacity-60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-100">
                  <Mic className="w-5 h-5 text-gray-400" />
                </div>
                <div>
                  <p className="font-semibold text-charcoal text-sm">{t.moduleView.interviewLuxMentor}</p>
                  <p className="text-xs text-gray-500">{t.moduleView.interviewLockedHint}</p>
                </div>
              </div>
              <Lock className="w-5 h-5 text-gray-300" />
            </div>
          </div>
        )
      )}

      {/* Lux Mentor Class — shown ONLY when a CLASS evaluation event is tied to THIS exact
          module. The old `|| !e.moduleId` fallback made a course-wide class (moduleId=null,
          e.g. one created manually with no module chosen) appear on EVERY module page — not
          just modules explicitly planned to have one. Trello DmPpbrff comment 6a9232ef.
          Also now gated on allLessonsDone — first step in Mack's requested order (lessons →
          class → quiz → reflection → interview), comment 6a9269e2. */}
      {hasClassPlanned && !allLessonsDone && (
        <div className="card opacity-60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-100">
                <PlayCircle className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="font-semibold text-charcoal text-sm">{t.moduleView.luxMentorClass}</p>
                <p className="text-xs text-gray-500">{t.moduleView.interviewLockedHint}</p>
              </div>
            </div>
            <Lock className="w-5 h-5 text-gray-300" />
          </div>
        </div>
      )}
      {hasClassPlanned && allLessonsDone && (
        <LuxMentorClass
          courseId={courseId}
          moduleId={moduleId}
          sessions={classSessions}
          onCompleted={loadClassSessions}
        />
      )}
    </div>
  );
}
