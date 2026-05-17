'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { LayoutDashboard, BookOpen, CalendarCheck, MessageSquare, Bot, Sparkles, ChevronRight, X } from 'lucide-react';
import { api } from '@/lib/api';

const STEPS = [
  {
    target: 'a[href="/dashboard"]',
    icon: <LayoutDashboard className="w-10 h-10 text-blue-400" />,
    title: 'Tu Dashboard',
    body: 'Aquí tienes una vista rápida de tu progreso, cursos activos, notificaciones y próximas fechas límite. Es tu punto de partida cada vez que ingreses.',
  },
  {
    target: 'a[href="/courses"]',
    icon: <BookOpen className="w-10 h-10 text-purple-400" />,
    title: 'Mis Cursos',
    body: 'Accede a todos los cursos asignados a ti. Cada curso tiene módulos con lecciones en video y texto, quiz y reflexión al final de cada módulo.',
  },
  {
    target: 'a[href="/tasks"]',
    icon: <CalendarCheck className="w-10 h-10 text-amber-400" />,
    title: 'Mi Calendario',
    body: 'Aquí aparecen las tareas que tu evaluador te ha asignado con fechas límite. Puedes exportarlas a Google Calendar o cualquier app de calendario.',
  },
  {
    target: 'a[href="/communications"]',
    icon: <MessageSquare className="w-10 h-10 text-rose-400" />,
    title: 'Comunicaciones',
    body: 'Chatea directamente con tu evaluador. Puedes enviar mensajes, hacer preguntas y participar en chats grupales de tu curso.',
  },
  {
    target: null,
    icon: <Bot className="w-10 h-10 text-emerald-400" />,
    title: 'Tu Mentor IA',
    body: 'En cada lección encontrarás un botón de chat con IA. Tu mentor virtual puede responder preguntas sobre el contenido de la lección, aclarar conceptos y ayudarte a profundizar.',
  },
  {
    target: null,
    icon: <Sparkles className="w-10 h-10 text-yellow-400" />,
    title: '¡Todo listo!',
    body: '¡Ya conoces todo lo que Lux Learning tiene para ti! Navega a "Mis Cursos" para comenzar tu aprendizaje. ¡Mucho éxito!',
  },
];

export function OnboardingWizard() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    api.student.onboarding.check()
      .then((res: any) => {
        const done = res?.data?.done ?? res?.done ?? false;
        if (!done) setVisible(true);
      })
      .catch(() => {});
  }, []);

  const updateSpotlight = useCallback(() => {
    const targetSelector = STEPS[step]?.target;
    if (!targetSelector) {
      setSpotlight(null);
      return;
    }
    const el = document.querySelector(targetSelector) as HTMLElement | null;
    if (!el) {
      setSpotlight(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setSpotlight({
      top: rect.top - 8,
      left: rect.left - 8,
      width: rect.width + 16,
      height: rect.height + 16,
    });
  }, [step]);

  useEffect(() => {
    if (!visible) return;
    updateSpotlight();
    window.addEventListener('resize', updateSpotlight);
    return () => window.removeEventListener('resize', updateSpotlight);
  }, [visible, step, updateSpotlight]);

  const markDone = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    api.student.onboarding.complete().catch(() => {});
  }, []);

  const finish = useCallback(() => {
    markDone();
    setVisible(false);
  }, [markDone]);

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      finish();
    }
  };

  if (!visible) return null;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <>
      {/* Overlay — either spotlight or plain dark */}
      {spotlight ? (
        <div
          className="fixed pointer-events-none"
          style={{
            zIndex: 60,
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            borderRadius: 12,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.78)',
            outline: '2px solid rgba(255,255,255,0.25)',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/75 z-[60] pointer-events-none" />
      )}

      {/* Click catcher (closes nothing, blocks clicks on background) */}
      <div className="fixed inset-0 z-[61]" onClick={finish} />

      {/* Card */}
      <div
        ref={cardRef}
        className="fixed z-[62] bg-white dark:bg-[#1C1C2E] rounded-2xl shadow-2xl w-full max-w-sm p-7 flex flex-col items-center text-center gap-5 animate-fade-in"
        style={{
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* X button */}
        <button
          onClick={finish}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          aria-label="Omitir tutorial"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-gray-50 dark:bg-white/5 flex items-center justify-center">
          {current.icon}
        </div>

        {/* Text */}
        <div className="space-y-2 px-1">
          <h2 className="font-heading font-bold text-lg text-charcoal dark:text-white">{current.title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{current.body}</p>
        </div>

        {/* Step dots */}
        <div className="flex gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-5 bg-cta-from' : 'w-1.5 bg-gray-200 dark:bg-white/20'
              }`}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="flex gap-3 w-full">
          {!isLast && (
            <button
              onClick={finish}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
            >
              Omitir
            </button>
          )}
          <button
            onClick={next}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors bg-gradient-to-r from-cta-from to-cta-to hover:opacity-90 ${isLast ? 'w-full' : 'flex-1'}`}
          >
            {isLast ? '¡Comenzar!' : 'Siguiente'}
            {!isLast && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </>
  );
}
