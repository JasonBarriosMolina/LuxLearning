'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight, BookOpen, ClipboardCheck, TrendingUp, Shield,
  Award, MessageCircle, Calendar, Users, Zap, Bell, CheckCircle,
} from 'lucide-react';
import { PrismaLogo } from '@/components/shared/PrismaLogo';
import { useAuth } from '@/lib/hooks/useAuth';

export default function LandingPage() {
  const { isAuthenticated, isLoading, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(role === 'EVALUATOR' || role === 'ADMIN' || role === 'SUPER_ADMIN' ? '/evaluator/dashboard' : '/dashboard');
    }
  }, [isLoading, isAuthenticated, role, router]);

  if (isLoading || isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cta-from border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-charcoal overflow-hidden">
      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-cta-from/8 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-40 w-[500px] h-[500px] bg-cta-to/6 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 right-1/3 w-[400px] h-[400px] bg-cta-from/6 rounded-full blur-3xl" />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-6 lg:px-16 py-5 border-b border-border">
        <PrismaLogo size={32} />
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-gray-500 hover:text-charcoal text-sm font-medium transition-colors">
            Iniciar sesión
          </Link>
          <Link
            href="/register"
            className="bg-cta-gradient text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity"
          >
            Registrarse
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 px-6 lg:px-16 pt-20 pb-24 text-center max-w-4xl mx-auto">
        <div className="flex justify-center mb-8">
          <PrismaLogo size={72} textColor="#2C2C2C" />
        </div>

        <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl leading-tight mb-6 text-charcoal">
          Claridad que{' '}
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#00B4D8] to-[#7B2FBE]">
            transforma
          </span>
        </h1>

        <p className="text-gray-500 text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
          Un programa completo de aprendizaje con lecciones en video, evaluaciones, mentores humanos e inteligencia artificial.
          Cada avance queda certificado.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 bg-cta-gradient text-white font-heading font-semibold px-8 py-4 rounded-xl hover:opacity-90 transition-opacity text-base"
          >
            Comenzar ahora <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 bg-gray-100 border border-border text-charcoal font-heading font-semibold px-8 py-4 rounded-xl hover:bg-gray-200 transition-colors text-base"
          >
            Ya tengo cuenta
          </Link>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="relative z-10 px-6 lg:px-16 py-20 bg-gray-50 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="font-heading font-bold text-3xl text-charcoal mb-3">Cómo funciona</h2>
            <p className="text-gray-500">Tres pasos para transformar tu aprendizaje en un logro real.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Connector line — desktop only */}
            <div className="hidden md:block absolute top-10 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] h-px bg-border z-0" />

            {[
              {
                step: '01',
                icon: <Users className="w-6 h-6" />,
                title: 'Inscríbete',
                desc: 'Tu institución te asigna al programa. Recibes acceso inmediato con tu correo y una contraseña temporal.',
                color: 'bg-cyan-50 text-cyan-600 border-cyan-200',
              },
              {
                step: '02',
                icon: <BookOpen className="w-6 h-6" />,
                title: 'Aprende',
                desc: 'Completa lecciones en video, quizzes por módulo y reflexiones escritas revisadas por tu evaluador.',
                color: 'bg-purple-50 text-purple-600 border-purple-200',
              },
              {
                step: '03',
                icon: <Award className="w-6 h-6" />,
                title: 'Certifícate',
                desc: 'Al completar todos los módulos aprobados obtienes tu certificado digital personalizado con nombre y sello.',
                color: 'bg-amber-50 text-amber-600 border-amber-200',
              },
            ].map((s) => (
              <div key={s.step} className="relative z-10 flex flex-col items-center text-center">
                <div className={`w-20 h-20 rounded-2xl border-2 flex items-center justify-center mb-5 bg-white shadow-sm ${s.color}`}>
                  {s.icon}
                </div>
                <span className="text-xs font-bold text-gray-400 mb-1 tracking-widest uppercase">Paso {s.step}</span>
                <h3 className="font-heading font-bold text-xl text-charcoal mb-2">{s.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed max-w-xs">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 px-6 lg:px-16 py-20 max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="font-heading font-bold text-3xl text-charcoal mb-3">Todo lo que necesitas en un solo lugar</h2>
          <p className="text-gray-500">Una plataforma completa diseñada para el aprendizaje activo y la evaluación formativa.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              icon: <BookOpen className="w-5 h-5" />,
              title: 'Lecciones en video',
              desc: 'Contenido estructurado por módulos con puntos clave generados con IA.',
              iconBg: 'bg-cyan-50 text-cyan-600',
              border: 'border-cyan-100',
            },
            {
              icon: <ClipboardCheck className="w-5 h-5" />,
              title: 'Quiz interactivo',
              desc: 'Preguntas de selección múltiple con retroalimentación inmediata por módulo.',
              iconBg: 'bg-purple-50 text-purple-600',
              border: 'border-purple-100',
            },
            {
              icon: <MessageCircle className="w-5 h-5" />,
              title: 'Reflexión guiada',
              desc: 'Escribe tu aprendizaje y recibe feedback personalizado de tu evaluador.',
              iconBg: 'bg-emerald-50 text-emerald-600',
              border: 'border-emerald-100',
            },
            {
              icon: <Shield className="w-5 h-5" />,
              title: 'Autenticidad con IA',
              desc: 'Cada reflexión pasa por un filtro de IA para garantizar trabajo original.',
              iconBg: 'bg-indigo-50 text-indigo-600',
              border: 'border-indigo-100',
            },
            {
              icon: <Users className="w-5 h-5" />,
              title: 'Chat grupal',
              desc: 'Comunícate con tu grupo de curso y evaluadores en tiempo real.',
              iconBg: 'bg-sky-50 text-sky-600',
              border: 'border-sky-100',
            },
            {
              icon: <Calendar className="w-5 h-5" />,
              title: 'Calendario de eventos',
              desc: 'Visualiza fechas importantes del programa publicadas por tu institución.',
              iconBg: 'bg-rose-50 text-rose-600',
              border: 'border-rose-100',
            },
            {
              icon: <TrendingUp className="w-5 h-5" />,
              title: 'Progreso en tiempo real',
              desc: 'Seguimiento detallado de tu avance por módulo con historial de actividad.',
              iconBg: 'bg-orange-50 text-orange-600',
              border: 'border-orange-100',
            },
            {
              icon: <Bell className="w-5 h-5" />,
              title: 'Notificaciones push',
              desc: 'Alertas instantáneas cuando tu evaluador responde o hay novedades del curso.',
              iconBg: 'bg-amber-50 text-amber-600',
              border: 'border-amber-100',
            },
          ].map((f) => (
            <div
              key={f.title}
              className={`rounded-2xl bg-white border ${f.border} p-5 shadow-sm hover:shadow-md transition-shadow`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${f.iconBg}`}>
                {f.icon}
              </div>
              <h3 className="font-heading font-bold text-charcoal text-sm mb-1.5">{f.title}</h3>
              <p className="text-gray-500 text-xs leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Certificate CTA */}
      <section className="relative z-10 px-6 lg:px-16 py-20 bg-gray-50 border-y border-border">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-3xl border border-amber-100 shadow-sm p-10 md:p-14 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-shrink-0 w-20 h-20 rounded-2xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
              <Award className="w-10 h-10 text-amber-500" />
            </div>
            <div className="text-center md:text-left flex-1">
              <h2 className="font-heading font-bold text-2xl md:text-3xl text-charcoal mb-3">
                Tu esfuerzo merece un certificado
              </h2>
              <p className="text-gray-500 leading-relaxed mb-2">
                Al completar todos los módulos y aprobar tus reflexiones, obtienes un <strong className="text-charcoal">certificado digital personalizado</strong> generado con inteligencia artificial, con tu nombre, programa y sello de autenticidad.
              </p>
              <div className="flex flex-wrap gap-3 justify-center md:justify-start mt-4">
                {['Nombre personalizado', 'Sello digital', 'URL pública', 'Generado con IA'].map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
                    <CheckCircle className="w-3 h-3" /> {tag}
                  </span>
                ))}
              </div>
            </div>
            <Link
              href="/register"
              className="flex-shrink-0 inline-flex items-center gap-2 bg-cta-gradient text-white font-heading font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-opacity text-sm whitespace-nowrap"
            >
              Comenzar <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* AI Badge */}
      <section className="relative z-10 px-6 lg:px-16 py-12">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-full text-sm font-semibold text-indigo-600 mb-4">
            <Zap className="w-4 h-4" /> Potenciado por Amazon Bedrock · Claude AI
          </div>
          <p className="text-gray-400 text-sm max-w-xl mx-auto">
            Lux Learning usa inteligencia artificial de última generación para generar contenido de cursos, detectar autenticidad en reflexiones y crear certificados personalizados.
          </p>
        </div>
      </section>

      {/* Copyright mínimo */}
      <div className="relative z-10 py-8 text-center">
        <p className="text-gray-400 text-xs">
          &copy; {new Date().getFullYear()} Lux Learning. Todos los derechos reservados.
        </p>
      </div>
    </div>
  );
}
