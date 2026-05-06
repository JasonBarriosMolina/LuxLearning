'use client';

import { useEffect, useState } from 'react';
import { X, ArrowRight, BookOpen, TrendingUp, MessageSquare, Award } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';

const STEPS = [
  {
    icon: <BookOpen className="w-8 h-8 text-cta-from" />,
    title: '¡Bienvenido a Lux Learning!',
    description: 'Aquí encontrarás tus cursos asignados. Aprende a tu ritmo con lecciones en video.',
  },
  {
    icon: <MessageSquare className="w-8 h-8 text-purple-500" />,
    title: 'Reflexiona para avanzar',
    description: 'Al terminar cada módulo, escribe una reflexión sobre lo aprendido. Un evaluador la revisará para desbloquearte el siguiente módulo.',
  },
  {
    icon: <TrendingUp className="w-8 h-8 text-emerald-500" />,
    title: 'Sigue tu progreso',
    description: 'En "Mi Progreso" verás cuánto has avanzado en cada módulo y el feedback de tu evaluador.',
  },
  {
    icon: <Award className="w-8 h-8 text-amber-500" />,
    title: '¡Obtén tu certificado!',
    description: 'Al completar todos los módulos de un curso con reflexiones aprobadas, se genera automáticamente tu certificado descargable.',
  },
];

const TOUR_KEY = 'lux-onboarding-done';

export function OnboardingTour() {
  const { role } = useAuth();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Only show to students who haven't seen the tour
    if (role !== 'STUDENT') return;
    if (localStorage.getItem(TOUR_KEY)) return;
    // Small delay so the page loads first
    const t = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(t);
  }, [role]);

  const close = () => {
    localStorage.setItem(TOUR_KEY, '1');
    setVisible(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      close();
    }
  };

  if (!visible) return null;

  const current = STEPS[step]!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-sm w-full p-6 relative animate-slide-up">
        {/* Close */}
        <button
          onClick={close}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-surface text-gray-400 hover:text-gray-600"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Icon */}
        <div className="w-16 h-16 bg-surface rounded-2xl flex items-center justify-center mb-4">
          {current.icon}
        </div>

        {/* Content */}
        <h2 className="font-heading font-bold text-xl text-charcoal mb-2">{current.title}</h2>
        <p className="text-gray-500 text-sm leading-relaxed">{current.description}</p>

        {/* Progress dots */}
        <div className="flex items-center gap-2 mt-6 mb-4">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step ? 'bg-cta-from w-6' : 'bg-gray-200 w-2'
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={close}
            className="text-sm text-gray-400 hover:text-gray-600 font-medium"
          >
            Saltar
          </button>
          <button
            onClick={next}
            className="flex items-center gap-2 bg-cta-gradient text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity"
          >
            {step < STEPS.length - 1 ? (
              <>Siguiente <ArrowRight className="w-4 h-4" /></>
            ) : (
              '¡Empezar! 🚀'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
