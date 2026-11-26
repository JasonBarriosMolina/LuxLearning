import Link from 'next/link';
import Image from 'next/image';
import { AUDIENCE_LINKS } from './audience-links';

export function LandingFooter() {
  return (
    <footer className="border-t border-lx-line bg-lx-paper">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr] lg:px-10">
        <div className="max-w-sm">
          <Image src="/lux-logo-fullcolor.svg" alt="Lux Learning" width={148} height={43} />
          <p className="mt-4 leading-relaxed text-lx-muted">
            Cursos diseñados a tu medida, guiados por profesionales que te acompañan en cada paso.
          </p>
        </div>
        <nav aria-label="Explora">
          <p className="text-sm font-bold text-lx-ink">Explora</p>
          <ul className="mt-4 space-y-3 text-lx-muted">
            {AUDIENCE_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="transition-colors hover:text-cta-from">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Tu cuenta y contacto">
          <p className="text-sm font-bold text-lx-ink">Contacto</p>
          <ul className="mt-4 space-y-3 text-lx-muted">
            <li>
              <a href="mailto:sales@luxlearning.academy" className="transition-colors hover:text-cta-from">sales@luxlearning.academy</a>
            </li>
            <li>
              <Link href="/login" className="transition-colors hover:text-cta-from">Iniciar sesión</Link>
            </li>
          </ul>
        </nav>
      </div>
      <p className="border-t border-lx-line/70 px-5 py-6 text-center text-sm text-lx-soft">
        &copy; {new Date().getFullYear()} Lux Learning. Todos los derechos reservados.
      </p>
    </footer>
  );
}
