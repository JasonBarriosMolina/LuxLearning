'use client';

import { useState } from 'react';
import {
  PlayCircle, Eye, RefreshCw, Pencil, RotateCcw, Trash2, GripVertical, ChevronUp, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { formatCourseDuration } from '@/lib/utils';
import { ConfirmDelete } from './ConfirmDelete';
import { LessonFields } from './LessonFields';
import type { LessonForm } from './types';

export function LessonRow({ lesson, onRefresh, onMoveUp, onMoveDown, isFirst, isLast }: {
  lesson: any; onRefresh: () => void;
  onMoveUp?: () => void; onMoveDown?: () => void;
  isFirst?: boolean; isLast?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<LessonForm>({
    title: lesson.title, duration: lesson.duration, youtubeId: lesson.youtubeId ?? '',
    imageUrl: lesson.imageUrl ?? '', content: lesson.content ?? '',
    points: lesson.points?.length > 0 ? lesson.points : [''],
    tip: lesson.tip ?? '', order: lesson.order,
  });
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenType, setRegenType] = useState<'text' | 'image' | 'infographic'>('text');
  const [regenLevel, setRegenLevel] = useState<'basic' | 'intermediate' | 'advanced'>('intermediate');
  const [regenStyle, setRegenStyle] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState('');
  const [regenPhase, setRegenPhase] = useState<'config' | 'preview'>('config');
  const [regenPreviewData, setRegenPreviewData] = useState<any>(null);
  const [lessonPreviewOpen, setLessonPreviewOpen] = useState(false);
  const [regenExtraContext, setRegenExtraContext] = useState('');

  // Phase 1: generate preview without saving
  const handlePreview = async () => {
    setRegenLoading(true);
    setRegenError('');
    try {
      const res = await api.admin.lessons.regenerateFormat(lesson.id, {
        type: regenType,
        ...(regenType === 'text' ? { level: regenLevel } : {}),
        ...(regenStyle ? { style: regenStyle } : {}),
        ...(regenExtraContext.trim() ? { extraContext: regenExtraContext.trim() } : {}),
        preview: true,
      });
      setRegenPreviewData((res as any).data ?? res);
      setRegenPhase('preview');
    } catch (err: any) {
      setRegenError(err.message ?? 'Error al generar previsualización');
    } finally {
      setRegenLoading(false);
    }
  };

  // Phase 2: apply confirmed previewData
  const handleConfirmRegen = async (combineMode = false) => {
    setRegenLoading(true);
    setRegenError('');
    try {
      await api.admin.lessons.regenerateFormat(lesson.id, {
        type: regenType,
        previewData: regenPreviewData,
        combineMode,
      });
      setRegenOpen(false);
      setRegenPhase('config');
      setRegenPreviewData(null);
      onRefresh();
    } catch (err: any) {
      setRegenError(err.message ?? 'Error al guardar');
    } finally {
      setRegenLoading(false);
    }
  };

  const handleCloseRegen = () => {
    setRegenOpen(false);
    setRegenPhase('config');
    setRegenPreviewData(null);
    setRegenError('');
    setRegenExtraContext('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.admin.lessons.update(lesson.id, { ...form, points: form.points.filter((p) => p.trim()) });
      setEditing(false); onRefresh();
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await api.admin.lessons.delete(lesson.id); onRefresh(); }
    finally { setDeleting(false); setConfirmDel(false); }
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-3 p-3 bg-surface rounded-xl border border-border">
        <div className="flex flex-col items-center gap-0.5 shrink-0 mt-0.5">
          <GripVertical className="w-3.5 h-3.5 text-gray-300" />
          <button onClick={onMoveUp} disabled={isFirst} className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-30 transition-colors" title="Mover arriba"><ChevronUp className="w-3 h-3" /></button>
          <button onClick={onMoveDown} disabled={isLast} className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-30 transition-colors" title="Mover abajo"><ChevronDown className="w-3 h-3" /></button>
        </div>
        <PlayCircle className="w-4 h-4 text-cta-from shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-charcoal">{lesson.order}. {lesson.title}</p>
          <p className="text-xs text-gray-400 mt-0.5">{formatCourseDuration(lesson.duration)}</p>
          {lesson.points?.filter((p: string) => p).length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">{lesson.points.filter((p: string) => p).length} puntos clave</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0 items-center">
          <button onClick={() => setLessonPreviewOpen(true)} title="Vista previa de la lección" className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-teal-50 transition-colors">
            <Eye className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { setRegenOpen(true); setRegenPhase('config'); setRegenPreviewData(null); setRegenError(''); }} title="Regenerar con IA" className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-charcoal hover:bg-white transition-colors" title="Editar lección"><Pencil className="w-3.5 h-3.5" /></button>
          {lesson.prevSnapshot && (
            <button
              title="Restaurar versión anterior"
              onClick={() => {
                try {
                  const snap = JSON.parse(lesson.prevSnapshot);
                  setForm({
                    title: snap.title ?? '', duration: snap.duration ?? '',
                    youtubeId: snap.youtubeId ?? '', imageUrl: snap.imageUrl ?? '',
                    content: snap.content ?? '',
                    points: snap.points?.length > 0 ? snap.points : [''],
                    tip: snap.tip ?? '', order: snap.order ?? lesson.order,
                  });
                  setEditing(true);
                } catch {}
              }}
              className="p-1.5 rounded-lg text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => setConfirmDel(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        <ConfirmDelete open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={handleDelete} loading={deleting} label="lección" />

        {/* Lesson preview modal */}
        <Modal open={lessonPreviewOpen} onClose={() => setLessonPreviewOpen(false)} title={`Vista previa — ${lesson.title}`} size="xl">
          <div className="space-y-5 overflow-y-auto max-h-[70vh] pr-1">
            {lesson.youtubeId && (
              <div className="aspect-video rounded-xl overflow-hidden bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${lesson.youtubeId}`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}
            {lesson.content && (
              <div
                className="prose prose-sm max-w-none text-charcoal"
                dangerouslySetInnerHTML={{ __html: lesson.content }}
              />
            )}
            {lesson.points?.filter((p: string) => p).length > 0 && (
              <div className="bg-blue-50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Puntos clave</p>
                <ul className="space-y-1.5">
                  {lesson.points.filter((p: string) => p).map((p: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-charcoal">
                      <span className="w-5 h-5 rounded-full bg-blue-200 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {lesson.tip && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Consejo</p>
                <p className="text-sm text-amber-800">{lesson.tip}</p>
              </div>
            )}
            {!lesson.youtubeId && !lesson.content && !lesson.tip && lesson.points?.filter((p: string) => p).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">Esta lección aún no tiene contenido.</p>
            )}
          </div>
        </Modal>

        {/* Regenerate Modal */}
        <Modal open={regenOpen} onClose={handleCloseRegen} title={`Regenerar — ${lesson.title}`} size="sm">
          <div className="space-y-4">
            {regenPhase === 'config' ? (
              <>
                {/* Type tabs */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Tipo</p>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    {(['text', 'image', 'infographic'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => { setRegenType(t); setRegenStyle(''); }}
                        className={`flex-1 py-1.5 text-xs font-medium transition-colors ${regenType === t ? 'bg-indigo-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                      >
                        {t === 'text' ? '📝 Texto' : t === 'image' ? '🖼 Imagen' : '📊 Infografía'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Level (text only) */}
                {regenType === 'text' && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Nivel</p>
                    <div className="flex rounded-lg border border-border overflow-hidden">
                      {([['basic', 'Básico'], ['intermediate', 'Intermedio'], ['advanced', 'Avanzado']] as const).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setRegenLevel(val)}
                          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${regenLevel === val ? 'bg-indigo-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">
                      {regenLevel === 'basic' ? 'Vocabulario simple, ejemplos cotidianos, sin tecnicismos.' :
                       regenLevel === 'advanced' ? 'Profundidad técnica, terminología especializada.' :
                       'Lenguaje claro, ejemplos prácticos, estructura definida.'}
                    </p>
                  </div>
                )}

                {/* Style (image only) */}
                {regenType === 'image' && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Estilo</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[['realistic', '📷 Realista'], ['illustration', '🎨 Ilustración'], ['minimal', '⬜ Minimal'], ['comic', '💥 Cómic'], ['colorful', '🌈 Colorida'], ['corporate', '🏢 Corporativa'], ['infographic', '📊 Infografía']].map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setRegenStyle(regenStyle === val ? '' : val)}
                          className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors ${regenStyle === val ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-border text-gray-500 hover:bg-gray-50'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">Opcional — deja vacío para estilo automático.</p>
                  </div>
                )}

                {/* Infographic description */}
                {regenType === 'infographic' && (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 space-y-1">
                    <p className="text-xs font-semibold text-indigo-700">¿Qué genera?</p>
                    <p className="text-xs text-indigo-600 leading-relaxed">
                      Claude analiza el contenido de la lección y genera una <strong>infografía SVG educativa</strong> con título, íconos y secciones de texto real — sin pseudo-texto ni alucinaciones tipográficas.
                    </p>
                    <p className="text-xs text-indigo-500 mt-1">El archivo se guarda como imagen de la lección y puede descargarse.</p>
                  </div>
                )}

                {/* Extra context for instructor (text only) */}
                {regenType === 'text' && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Contexto adicional <span className="font-normal text-gray-400">(opcional)</span>
                    </label>
                    <textarea
                      value={regenExtraContext}
                      onChange={(e) => setRegenExtraContext(e.target.value.slice(0, 500))}
                      placeholder="Ej. Enfócate en ejemplos prácticos para pequeñas empresas…"
                      className="input-field text-xs min-h-[60px] resize-none w-full"
                      maxLength={500}
                    />
                    <p className="text-xs text-gray-400 text-right">{regenExtraContext.length}/500</p>
                  </div>
                )}

                {regenError && <p className="text-xs text-red-500">{regenError}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="secondary" size="sm" onClick={handleCloseRegen}>Cancelar</Button>
                  <Button size="sm" loading={regenLoading} onClick={handlePreview}>
                    Previsualizar
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Preview phase — two-column comparison for text */}
                {regenType === 'text' && regenPreviewData ? (
                  <div className="grid grid-cols-2 gap-3">
                    {/* Left: current (gray) */}
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Actual</p>
                      {lesson.title && <p className="text-xs"><span className="font-semibold text-gray-500">Título:</span> {lesson.title}</p>}
                      {lesson.points?.filter((p: string) => p).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500">Puntos:</p>
                          <ul className="text-xs text-gray-600 pl-3 space-y-0.5">
                            {lesson.points.filter((p: string) => p).map((p: string, i: number) => (
                              <li key={i} className="list-disc">{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {lesson.tip && <p className="text-xs"><span className="font-semibold text-gray-500">Consejo:</span> {lesson.tip}</p>}
                    </div>
                    {/* Right: generated (blue) */}
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-1.5">
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Generado</p>
                      {regenPreviewData.title && <p className="text-xs"><span className="font-semibold text-gray-500">Título:</span> {regenPreviewData.title}</p>}
                      {Array.isArray(regenPreviewData.points) && regenPreviewData.points.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500">Puntos:</p>
                          <ul className="text-xs text-gray-700 pl-3 space-y-0.5">
                            {regenPreviewData.points.map((p: string, i: number) => (
                              <li key={i} className="list-disc">{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {regenPreviewData.tip && <p className="text-xs"><span className="font-semibold text-gray-500">Consejo:</span> {regenPreviewData.tip}</p>}
                    </div>
                  </div>
                ) : (regenType === 'image' || regenType === 'infographic') && regenPreviewData?.imageUrl ? (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-indigo-600 uppercase">Vista previa del contenido generado</p>
                      <a
                        href={regenPreviewData.imageUrl}
                        download={`leccion-${regenType}-${Date.now()}.${regenPreviewData.imageUrl.endsWith('.svg') ? 'svg' : 'jpg'}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                        title="Descargar imagen"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        Descargar
                      </a>
                    </div>
                    <img src={regenPreviewData.imageUrl} alt="Vista previa" className="w-full rounded-lg object-cover max-h-48" />
                  </div>
                ) : null}

                {regenError && <p className="text-xs text-red-500">{regenError}</p>}

                <div className="space-y-2 pt-1">
                  {regenType === 'text' ? (
                    <>
                      <Button size="sm" className="w-full" loading={regenLoading} onClick={() => handleConfirmRegen(false)}>
                        Sí, reemplaza todo
                      </Button>
                      <Button size="sm" variant="secondary" className="w-full" loading={regenLoading} onClick={() => handleConfirmRegen(true)}>
                        Combina los materiales nuevos con los existentes
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" className="w-full" loading={regenLoading} onClick={() => handleConfirmRegen(false)}>
                      Usar esta imagen
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="w-full" onClick={() => { setRegenPhase('config'); setRegenPreviewData(null); setRegenError(''); }}>
                    No, generar otra opción
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="p-4 bg-white rounded-xl border-2 border-cta-from space-y-4">
      <LessonFields form={form} setForm={setForm} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
        <Button type="submit" size="sm" loading={saving}>Guardar</Button>
      </div>
    </form>
  );
}
