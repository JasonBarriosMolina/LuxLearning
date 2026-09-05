'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Lock, Download, Play, Pause, Maximize, Minimize, ChevronRight, Captions, FileText, ChevronDown, ChevronUp, Music, VolumeX } from 'lucide-react';
import { api } from '@/lib/api';
import {
  findActiveSlideIndex, slideProgress, canScrub, findActiveCaptionIndex, buildCarouselTranscript,
  musicDuckGain, pickBgmTrack, type CarouselSlide, type SpeechMark,
} from './LuxCarrouselPlayer.helpers';

interface Props {
  courseId: string;
  moduleId: string;
  lessonId: string;
  audioUrl: string;
  slides: CarouselSlide[];
  // Polly sentence-level speech marks, same data used to time the slides
  // (carousel-worker.ts) — reused here for close captions + the post-class
  // transcript (Trello DmPpbrff, 2026-09-04 — Mack: "No hay close captions en los
  // carrouseles... Ni transcripción del texto post clase").
  speechMarks?: SpeechMark[];
  pdfRecapUrl: string | null;
  hasCompletedBefore: boolean;
  onCompleted: () => void;
  // "Continuar" CTA once the carousel ends (Trello DmPpbrff, 2026-09-01 00:57 —
  // Mack: "crear un botón de siguiente"). null when this is the module's last lesson.
  nextLessonId?: string | null;
  nextLessonTitle?: string | null;
}

// Lux Carrousel player (Trello N1bbWdz0, 2026-08-30) — student-facing playback of a
// pre-generated narrated slide sequence. First view is locked (no scrub/skip, must
// finish once); later views unlock free navigation + the "Lux Recap" PDF download.
export function LuxCarrouselPlayer({ courseId, moduleId, lessonId, audioUrl, slides, speechMarks = [], pdfRecapUrl: initialPdfRecapUrl, hasCompletedBefore, onCompleted, nextLessonId, nextLessonTitle }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ended, setEnded] = useState(hasCompletedBefore);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const completedRef = useRef(false);
  // Close captions — off by default like any standard video player, toggled via the CC
  // button. Post-class transcript — collapsed by default, shown once the carousel ends.
  const [ccEnabled, setCcEnabled] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  // Background music (Trello DmPpbrff, 2026-09-04 — Mack: "Ni música... con opción de
  // reproducirse"): off by default (a browser gesture is required to start audio
  // anyway, and not every student wants music under a study lesson) — same convention
  // as captions above. musicRef is a second, independent <audio> element; its volume
  // is continuously ducked under the narration via musicDuckGain (LuxCarrouselPlayer.
  // helpers.ts), not synced in *position* to it — it just loops in the background.
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const bgmTrack = pickBgmTrack(lessonId);

  // Trello DmPpbrff, 2026-09-02 22:12 (Mack): "si ya el carrusel se vio... el botón
  // de continuar debería aparecer automáticamente" — it didn't, because the parent
  // page's `completed` state starts false and only flips true via its own effect
  // once lesson data arrives, one render AFTER this component first mounts. The
  // `useState(hasCompletedBefore)` initializer above only runs once at mount, so it
  // locked in `ended=false` and never noticed the prop becoming true a tick later.
  useEffect(() => { if (hasCompletedBefore) setEnded(true); }, [hasCompletedBefore]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      stageRef.current?.requestFullscreen?.().catch(() => {});
    }
  };
  // "Lux Recap" PDF is built on demand (Trello N1bbWdz0, 2026-08-31 15:21) — the first
  // request builds + caches it on the Lesson row; later visits (any student) just get
  // the cached URL back instantly via the same endpoint.
  const [pdfRecapUrl, setPdfRecapUrl] = useState(initialPdfRecapUrl);
  const [pdfRequesting, setPdfRequesting] = useState(false);
  const requestPdf = async () => {
    setPdfRequesting(true);
    try {
      const res = await api.lessons.carouselRecap(lessonId);
      const url = (res as any)?.data?.pdfRecapUrl ?? (res as any)?.pdfRecapUrl;
      if (url) setPdfRecapUrl(url);
    } catch { /* let the student retry */ }
    finally { setPdfRequesting(false); }
  };
  const unlocked = canScrub(hasCompletedBefore);

  const activeIdx = findActiveSlideIndex(slides, currentMs);
  const activeSlide = activeIdx >= 0 ? slides[activeIdx] : undefined;
  const progress = slideProgress(activeSlide, currentMs);
  const activeCaptionIdx = findActiveCaptionIndex(speechMarks, currentMs);
  const activeCaption = activeCaptionIdx >= 0 ? speechMarks[activeCaptionIdx]!.value : null;
  const transcript = buildCarouselTranscript(speechMarks);
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

  // Explicit, synchronous play()/pause() right inside the click handler (not only in
  // the effect below) — browsers require a direct user-gesture call stack to allow
  // audio playback; deferring the very first play() to an effect risks it being
  // silently blocked as unprompted autoplay.
  const toggleMusic = () => {
    const music = musicRef.current;
    if (!music) return;
    const next = !musicEnabled;
    setMusicEnabled(next);
    if (next && isPlaying) music.play().catch(() => {});
    else music.pause();
  };

  // Keeps the music in lockstep with the narration's own play/pause (e.g. the student
  // pauses narration via the main play button, or it ends) without needing its own
  // duplicate play/pause controls.
  useEffect(() => {
    const music = musicRef.current;
    if (!music || !musicEnabled) return;
    if (isPlaying) music.play().catch(() => {}); else music.pause();
  }, [isPlaying, musicEnabled]);

  // Ducking: low and steady while narration is speaking, rises during the silence
  // between slides (see musicDuckGain's own doc comment for why this simpler,
  // deterministic approach was chosen over real-time amplitude analysis). Rest
  // volume 20% per Mack's request (2026-09-04, Trello DmPpbrff) — was 45%/12%.
  useEffect(() => {
    const music = musicRef.current;
    if (!music) return;
    const msIntoSlide = activeSlide ? currentMs - activeSlide.startMs : 0;
    music.volume = musicDuckGain({ isNarrationPlaying: isPlaying, msIntoSlide, duckedGain: 0.06, restGain: 0.20, fadeMs: 400 });
  }, [currentMs, isPlaying, activeSlide]);

  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-black">
      {/* Slide stage */}
      <div ref={stageRef} className="relative aspect-video bg-charcoal overflow-hidden">
        {activeSlide?.imageUrl && (
          <img
            src={activeSlide.imageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 ease-linear"
            style={{ transform: `scale(${kenBurnsScale}) translateX(${kenBurnsTranslate}%)` }}
          />
        )}
        {/* Close captions (Trello DmPpbrff, 2026-09-04/05 — Mack, 09-05 follow-up:
            "deberían estar a una altura diferente para que no interrumpan con lo que ya
            está escrito ... un poco más altos"): raised further above the always-on
            title/bullets overlay below — that overlay's height varies with how many
            bullets a slide has, so bottom-24 wasn't always enough clearance. */}
        {ccEnabled && activeCaption && (
          <div className="absolute inset-x-0 bottom-36 flex justify-center px-4 pointer-events-none z-10">
            <p className="max-w-[90%] text-center text-white text-sm md:text-base font-medium bg-black/75 rounded-lg px-3 py-1.5">
              {activeCaption}
            </p>
          </div>
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
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 text-white text-xs px-2.5 py-1 rounded-full">
            <Lock className="w-3 h-3" /> Primera vista
          </div>
        )}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {/* Background music toggle (Trello DmPpbrff, 2026-09-04 — Mack: "Ni música
              como se conversó... con opción de reproducirse") */}
          {bgmTrack && (
            <button
              onClick={toggleMusic}
              className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                musicEnabled ? 'bg-cta-from text-white' : 'bg-black/50 text-white hover:bg-black/70'
              }`}
              title={musicEnabled ? 'Silenciar música de fondo' : 'Reproducir música de fondo'}
              aria-pressed={musicEnabled}
            >
              {musicEnabled ? <Music className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          )}
          {/* Close captions toggle (Trello DmPpbrff, 2026-09-04 — Mack: "No hay close
              captions en los carrouseles") */}
          {speechMarks.length > 0 && (
            <button
              onClick={() => setCcEnabled((v) => !v)}
              className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                ccEnabled ? 'bg-cta-from text-white' : 'bg-black/50 text-white hover:bg-black/70'
              }`}
              title={ccEnabled ? 'Ocultar subtítulos' : 'Mostrar subtítulos'}
              aria-pressed={ccEnabled}
            >
              <Captions className="w-4 h-4" />
            </button>
          )}
          {/* Fullscreen toggle (Trello DmPpbrff, 2026-09-01 00:57) */}
          <button
            onClick={toggleFullscreen}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>
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
      {bgmTrack && <audio ref={musicRef} src={bgmTrack.url} loop className="hidden" />}

      {ended && (
        <div className="bg-surface px-4 py-3 space-y-3">
          {/* Post-class transcript (Trello DmPpbrff, 2026-09-04 — Mack: "Ni
              transcripción del texto post clase"): available immediately, no async
              wait — unlike the VAPI class transcript, this is just the already-stored
              Polly speech marks joined back into text, nothing to generate on demand. */}
          {transcript && (
            <div className="border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setShowTranscript((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-charcoal hover:bg-surface/60 transition-colors"
              >
                <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Transcripción de la clase</span>
                {showTranscript ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showTranscript && (
                <p className="px-3 pb-3 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto">
                  {transcript}
                </p>
              )}
            </div>
          )}
          <div>
            {pdfRecapUrl ? (
              <a
                href={pdfRecapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-cta-from hover:underline"
              >
                <Download className="w-3.5 h-3.5" /> Descargar Lux Recap (PDF)
              </a>
            ) : (
              <button
                onClick={requestPdf}
                disabled={pdfRequesting}
                className="inline-flex items-center gap-1.5 text-xs text-cta-from hover:underline disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" /> {pdfRequesting ? 'Generando PDF…' : 'Solicitar Lux Recap (PDF)'}
              </button>
            )}
          </div>
          {/* "Continuar" CTA (Trello DmPpbrff, 2026-09-01 00:57) — the carousel branch
              of the lesson page has no shared prev/next nav bar like other lesson
              types, so this was the only way to move forward without scrolling away. */}
          {nextLessonId && (
            <Link
              href={`/courses/${courseId}/modules/${moduleId}/lessons/${nextLessonId}`}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {nextLessonTitle ? `Siguiente: ${nextLessonTitle}` : 'Siguiente lección'} <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
