import { BadgeCheck, CheckCircle2, MessageSquareQuote } from 'lucide-react';
import { HeroRoute } from './HeroRoute';

/** Hero composition: the interactive route plus small cards that hint at the product. */
export function HeroVisual() {
  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute -right-6 -top-8 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,143,219,0.35),transparent_70%)] blur-2xl"
        aria-hidden="true"
      />
      <div className="lx-dots-blue pointer-events-none absolute -bottom-8 -left-8 h-40 w-40 rounded-3xl" aria-hidden="true" />

      <HeroRoute />

      <div className="absolute -left-6 -top-14 hidden items-center gap-3 rounded-2xl bg-lx-paper px-4 py-3 shadow-[0_18px_40px_-20px_rgba(15,45,74,0.55)] ring-1 ring-lx-line sm:flex" aria-hidden="true">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#1FA2C7,#1F6FB2)] text-white">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-extrabold text-lx-navy">Quiz aprobado</p>
          <p className="text-xs font-medium text-lx-muted">3 de 4 correctas</p>
        </div>
      </div>

      <div className="absolute -bottom-7 right-4 hidden items-center gap-3 rounded-2xl bg-lx-paper px-4 py-3 shadow-[0_18px_40px_-20px_rgba(15,45,74,0.55)] ring-1 ring-lx-line sm:flex" aria-hidden="true">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#2F8FDB,#0F2D4A)] text-white">
          <MessageSquareQuote className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-extrabold text-lx-navy">Nuevo comentario</p>
          <p className="text-xs font-medium text-lx-muted">Tu evaluadora revisó tu reflexión</p>
        </div>
        <BadgeCheck className="ml-1 h-5 w-5 text-lux-gold" />
      </div>
    </div>
  );
}
