'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Loader2, AlertTriangle, CheckCircle, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api } from '@/lib/api';

interface DraftSlide {
  onScreenText: { title: string; bullets: string[] };
  narrationSegment: string;
  imagePrompt: string;
}

interface Props {
  moduleId: string;
  courseLanguage?: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

type WizardStep = 'topic' | 'review' | 'generating' | 'done' | 'error';

// Lux Carrousel Mini Wizard (Trello N1bbWdz0, 2026-08-30): opt-in per module, triggered
// manually from the module editor — 3 steps per spec: topic → script review/approval →
// async asset generation. Not part of the bulk Lux Planner course-generation worker,
// since the script needs human review before assets (audio/images/PDF) are built.
export function LuxCarrouselWizard({ moduleId, courseLanguage = 'ES', open, onClose, onDone }: Props) {
  const [step, setStep] = useState<WizardStep>('topic');
  const [topic, setTopic] = useState('');
  const [slides, setSlides] = useState<DraftSlide[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const reset = () => {
    setStep('topic'); setTopic(''); setSlides([]); setError(''); setLoading(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const close = () => { reset(); onClose(); };

  const requestDraft = async () => {
    setLoading(true); setError('');
    try {
      const res = await api.admin.carousel.draft(moduleId, { topic: topic.trim() || undefined });
      const data = (res as any)?.data ?? res;
      if (!data?.slides?.length) { setError('No se pudo generar el guion. Intenta de nuevo.'); setLoading(false); return; }
      setSlides(data.slides);
      setStep('review');
    } catch (err: any) {
      setError(err?.message ?? 'Error al generar el guion');
    } finally {
      setLoading(false);
    }
  };

  const updateSlide = (i: number, patch: Partial<DraftSlide>) => {
    setSlides((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const removeSlide = (i: number) => setSlides((prev) => prev.filter((_, idx) => idx !== i));

  const approveAndGenerate = async () => {
    setStep('generating'); setError('');
    try {
      const res = await api.admin.carousel.generate(moduleId, { slides, courseLanguage });
      const jobId = (res as any)?.data?.jobId ?? (res as any)?.jobId;
      if (!jobId) { setError('No se pudo iniciar la generación.'); setStep('error'); return; }
      let elapsed = 0;
      pollRef.current = setInterval(async () => {
        elapsed += 3;
        try {
          const poll = await api.admin.courses.aiJob(jobId);
          const status = (poll as any)?.data?.status ?? (poll as any)?.status;
          if (status === 'done') {
            clearInterval(pollRef.current!); pollRef.current = null;
            setStep('done'); onDone();
          } else if (status === 'error') {
            clearInterval(pollRef.current!); pollRef.current = null;
            setError('Ocurrió un error generando el carrousel.');
            setStep('error');
          } else if (elapsed >= 240) {
            clearInterval(pollRef.current!); pollRef.current = null;
            setError('Tiempo de espera agotado. Recarga la página para verificar si se creó.');
            setStep('error');
          }
        } catch { /* network hiccup — keep polling */ }
      }, 3000);
    } catch (err: any) {
      setError(err?.message ?? 'Error al iniciar la generación');
      setStep('error');
    }
  };

  return (
    <Modal open={open} onClose={close} title="🎠 Lux Carrousel" size="xl">
      {step === 'topic' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Genera una lección tipo carrusel de 5-7 minutos: narración por voz neuronal + imágenes tipo infografía sincronizadas. Déjalo vacío para usar el tema del módulo.
          </p>
          <Input
            label="Tema (opcional)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="ej. Backpropagation en redes neuronales"
          />
          {error && <p className="text-sm text-red-500 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={close}>Cancelar</Button>
            <Button onClick={requestDraft} loading={loading} leftIcon={<Sparkles className="w-4 h-4" />}>
              Generar guion
            </Button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Revisa y ajusta el guion antes de generar el audio y las imágenes ({slides.length} diapositivas).
          </p>
          <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-1">
            {slides.map((s, i) => (
              <div key={i} className="border border-border rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-400">Diapositiva {i + 1}</span>
                  <button onClick={() => removeSlide(i)} className="text-gray-300 hover:text-red-500" title="Quitar diapositiva">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Input
                  value={s.onScreenText.title}
                  onChange={(e) => updateSlide(i, { onScreenText: { ...s.onScreenText, title: e.target.value } })}
                  placeholder="Título en pantalla"
                />
                <textarea
                  className="input-field resize-y min-h-[60px] text-sm w-full"
                  value={s.narrationSegment}
                  onChange={(e) => updateSlide(i, { narrationSegment: e.target.value })}
                  placeholder="Texto narrado"
                />
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-red-500 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setStep('topic')}>Volver</Button>
            <Button onClick={approveAndGenerate} disabled={slides.length === 0} leftIcon={<CheckCircle className="w-4 h-4" />}>
              Aprobar y generar
            </Button>
          </div>
        </div>
      )}

      {step === 'generating' && (
        <div className="text-center py-8 space-y-3">
          <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Generando audio, imágenes y el PDF de repaso… puede tardar unos minutos.</p>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-8 space-y-3">
          <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto" />
          <p className="text-sm font-semibold text-charcoal">¡Lux Carrousel listo!</p>
          <Button onClick={close}>Cerrar</Button>
        </div>
      )}

      {step === 'error' && (
        <div className="text-center py-8 space-y-3">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto" />
          <p className="text-sm text-red-600">{error}</p>
          <Button variant="secondary" onClick={close}>Cerrar</Button>
        </div>
      )}
    </Modal>
  );
}
