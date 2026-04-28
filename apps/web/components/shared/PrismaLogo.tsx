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
      {/* Prisma — triángulo SVG minimalista */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Lux Learning logo"
      >
        <defs>
          <linearGradient id="prismaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00B4D8" />
            <stop offset="100%" stopColor="#7B2FBE" />
          </linearGradient>
        </defs>
        {/* Outer triangle */}
        <polygon
          points="16,2 30,28 2,28"
          fill="url(#prismaGrad)"
          opacity="0.95"
        />
        {/* Inner triangle (inverted, creates prism effect) */}
        <polygon
          points="16,10 24,26 8,26"
          fill="rgba(255,255,255,0.15)"
        />
        {/* Highlight edge */}
        <line x1="16" y1="2" x2="16" y2="26" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      </svg>

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
