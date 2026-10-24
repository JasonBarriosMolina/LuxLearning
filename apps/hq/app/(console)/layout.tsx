'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, GraduationCap, Loader2, LogOut, Menu, X } from 'lucide-react';
import { canSeePipelines, useAuth } from '@/lib/auth';

const NAV = [
  { href: '/prospectos', label: 'Demos de instituciones', icon: Building2 },
  { href: '/talento', label: 'Postulaciones de profesores', icon: GraduationCap },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { staff, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !staff) router.replace('/login');
  }, [loading, staff, router]);
  useEffect(() => setOpen(false), [pathname]);

  if (loading || !staff) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-royal" aria-label="Cargando" />
      </div>
    );
  }

  const onSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/" className="px-2 text-lg font-extrabold text-white">
        Lux <span className="text-gold">HQ</span>
      </Link>
      <nav aria-label="Secciones" className="mt-8 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors ${
                active ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-xl bg-white/10 p-3">
        <p className="truncate text-sm font-bold text-white">{staff.name ?? staff.email}</p>
        <p className="truncate text-xs text-white/60">{staff.groups.join(' · ') || 'Sin rol'}</p>
        <button type="button" onClick={onSignOut} className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-white/80 hover:text-white">
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 bg-[linear-gradient(180deg,#0F2D4A,#17527E)] p-5 lg:block">{sidebar}</aside>

      <header className="sticky top-0 z-20 flex items-center justify-between bg-navy px-4 py-3 lg:hidden">
        <span className="font-extrabold text-white">Lux <span className="text-gold">HQ</span></span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={open} className="text-white">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </header>
      {open && <div className="fixed inset-x-0 top-[52px] z-20 bg-[linear-gradient(180deg,#0F2D4A,#17527E)] p-5 lg:hidden">{sidebar}</div>}

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        {canSeePipelines(staff) ? children : (
          <div className="card p-8">
            <h1 className="text-xl font-extrabold text-navy">Tu rol aún no tiene secciones</h1>
            <p className="mt-2 text-muted">Las bandejas de demos y profesores son para los roles Dueño y Marketing. Pídele acceso a un administrador.</p>
          </div>
        )}
      </main>
    </div>
  );
}
