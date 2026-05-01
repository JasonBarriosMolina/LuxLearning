'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, BookOpen, ClipboardCheck, TrendingUp, Shield } from 'lucide-react';
import { PrismaLogo } from '@/components/shared/PrismaLogo';
import { useAuth } from '@/lib/hooks/useAuth';

export default function LandingPage() {
  const { isAuthenticated, isLoading, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(role === 'EVALUATOR' || role === 'ADMIN' ? '/evaluator/dashboard' : '/dashboard');
    }
  }, [isLoading, isAuthenticated, role, router]);

  if (isLoading || isAuthenticated) {
    return (
      <div className="min-h-screen bg-charcoal flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cta-from border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-charcoal text-white overflow-hidden">
      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-cta-from/15 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-40 w-[500px] h-[500px] bg-cta-to/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 right-1/3 w-[400px] h-[400px] bg-cta-from/10 rounded-full blur-3xl" />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-6 lg:px-16 py-5">
        <PrismaLogo size={32} />
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-white/70 hover:text-white text-sm font-medium transition-colors">
            Iniciar sesión
          </Link>
          <Link
            href="/register"
            className="bg-white text-charcoal text-sm font-semibold px-4 py-2 rounded-xl hover:bg-white/90 transition-colors"
          >
            Registrarse
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 px-6 lg:px-16 pt-20 pb-24 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-full text-xs font-semibold text-white/80 mb-8 border border-white/10">
          <span className="w-2 h-2 rounded-full bg-cta-from animate-pulse" />
          Plataforma de aprendizaje activo
        </div>

        <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl leading-tight mb-6">
          Claridad que{' '}
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#00B4D8] to-[#7B2FBE]">
            transforma
          </span>
        </h1>

        <p className="text-white/60 text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
          Aprende a tu ritmo con lecciones en video, evaluaciones y reflexiones guiadas.
          Cada módulo desbloqueado es un paso real en tu crecimiento.
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
            className="inline-flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-heading font-semibold px-8 py-4 rounded-xl hover:bg-white/15 transition-colors text-base"
          >
            Ya tengo cuenta
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 px-6 lg:px-16 pb-24 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              icon: <BookOpen className="w-6 h-6" />,
              title: 'Lecciones en video',
              desc: 'Contenido estructurado en módulos con puntos clave y consejos prácticos.',
              color: 'from-cyan-500/20 to-cyan-500/5',
              iconBg: 'bg-cyan-500/20 text-cyan-400',
            },
            {
              icon: <ClipboardCheck className="w-6 h-6" />,
              title: 'Quiz por módulo',
              desc: 'Evalúa tu comprensión antes de avanzar. Retroalimentación inmediata.',
              color: 'from-purple-500/20 to-purple-500/5',
              iconBg: 'bg-purple-500/20 text-purple-400',
            },
            {
              icon: <TrendingUp className="w-6 h-6" />,
              title: 'Reflexión guiada',
              desc: 'Escribe y comparte tu aprendizaje. Un evaluador te da retroalimentación personal.',
              color: 'from-emerald-500/20 to-emerald-500/5',
              iconBg: 'bg-emerald-500/20 text-emerald-400',
            },
            {
              icon: <Shield className="w-6 h-6" />,
              title: 'Progreso real',
              desc: 'Cada módulo se desbloquea solo cuando realmente lo completaste.',
              color: 'from-amber-500/20 to-amber-500/5',
              iconBg: 'bg-amber-500/20 text-amber-400',
            },
          ].map((f) => (
            <div
              key={f.title}
              className={`relative overflow-hidden rounded-2xl bg-gradient-to-b ${f.color} border border-white/10 p-5`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${f.iconBg}`}>
                {f.icon}
              </div>
              <h3 className="font-heading font-bold text-white text-base mb-1.5">{f.title}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 px-6 lg:px-16 pb-20 text-center">
        <p className="text-white/30 text-sm">
          &copy; {new Date().getFullYear()} Lux Learning. Claridad que transforma.
        </p>
      </section>
    </div>
  );
}
