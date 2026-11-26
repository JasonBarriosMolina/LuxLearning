import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AuthRedirect } from '@/components/landing/AuthRedirect';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { HeroVisual } from '@/components/landing/HeroVisual';
import { ValueStrip, CtaBand } from '@/components/landing/sections';
import { CourseShowcase } from '@/components/landing/CourseShowcase';
import { MentorSection } from '@/components/landing/MentorSection';
import { CertificateSection } from '@/components/landing/CertificateSection';
import { AudienceCards } from '@/components/landing/AudienceCards';
import { Faq } from '@/components/landing/Faq';
import { COURSES, HOME_FAQ } from '@/components/landing/content';

export const metadata: Metadata = {
  title: { absolute: 'Lux Learning · Cursos diseñados a tu medida, guiados por profesionales' },
  description:
    'Aprende paso a paso, recibe la guía de profesionales en cada módulo y obtén un certificado verificable. Cursos en vivo y a tu ritmo.',
  openGraph: {
    title: 'Cursos diseñados a tu medida, guiados por profesionales',
    description: 'Aprende paso a paso, recibe la guía de profesionales y obtén un certificado verificable.',
  },
};

export default function LandingPage() {
  return (
    <>
      <AuthRedirect />
      <LandingNav />

      <main>
        <section className="lx-glow-hero overflow-hidden px-5 pb-28 pt-14 lg:px-10 lg:pb-36 lg:pt-20">
          <div className="mx-auto grid max-w-7xl items-center gap-16 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-lx-ice px-4 py-2 text-sm font-bold text-lx-royal ring-1 ring-[rgba(47,143,219,0.25)]">
                <span className="h-2 w-2 rounded-full bg-lux-gold" aria-hidden="true" />
                Cursos en vivo y a tu ritmo
              </p>
              <h1 className="mt-6 text-[2.75rem] font-extrabold leading-[1.02] tracking-[-0.04em] text-lx-navy sm:text-6xl lg:text-[4.25rem]">
                Cursos diseñados a tu medida, guiados por profesionales
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-relaxed text-lx-muted sm:text-xl">
                Avanza paso a paso, recibe la opinión de un experto en cada módulo y termina con un certificado que respalda lo
                que sabes.
              </p>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Link href="/cursos" className="lx-btn lx-btn-blue">
                  Explorar cursos
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link href="/register" className="lx-btn lx-btn-ghost">
                  Crear mi cuenta
                </Link>
              </div>
            </div>
            <HeroVisual />
          </div>
        </section>

        <ValueStrip />

        <CourseShowcase
          title="Encuentra tu próximo curso"
          text="Programas prácticos, pensados para que apliques lo que aprendes desde la primera semana."
          courses={COURSES.slice(0, 3)}
        />
        <MentorSection />
        <CertificateSection />
        <AudienceCards />
        <Faq items={HOME_FAQ} />
        <CtaBand
          title="Tu siguiente paso profesional empieza hoy"
          text="Elige un curso, aprende con la guía de profesionales y lleva tu certificado a donde vayas."
          primary={{ label: 'Explorar cursos', href: '/cursos' }}
          secondary={{ label: 'Crear mi cuenta', href: '/register' }}
        />
      </main>

      <LandingFooter />
    </>
  );
}
