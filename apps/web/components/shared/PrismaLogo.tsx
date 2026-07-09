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
      <Image
        src="/lux-logo.png"
        alt="Lux Learning"
        width={size}
        height={size}
        style={{ objectFit: 'contain' }}
        priority
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
