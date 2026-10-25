import Image from 'next/image';
import { BadgeCheck, Link2, Linkedin } from 'lucide-react';

const PERKS = [
  { icon: BadgeCheck, text: 'Cualquiera puede verificarlo en línea' },
  { icon: Link2, text: 'Una dirección propia para compartirlo' },
  { icon: Linkedin, text: 'Listo para tu perfil de LinkedIn' },
];

export function CertificateSection() {
  return (
    <section className="lx-band-deep relative overflow-hidden px-5 py-24 lg:px-10">
      <div className="lx-dots pointer-events-none absolute inset-y-0 left-0 w-1/2 opacity-40" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-2">
        <div className="lg:order-2">
          <h2 className="text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] md:text-5xl">Un certificado que habla por ti</h2>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/80">
            Al terminar tu programa recibes un certificado con tu nombre que cualquiera puede verificar. Compártelo con tu empresa
            o súmalo a tu perfil profesional.
          </p>
          <ul className="mt-8 space-y-3">
            {PERKS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-[1.05rem] font-semibold ring-1 ring-white/15">
                <Icon className="h-5 w-5 shrink-0 text-[#9FD3F5]" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:order-1">
          <div className="mx-auto max-w-lg -rotate-2 rounded-[28px] bg-lx-paper p-3 text-lx-ink shadow-[0_50px_90px_-40px_rgba(0,0,0,0.6)] transition-transform duration-500 hover:rotate-0">
            <div className="rounded-[20px] border border-[rgba(226,186,80,0.55)] px-8 py-10 text-center sm:px-12">
              <Image src="/lux-logo-fullcolor.svg" alt="" width={120} height={35} className="mx-auto" aria-hidden="true" />
              <p className="mt-8 text-sm font-medium text-lx-soft">Este certificado se otorga a</p>
              <p className="mt-2 text-3xl font-extrabold tracking-[-0.02em] text-lx-navy">Mariana López</p>
              <p className="mt-5 text-sm font-medium text-lx-soft">por completar con éxito el programa</p>
              <p className="lx-gold-text mt-2 text-xl font-extrabold">Liderazgo que inspira</p>
              <div className="mt-9 flex items-center justify-between gap-4 border-t border-lx-line pt-5 text-xs font-medium text-lx-soft">
                <span>Emitido en 2026</span>
                <span className="inline-flex items-center gap-1 font-bold text-lx-royal">
                  <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                  Verificado
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
