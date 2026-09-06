import Image from 'next/image';

interface PrismaLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  textColor?: string;
}

export function PrismaLogo({
  size = 32,
  className = '',
  showText = true,
  textColor = '#FFFFFF',
}: PrismaLogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* Trello DmPpbrff, 2026-09-06 (Mack): "cuando vas a hacer el login, aparece un
          ícono antiguo de Lux Learning... actualízalo con el ícono que ya tenemos
          cuando ingresamos en la plataforma." PrismaLogo (login/register/forgot-
          password/Topbar) still pointed at the old /lux-logo.png; Sidebar.tsx already
          uses the current icon set — same dark-mode swap pattern as there. */}
      <Image
        src="/lux-icon-fullcolor.svg"
        alt="Lux Learning"
        width={size}
        height={size}
        style={{ objectFit: 'contain' }}
        priority
        className="block dark:hidden"
      />
      <Image
        src="/lux-icon-white.svg"
        alt="Lux Learning"
        width={size}
        height={size}
        style={{ objectFit: 'contain' }}
        priority
        className="hidden dark:block"
      />
      {showText && (
        <span
          className="font-heading font-bold tracking-tight"
          style={{ color: textColor, fontSize: size * 0.56 }}
        >
          Lux Learning
        </span>
      )}
    </div>
  );
}
