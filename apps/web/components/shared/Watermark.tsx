'use client';

import Image from 'next/image';
import { usePathname } from 'next/navigation';

// Public marketing pages carry their own branding; the watermark would cover their content.
const PUBLIC_PATHS = ['/', '/cursos', '/instituciones', '/profesores', '/profesores/postular', '/evaluadores', '/demo'];

export function Watermark() {
  const pathname = usePathname();
  if (PUBLIC_PATHS.includes(pathname)) return null;

  return (
    <div className="fixed bottom-8 right-8 w-28 md:w-36 opacity-25 z-[1] pointer-events-none select-none">
      {/* Light mode */}
      <Image
        src="/lux-icon-fullcolor.svg"
        alt=""
        width={256}
        height={256}
        className="w-full h-auto block dark:hidden"
        aria-hidden="true"
        priority={false}
      />
      {/* Dark mode */}
      <Image
        src="/lux-icon-white.svg"
        alt=""
        width={256}
        height={256}
        className="w-full h-auto hidden dark:block"
        aria-hidden="true"
        priority={false}
      />
    </div>
  );
}
