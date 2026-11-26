import { Plus } from 'lucide-react';
import type { FaqItem } from './content';

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <section className="bg-lx-ice/70 px-5 py-24 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <h2 className="text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] text-lx-navy md:text-5xl">Preguntas frecuentes</h2>
          <p className="mt-4 text-lg leading-relaxed text-lx-muted">
            ¿Te queda alguna duda? Escríbenos a{' '}
            <a href="mailto:sales@luxlearning.academy" className="font-semibold text-lx-royal underline-offset-4 hover:underline">
              sales@luxlearning.academy
            </a>
            .
          </p>
        </div>
        <div className="space-y-3">
          {items.map((item) => (
            <details key={item.q} className="lx-faq group rounded-2xl bg-lx-paper ring-1 ring-lx-line open:ring-[rgba(47,143,219,0.55)]">
              <summary className="flex items-center justify-between gap-6 p-6 text-lg font-bold text-lx-navy">
                {item.q}
                <span className="lx-faq-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lx-ice text-lx-royal group-open:bg-lx-royal group-open:text-white">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </span>
              </summary>
              <p className="-mt-2 px-6 pb-6 leading-relaxed text-lx-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
