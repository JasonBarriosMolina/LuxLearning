'use client';

import { CheckCircle, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { WIZARD_STEPS } from './types';

interface Props {
  step: number; // 1-8
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  hideNext?: boolean;
  children: React.ReactNode;
}

export function WizardShell({ step, onBack, onNext, nextLabel = 'Continuar', nextDisabled, nextLoading, hideNext, children }: Props) {
  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      {/* Stepper */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {WIZARD_STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const active = n === step;
          return (
            <div key={label} className="flex items-center gap-1 shrink-0">
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                active ? 'bg-cta-gradient text-white' : done ? 'bg-emerald-50 text-emerald-600' : 'bg-surface text-gray-400'
              }`}>
                {done ? <CheckCircle className="w-3.5 h-3.5" /> : <span>{n}</span>}
                <span className="hidden sm:inline">{label}</span>
              </div>
              {n < WIZARD_STEPS.length && <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
            </div>
          );
        })}
      </div>

      {children}

      {/* Nav */}
      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={onBack} disabled={!onBack} leftIcon={<ChevronLeft className="w-4 h-4" />}>
          Atrás
        </Button>
        {!hideNext && (
          <Button onClick={onNext} disabled={nextDisabled} loading={nextLoading} rightIcon={<ChevronRight className="w-4 h-4" />}>
            {nextLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
