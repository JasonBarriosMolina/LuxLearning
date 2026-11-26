import Link from 'next/link';
import { ArrowRight, BookOpen, Building2, Presentation } from 'lucide-react';
import { AUDIENCE_CARDS } from './content';

const TONES = {
  royal: 'bg-[linear-gradient(150deg,#1F6FB2,#2F8FDB)]',
  deep: 'bg-[linear-gradient(150deg,#0F2D4A,#17527E)]',
  cyan: 'bg-[linear-gradient(150deg,#17527E,#1FA2C7)]',
} as const;

const ICONS = { '/cursos': BookOpen, '/instituciones': Building2, '/profesores': Presentation } as const;

export function AudienceCards() {
  return (
    <section className="px-5 py-24 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <h2 className="max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] text-lx-navy md:text-5xl">
          Lux se adapta a cómo aprendes y enseñas
        </h2>
        <ul className="mt-12 grid gap-6 lg:grid-cols-3">
          {AUDIENCE_CARDS.map((card) => {
            const Icon = ICONS[card.href as keyof typeof ICONS];
            return (
              <li key={card.href}>
                <Link
                  href={card.href}
                  className={`group relative flex h-full min-h-[320px] flex-col overflow-hidden rounded-[28px] p-8 text-white shadow-[0_30px_60px_-30px_rgba(15,45,74,0.7)] transition-transform duration-300 hover:-translate-y-1 ${TONES[card.tone]}`}
                >
                  <div className="lx-dots pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
                  <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <p className="relative mt-6 text-sm font-bold text-white/80">{card.label}</p>
                  <h3 className="relative mt-2 text-2xl font-extrabold leading-tight tracking-[-0.02em]">{card.title}</h3>
                  <p className="relative mt-3 flex-1 leading-relaxed text-white/80">{card.text}</p>
                  <span className="relative mt-8 inline-flex items-center gap-2 font-bold">
                    {card.cta}
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
