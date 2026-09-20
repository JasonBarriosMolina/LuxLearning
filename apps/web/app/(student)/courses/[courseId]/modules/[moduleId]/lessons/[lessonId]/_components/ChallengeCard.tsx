'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

interface Challenge {
  id: string;
  type: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  xpReward: number;
  lessonId: string;
  moduleId: string;
}

interface Props {
  challenge: Challenge;
  onAnswered?: (xpEarned: number) => void;
}

export function ChallengeCard({ challenge, onAnswered }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [xpEarned, setXpEarned] = useState<number | null>(null);

  const answered = selected !== null;
  const isCorrect = selected === challenge.correctIndex;

  const handleSelect = async (index: number) => {
    if (answered) return;
    setSelected(index);
    const correct = index === challenge.correctIndex;
    try {
      const res = await api.lessons.challengeAnswer({
        challengeId: challenge.id,
        lessonId: challenge.lessonId,
        moduleId: challenge.moduleId,
        isCorrect: correct,
      });
      const earned = (res as any).xpEarned ?? 0;
      setXpEarned(earned);
      onAnswered?.(earned);
    } catch {
      // fire-and-forget — UI still shows feedback
    }
  };

  const typeLabel = challenge.type === 'SOCRÁTICA' ? 'Mito o realidad' : 'Toma de decisión';

  return (
    <div className="my-6 rounded-2xl border border-border bg-surface/60 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-cta-from uppercase">{typeLabel}</span>
        {answered && xpEarned !== null && xpEarned > 0 && (
          <span className="text-[11px] font-semibold text-emerald-600">+{xpEarned} XP</span>
        )}
      </div>

      <div className="px-4 pt-3 pb-4 space-y-3">
        <p className="text-sm font-medium text-charcoal leading-snug">{challenge.question}</p>

        <div className="flex flex-col gap-2">
          {challenge.options.map((option, i) => {
            let optionClass = 'border-border text-gray-700 hover:border-cta-from hover:text-charcoal';
            if (answered) {
              if (i === challenge.correctIndex) {
                optionClass = 'border-emerald-400 bg-emerald-50 text-emerald-800';
              } else if (i === selected) {
                optionClass = 'border-red-300 bg-red-50 text-red-700';
              } else {
                optionClass = 'border-border text-gray-400';
              }
            }
            return (
              <button
                key={i}
                onClick={() => handleSelect(i)}
                disabled={answered}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl border text-sm transition-all disabled:cursor-default ${optionClass}`}
              >
                {option}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className={`text-xs leading-relaxed rounded-lg px-3 py-2 ${
            isCorrect
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-gray-50 text-gray-600 border border-gray-200'
          }`}>
            {challenge.explanation}
          </div>
        )}
      </div>
    </div>
  );
}
