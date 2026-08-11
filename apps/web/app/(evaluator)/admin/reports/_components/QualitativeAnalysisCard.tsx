'use client';

import { BarChart2 } from 'lucide-react';

type AnalysisEntry = {
  moduleId: string; moduleTitle: string;
  keyTopics: { topic: string; count: number; sentiment: string }[];
  reflectionSummary: string;
  weakQuizTopics: { questionText: string; errorRate: number }[];
  analyzedAt: string;
};

function sentimentColor(s: string) {
  if (s === 'positive') return 'bg-emerald-100 text-emerald-700';
  if (s === 'negative') return 'bg-red-100 text-red-600';
  return 'bg-gray-100 text-gray-600';
}

interface Props {
  analysis: AnalysisEntry[];
  lang: string;
  labels: {
    title: string;
    hint: string;
    analyzedAt: (date: string) => string;
  };
}

export function QualitativeAnalysisCard({ analysis, lang, labels }: Props) {
  if (analysis.length === 0) return null;
  return (
    <div className="card">
      <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
        <BarChart2 className="w-5 h-5 text-purple-500" /> {labels.title}
        <span className="text-xs font-normal text-gray-400 ml-1">{labels.hint}</span>
      </h2>
      <div className="space-y-6">
        {analysis.map((a) => (
          <div key={a.moduleId} className="border border-border rounded-xl p-4">
            <p className="font-semibold text-charcoal mb-1">{a.moduleTitle}</p>
            {a.reflectionSummary && (
              <p className="text-sm text-gray-600 mb-3 italic">"{a.reflectionSummary}"</p>
            )}
            {a.keyTopics.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {a.keyTopics.map((topic, i) => (
                  <span key={i} className={`px-2.5 py-1 rounded-full text-xs font-medium ${sentimentColor(topic.sentiment)}`}>
                    {topic.topic} <span className="opacity-60">×{topic.count}</span>
                  </span>
                ))}
              </div>
            )}
            {a.analyzedAt && (
              <p className="text-xs text-gray-400 mt-2">
                {labels.analyzedAt(new Date(a.analyzedAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES'))}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
