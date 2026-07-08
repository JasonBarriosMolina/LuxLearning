'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, XCircle, RotateCcw, Trophy, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { TextToSpeechButton } from '@/components/shared/TextToSpeechButton';

import { shuffle, buildShuffleMaps, buildQuestionOrder } from './shuffleUtils';
import { useLanguage } from '@/lib/i18n';

// Re-export for backwards compatibility if needed
export { shuffle, buildShuffleMaps, buildQuestionOrder };

type QuizState = 'answering' | 'submitting' | 'result';

export default function QuizPage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const router = useRouter();
  const { t } = useLanguage();

  const [course, setCourse] = useState<any>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [state, setState] = useState<QuizState>('answering');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [gapAnalysis, setGapAnalysis] = useState<{ gaps: { concept: string; suggestedFocus: string }[]; overallPattern: string | null } | null>(null);
  const [gapLoading, setGapLoading] = useState(false);

  // shuffledMaps[qIdx][visualPos] = originalIdx
  const shuffledMapsRef = useRef<number[][]>([]);
  // shuffledQuestionsRef[visualPos] = originalQuestionIdx
  const shuffledQuestionsRef = useRef<number[]>([]);

  const buildAndSetShuffle = (qs: any[]) => {
    shuffledMapsRef.current = buildShuffleMaps(qs);
    shuffledQuestionsRef.current = buildQuestionOrder(qs);
  };

  useEffect(() => {
    api.courses.get(courseId).then((res) => {
      const data = (res as any).data;
      setCourse(data);
      const mod = data.modules?.find((m: any) => m.id === moduleId);
      const qs = mod?.questions ?? [];
      setAnswers(new Array(qs.length).fill(null));
      buildAndSetShuffle(qs);
      setLoading(false);
    });
  }, [courseId, moduleId]);

  const module = course?.modules?.find((m: any) => m.id === moduleId);
  const questions = module?.questions ?? [];
  const answeredCount = answers.filter((a) => a !== null).length;
  const allAnswered = answeredCount === questions.length;

  const handleAnswer = (visualIndex: number) => {
    // Map visual question position → original question index
    const origQIdx = shuffledQuestionsRef.current[currentQ] ?? currentQ;
    // Map visual option position → original option index
    const originalIdx = shuffledMapsRef.current[origQIdx]?.[visualIndex] ?? visualIndex;
    const newAnswers = [...answers];
    newAnswers[origQIdx] = originalIdx;
    setAnswers(newAnswers);

    // Auto-advance
    if (currentQ < questions.length - 1) {
      setTimeout(() => setCurrentQ(currentQ + 1), 300);
    }
  };

  const handleSubmit = async () => {
    setState('submitting');
    try {
      const res = await api.quiz.submit(moduleId, {
        moduleId,
        courseId,
        answers: answers as number[],
      });
      const data = (res as any).data ?? res;
      setResult(data);
      setState('result');
      // Fire gap analysis if student didn't pass
      if (!data.passed && Array.isArray(data.results) && data.results.some((r: any) => !r.isCorrect)) {
        setGapLoading(true);
        api.quiz.gapAnalysis(moduleId, { results: data.results })
          .then((gapRes: any) => {
            const d = gapRes?.data;
            if (d?.gaps?.length > 0) setGapAnalysis(d);
          })
          .catch(() => { /* soft fail — no bloquear UI */ })
          .finally(() => setGapLoading(false));
      }
    } catch (err: any) {
      alert(t.quizPage.submitError);
      setState('answering');
    }
  };

  const handleRetry = () => {
    setAnswers(new Array(questions.length).fill(null));
    setCurrentQ(0);
    setResult(null);
    setGapAnalysis(null);
    setGapLoading(false);
    setState('answering');
    // Re-shuffle on every new attempt
    buildAndSetShuffle(questions);
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="card h-64" />
      </div>
    );
  }

  if (!module) {
    return <div className="card text-center py-16"><p>{t.moduleView.moduleNotFound}</p></div>;
  }

  if (questions.length === 0) {
    return (
      <div className="max-w-2xl mx-auto card text-center py-16 space-y-3">
        <p className="font-heading font-bold text-xl text-charcoal">{t.quizPage.noQuestions}</p>
        <p className="text-gray-500 text-sm">{t.quizPage.studyHint}</p>
        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="btn-secondary inline-flex text-sm">
          {t.quizPage.backToModule}
        </Link>
      </div>
    );
  }

  // ── Result screen ────────────────────────────────────────────────────────
  if (state === 'result' && result) {
    const passed = result.passed;
    const attemptNumber: number = result.attempt ?? 1;
    // Show correct answers only from attempt 3 onward when failed
    const showCorrectAnswers = passed || attemptNumber >= 3;

    return (
      <div className="max-w-2xl mx-auto animate-slide-up space-y-5">
        {/* Score summary card */}
        <div className="card text-center py-8 space-y-4">
          <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto ${
            passed ? 'bg-emerald-100' : 'bg-red-100'
          }`}>
            {passed ? (
              <Trophy className="w-10 h-10 text-emerald-600" />
            ) : (
              <XCircle className="w-10 h-10 text-red-500" />
            )}
          </div>

          <div>
            <p className={`font-heading font-bold text-4xl mb-1 ${passed ? 'text-emerald-600' : 'text-red-500'}`}>
              {isNaN(result.score) ? '—' : result.score}%
            </p>
            <h2 className="font-heading font-bold text-2xl text-charcoal">
              {passed ? t.quizPage.passed : t.quizPage.notPassed}
            </h2>
            <p className="text-gray-500 mt-2">
              {t.quizPage.correctCount(result.correctCount, result.totalQuestions)} • {t.quizPage.minScore(result.passingScore)}
              {attemptNumber > 1 && ` • ${t.quizPage.attemptN(attemptNumber)}`}
            </p>
          </div>

          <div className="w-full max-w-xs mx-auto">
            <ProgressBar value={result.score} />
          </div>

          {passed ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">{t.quizPage.excellentWork}</p>
              <Link href={`/courses/${courseId}/modules/${moduleId}/reflection`} className="btn-primary inline-flex">
                {t.quizPage.writeReflection}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {!showCorrectAnswers && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-left space-y-3">
                  <p className="font-semibold text-amber-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {gapLoading ? 'Analizando tus respuestas...' : t.quizPage.reviewTopics}
                  </p>

                  {/* Gap analysis panel */}
                  {gapLoading && (
                    <div className="flex items-center gap-2 text-xs text-amber-600">
                      <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      Identificando brechas de conocimiento...
                    </div>
                  )}
                  {!gapLoading && gapAnalysis && gapAnalysis.gaps.length > 0 ? (
                    <div className="space-y-2">
                      {gapAnalysis.overallPattern && (
                        <p className="text-xs text-amber-700 italic">{gapAnalysis.overallPattern}</p>
                      )}
                      <ul className="space-y-2">
                        {gapAnalysis.gaps.map((gap, i) => (
                          <li key={i} className="bg-white rounded-lg p-2.5 border border-amber-100">
                            <p className="font-medium text-sm text-charcoal">{gap.concept}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{gap.suggestedFocus}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : !gapLoading && (
                    <ul className="list-disc pl-5 space-y-0.5">
                      {result.results
                        ?.filter((r: any) => !r.isCorrect)
                        .map((r: any, i: number) => (
                          <li key={i} className="text-amber-700">{r.questionText}</li>
                        ))}
                    </ul>
                  )}

                  <p className="text-amber-600 text-xs">
                    {t.quizPage.attemptsLeft(3 - attemptNumber)}
                  </p>
                </div>
              )}
              <p className="text-sm text-gray-600">
                {showCorrectAnswers
                  ? t.quizPage.studyHint
                  : t.quizPage.studyHint}
              </p>
              <Button onClick={handleRetry} leftIcon={<RotateCcw className="w-4 h-4" />}>
                {t.quizPage.retryBtn}
              </Button>
            </div>
          )}

          <Link href={`/courses/${courseId}/modules/${moduleId}`} className="text-sm text-gray-500 hover:text-charcoal block">
            {t.quizPage.backToModule}
          </Link>
        </div>

        {/* Answer review — only shown when passed or attempt >= 3 */}
        {showCorrectAnswers && result.results && result.results.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-heading font-bold text-lg text-charcoal">{t.quizPage.reviewTitle}</h3>
            {result.results.map((r: any, i: number) => (
              <div
                key={i}
                className={`card border-2 ${r.isCorrect ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30'}`}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${r.isCorrect ? 'bg-emerald-100' : 'bg-red-100'}`}>
                    {r.isCorrect
                      ? <CheckCircle className="w-4 h-4 text-emerald-600" />
                      : <XCircle className="w-4 h-4 text-red-500" />}
                  </div>
                  <p className="font-semibold text-charcoal text-sm leading-snug">
                    {i + 1}. {r.questionText}
                  </p>
                </div>
                <div className="space-y-1.5 pl-9">
                  {r.options.map((opt: string, j: number) => {
                    const isCorrect = j === r.correctIndex;
                    const isSelected = j === r.selectedIndex;
                    const isWrong = isSelected && !isCorrect;
                    return (
                      <div
                        key={j}
                        className={cn(
                          'px-3 py-2 rounded-lg text-sm flex items-center gap-2',
                          isCorrect ? 'bg-emerald-100 text-emerald-800 font-medium'
                            : isWrong ? 'bg-red-100 text-red-700 line-through'
                            : 'text-gray-500'
                        )}
                      >
                        <span className="font-bold text-xs w-4 shrink-0">{String.fromCharCode(65 + j)}.</span>
                        {opt}
                        {isCorrect && <CheckCircle className="w-3.5 h-3.5 text-emerald-600 ml-auto shrink-0" />}
                        {isWrong && <XCircle className="w-3.5 h-3.5 text-red-500 ml-auto shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Answering screen ────────────────────────────────────────────────────
  const origQIdx = shuffledQuestionsRef.current[currentQ] ?? currentQ;
  const currentQuestion = questions[origQIdx];
  const shuffleMap = shuffledMapsRef.current[origQIdx] ?? currentQuestion?.options?.map((_: any, i: number) => i) ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="p-2 rounded-lg hover:bg-surface">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <h1 className="font-heading font-bold text-xl text-charcoal">{t.quizPage.title(module.title)}</h1>
          <p className="text-sm text-gray-500">{t.quizPage.minScore(module.passingScore)}</p>
        </div>
      </div>

      {/* Progress */}
      <ProgressBar
        value={Math.round((answeredCount / questions.length) * 100)}
        label={t.quizPage.answeredOf(answeredCount, questions.length)}
        showPercent
      />

      {/* Question navigator dots */}
      <div className="flex gap-2 flex-wrap">
        {questions.map((_: any, i: number) => {
          const origIdx = shuffledQuestionsRef.current[i] ?? i;
          return (
            <button
              key={i}
              onClick={() => setCurrentQ(i)}
              className={cn(
                'w-8 h-8 rounded-full text-xs font-bold transition-all',
                i === currentQ
                  ? 'bg-cta-gradient text-white'
                  : answers[origIdx] !== null
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-surface text-gray-400 hover:bg-border'
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {/* Current question */}
      {currentQuestion && (
        <div className="card space-y-4 animate-fade-in">
          <p className="text-xs font-semibold text-gray-400">{t.quizPage.questionOf(currentQ + 1, questions.length)}</p>
          <p className="font-heading font-semibold text-lg text-charcoal leading-snug">
            {currentQuestion.text}
          </p>
          <TextToSpeechButton key={currentQ} text={currentQuestion.text} />

          <div className="space-y-2">
            {shuffleMap.map((originalIdx: number, visualPos: number) => {
              const option = currentQuestion.options[originalIdx];
              // answers[origQIdx] stores the original option index; check if this visual option is selected
              const isSelected = answers[origQIdx] === originalIdx;
              return (
                <button
                  key={originalIdx}
                  onClick={() => handleAnswer(visualPos)}
                  className={cn(
                    'w-full text-left p-4 rounded-xl border-2 transition-all duration-200 text-sm',
                    isSelected
                      ? 'border-cta-from bg-blue-50 text-charcoal font-medium'
                      : 'border-border hover:border-cta-from hover:bg-surface text-gray-700'
                  )}
                >
                  <span className="font-bold mr-3 text-gray-400">
                    {String.fromCharCode(65 + visualPos)}.
                  </span>
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          onClick={() => setCurrentQ(Math.max(0, currentQ - 1))}
          disabled={currentQ === 0}
        >
          <ArrowLeft className="w-4 h-4" /> {t.quizPage.prev}
        </Button>

        {currentQ < questions.length - 1 ? (
          <Button
            variant="secondary"
            onClick={() => setCurrentQ(currentQ + 1)}
          >
            {t.quizPage.next}
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            loading={state === 'submitting'}
            disabled={!allAnswered}
            leftIcon={<CheckCircle className="w-4 h-4" />}
          >
            {t.quizPage.submit}
          </Button>
        )}
      </div>

      {!allAnswered && (
        <p className="text-center text-xs text-amber-600">
          {t.quizPage.answerAll}
        </p>
      )}
    </div>
  );
}
