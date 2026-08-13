'use client';

import { CheckCircle } from 'lucide-react';
import { STEPS } from './constants';

export function StepBar({ current, onStep }: { current: number; onStep?: (n: number) => void }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => {
        const isDone = current > s.n;
        const isCurrent = current === s.n;
        const isClickable = isDone && !!onStep;
        return (
          <div key={s.n} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                role={isClickable ? 'button' : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onClick={isClickable ? () => onStep(s.n) : undefined}
                onKeyDown={isClickable ? (e) => (e.key === 'Enter' || e.key === ' ') && onStep(s.n) : undefined}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-150
                  ${isDone ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-gradient-to-br from-cta-from to-cta-to text-white shadow-md' : 'bg-gray-100 text-gray-400'}
                  ${isClickable ? 'cursor-pointer hover:bg-emerald-600 hover:scale-105' : ''}`}
              >
                {isDone ? <CheckCircle className="w-4 h-4" /> : s.n}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${isCurrent ? 'text-cta-from' : 'text-gray-400'}`}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`h-0.5 w-12 mx-1 mb-4 transition-colors duration-150 ${isDone ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
          </div>
        );
      })}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{children}</p>;
}
