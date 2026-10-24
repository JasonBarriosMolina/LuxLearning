import type { Metadata } from 'next';
import { ArrowRight, BarChart3, BookOpenCheck, Check, ClipboardCheck, Sparkles, type LucideIcon } from 'lucide-react';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { PageHero, CtaBand } from '@/components/landing/sections';
import { MINI_APPS, MINI_APPS_NOTIFY_HREF, TEACH_WITH_US, type MiniApp } from '@/components/landing/content';

export const metadata: Metadata = {
  title: 'Para profesores',
  description: 'Mini apps para tu día a día como profesor, o súmate al equipo de profesionales de Lux Learning.',
};

const H2 = 'text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] md:text-5xl';
const APP_ICONS: Record<MiniApp['icon'], LucideIcon> = { chart: BarChart3, plan: BookOpenCheck, check: ClipboardCheck };
const APP_TINTS = ['from-[#17527E] to-[#2F8FDB]', 'from-[#1F6FB2] to-[#1FA2C7]', 'from-[#0F2D4A] to-[#1F6FB2]'];

/** A glimpse of the lesson-planning mini app. */
function PlanPreview() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -right-8 -top-10 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(31,162,199,0.3),transparent_70%)] blur-2xl" aria-hidden="true" />
      <div className="lx-edge relative rounded-[28px] bg-[rgba(255,255,255,0.88)] p-6 shadow-[0_30px_80px_-40px_rgba(15,45,74,0.45)] backdrop-blur-sm sm:p-8">
        <p className="text-sm font-semibold text-lx-muted">Planeamiento · 3.er grado · Matemáticas</p>
        <p className="mt-1 text-2xl font-extrabold tracking-[-0.02em] text-lx-navy">Fracciones en la vida diaria</p>
        <ul className="mt-6 space-y-3">
          {['Objetivo: comparar fracciones con ejemplos de cocina', 'Actividad en parejas de 15 minutos', 'Evaluación rápida con 3 preguntas'].map((item) => (
            <li key={item} className="flex items-start gap-3 rounded-2xl bg-lx-ice/80 p-3.5 font-semibold text-lx-navy">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2F8FDB,#17527E)] text-white">
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
              </span>
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-[rgba(226,186,80,0.55)] bg-white px-3 py-1.5 text-sm font-bold text-lx-navy">
          <Sparkles className="h-4 w-4 text-lux-gold" aria-hidden="true" />
          Listo para usar en clase
        </p>
      </div>
    </div>
  );
}

export default function ProfesoresPage() {
  return (
    <>
      <LandingNav />
      <main>
        <PageHero
          title="Enseña con mejores herramientas, o enseña con nosotros"
          subtitle="Usa nuestras mini apps para planear, evaluar y dar seguimiento en menos tiempo. O súmate al equipo de profesionales que acompaña a nuestros estudiantes."
          primary={{ label: 'Conocer las mini apps', href: '#mini-apps' }}
          secondary={{ label: 'Quiero enseñar con Lux', href: '#ensena' }}
          aside={<PlanPreview />}
        />

        <section id="mini-apps" className="lx-dots-blue scroll-mt-24 px-5 py-24 lg:px-10">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="max-w-2xl">
                <h2 className={`text-lx-navy ${H2}`}>Mini apps para tu día a día</h2>
                <p className="mt-4 text-lg leading-relaxed text-lx-muted">
                  Herramientas pensadas por y para profesores. Úsalas solas o junto con tus cursos en Lux.
                </p>
              </div>
              <a href={MINI_APPS_NOTIFY_HREF} className="lx-btn lx-btn-blue shrink-0 self-start md:self-auto">
                Quiero conocerlas
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
            <ul className="mt-12 grid gap-6 md:grid-cols-3">
              {MINI_APPS.map((app, i) => {
                const Icon = APP_ICONS[app.icon];
                return (
                  <li key={app.title} className="flex flex-col rounded-3xl bg-lx-paper p-7 ring-1 ring-lx-line">
                    <div className="flex items-start justify-between">
                      <span className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-[0_12px_28px_-14px_rgba(23,82,126,0.9)] ${APP_TINTS[i % APP_TINTS.length]}`}>
                        <Icon className="h-7 w-7" aria-hidden="true" />
                      </span>
                      <span className="rounded-full bg-lx-ice px-3 py-1 text-xs font-bold text-lx-royal">Próximamente</span>
                    </div>
                    <h3 className="mt-6 text-xl font-extrabold tracking-[-0.02em] text-lx-navy">{app.title}</h3>
                    <p className="mt-2 leading-relaxed text-lx-muted">{app.text}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section id="ensena" className="lx-band-deep relative scroll-mt-20 overflow-hidden px-5 py-24 lg:px-10">
          <div className="lx-dots pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-40" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-2">
            <div>
              <h2 className={H2}>{TEACH_WITH_US.title}</h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/80">{TEACH_WITH_US.text}</p>
              <a href={TEACH_WITH_US.applyHref} className="lx-btn lx-btn-white mt-9">
                Postularme
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
            <ul className="space-y-4">
              {TEACH_WITH_US.points.map((point) => (
                <li key={point} className="flex items-start gap-4 rounded-2xl bg-white/10 p-5 text-lg font-semibold ring-1 ring-white/15">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-lx-royal">
                    <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <CtaBand
          title="¿Ya enseñas en Lux?"
          text="Entra a tu panel para revisar entregas, pasar asistencia y acompañar a tus estudiantes."
          primary={{ label: 'Iniciar sesión', href: '/login' }}
        />
      </main>
      <LandingFooter />
    </>
  );
}
