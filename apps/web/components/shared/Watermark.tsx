import Image from 'next/image';

export function Watermark() {
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
