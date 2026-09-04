'use client';

import { Volume2 } from 'lucide-react';
import { extractYouTubeId } from './LuxMentorClass.helpers';

// Extracted from LuxMentorClass.tsx (code review, 2026-09-04) to keep that file
// under the 400-line page-component limit — the 'content' phase's render.
interface Props {
  lessonVideoUrl: string | null;
  lessonScript: string | null;
  attemptsMax?: number;
  attemptsUsed?: number;
  onStart: () => void;
  s: (es: string, en: string) => string;
}

export function LuxMentorClassContent({ lessonVideoUrl, lessonScript, attemptsMax, attemptsUsed, onStart, s }: Props) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="bg-surface px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
          <Volume2 className="w-4 h-4 text-blue-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-charcoal">{s('Contenido de la lección', 'Lesson Content')}</p>
          <p className="text-xs text-gray-500">{s('Lux Mentor te la leerá en voz alta y luego podrás hacer preguntas', 'Lux Mentor will read it aloud, then you can ask questions')}</p>
        </div>
      </div>
      <div className="p-4 space-y-4">
        {lessonVideoUrl && (
          <div className="rounded-xl overflow-hidden bg-black aspect-video">
            {lessonVideoUrl.includes('youtube.com') || lessonVideoUrl.includes('youtu.be') ? (
              <iframe
                src={`https://www.youtube.com/embed/${extractYouTubeId(lessonVideoUrl)}`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video src={lessonVideoUrl} controls className="w-full h-full" />
            )}
          </div>
        )}
        {lessonScript && !lessonVideoUrl && (
          <div className="bg-gray-50 rounded-xl p-4 max-h-56 overflow-y-auto">
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">{s('Contenido', 'Content')}</p>
            <p className="text-sm text-charcoal leading-relaxed whitespace-pre-wrap">{lessonScript}</p>
          </div>
        )}
        <button onClick={onStart} className="btn-primary w-full flex items-center justify-center gap-2">
          <Volume2 className="w-4 h-4" />
          {s('Iniciar clase con Lux Mentor', 'Start class with Lux Mentor')}
        </button>
        <p className="text-xs text-gray-400 text-center">
          {s(`Sesión de voz · ${attemptsMax ?? 2} intentos máx`, `Voice session · max ${attemptsMax ?? 2} attempts`)}
          {(attemptsUsed ?? 0) > 0
            ? s(` · ${attemptsUsed} usado${(attemptsUsed ?? 0) !== 1 ? 's' : ''}`, ` · ${attemptsUsed} used`)
            : ''}
        </p>
      </div>
    </div>
  );
}
