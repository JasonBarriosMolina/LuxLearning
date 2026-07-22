'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, PlayCircle, CheckCircle, Lock, Clock,
  BookOpen, ClipboardCheck, FileText, Star, Upload, FileCheck, AlertCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge, ReflectionStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatCourseDuration } from '@/lib/utils';
import type { ReflectionStatus } from '@lux/types';
import { useLanguage } from '@/lib/i18n';

const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB

export default function ModulePage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const { t, lang } = useLanguage();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadSubmissions = useCallback(async () => {
    try {
      const res = await api.submissions.list(moduleId);
      setSubmissions((res as any).data ?? []);
    } catch {}
  }, [moduleId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.courses.get(courseId),
      api.lessons.favorites(),
      api.submissions.list(moduleId).catch(() => ({ data: [] })),
    ]).then(([courseRes, favRes, subsRes]) => {
      setCourse((courseRes as any).data);
      const favs: any[] = (favRes as any).data ?? [];
      setFavIds(new Set(favs.filter((f: any) => f?.type === 'lesson').map((f: any) => f?.id)));
      setSubmissions((subsRes as any).data ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [courseId, moduleId, lang]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setUploadError(t.moduleView.evidenceFileTooBig);
      setUploadState('error');
      return;
    }
    setUploadState('uploading');
    setUploadError('');
    try {
      const presignRes = await api.submissions.presign({
        courseId,
        moduleId,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
      });
      const { submissionId, uploadUrl } = (presignRes as any).data;
      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      await api.submissions.register({
        submissionId,
        courseId,
        moduleId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
      });
      setUploadState('done');
      await loadSubmissions();
      setTimeout(() => setUploadState('idle'), 2000);
    } catch {
      setUploadError(t.moduleView.evidenceUploadError);
      setUploadState('error');
    }
  }, [courseId, moduleId, t, loadSubmissions]);

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

  const getModuleStatus = () => {
    if (reflectionStatus === 'APPROVED') return { label: t.moduleView.statusCompleted, variant: 'success' as const };
    if (reflectionStatus === 'PENDING_EVAL') return { label: t.moduleView.statusInReview, variant: 'pending' as const };
    if (reflectionStatus === 'PENDING_AI') return { label: t.moduleView.reflectionStatusPendingAi, variant: 'info' as const };
    if (reflectionStatus === 'REJECTED') return { label: t.moduleView.reflectionStatusRejected, variant: 'error' as const };
    if (module.quizPassed) return { label: t.moduleView.quizPassed, variant: 'success' as const };
    if (allLessonsDone) return { label: t.moduleView.statusPendingReflection, variant: 'warning' as const };
    return { label: t.moduleView.statusPendingQuiz, variant: 'default' as const };
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

      {/* Quiz CTA */}
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

      {/* Reflection CTA */}
      <div className={`card ${!module.quizPassed ? 'opacity-60' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              reflectionStatus === 'APPROVED' ? 'bg-emerald-100'
                : reflectionStatus ? 'bg-purple-100'
                : module.quizPassed ? 'bg-blue-100'
                : 'bg-gray-100'
            }`}>
              {reflectionStatus === 'APPROVED' ? (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              ) : (
                <FileText className={`w-5 h-5 ${module.quizPassed ? 'text-blue-600' : 'text-gray-400'}`} />
              )}
            </div>
            <div>
              <p className="font-semibold text-charcoal text-sm">{t.moduleView.reflectionTitle}</p>
              <p className="text-xs text-gray-500">
                {reflectionStatus
                  ? { PENDING_AI: t.moduleView.reflectionPendingAi, PENDING_EVAL: t.moduleView.reflectionPendingEval, APPROVED: t.moduleView.reflectionApproved, REJECTED: t.moduleView.reflectionRejected }[reflectionStatus]
                  : module.quizPassed
                  ? t.moduleView.writeReflectionHint
                  : t.moduleView.passQuizFirst}
              </p>
            </div>
          </div>
          {module.quizPassed && (!reflectionStatus || reflectionStatus === 'REJECTED') && (
            <Link href={`/courses/${courseId}/modules/${moduleId}/reflection`}>
              <Button size="sm" variant={reflectionStatus === 'REJECTED' ? 'secondary' : 'primary'}>
                {reflectionStatus === 'REJECTED' ? t.moduleView.rewrite : t.moduleView.write}
              </Button>
            </Link>
          )}
          {reflectionStatus && reflectionStatus !== 'REJECTED' && (
            <ReflectionStatusBadge status={reflectionStatus} />
          )}
          {!module.quizPassed && <Lock className="w-5 h-5 text-gray-300" />}
        </div>
      </div>

      {/* Evidence Submissions */}
      <div className="card space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-orange-100 shrink-0">
            <Upload className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <p className="font-semibold text-charcoal text-sm">{t.moduleView.evidenceTitle}</p>
            <p className="text-xs text-gray-500">{t.moduleView.evidenceMaxSize}</p>
          </div>
        </div>

        {/* Upload zone */}
        <div
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
            dragging ? 'border-cta-from bg-blue-50' : 'border-gray-200 hover:border-cta-from hover:bg-gray-50'
          } ${uploadState === 'uploading' ? 'pointer-events-none opacity-60' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFileUpload(file);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
              e.target.value = '';
            }}
          />
          {uploadState === 'uploading' ? (
            <p className="text-sm text-blue-600 font-medium">{t.moduleView.evidenceUploading}</p>
          ) : uploadState === 'done' ? (
            <p className="text-sm text-emerald-600 font-medium flex items-center justify-center gap-2">
              <CheckCircle className="w-4 h-4" /> {t.moduleView.evidenceUploaded}
            </p>
          ) : uploadState === 'error' ? (
            <p className="text-sm text-red-500 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4" /> {uploadError}
            </p>
          ) : (
            <>
              <Upload className="w-6 h-6 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">{t.moduleView.evidenceDragDrop}</p>
            </>
          )}
        </div>

        {/* Submission list */}
        {submissions.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-2">{t.moduleView.evidenceNoFiles}</p>
        ) : (
          <div className="space-y-2">
            {submissions.map((sub: any) => (
              <div key={sub.submissionId} className="flex items-center gap-3 p-3 bg-surface rounded-xl">
                <FileCheck className="w-5 h-5 text-orange-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-charcoal truncate">{sub.fileName}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(sub.createdAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {sub.status === 'graded' ? (
                    <div className="space-y-0.5">
                      <Badge variant="success">{t.moduleView.evidenceGrade(sub.grade ?? 0)}</Badge>
                      {sub.feedback && (
                        <p className="text-xs text-gray-500 max-w-[180px] text-right">{sub.feedback}</p>
                      )}
                    </div>
                  ) : (
                    <Badge variant="pending">{t.moduleView.evidencePending}</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
