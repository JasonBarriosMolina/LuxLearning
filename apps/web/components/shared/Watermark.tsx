import Image from 'next/image';

export function Watermark() {
  return (
    <div className="fixed bottom-8 right-8 w-48 md:w-56 opacity-30 z-30 pointer-events-none select-none">
      {/* Light mode */}
      <Image
        src="/lux-icon-fullcolor.svg"
        alt=""
        width={224}
        height={65}
        className="w-full h-auto block dark:hidden"
        aria-hidden="true"
        priority={false}
      />
      {/* Dark mode */}
      <Image
        src="/lux-icon-white.svg"
        alt=""
        width={224}
        height={65}
        className="w-full h-auto hidden dark:block"
        aria-hidden="true"
        priority={false}
      />
    </div>
  );
}
