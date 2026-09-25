'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Sparkles, RefreshCw, ChevronLeft, ChevronRight, Loader2, Send, Maximize2, Minimize2 } from 'lucide-react';
import { api } from '@/lib/api';

const TYPE_LABELS: Record<string, string> = {
  MAGISTRAL: 'Clase magistral',
  QA: 'Preguntas de Análisis',
  ACTIVITY: 'Actividad',
  DISCUSSION: 'Preguntas de Análisis',
  CONCLUSION: 'Conclusión Clave',
  VIDEO: 'Recurso audiovisual',
};

const TYPE_COLORS: Record<string, string> = {
  MAGISTRAL: 'bg-blue-100 text-blue-800',
  QA: 'bg-indigo-100 text-indigo-800',
  ACTIVITY: 'bg-teal-100 text-teal-800',
  DISCUSSION: 'bg-violet-100 text-violet-800',
  CONCLUSION: 'bg-amber-100 text-amber-800',
  VIDEO: 'bg-rose-100 text-rose-800',
};

interface Slide {
  index: number;
  type: string;
  timeRange: string;
  title: string;
  content: string;
  bullets?: string[];
  speakerNotes: string;
  imageUrl: string | null;
  imageCredit: string | null;
  videoId?: string | null;
  watchPoints?: string[];
}

function sanitizeContent(text: string): string {
  return text.replace(/^(GANCHO|DESARROLLO|CIERRE|HOOK|DEVELOP|CLOSE)\s*:/gi, '').trim();
}

function parseNotes(notes: string) {
  const sections: { label: string; text: string }[] = [];
  const patterns = [
    { label: 'Gancho', key: /GANCHO:/i },
    { label: 'Desarrollo', key: /DESARROLLO:/i },
    { label: 'Cierre', key: /CIERRE:/i },
    { label: 'Hook', key: /HOOK:/i },
    { label: 'Develop', key: /DEVELOP:/i },
    { label: 'Close', key: /CLOSE:/i },
  ];
  let remaining = notes;
  const found = patterns.filter(p => p.key.test(remaining));
  if (!found.length) return [{ label: '', text: notes }];
  for (let i = 0; i < found.length; i++) {
    const start = remaining.search(found[i].key);
    const end = i + 1 < found.length ? remaining.search(found[i + 1].key) : remaining.length;
    const text = remaining.slice(start).replace(found[i].key, '').slice(0, end - start).trim().replace(/\.$/, '').trim();
    sections.push({ label: found[i].label, text });
  }
  return sections;
}

function SlideContent({ slide }: { slide: Slide }) {
  const isVideo = slide.type === 'VIDEO';
  const hasBullets = slide.bullets && slide.bullets.length > 0;
  const hasImage = !!slide.imageUrl;

  if (isVideo) {
    return (
      <div className="absolute inset-0 flex">
        {/* Video left */}
        <div className="flex-1 flex items-center justify-center p-6 border-r border-gray-100">
          {slide.videoId ? (
            <iframe
              src={`https://www.youtube.com/embed/${slide.videoId}?rel=0&modestbranding=1`}
              className="w-full rounded-xl shadow-lg"
              style={{ aspectRatio: '16/9' }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={slide.title}
            />
          ) : (
            <div className="w-full rounded-xl bg-gray-100 flex flex-col items-center justify-center gap-3" style={{ aspectRatio: '16/9' }}>
              <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center">
                <svg className="w-7 h-7 text-rose-500" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </div>
              <p className="text-xs text-gray-400">Video no disponible (sin clave YouTube API)</p>
            </div>
          )}
        </div>
        {/* Watch points right */}
        <div className="w-72 flex flex-col justify-center gap-4 px-6">
          <h2 className="text-lg font-bold text-charcoal leading-snug">{slide.title}</h2>
          {slide.watchPoints && slide.watchPoints.length > 0 && (
            <ul className="space-y-2.5">
              {slide.watchPoints.map((wp, i) => (
                <li key={i} className="flex gap-2.5 items-start">
                  <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  <span className="text-sm text-gray-700 leading-snug">{wp}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (hasBullets && hasImage) {
    return (
      <div className="absolute inset-0 flex">
        {/* Text left */}
        <div className="flex-1 flex flex-col justify-center gap-4 px-10 py-8">
          <h2 className="text-2xl font-bold text-charcoal leading-tight">{slide.title}</h2>
          {slide.content && <p className="text-sm text-gray-500 leading-relaxed">{sanitizeContent(slide.content)}</p>}
          <ul className="space-y-2">
            {slide.bullets!.map((b, i) => (
              <li key={i} className="flex gap-2.5 items-start">
                <span className="mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-cta-from" />
                <span className="text-sm sm:text-base text-gray-700 leading-snug">{sanitizeContent(b)}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* Image right */}
        <div className="w-2/5 relative overflow-hidden">
          <img src={slide.imageUrl!} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-l from-transparent to-white/10" />
        </div>
      </div>
    );
  }

  if (hasBullets) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center px-12 gap-5 text-center">
        {slide.imageUrl && (
          <div className="absolute inset-0 bg-cover bg-center opacity-[0.06]" style={{ backgroundImage: `url(${slide.imageUrl})` }} />
        )}
        <h1 className="text-3xl sm:text-4xl font-bold text-charcoal leading-tight z-10">{slide.title}</h1>
        <ul className="space-y-2 text-left z-10 max-w-2xl">
          {slide.bullets!.map((b, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-cta-from" />
              <span className="text-base sm:text-lg text-gray-700 leading-snug">{sanitizeContent(b)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <>
      {slide.imageUrl && (
        <div className="absolute inset-0 bg-cover bg-center opacity-[0.07]" style={{ backgroundImage: `url(${slide.imageUrl})` }} />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-16 text-center gap-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-charcoal leading-tight">{slide.title}</h1>
        <p className="text-base sm:text-lg text-gray-600 leading-relaxed max-w-3xl">{sanitizeContent(slide.content)}</p>
      </div>
    </>
  );
}

export default function PresentationPage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();

  const [slides, setSlides] = useState<Slide[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [current, setCurrent] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenFeedback, setRegenFeedback] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);

  const slideContainerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.evaluator.presentation.get(courseId, moduleId);
      const payload = (res as any).data ?? res as any;
      setSlides(payload.slides ?? []);
      setGeneratedAt(payload.generatedAt ?? null);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [courseId, moduleId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setCurrent((p) => Math.min(slides.length - 1, p + 1));
        setRegenOpen(false);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setCurrent((p) => Math.max(0, p - 1));
        setRegenOpen(false);
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'Escape' && isFullscreen) {
        exitFullscreen();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [slides.length, isFullscreen]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      slideContainerRef.current?.requestFullscreen();
    }
  };

  const exitFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.evaluator.presentation.generate(courseId, moduleId);
      const payload = (res as any).data ?? res as any;
      setSlides(payload.slides ?? []);
      setGeneratedAt(payload.generatedAt ?? null);
      setCurrent(0);
    } catch { /* silent */ }
    finally { setGenerating(false); }
  };

  const handleRegen = async () => {
    if (!regenFeedback.trim() || regenLoading) return;
    setRegenLoading(true);
    try {
      const res = await api.evaluator.presentation.regenerate(courseId, moduleId, { slideIndex: current, feedback: regenFeedback });
      const updated = ((res as any).data?.slide ?? (res as any).slide) as Slide;
      if (updated) {
        setSlides((prev) => prev.map((s) => s.index === current ? { ...updated, index: current } : s));
        setRegenFeedback('');
        setRegenOpen(false);
      }
    } catch { /* silent */ }
    finally { setRegenLoading(false); }
  };

  const slide = slides[current];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <Link href={`/evaluator/courses/${courseId}/presentation`} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-charcoal">
          <ArrowLeft className="w-4 h-4" /> Atrás
        </Link>
        <span className="text-xs font-semibold tracking-wide text-cta-from uppercase ml-auto">Lux Slides</span>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cta-from to-cta-to text-white text-sm font-semibold shadow hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {slides.length ? 'Regenerar presentación' : 'Generar presentación'}
        </button>
      </div>

      {!slides.length && !generating && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <Sparkles className="w-10 h-10 text-gray-300" />
          <p className="text-gray-500 text-sm max-w-sm">
            Genera una presentación de 55 minutos basada en el contenido de este módulo. Incluye imágenes, video educativo y estructura pedagógica completa.
          </p>
        </div>
      )}

      {generating && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-cta-from" />
          <p className="text-sm text-gray-500">Generando la presentación con Lux Mentor…</p>
        </div>
      )}

      {slides.length > 0 && !generating && slide && (
        <>
          {/* Slide viewer */}
          <div
            ref={slideContainerRef}
            className="relative rounded-2xl overflow-hidden shadow-2xl border border-gray-100 bg-white"
            style={{ aspectRatio: '16/9' }}
          >
            <SlideContent slide={slide} />

            {/* Lux Learning logo watermark */}
            <img
              src="/lux-logo-fullcolor.svg"
              alt=""
              className="absolute bottom-4 right-5 h-10 opacity-40 select-none pointer-events-none z-20"
            />

            {/* Type badge */}
            <div className="absolute top-5 left-5 z-20">
              <span className={`text-[11px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full ${TYPE_COLORS[slide.type] ?? 'bg-gray-100 text-gray-600'}`}>
                {slide.timeRange} min · {TYPE_LABELS[slide.type] ?? slide.type}
              </span>
            </div>

            {/* Slide counter */}
            <div className="absolute top-5 right-5 text-gray-300 text-xs font-mono z-20">
              {current + 1} / {slides.length}
            </div>

            {/* Fullscreen button */}
            <button
              onClick={toggleFullscreen}
              className="absolute bottom-4 left-5 z-20 w-8 h-8 rounded-lg bg-black/10 hover:bg-black/20 text-charcoal flex items-center justify-center transition-colors"
              title={isFullscreen ? 'Salir pantalla completa (Esc)' : 'Pantalla completa (F)'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Navigation arrows */}
            <button
              onClick={() => { setCurrent((p) => Math.max(0, p - 1)); setRegenOpen(false); }}
              disabled={current === 0}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/10 hover:bg-black/20 text-charcoal flex items-center justify-center transition-colors disabled:opacity-20"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setCurrent((p) => Math.min(slides.length - 1, p + 1)); setRegenOpen(false); }}
              disabled={current === slides.length - 1}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/10 hover:bg-black/20 text-charcoal flex items-center justify-center transition-colors disabled:opacity-20"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Speaker notes */}
          {slide.speakerNotes && (
            <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
              <p className="text-xs font-semibold text-charcoal uppercase tracking-wide mb-2">Notas del orador</p>
              <div className="flex flex-wrap gap-3">
                {parseNotes(slide.speakerNotes).map((s, i) => (
                  <div key={i} className="flex-1 min-w-[160px]">
                    {s.label && <span className="text-[10px] font-bold uppercase tracking-wider text-cta-from">{s.label} · </span>}
                    <span className="text-gray-600">{s.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Slide thumbnails */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {slides.map((s, i) => (
              <button
                key={i}
                onClick={() => { setCurrent(i); setRegenOpen(false); }}
                className={`relative shrink-0 w-20 h-12 rounded-lg overflow-hidden border-2 transition-all ${i === current ? 'border-cta-from scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}
                style={{ background: '#f8f9fa' }}
              >
                {s.imageUrl && <img src={s.imageUrl} alt="" className="w-full h-full object-cover opacity-20" />}
                {s.type === 'VIDEO' && !s.imageUrl && (
                  <div className="absolute inset-0 flex items-center justify-center bg-rose-50">
                    <svg className="w-4 h-4 text-rose-400" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-charcoal text-[9px] font-bold px-1 text-center leading-tight">{s.title.slice(0, 20)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Regenerate single slide */}
          <div className="rounded-xl border border-border overflow-hidden">
            <button
              onClick={() => setRegenOpen((p) => !p)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-surface transition-colors"
            >
              <div className="flex items-center gap-2 text-gray-600">
                <RefreshCw className="w-4 h-4" />
                <span className="font-medium">Regenerar esta diapositiva</span>
              </div>
              <ArrowRight className={`w-4 h-4 text-gray-400 transition-transform ${regenOpen ? 'rotate-90' : ''}`} />
            </button>
            {regenOpen && (
              <div className="px-4 pb-4 border-t border-border space-y-3 pt-3">
                <p className="text-xs text-gray-500">Describe qué cambiar en esta diapositiva. La IA generará una nueva versión.</p>
                <div className="flex gap-2">
                  <input
                    value={regenFeedback}
                    onChange={(e) => setRegenFeedback(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRegen(); } }}
                    placeholder="Ej: Simplifica el texto, el contenido es muy denso"
                    className="flex-1 text-sm px-3 py-2 rounded-xl border border-border bg-surface text-charcoal placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cta-from"
                    disabled={regenLoading}
                  />
                  <button
                    onClick={handleRegen}
                    disabled={regenLoading || !regenFeedback.trim()}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-gradient-to-br from-cta-from to-cta-to text-white disabled:opacity-40 shrink-0"
                  >
                    {regenLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {generatedAt && (
            <p className="text-xs text-gray-400 text-center pb-4">
              Generado el {new Date(generatedAt).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {slide.imageCredit && ` · Foto: ${slide.imageCredit} (Pexels)`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
