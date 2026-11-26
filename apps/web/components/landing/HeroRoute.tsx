'use client';

import { useEffect, useRef, useState } from 'react';
import { ROUTE_STEPS } from './content';

const RESTING_STEP = 3;

/** The signature moment: a learning route that lights up on load and can be explored step by step. */
export function HeroRoute() {
  const [current, setCurrent] = useState(-1);
  const [touched, setTouched] = useState(false);
  const touchedRef = useRef(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCurrent(RESTING_STEP);
      return;
    }
    let step = -1;
    const timer = window.setInterval(() => {
      step += 1;
      if (touchedRef.current || step > RESTING_STEP) return window.clearInterval(timer);
      setCurrent(step);
    }, 550);
    return () => window.clearInterval(timer);
  }, []);

  const select = (i: number) => {
    touchedRef.current = true;
    setTouched(true);
    setCurrent(i);
  };

  const active = ROUTE_STEPS[Math.max(current, 0)];

  return (
    <div className="lx-edge rounded-[28px] bg-[rgba(255,255,255,0.78)] p-5 shadow-[0_30px_80px_-40px_rgba(29,50,71,0.35)] backdrop-blur-sm sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-semibold text-lx-muted">Así avanzas en un curso</p>
        <p className="text-sm font-bold text-cta-from">
          {Math.max(current + 1, 0)} de {ROUTE_STEPS.length}
        </p>
      </div>

      <ol className="mt-6 flex items-start" aria-label="Pasos de un curso">
        {ROUTE_STEPS.map((step, i) => {
          const on = i <= current;
          return (
            <li key={step.label} className="flex flex-1 items-start last:flex-none">
              <div className="flex w-14 flex-col items-center sm:w-20">
                <button
                  type="button"
                  onClick={() => select(i)}
                  aria-current={i === current ? 'step' : undefined}
                  aria-label={step.label}
                  data-on={on}
                  data-current={i === current}
                  className="lx-node h-8 w-8 rounded-full border-2 border-lx-line bg-lx-paper sm:h-9 sm:w-9"
                />
                <span
                  className={`mt-2 text-center text-[11px] font-semibold leading-tight sm:text-xs ${
                    on ? 'text-cta-from' : 'text-lx-soft'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < ROUTE_STEPS.length - 1 && (
                <span data-on={i < current} className="lx-seg -mx-3 mt-4 h-[3px] flex-1 rounded-full bg-lx-line sm:-mx-5" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>

      <div key={current} className="lx-panel-in mt-6 min-h-[112px] rounded-2xl bg-lx-sky/70 p-5" aria-live={touched ? 'polite' : 'off'}>
        <p className="text-base font-bold text-lx-ink">{active.label}</p>
        <p className="mt-1.5 leading-relaxed text-lx-muted">{active.text}</p>
        {active.quote && (
          <figure className="mt-3 border-l-[3px] border-lux-gold pl-3">
            <blockquote className="text-[0.95rem] italic leading-relaxed text-lx-ink">“{active.quote.body}”</blockquote>
            <figcaption className="mt-1 text-sm font-semibold text-cta-from">{active.quote.author}</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
