'use client';

import { useEffect, useRef, useState } from 'react';
import { Lock, Download, Play, Pause } from 'lucide-react';
import { api } from '@/lib/api';
import { findActiveSlideIndex, slideProgress, canScrub, type CarouselSlide } from './LuxCarrouselPlayer.helpers';

interface Props {
  courseId: string;
  moduleId: string;
  lessonId: string;
  audioUrl: string;
  slides: CarouselSlide[];
  pdfRecapUrl: string | null;
  hasCompletedBefore: boolean;
  onCompleted: () => void;
}

// Lux Carrousel player (Trello N1bbWdz0, 2026-08-30) — student-facing playback of a
// pre-generated narrated slide sequence. First view is locked (no scrub/skip, must
// finish once); later views unlock free navigation + the "Lux Recap" PDF download.
export function LuxCarrouselPlayer({ courseId, moduleId, lessonId, audioUrl, slides, pdfRecapUrl, hasCompletedBefore, onCompleted }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ended, setEnded] = useState(hasCompletedBefore);
  const completedRef = useRef(false);
  const unlocked = canScrub(hasCompletedBefore);

  const activeIdx = findActiveSlideIndex(slides, currentMs);
  const activeSlide = activeIdx >= 0 ? slides[activeIdx] : undefined;
  const progress = slideProgress(activeSlide, currentMs);
  // Ken Burns: slow pan+zoom across the slide's own duration, direction alternates per slide.
  const kenBurnsScale = 1 + progress * 0.08;
  const kenBurnsTranslate = (activeIdx % 2 === 0 ? 1 : -1) * progress * 2;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentMs(audio.currentTime * 1000);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setEnded(true);
      if (!completedRef.current && !hasCompletedBefore) {
        completedRef.current = true;
        api.lessons.complete({ courseId, moduleId, lessonId, durationMs: audio.duration * 1000 }).catch(() => {});
        onCompleted();
      }
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause(); else audio.play().catch(() => {});
  };

  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-black">
      {/* Slide stage */}
      <div className="relative aspect-video bg-charcoal overflow-hidden">
        {activeSlide?.imageUrl && (
          <img
            src={activeSlide.imageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 ease-linear"
            style={{ transform: `scale(${kenBurnsScale}) translateX(${kenBurnsTranslate}%)` }}
          />
        )}
        {/* Text overlay — Capa 2: 100% legible native HTML/CSS, not AI-drawn */}
        {activeSlide && (
          <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
            <p className="text-white font-heading font-bold text-lg mb-1">{activeSlide.onScreenText.title}</p>
            {activeSlide.onScreenText.bullets.length > 0 && (
              <ul className="text-white/90 text-sm space-y-0.5 list-disc list-inside">
                {activeSlide.onScreenText.bullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            )}
          </div>
        )}
        {/* Lock overlay hint on first view */}
        {!unlocked && !ended && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/50 text-white text-xs px-2.5 py-1 rounded-full">
            <Lock className="w-3 h-3" /> Primera vista
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-surface px-4 py-3 flex items-center gap-3">
        <button onClick={togglePlay} className="w-9 h-9 rounded-full bg-cta-gradient flex items-center justify-center text-white shrink-0">
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        {unlocked ? (
          <audio ref={audioRef} src={audioUrl} controls className="flex-1 h-9" />
        ) : (
          <>
            <audio ref={audioRef} src={audioUrl} className="hidden" />
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-cta-gradient transition-[width] duration-200"
                style={{ width: activeSlide ? `${Math.round(((activeIdx + progress) / slides.length) * 100)}%` : '0%' }}
              />
            </div>
          </>
        )}
      </div>

      {ended && pdfRecapUrl && (
        <div className="bg-surface px-4 pb-3">
          <a
            href={pdfRecapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-cta-from hover:underline"
          >
            <Download className="w-3.5 h-3.5" /> Descargar Lux Recap (PDF)
          </a>
        </div>
      )}
    </div>
  );
}
