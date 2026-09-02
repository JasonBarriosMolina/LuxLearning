'use client';

import { useState } from 'react';
import { BookOpen, MessageSquare } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

interface ReviewMessage {
  role: string;
  message?: string;
  content?: string;
}

interface Props {
  transcript: string | null;
  messages: ReviewMessage[];
  lessonScript: string | null;
}

export function LuxMentorClassReview({ transcript, messages, lessonScript }: Props) {
  const [tab, setTab] = useState<'material' | 'transcript'>('material');
  const { lang } = useLanguage();
  const s = (es: string, en: string) => lang === 'en' ? en : es;

  const tabs = [
    { key: 'material' as const, label: s('Material Base', 'Base Material'), icon: BookOpen },
    { key: 'transcript' as const, label: s('Transcripción', 'Transcript'), icon: MessageSquare },
  ];

  // Parse messages into chat format (alternating Mentor / Student)
  const chatMessages = messages.filter(
    (m) => (m.role === 'assistant' || m.role === 'user' || m.role === 'bot') && (m.message || m.content),
  );

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'text-[#17527E] border-b-2 border-[#17527E] -mb-px bg-white dark:bg-transparent'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="max-h-72 overflow-y-auto p-4">
        {tab === 'material' ? (
          lessonScript ? (
            <p className="text-sm text-charcoal dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
              {lessonScript}
            </p>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">
              {s('No hay material disponible.', 'No material available.')}
            </p>
          )
        ) : (
          // Transcript tab
          <>
            {chatMessages.length > 0 ? (
              <div className="space-y-3">
                {chatMessages.map((m, i) => {
                  const isBot = m.role === 'assistant' || m.role === 'bot';
                  const text = m.message ?? m.content ?? '';
                  return (
                    <div key={i} className={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[85%] rounded-xl px-3 py-2 ${
                        isBot
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100'
                          : 'bg-gray-100 dark:bg-white/10 text-charcoal dark:text-gray-200'
                      }`}>
                        <p className={`text-[10px] font-semibold mb-0.5 ${isBot ? 'text-blue-500' : 'text-gray-400'}`}>
                          {isBot ? 'Lux Mentor' : s('Tú', 'You')}
                        </p>
                        <p className="text-xs leading-relaxed">{text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : transcript ? (
              <p className="text-sm text-charcoal dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                {transcript}
              </p>
            ) : (
              // Trello DmPpbrff, 2026-09-01 00:57 (Mack): "es importante que se le
              // mencione al estudiante que todavía no está disponible, que se está
              // generando" — not a flat "no transcript" dead end. VAPI's end-of-call
              // webhook (which fills this in) can lag a bit behind the call ending;
              // the student already gets a push + in-app notification once it's ready
              // (courses/vapi-webhook.ts, "Clase completada").
              <p className="text-sm text-gray-400 text-center py-6">
                {s(
                  'La transcripción todavía se está generando. Te avisaremos (notificación) cuando esté lista.',
                  'The transcript is still being generated. We\'ll notify you once it\'s ready.',
                )}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
