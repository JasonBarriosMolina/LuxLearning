'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, XCircle, RotateCcw, Trophy, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';

type QuizState = 'answering' | 'submitting' | 'result';

/** Fisher-Yates shuffle — returns a new array */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Build shuffled mappings: shuffledMaps[qIdx][shuffledPos] = originalIdx */
function buildShuffleMaps(questions: any[]): number[][] {
  return questions.map((q) => {
    const indices = q.options.map((_: any, i: number) => i);
    return shuffle(indices);
  });
}

export default function QuizPage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const router = useRouter();

  const [course, setCourse] = useState<any>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [state, setState] = useState<QuizState>('answering');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // shuffledMaps[qIdx][visualPos] = originalIdx
  const shuffledMapsRef = useRef<number[][]>([]);

  const buildAndSetShuffle = (qs: any[]) => {
    shuffledMapsRef.current = buildShuffleMaps(qs);
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
  const currentQuestion = questions[currentQ];
  const answeredCount = answers.filter((a) => a !== null).length;
  const allAnswered = answeredCount === questions.length;

  const handleAnswer = (visualIndex: number) => {
    // Map visual position → original index
    const originalIdx = shuffledMapsRef.current[currentQ]?.[visualIndex] ?? visualIndex;
    const newAnswers = [...answers];
    newAnswers[currentQ] = originalIdx;
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
      setResult((res as any).data ?? res);
      setState('result');
    } catch (err: any) {
      alert('Error al enviar el quiz. Por favor intenta de nuevo.');
      setState('answering');
    }
  };

  const handleRetry = () => {
    setAnswers(new Array(questions.length).fill(null));
    setCurrentQ(0);
    setResult(null);
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
    return <div className="card text-center py-16"><p>Módulo no encontrado</p></div>;
  }

  if (questions.length === 0) {
    return (
      <div className="max-w-2xl mx-auto card text-center py-16 space-y-3">
        <p className="font-heading font-bold text-xl text-charcoal">Sin preguntas configuradas</p>
        <p className="text-gray-500 text-sm">Este módulo aún no tiene preguntas de quiz. Contacta a tu evaluador.</p>
        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="btn-secondary inline-flex text-sm">
          Volver al módulo
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
              {passed ? '¡Aprobado!' : 'No aprobado'}
            </h2>
            <p className="text-gray-500 mt-2">
              {result.correctCount} de {result.totalQuestions} correctas • Nota mínima: {result.passingScore}%
              {attemptNumber > 1 && ` • Intento ${attemptNumber}`}
            </p>
          </div>

          <div className="w-full max-w-xs mx-auto">
            <ProgressBar value={result.score} />
          </div>

          {passed ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">Excelente trabajo. Ahora escribe tu reflexión para completar el módulo.</p>
              <Link href={`/courses/${courseId}/modules/${moduleId}/reflection`} className="btn-primary inline-flex">
                Escribir reflexión
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {!showCorrectAnswers && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 text-left space-y-1">
                  <p className="font-semibold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    Repasa estos temas antes del próximo intento:
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {result.results
                      ?.filter((r: any) => !r.isCorrect)
                      .map((r: any, i: number) => (
                        <li key={i} className="text-amber-700">{r.questionText}</li>
                      ))}
                  </ul>
                  <p className="text-amber-600 text-xs mt-1">
                    Te quedan {3 - attemptNumber} intento{3 - attemptNumber !== 1 ? 's' : ''} antes de ver las respuestas.
                  </p>
                </div>
              )}
              <p className="text-sm text-gray-600">
                {showCorrectAnswers
                  ? 'Revisa las respuestas correctas abajo y vuelve a intentarlo.'
                  : '¡Tú puedes! Estudia el material y vuelve a intentarlo.'}
              </p>
              <Button onClick={handleRetry} leftIcon={<RotateCcw className="w-4 h-4" />}>
                Intentar de nuevo
              </Button>
            </div>
          )}

          <Link href={`/courses/${courseId}/modules/${moduleId}`} className="text-sm text-gray-500 hover:text-charcoal block">
            Volver al módulo
          </Link>
        </div>

        {/* Answer review — only shown when passed or attempt >= 3 */}
        {showCorrectAnswers && result.results && result.results.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-heading font-bold text-lg text-charcoal">Revisión de respuestas</h3>
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
  const shuffleMap = shuffledMapsRef.current[currentQ] ?? currentQuestion?.options?.map((_: any, i: number) => i) ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="p-2 rounded-lg hover:bg-surface">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <h1 className="font-heading font-bold text-xl text-charcoal">Quiz — {module.title}</h1>
          <p className="text-sm text-gray-500">Nota mínima: {module.passingScore}%</p>
        </div>
      </div>

      {/* Progress */}
      <ProgressBar
        value={Math.round((answeredCount / questions.length) * 100)}
        label={`${answeredCount} de ${questions.length} respondidas`}
        showPercent
      />

      {/* Question navigator dots */}
      <div className="flex gap-2 flex-wrap">
        {questions.map((_: any, i: number) => (
          <button
            key={i}
            onClick={() => setCurrentQ(i)}
            className={cn(
              'w-8 h-8 rounded-full text-xs font-bold transition-all',
              i === currentQ
                ? 'bg-cta-gradient text-white'
                : answers[i] !== null
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-surface text-gray-400 hover:bg-border'
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Current question */}
      {currentQuestion && (
        <div className="card space-y-4 animate-fade-in">
          <p className="text-xs font-semibold text-gray-400">PREGUNTA {currentQ + 1} DE {questions.length}</p>
          <p className="font-heading font-semibold text-lg text-charcoal leading-snug">
            {currentQuestion.text}
          </p>

          <div className="space-y-2">
            {shuffleMap.map((originalIdx: number, visualPos: number) => {
              const option = currentQuestion.options[originalIdx];
              // answers[currentQ] stores the original index; check if this visual option is selected
              const isSelected = answers[currentQ] === originalIdx;
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
          <ArrowLeft className="w-4 h-4" /> Anterior
        </Button>

        {currentQ < questions.length - 1 ? (
          <Button
            variant="secondary"
            onClick={() => setCurrentQ(currentQ + 1)}
          >
            Siguiente
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            loading={state === 'submitting'}
            disabled={!allAnswered}
            leftIcon={<CheckCircle className="w-4 h-4" />}
          >
            Enviar quiz
          </Button>
        )}
      </div>

      {!allAnswered && (
        <p className="text-center text-xs text-amber-600">
          Responde todas las preguntas antes de enviar
        </p>
      )}
    </div>
  );
}
