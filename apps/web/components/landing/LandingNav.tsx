'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';

import { AUDIENCE_LINKS } from './audience-links';

export function LandingNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-lx-line/70 bg-[rgba(255,255,255,0.82)] backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-3.5 lg:px-10">
        <Link href="/" aria-label="Lux Learning, inicio" className="shrink-0">
          <Image src="/lux-logo-fullcolor.svg" alt="Lux Learning" width={148} height={43} priority />
        </Link>

        <nav aria-label="Principal" className="hidden items-center gap-8 md:flex">
          {AUDIENCE_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? 'page' : undefined}
              className={`text-[0.95rem] font-semibold transition-colors hover:text-cta-from ${
                pathname === link.href ? 'text-cta-from' : 'text-lx-muted'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-5 md:flex">
          <Link href="/login" className="text-[0.95rem] font-semibold text-lx-muted transition-colors hover:text-lx-ink">
            Iniciar sesión
          </Link>
          <Link href="/register" className="lx-btn lx-btn-blue !px-5 !py-3 !text-sm">
            Empezar ahora
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="lx-mobile-menu"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          className="flex h-11 w-11 items-center justify-center rounded-full text-lx-ink md:hidden"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div id="lx-mobile-menu" className="lx-panel-in border-t border-lx-line/70 px-5 pb-6 pt-2 md:hidden">
          <nav aria-label="Principal móvil" className="flex flex-col">
            {AUDIENCE_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="border-b border-lx-line/60 py-4 text-lg font-semibold text-lx-ink">
                {link.label}
              </Link>
            ))}
            <Link href="/login" className="py-4 text-lg font-semibold text-lx-muted">
              Iniciar sesión
            </Link>
          </nav>
          <Link href="/register" className="lx-btn lx-btn-blue mt-2 w-full">
            Empezar ahora
          </Link>
        </div>
      )}
    </header>
  );
}
