import { Check } from 'lucide-react';
import { MENTOR_POINTS } from './content';

/** The differentiator: a real person reads your work. Shown as a reflection with margin notes. */
export function MentorSection() {
  return (
    <section className="px-5 py-24 lg:px-10">
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-2">
        <div>
          <h2 className="text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] text-lx-navy md:text-5xl">Aquí nunca aprendes solo</h2>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-lx-muted">
            Cada trabajo que entregas lo lee un profesional. Te responde con comentarios claros para que sepas qué hiciste bien
            y cómo dar el siguiente paso.
          </p>
          <ul className="mt-8 space-y-4">
            {MENTOR_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[1.05rem] font-medium">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4A9BDB,#17527E)] text-white">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>

        <figure className="relative" aria-label="Ejemplo de una reflexión revisada por un evaluador">
          <div className="rounded-3xl bg-lx-paper p-7 shadow-[0_30px_80px_-40px_rgba(29,50,71,0.4)] ring-1 ring-lx-line sm:p-9">
            <p className="text-sm font-semibold text-lx-soft">Reflexión · Módulo 2 · Liderazgo que inspira</p>
            <p className="mt-4 leading-[1.8] text-lx-ink">
              En mi equipo, las reuniones de los lunes se alargan porque nadie sabe qué decidir.{' '}
              <mark className="rounded bg-[rgba(248,222,148,0.6)] px-0.5 text-lx-ink">
                Voy a empezar cada reunión con una sola pregunta clara
              </mark>{' '}
              y cerrar con quién hace qué y para cuándo. Creo que así todos sabrán qué esperar.
            </p>
          </div>

          <div className="lx-edge relative -mt-6 ml-6 rounded-2xl bg-lx-paper p-5 shadow-[0_24px_60px_-28px_rgba(23,82,126,0.45)] sm:ml-16 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,#3E8FD0,#17527E)] text-sm font-bold text-white">
                AM
              </span>
              <div>
                <p className="text-sm font-bold">Ana Morales</p>
                <p className="text-xs font-medium text-lx-muted">Evaluadora · Consultora en gestión de equipos</p>
              </div>
            </div>
            <blockquote className="mt-4 italic leading-relaxed text-lx-ink">
              “Excelente decisión: una pregunta clara cambia toda la reunión. Para tu próxima entrega, cuéntame cómo vas a saber
              si funcionó. ¿Qué medirías después de un mes?”
            </blockquote>
          </div>
        </figure>
      </div>
    </section>
  );
}
