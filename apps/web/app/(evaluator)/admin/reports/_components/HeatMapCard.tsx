'use client';

import { Flame } from 'lucide-react';

type HeatMapEntry = {
  moduleId: string; moduleTitle: string; courseTitle: string;
  questions: { index: number; text: string; errorRate: number; totalAttempts: number }[];
};

function heatColor(rate: number): string {
  if (rate >= 70) return 'bg-red-500 text-white';
  if (rate >= 50) return 'bg-orange-400 text-white';
  if (rate >= 30) return 'bg-amber-300 text-charcoal';
  return 'bg-emerald-100 text-emerald-700';
}

interface Props {
  heatMap: HeatMapEntry[];
  labels: {
    title: string;
    hint: string;
    scale: string;
  };
}

export function HeatMapCard({ heatMap, labels }: Props) {
  const activeMods = heatMap.filter((h) => h && h.questions.some((q) => q.totalAttempts > 0));
  if (activeMods.length === 0) return null;
  return (
    <div className="card">
      <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
        <Flame className="w-5 h-5 text-orange-500" /> {labels.title}
        <span className="text-xs font-normal text-gray-400 ml-1">{labels.hint}</span>
      </h2>
      <div className="space-y-5">
        {activeMods.map((mod) => (
          <div key={mod.moduleId}>
            <p className="font-medium text-sm text-charcoal mb-2">
              {mod.moduleTitle} <span className="text-gray-400 font-normal">· {mod.courseTitle}</span>
            </p>
            <div className="grid gap-2">
              {mod.questions.filter((q) => q.totalAttempts > 0).map((q) => (
                <div key={q.index} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-6 shrink-0 text-right">{q.index + 1}.</span>
                  <div className="flex-1 text-xs text-gray-600 truncate" title={q.text}>{q.text}</div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-lg shrink-0 ${heatColor(q.errorRate)}`}>
                    {q.errorRate}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border text-xs text-gray-500">
        <span>{labels.scale}</span>
        {[['<30%', 'bg-emerald-100'], ['30-49%', 'bg-amber-300'], ['50-69%', 'bg-orange-400'], ['≥70%', 'bg-red-500']].map(([label, cls]) => (
          <span key={label} className="flex items-center gap-1">
            <span className={`w-3 h-3 rounded ${cls}`} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
