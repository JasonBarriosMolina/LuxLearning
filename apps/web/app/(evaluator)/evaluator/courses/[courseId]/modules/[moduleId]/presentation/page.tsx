'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Sparkles, RefreshCw, ChevronLeft, ChevronRight, Loader2, Send } from 'lucide-react';
import { api } from '@/lib/api';

const TYPE_LABELS: Record<string, string> = {
  MAGISTRAL: 'Clase magistral',
  QA: 'Preguntas y respuestas',
  ACTIVITY: 'Actividad',
  DISCUSSION: 'Discusión',
  REFLECTION: 'Reflexión y cierre',
};

const TYPE_COLORS: Record<string, string> = {
  MAGISTRAL: 'bg-blue-100 text-blue-800',
  QA: 'bg-indigo-100 text-indigo-800',
  ACTIVITY: 'bg-teal-100 text-teal-800',
  DISCUSSION: 'bg-violet-100 text-violet-800',
  REFLECTION: 'bg-amber-100 text-amber-800',
};

interface Slide {
  index: number;
  type: string;
  timeRange: string;
  title: string;
  content: string;
  speakerNotes: string;
  imageUrl: string | null;
  imageCredit: string | null;
}

export default function PresentationPage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();

  const [slides, setSlides] = useState<Slide[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [current, setCurrent] = useState(0);

  // Per-slide regeneration state
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenFeedback, setRegenFeedback] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);

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
            Genera una presentación de 55 minutos basada en el contenido de este módulo. Puedes regenerar diapositivas individuales con retroalimentación.
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
            className="relative rounded-2xl overflow-hidden shadow-2xl border border-gray-100"
            style={{ aspectRatio: '16/9', background: '#ffffff' }}
          >
            {/* Background image — subtle decorative overlay */}
            {slide.imageUrl && (
              <div
                className="absolute inset-0 bg-cover bg-center opacity-[0.07]"
                style={{ backgroundImage: `url(${slide.imageUrl})` }}
              />
            )}

            {/* Lux Learning logo watermark — bottom-right */}
            <img
              src="/lux-logo-fullcolor.svg"
              alt=""
              className="absolute bottom-4 right-5 h-5 opacity-20 select-none pointer-events-none"
            />

            {/* Time badge */}
            <div className="absolute top-5 left-5">
              <span className={`text-[11px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full ${TYPE_COLORS[slide.type] ?? 'bg-gray-100 text-gray-600'}`}>
                {slide.timeRange} min · {TYPE_LABELS[slide.type] ?? slide.type}
              </span>
            </div>

            {/* Slide counter */}
            <div className="absolute top-5 right-5 text-gray-300 text-xs font-mono">
              {current + 1} / {slides.length}
            </div>

            {/* Content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center px-16 text-center gap-6">
              <h1 className="text-3xl sm:text-4xl font-bold text-charcoal leading-tight">
                {slide.title}
              </h1>
              <p className="text-base sm:text-lg text-gray-600 leading-relaxed max-w-3xl">
                {slide.content}
              </p>
            </div>

            {/* Navigation arrows */}
            <button
              onClick={() => { setCurrent((p) => Math.max(0, p - 1)); setRegenOpen(false); }}
              disabled={current === 0}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/10 hover:bg-black/20 text-charcoal flex items-center justify-center transition-colors disabled:opacity-20"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setCurrent((p) => Math.min(slides.length - 1, p + 1)); setRegenOpen(false); }}
              disabled={current === slides.length - 1}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/10 hover:bg-black/20 text-charcoal flex items-center justify-center transition-colors disabled:opacity-20"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Speaker notes */}
          {slide.speakerNotes && (
            <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-gray-600">
              <span className="font-semibold text-charcoal text-xs uppercase tracking-wide mr-2">Notas del orador:</span>
              {slide.speakerNotes}
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
