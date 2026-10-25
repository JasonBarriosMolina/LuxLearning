import type { Metadata } from 'next';
import { Clock, GraduationCap, Laptop } from 'lucide-react';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { TeacherApplicationForm } from '@/components/landing/TeacherApplicationForm';
import { ONBOARDING_STEPS } from '@/components/landing/content';

export const metadata: Metadata = {
  title: 'Enseña con Lux',
  description: 'Postúlate para crear cursos y acompañar estudiantes como profesional de Lux Learning.',
};

const FACTS = [
  { icon: Clock, text: 'Te toma unos 10 minutos' },
  { icon: Laptop, text: 'Trabajo remoto y horarios flexibles' },
  { icon: GraduationCap, text: 'Te acompañamos a crear tu primer curso' },
];

export default function PostularPage() {
  return (
    <>
      <LandingNav />
      <main className="lx-glow-hero overflow-hidden px-5 pb-24 pt-12 lg:px-10 lg:pt-16">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.8fr_1.4fr]">
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <h1 className="text-[2.4rem] font-extrabold leading-[1.05] tracking-[-0.04em] text-lx-navy sm:text-5xl">Enseña con Lux</h1>
            <p className="mt-5 text-lg leading-relaxed text-lx-muted">
              Cuéntanos sobre tu experiencia y el curso que te gustaría crear. Con tus respuestas preparamos tu proceso de
              incorporación.
            </p>
            <ul className="mt-8 space-y-3">
              {FACTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 font-semibold text-lx-navy">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lx-ice text-lx-royal">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
            <div className="mt-10 hidden rounded-3xl bg-lx-paper p-6 ring-1 ring-lx-line lg:block">
              <p className="font-extrabold text-lx-navy">Después de postularte</p>
              <ol className="mt-4 space-y-4">
                {ONBOARDING_STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2F8FDB,#17527E)] text-sm font-extrabold text-white">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-bold text-lx-navy">{s.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-lx-muted">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </aside>
          <TeacherApplicationForm />
        </div>
      </main>
      <LandingFooter />
    </>
  );
}
