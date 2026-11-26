import type { Metadata } from 'next';
import { BadgeCheck, PlayCircle, Radio } from 'lucide-react';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { PageHero, ValueStrip, StepsSection, CtaBand } from '@/components/landing/sections';
import { CourseShowcase } from '@/components/landing/CourseShowcase';
import { MentorSection } from '@/components/landing/MentorSection';
import { CertificateSection } from '@/components/landing/CertificateSection';
import { Faq } from '@/components/landing/Faq';
import { COURSES, COURSES_FAQ } from '@/components/landing/content';

export const metadata: Metadata = {
  title: 'Cursos',
  description: 'Cursos en vivo y a tu ritmo, con la guía de profesionales en cada módulo y un certificado verificable al terminar.',
};

const PROGRESS = [
  { title: 'Comunicación efectiva', modality: 'En vivo', pct: 72, bar: 'from-[#1FA2C7] to-[#2F8FDB]' },
  { title: 'Liderazgo que inspira', modality: 'A tu ritmo', pct: 40, bar: 'from-[#17527E] to-[#2F8FDB]' },
];

/** A glimpse of the student's dashboard: what you get once you sign up. */
function ProgressPreview() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -right-8 -top-10 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(31,162,199,0.3),transparent_70%)] blur-2xl" aria-hidden="true" />
      <div className="lx-edge relative rounded-[28px] bg-[rgba(255,255,255,0.85)] p-6 shadow-[0_30px_80px_-40px_rgba(15,45,74,0.45)] backdrop-blur-sm sm:p-8">
        <p className="text-sm font-semibold text-lx-muted">Tu progreso</p>
        <p className="mt-1 text-2xl font-extrabold tracking-[-0.02em] text-lx-navy">Hola, Mariana</p>
        <ul className="mt-6 space-y-4">
          {PROGRESS.map((c) => (
            <li key={c.title} className="rounded-2xl bg-lx-ice/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold text-lx-navy">{c.title}</p>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-lx-royal">
                  {c.modality === 'En vivo' ? <Radio className="h-3.5 w-3.5" aria-hidden="true" /> : <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                  {c.modality}
                </span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white">
                <div className={`h-full rounded-full bg-gradient-to-r ${c.bar}`} style={{ width: `${c.pct}%` }} />
              </div>
              <p className="mt-2 text-xs font-semibold text-lx-muted">{c.pct}% completado</p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-[rgba(226,186,80,0.5)] bg-white p-4">
          <BadgeCheck className="h-6 w-6 shrink-0 text-lux-gold" aria-hidden="true" />
          <p className="text-sm font-bold text-lx-navy">Certificado de Gestión del tiempo listo para compartir</p>
        </div>
      </div>
    </div>
  );
}

export default function CursosPage() {
  return (
    <>
      <LandingNav />
      <main>
        <PageHero
          title="Aprende lo que necesitas, a tu manera"
          subtitle="Clases en vivo o cursos a tu propio ritmo, con un profesional que revisa tu trabajo y te ayuda a mejorar en cada paso."
          primary={{ label: 'Crear mi cuenta', href: '/register' }}
          secondary={{ label: 'Ver el catálogo', href: '#catalogo' }}
          aside={<ProgressPreview />}
        />
        <ValueStrip />
        <CourseShowcase
          id="catalogo"
          title="Elige tu próximo curso"
          text="Programas prácticos para crecer en tu trabajo y en tu vida. Crea tu cuenta y empieza el que más te guste."
          courses={COURSES}
          showAllLink={false}
        />
        <MentorSection />
        <StepsSection
          title="Empieza en tres pasos"
          intro="Crear tu cuenta toma un par de minutos. Después, solo te queda aprender."
          steps={[
            { title: 'Crea tu cuenta', desc: 'Regístrate con tu correo y entra desde cualquier dispositivo.' },
            { title: 'Elige tu curso', desc: 'Revisa el programa, la modalidad y lo que vas a lograr al terminarlo.' },
            { title: 'Aprende y certifícate', desc: 'Avanza con la guía de tu evaluador y recibe tu certificado al completar el programa.' },
          ]}
        />
        <CertificateSection />
        <Faq items={COURSES_FAQ} />
        <CtaBand
          title="Tu próximo aprendizaje empieza hoy"
          text="Crea tu cuenta en minutos y da el primer paso con la guía de un profesional."
          primary={{ label: 'Crear mi cuenta', href: '/register' }}
          secondary={{ label: 'Ver el catálogo', href: '#catalogo' }}
        />
      </main>
      <LandingFooter />
    </>
  );
}
