'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, XCircle, RotateCcw, Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn } from '@/lib/utils';

type QuizState = 'answering' | 'submitting' | 'result';

export default function QuizPage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const router = useRouter();

  const [course, setCourse] = useState<any>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [state, setState] = useState<QuizState>('answering');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.courses.get(courseId).then((res) => {
      const data = (res as any).data;
      setCourse(data);
      const mod = data.modules?.find((m: any) => m.id === moduleId);
      setAnswers(new Array(mod?.questions?.length ?? 0).fill(null));
      setLoading(false);
    });
  }, [courseId, moduleId]);

  const module = course?.modules?.find((m: any) => m.id === moduleId);
  const questions = module?.questions ?? [];
  const currentQuestion = questions[currentQ];
  const answeredCount = answers.filter((a) => a !== null).length;
  const allAnswered = answeredCount === questions.length;

  const handleAnswer = (optionIndex: number) => {
    const newAnswers = [...answers];
    newAnswers[currentQ] = optionIndex;
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
        answers: answers as number[],
      });
      setResult((res as any).data ?? res);
      setState('result');
    } catch (err: any) {
      alert(err.message ?? 'Error al enviar el quiz');
      setState('answering');
    }
  };

  const handleRetry = () => {
    setAnswers(new Array(questions.length).fill(null));
    setCurrentQ(0);
    setResult(null);
    setState('answering');
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

  // Result screen
  if (state === 'result' && result) {
    const passed = result.passed;
    return (
      <div className="max-w-2xl mx-auto animate-slide-up">
        <div className="card text-center py-10 space-y-6">
          {/* Score circle */}
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
            <p className={`font-heading font-bold text-4xl mb-1 ${
              passed ? 'text-emerald-600' : 'text-red-500'
            }`}>
              {result.score}%
            </p>
            <h2 className="font-heading font-bold text-2xl text-charcoal">
              {passed ? '¡Aprobado!' : 'No aprobado'}
            </h2>
            <p className="text-gray-500 mt-2">
              {result.correctCount} de {result.totalQuestions} correctas •
              Nota mínima: {result.passingScore}%
            </p>
          </div>

          <div className="w-full max-w-xs mx-auto">
            <ProgressBar value={result.score} />
          </div>

          {passed ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Excelente trabajo. Ahora escribe tu reflexión para completar el módulo.
              </p>
              <Link
                href={`/courses/${courseId}/modules/${moduleId}/reflection`}
                className="btn-primary inline-flex"
              >
                Escribir reflexión
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                No te desanimes. Puedes intentarlo de nuevo sin límites.
              </p>
              <Button onClick={handleRetry} leftIcon={<RotateCcw className="w-4 h-4" />}>
                Intentar de nuevo
              </Button>
            </div>
          )}

          <Link
            href={`/courses/${courseId}/modules/${moduleId}`}
            className="text-sm text-gray-500 hover:text-charcoal block"
          >
            Volver al módulo
          </Link>
        </div>
      </div>
    );
  }

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
            {currentQuestion.options.map((option: string, i: number) => (
              <button
                key={i}
                onClick={() => handleAnswer(i)}
                className={cn(
                  'w-full text-left p-4 rounded-xl border-2 transition-all duration-200 text-sm',
                  answers[currentQ] === i
                    ? 'border-cta-from bg-blue-50 text-charcoal font-medium'
                    : 'border-border hover:border-cta-from hover:bg-surface text-gray-700'
                )}
              >
                <span className="font-bold mr-3 text-gray-400">
                  {String.fromCharCode(65 + i)}.
                </span>
                {option}
              </button>
            ))}
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
