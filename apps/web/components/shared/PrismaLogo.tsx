import Image from 'next/image';

interface PrismaLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  textColor?: string;
}

// Real dimensions of lux-logo-fullcolor.svg/lux-logo-white.svg (2048x596 viewBox) —
// used to scale `width` from the caller's `size` (treated as height) without
// distorting the wordmark.
const LOGO_ASPECT = 2048 / 596;

export function PrismaLogo({
  size = 32,
  className = '',
  showText = true,
  textColor = '#FFFFFF',
}: PrismaLogoProps) {
  // Trello DmPpbrff, 2026-09-07 (Mack, correcting the 2026-09-06 fix): "Este tuvo
  // que ser el logo correcto. Mismo del dashboard, no el de la marca de agua."
  // lux-icon-fullcolor.svg/lux-icon-white.svg (used the day before, matching the
  // watermark's icon mark) are a DIFFERENT, older icon — not what Sidebar.tsx
  // actually shows. The full lux-logo-fullcolor.svg/lux-logo-white.svg (icon +
  // "Lux Learning" wordmark baked in as one image, byte-identical to the file
  // Mack sent) is what Sidebar uses and is the correct, current asset everywhere.
  // The wordmark being baked into the image makes the separate `showText` span
  // redundant — kept as a prop for API compatibility, but it's a no-op now since
  // there's no way to show "just the icon" from this asset without the text.
  void showText; void textColor;
  const width = Math.round(size * LOGO_ASPECT);
  return (
    <div className={`flex items-center ${className}`}>
      <Image
        src="/lux-logo-fullcolor.svg"
        alt="Lux Learning"
        width={width}
        height={size}
        style={{ objectFit: 'contain' }}
        priority
        className="block dark:hidden"
      />
      <Image
        src="/lux-logo-white.svg"
        alt="Lux Learning"
        width={width}
        height={size}
        style={{ objectFit: 'contain' }}
        priority
        className="hidden dark:block"
      />
    </div>
  );
}
