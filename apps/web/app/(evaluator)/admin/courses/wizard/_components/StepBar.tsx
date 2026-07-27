'use client';

import { CheckCircle } from 'lucide-react';
import { STEPS } from './constants';

export function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-150 ${current > s.n ? 'bg-emerald-500 text-white' : current === s.n ? 'bg-gradient-to-br from-cta-from to-cta-to text-white shadow-md' : 'bg-gray-100 text-gray-400'}`}>
              {current > s.n ? <CheckCircle className="w-4 h-4" /> : s.n}
            </div>
            <span className={`text-[10px] font-medium whitespace-nowrap ${current === s.n ? 'text-cta-from' : 'text-gray-400'}`}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`h-0.5 w-12 mx-1 mb-4 transition-colors duration-150 ${current > s.n ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{children}</p>;
}
