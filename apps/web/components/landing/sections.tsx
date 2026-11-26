import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, Clock, GraduationCap, BadgeCheck } from 'lucide-react';
import { JourneyTimeline, type JourneyStep } from './JourneyTimeline';
import { VALUE_POINTS } from './content';

type Action = { label: string; href: string };

const H2 = 'text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] md:text-5xl';

/** Top of each audience page: headline and actions on the left, a visual on the right. */
export function PageHero({ title, subtitle, primary, secondary, aside }: {
  title: string;
  subtitle: string;
  primary: Action;
  secondary?: Action;
  aside: ReactNode;
}) {
  return (
    <section className="lx-glow-hero relative overflow-hidden px-5 pb-20 pt-14 lg:px-10 lg:pb-24 lg:pt-20">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <h1 className="text-[2.6rem] font-extrabold leading-[1.04] tracking-[-0.04em] text-lx-navy sm:text-6xl">{title}</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-lx-muted sm:text-xl">{subtitle}</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link href={primary.href} className="lx-btn lx-btn-blue">
              {primary.label}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            {secondary && (
              <Link href={secondary.href} className="lx-btn lx-btn-ghost">
                {secondary.label}
              </Link>
            )}
          </div>
        </div>
        {aside}
      </div>
    </section>
  );
}

const VALUE_ICONS = { clock: Clock, guide: GraduationCap, badge: BadgeCheck } as const;
const VALUE_TINTS = [
  'bg-[linear-gradient(135deg,#2F8FDB,#17527E)]',
  'bg-[linear-gradient(135deg,#1FA2C7,#1F6FB2)]',
  'bg-[linear-gradient(135deg,#1F6FB2,#0F2D4A)]',
];

/** Three quick reasons, readable at a glance. */
export function ValueStrip() {
  return (
    <section className="relative z-10 -mt-10 px-5 lg:px-10">
      <ul className="mx-auto grid max-w-7xl gap-4 rounded-[28px] bg-lx-paper p-4 shadow-[0_30px_70px_-35px_rgba(15,45,74,0.45)] ring-1 ring-lx-line sm:p-6 md:grid-cols-3">
        {VALUE_POINTS.map((v, i) => {
          const Icon = VALUE_ICONS[v.icon];
          return (
            <li key={v.title} className="flex items-start gap-4 rounded-2xl p-3">
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_10px_24px_-12px_rgba(23,82,126,0.8)] ${VALUE_TINTS[i]}`}>
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <p className="text-lg font-extrabold text-lx-navy">{v.title}</p>
                <p className="mt-1 leading-relaxed text-lx-muted">{v.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type Feature = { title: string; desc: string };

const FEATURE_BARS = ['from-[#17527E] to-[#2F8FDB]', 'from-[#1F6FB2] to-[#1FA2C7]', 'from-[#0F2D4A] to-[#1F6FB2]'];

export function FeatureGrid({ title, intro, features }: { title: string; intro?: string; features: Feature[] }) {
  return (
    <section className="lx-dots-blue px-5 py-24 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <h2 className={`max-w-2xl text-lx-navy ${H2}`}>{title}</h2>
        {intro && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-lx-muted">{intro}</p>}
        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => (
            <div key={feature.title} className="rounded-3xl bg-lx-paper p-7 ring-1 ring-lx-line">
              <span className={`block h-1.5 w-14 rounded-full bg-gradient-to-r ${FEATURE_BARS[i % FEATURE_BARS.length]}`} aria-hidden="true" />
              <h3 className="mt-5 text-xl font-extrabold tracking-[-0.02em] text-lx-navy">{feature.title}</h3>
              <p className="mt-3 leading-relaxed text-lx-muted">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function StepsSection({ title, intro, steps }: { title: string; intro?: string; steps: JourneyStep[] }) {
  return (
    <section className="px-5 py-24 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1fr_1.5fr]">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <h2 className={`text-lx-navy ${H2}`}>{title}</h2>
          {intro && <p className="mt-4 max-w-md text-lg leading-relaxed text-lx-muted">{intro}</p>}
        </div>
        <JourneyTimeline steps={steps} />
      </div>
    </section>
  );
}

/** Closing call to action on a bright blue band. */
export function CtaBand({ title, text, primary, secondary }: { title: string; text: string; primary: Action; secondary?: Action }) {
  return (
    <section className="px-5 py-20 lg:px-10">
      <div className="lx-band-bright relative mx-auto max-w-7xl overflow-hidden rounded-[36px] px-8 py-16 sm:px-14 sm:py-20">
        <div className="lx-dots pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-60" aria-hidden="true" />
        <div className="relative max-w-2xl">
          <h2 className="text-4xl font-extrabold leading-[1.06] tracking-[-0.035em] sm:text-5xl">{title}</h2>
          <p className="mt-5 text-lg leading-relaxed text-white/85">{text}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href={primary.href} className="lx-btn lx-btn-white">
              {primary.label}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            {secondary && (
              <Link href={secondary.href} className="lx-btn lx-btn-outline-white">
                {secondary.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
