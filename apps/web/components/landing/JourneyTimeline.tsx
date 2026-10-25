'use client';

import { useEffect, useRef, useState } from 'react';

export type JourneyStep = { title: string; desc: string };

/** Vertical route whose line and steps light up as the visitor scrolls through it. */
export function JourneyTimeline({ steps }: { steps: JourneyStep[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // The line completes when the timeline's bottom reaches the middle of the screen.
      const span = rect.height - vh * 0.5;
      const passed = vh * 0.5 - rect.top;
      setProgress(span > 0 ? Math.min(1, Math.max(0, passed / span)) : 1);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const lit = Math.min(steps.length, Math.floor(progress * steps.length) + 1);

  return (
    <div ref={ref} className="relative">
      <div className="absolute bottom-0 left-6 top-0 w-[2px] bg-lx-line md:left-7" />
      <div
        className="absolute bottom-0 left-6 top-0 w-[2px] origin-top bg-[linear-gradient(180deg,#4A9BDB,#17527E)] transition-transform duration-500 ease-out md:left-7"
        style={{ transform: `scaleY(${progress})` }}
      />
      <ol className="relative">
        {steps.map((step, i) => {
          const on = i < lit;
          const current = i === lit - 1;
          return (
            <li key={step.title} className="relative pb-14 pl-16 last:pb-0 md:pl-20">
              <span
                className={`absolute left-0 top-0 flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-extrabold transition-all duration-500 md:h-14 md:w-14 ${
                  on ? 'border-transparent bg-[linear-gradient(135deg,#4A9BDB,#17527E)] text-white' : 'border-lx-line bg-lx-paper text-lx-soft'
                } ${current ? 'shadow-[0_0_0_6px_rgba(226,186,80,0.2),0_0_22px_rgba(226,186,80,0.5)]' : ''}`}
              >
                {i + 1}
              </span>
              <h3
                className={`text-xl font-extrabold tracking-[-0.02em] transition-colors duration-500 md:text-2xl ${
                  on ? 'text-lx-ink' : 'text-lx-soft'
                }`}
              >
                {step.title}
              </h3>
              <p className={`mt-2 max-w-md leading-relaxed transition-colors duration-500 ${on ? 'text-lx-muted' : 'text-lx-soft/70'}`}>
                {step.desc}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
