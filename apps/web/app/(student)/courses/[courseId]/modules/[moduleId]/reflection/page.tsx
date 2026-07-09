'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Send, CheckCircle, Clock, AlertCircle, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { countWords } from '@/lib/utils';
import type { Reflection } from '@lux/types';
import { useLanguage } from '@/lib/i18n';

const MIN_WORDS = 80;

export default function ReflectionPage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const router = useRouter();
  const { t, lang } = useLanguage();

  const [course, setCourse] = useState<any>(null);
  const [existingReflection, setExistingReflection] = useState<Reflection | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ assessment: string; suggestions: string[]; readyToSubmit: boolean } | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showAiWarningModal, setShowAiWarningModal] = useState(false);

  useEffect(() => {
    Promise.all([
      api.courses.get(courseId),
      api.reflection.get(moduleId),
    ]).then(([courseRes, reflectionRes]) => {
      setCourse((courseRes as any).data);
      const ref = (reflectionRes as any).data;
      if (ref) {
        setExistingReflection(ref);
        if (ref.status === 'REJECTED') {
          setText(''); // Let them rewrite
        }
      }
      setLoading(false);
    });
  }, [courseId, moduleId]);

  const module = course?.modules?.find((m: any) => m.id === moduleId);
  const wordCount = countWords(text);
  const wordsRemaining = Math.max(0, MIN_WORDS - wordCount);
  const isReady = wordCount >= MIN_WORDS;

  const handleAiPreview = async () => {
    if (wordCount < 20) return;
    setAnalyzing(true);
    setAiPreview(null);
    try {
      const res = await api.reflection.aiPreview(text, module?.title);
      setAiPreview((res as any).data ?? res);
      setShowAiPanel(true);
    } catch {
      // non-fatal
    } finally {
      setAnalyzing(false);
    }
  };

  const doSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      await api.reflection.submit({ moduleId, text });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? t.reflectionPage.errorSubmit);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isReady) return;

    // If AI preview flagged this as not ready, show warning modal first
    if (aiPreview && !aiPreview.readyToSubmit) {
      setShowAiWarningModal(true);
      return;
    }

    await doSubmit();
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="card h-64" />
      </div>
    );
  }

  // Submitted screen
  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto animate-slide-up">
        <div className="card text-center py-12 space-y-4">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
            <Clock className="w-10 h-10 text-cta-from" />
          </div>
          <h2 className="font-heading font-bold text-2xl text-charcoal">{t.reflectionPage.successTitle}</h2>
          <p className="text-gray-500 text-sm max-w-sm mx-auto">
            {t.reflectionPage.submittedMsg}
          </p>
          <Link href={`/courses/${courseId}/modules/${moduleId}`} className="btn-primary inline-flex">
            {t.reflectionPage.backToModuleLink}
          </Link>
        </div>
      </div>
    );
  }

  // Show existing non-rejected reflection
  if (existingReflection && existingReflection.status !== 'REJECTED') {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <Link href={`/courses/${courseId}/modules/${moduleId}`} className="p-2 rounded-lg hover:bg-surface">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <h1 className="font-heading font-bold text-xl text-charcoal">{t.reflectionPage.breadcrumbMyReflection}</h1>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-charcoal">{module?.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {t.reflectionPage.wordDateInfo(existingReflection.wordCount, new Date(existingReflection.submittedAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es'))}
              </p>
            </div>
            <ReflectionStatusBadge status={existingReflection.status} />
          </div>

          <div className="bg-surface rounded-xl p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {existingReflection.text}
          </div>

          {existingReflection.evaluatorFeedback && (
            <div className="border-l-4 border-cta-to pl-4">
              <p className="text-xs font-semibold text-gray-400 mb-1">{t.reflectionPage.feedbackEval}</p>
              <p className="text-sm text-gray-700">{existingReflection.evaluatorFeedback}</p>
            </div>
          )}

          {existingReflection.aiResult && existingReflection.status !== 'APPROVED' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
              <p className="font-semibold text-amber-800 mb-1">{t.reflectionPage.aiAnalysisTitle}</p>
              <p className="text-amber-700">
                {t.reflectionPage.aiVerdict2(existingReflection.aiResult.verdict, existingReflection.aiResult.confidence)}
              </p>
            </div>
          )}
        </div>

        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="btn-secondary inline-flex">
          <ArrowLeft className="w-4 h-4" /> {t.reflectionPage.backToModuleLink}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* AI Warning Modal */}
      {showAiWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowAiWarningModal(false)} />
          <div className="relative bg-white dark:bg-[#1A1A2E] rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
                <AlertCircle className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="font-heading font-bold text-lg text-charcoal">{t.reflectionPage.aiWarningTitle2}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{t.reflectionPage.aiWarningSubtitle}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              {t.reflectionPage.aiWarningBody}
            </p>
            <p className="text-sm font-semibold text-amber-700 bg-amber-50 rounded-xl px-4 py-3">
              {t.reflectionPage.aiWarningQuestion}
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowAiWarningModal(false)}
                className="btn-secondary flex-1 text-sm"
              >
                {t.reflectionPage.aiWarningCancel}
              </button>
              <button
                onClick={() => { setShowAiWarningModal(false); doSubmit(); }}
                disabled={submitting}
                className="flex-1 btn-primary text-sm bg-amber-500 hover:bg-amber-600"
              >
                {t.reflectionPage.aiWarningContinue}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="p-2 rounded-lg hover:bg-surface">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="font-heading font-bold text-xl text-charcoal">
            {existingReflection?.status === 'REJECTED' ? t.reflectionPage.breadcrumbRewrite : t.reflectionPage.breadcrumbNew}
          </h1>
          <p className="text-sm text-gray-500">{module?.title}</p>
        </div>
      </div>

      {/* Rejected notice */}
      {existingReflection?.status === 'REJECTED' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-700 text-sm">{t.reflectionPage.rejectedNotice}</p>
              {existingReflection.evaluatorFeedback && (
                <p className="text-sm text-red-600 mt-1">{existingReflection.evaluatorFeedback}</p>
              )}
              <p className="text-sm text-red-600 mt-1">{t.reflectionPage.writeNewReflection}</p>
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="card bg-blue-50 border border-blue-200">
        <h2 className="font-heading font-semibold text-base text-blue-800 mb-2">
          {t.reflectionPage.instructionsTitle2}
        </h2>
        <ul className="text-sm text-blue-700 space-y-1.5">
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {t.reflectionPage.instruction1v2}
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {t.reflectionPage.instruction2v2}
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {t.reflectionPage.instruction3v2(MIN_WORDS)}
          </li>
        </ul>
      </div>

      {/* Text area */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card p-0 overflow-hidden">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.reflectionPage.textareaPlaceholder(module?.title ?? '')}
            className="w-full min-h-[280px] p-6 text-sm text-charcoal placeholder-gray-400 resize-y focus:outline-none font-sans leading-relaxed"
            autoFocus
          />
          <div className={`flex items-center justify-between px-6 py-3 border-t border-border ${
            isReady ? 'bg-emerald-50' : 'bg-surface'
          }`}>
            <span className={`text-sm font-medium ${isReady ? 'text-emerald-600' : 'text-gray-500'}`}>
              {t.reflectionPage.wordCount(wordCount)}
              {!isReady && wordsRemaining > 0 && ` • ${t.reflectionPage.wordsRemainingLabel(wordsRemaining)}`}
            </span>
            {isReady && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                <CheckCircle className="w-3.5 h-3.5" /> {t.reflectionPage.readyToSend}
              </span>
            )}
          </div>
        </div>

        {/* AI Preview button */}
        {wordCount >= 20 && (
          <button
            type="button"
            onClick={handleAiPreview}
            disabled={analyzing}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 border-dashed border-cta-from/40 text-cta-from font-semibold text-sm hover:border-cta-from hover:bg-blue-50 transition-all disabled:opacity-60"
          >
            <Sparkles className="w-4 h-4" />
            {analyzing ? t.reflectionPage.analyzing : t.reflectionPage.analyzeBeforeSubmit}
          </button>
        )}

        {/* AI Preview panel */}
        {aiPreview && (
          <div className={`rounded-xl border p-4 space-y-3 ${aiPreview.readyToSubmit ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
            <button
              type="button"
              onClick={() => setShowAiPanel((v) => !v)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Sparkles className={`w-4 h-4 ${aiPreview.readyToSubmit ? 'text-emerald-600' : 'text-amber-600'}`} />
                <span className={`text-sm font-semibold ${aiPreview.readyToSubmit ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {aiPreview.readyToSubmit ? t.reflectionPage.aiReadyToSubmit : t.reflectionPage.aiSuggestImprovements}
                </span>
              </div>
              {showAiPanel ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {showAiPanel && (
              <div className="space-y-3">
                <p className={`text-sm ${aiPreview.readyToSubmit ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {aiPreview.assessment}
                </p>
                {aiPreview.suggestions.length > 0 && (
                  <ul className="space-y-2">
                    {aiPreview.suggestions.map((s, i) => (
                      <li key={i} className={`flex items-start gap-2 text-sm ${aiPreview.readyToSubmit ? 'text-emerald-800' : 'text-amber-800'}`}>
                        <span className="shrink-0 font-bold">{i + 1}.</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button
          type="submit"
          loading={submitting}
          disabled={!isReady}
          className="w-full"
          leftIcon={<Send className="w-4 h-4" />}
        >
          {t.reflectionPage.submitBtn}
        </Button>
      </form>
    </div>
  );
}
