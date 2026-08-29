'use client';

import { CheckCircle, Download, Loader2, Info, Sparkles, BookOpen, Save, ChevronDown, ChevronRight, Pencil, Trash2, Mic } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Step1Data, Step2Data, Step3Data, Step4Data, Step5Data,
  COURSE_TYPES, EVAL_TYPE_META,
} from './constants';
import { SectionLabel } from './StepBar';

interface StepPlaneamientoProps {
  step1: Step1Data;
  step2: Step2Data;
  step3: Step3Data;
  step4: Step4Data;
  step5: Step5Data;
  effectiveWeeks: number;
  editingCourseId: string | null;
  saveCourse: () => Promise<void>;
  onGoToCourse: (courseId: string) => void;
  onGoToEval: () => void;
  onRemoveEval: (itemId: string) => void;
  isEN: boolean;
}

export function StepPlaneamiento({
  step1, step2, step3, step4, step5,
  effectiveWeeks, editingCourseId,
  saveCourse, onGoToCourse, onGoToEval, onRemoveEval,
  isEN,
}: StepPlaneamientoProps) {
  const s = (es: string, en: string) => isEN ? en : es;
  const planEN = step1.planLanguage === 'EN';
  const ct = COURSE_TYPES.find((c) => c.id === step1.courseType);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const toggleExpand = (id: string) =>
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleDelete = (id: string) => {
    if (confirmDelete === id) { onRemoveEval(id); setConfirmDelete(null); }
    else setConfirmDelete(id);
  };

  if (step5.status === 'done') {
    return (
      <div className="space-y-6 text-center py-8">
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
          <CheckCircle className="w-10 h-10 text-emerald-500" />
        </div>
        <div>
          <p className="font-heading font-bold text-charcoal text-xl">{editingCourseId ? s('¡Curso actualizado exitosamente!', 'Course updated successfully!') : s('¡Curso creado exitosamente!', 'Course created successfully!')}</p>
          <p className="text-sm text-gray-400 mt-1">{step1.title}</p>
        </div>
        {step5.lessonJobId && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 rounded-xl flex items-center gap-3 text-left">
            <Loader2 className="w-4 h-4 text-blue-500 shrink-0 animate-spin" />
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {s('Lux Planner está generando las lecciones de cada módulo en segundo plano. Estarán listas en unos minutos al abrir el curso.',
                 'Lux Planner is generating lessons for each module in the background. They will be ready in a few minutes when you open the course.')}
            </p>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={() => onGoToCourse(step5.courseId!)} leftIcon={<BookOpen className="w-4 h-4" />}>
            {s('Ir al curso', 'Go to course')}
          </Button>
          {step5.docUrl && (
            <a href={step5.docUrl} target="_blank" rel="noopener noreferrer" download className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-border text-sm font-semibold text-charcoal hover:bg-surface transition-colors">
              <Download className="w-4 h-4 text-cta-from" />{s('Descargar documento editable', 'Download editable document')}
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Course identity card */}
      <div className="p-4 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10 rounded-xl border border-blue-100 space-y-1">
        <p className="font-semibold text-charcoal">{step1.title}</p>
        <p className="text-xs text-gray-500">{planEN ? ct?.labelEN : ct?.label} · {step1.academicPeriod || '—'} · {step1.modality}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
        {[
          { label: s('Semanas', 'Weeks'), value: step2.totalWeeks },
          { label: s('Excepciones', 'Exceptions'), value: step2.exceptions.length },
          { label: s('Evaluaciones', 'Evaluations'), value: step3.items.length },
          { label: s('Lectivas', 'Teaching'), value: effectiveWeeks },
        ].map(({ label, value }) => (
          <div key={label} className="p-3 rounded-xl bg-surface border border-border">
            <p className="text-xl font-bold text-cta-from">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Evaluations — collapsible */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>{s('Sistema de evaluación', 'Evaluation system')}</SectionLabel>
          <button onClick={onGoToEval} className="text-xs text-cta-from hover:underline font-medium flex items-center gap-1">
            <Pencil className="w-3 h-3" />{s('Editar evaluaciones', 'Edit evaluations')}
          </button>
        </div>
        <div className="space-y-2">
          {step3.items.map((it) => {
            const meta = EVAL_TYPE_META[it.type];
            const displayName = `${planEN ? it.nameEN : it.name}${(it.count ?? 1) > 1 ? ` (${it.count})` : ''}`;
            const isOpen = expanded.has(it.id);
            const isConfirming = confirmDelete === it.id;

            return (
              <div key={it.id} className="border border-border rounded-xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 px-3 py-2.5 bg-surface hover:bg-surface/80 transition-colors cursor-pointer" onClick={() => toggleExpand(it.id)}>
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>{meta.icon}{planEN ? meta.labelEN : meta.label}</span>
                  <span className="text-sm text-charcoal flex-1 font-medium">{displayName}</span>
                  <span className="text-sm font-bold text-cta-from shrink-0">{it.weight}%</span>
                </div>

                {/* Expanded details */}
                {isOpen && (
                  <div className="px-4 py-3 border-t border-border space-y-2 bg-white dark:bg-gray-900">
                    {/* Dates */}
                    {it.type !== 'ATTENDANCE' && it.dueDates.some(Boolean) && (
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{s('Fecha(s)', 'Date(s)')}</p>
                        <div className="flex flex-wrap gap-2">
                          {it.dueDates.filter(Boolean).map((d, i) => {
                            const [y, m, day] = d.split('-');
                            return (
                              <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                {it.count > 1 ? `${i + 1}. ` : ''}{day}/{m}/{y}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* Instructions */}
                    {it.type === 'EVIDENCE' && it.instructions && (
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{s('Instrucciones', 'Instructions')}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-3">{it.instructions}</p>
                      </div>
                    )}
                    {/* Interview dates */}
                    {it.type === 'INTERVIEW' && (it.interviewStartDate || it.interviewEndDate) && (
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1"><Mic className="w-3 h-3" />{s('Entrevistas', 'Interviews')}</p>
                        <p className="text-xs text-gray-500">
                          {it.interviewStartDate ? it.interviewStartDate : '?'} → {it.interviewEndDate ? it.interviewEndDate : '?'}
                          {it.interviewTimeSlot ? ` · ${s('Hasta', 'Until')} ${it.interviewTimeSlot}` : ''}
                        </p>
                      </div>
                    )}
                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button onClick={(e) => { e.stopPropagation(); onGoToEval(); }}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-cta-from text-cta-from hover:bg-blue-50 transition-colors font-medium">
                        <Pencil className="w-3 h-3" />{s('Editar', 'Edit')}
                      </button>
                      {!it.locked && (
                        isConfirming ? (
                          <div className="flex items-center gap-1">
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(it.id); }}
                              className="text-xs px-3 py-1.5 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors">
                              {s('Confirmar', 'Confirm')}
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                              className="text-xs px-2 py-1.5 rounded-lg border border-border text-gray-400 hover:bg-surface">
                              {s('Cancelar', 'Cancel')}
                            </button>
                          </div>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(it.id); }}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border text-red-500 hover:bg-red-50 transition-colors font-medium">
                            <Trash2 className="w-3 h-3" />{s('Eliminar', 'Delete')}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Deliverables summary */}
      {step3.items.some((it) => it.type !== 'ATTENDANCE' && it.dueDates.some(Boolean)) && (
        <div>
          <SectionLabel>{s('Resumen de entregables', 'Deliverables summary')}</SectionLabel>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface border-b border-border">
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">{s('Entregable', 'Deliverable')}</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 w-24">{s('Fecha', 'Date')}</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 w-14">{s('Peso', 'Weight')}</th>
                </tr>
              </thead>
              <tbody>
                {step3.items.filter((it) => it.type !== 'ATTENDANCE').flatMap((it) =>
                  it.dueDates.map((d, idx) => ({ it, d, idx }))
                ).filter(({ d }) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(({ it, d, idx }, ri) => {
                  const label = it.count > 1 ? `${planEN ? it.nameEN : it.name} ${idx + 1}` : (planEN ? it.nameEN : it.name);
                  const [y, m, day] = d.split('-');
                  return (
                    <tr key={ri} className="border-b border-border last:border-0 hover:bg-surface/50">
                      <td className="px-3 py-1.5 text-charcoal">{label}</td>
                      <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{day}/{m}/{y}</td>
                      <td className="px-3 py-1.5 font-semibold text-cta-from">{it.count > 1 ? `${(it.weight / it.count).toFixed(0)}%` : `${it.weight}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step4.weeklyPlan.length > 0 && (
        <div className="p-3 bg-purple-50 dark:bg-purple-900/10 border border-purple-100 rounded-xl flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />
          <p className="text-xs text-purple-700 dark:text-purple-300">
            {s(`Plan de ${step4.weeklyPlan.length} semanas con Lux Planner listo para incluir en el documento editable.`, `${step4.weeklyPlan.length}-week Lux Planner plan ready to include in the editable document.`)}
          </p>
        </div>
      )}

      <div className="p-4 rounded-xl border border-border bg-surface space-y-2">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-cta-from" />
          <p className="text-sm font-semibold text-charcoal">{s('Documento editable', 'Editable document')}</p>
        </div>
        <p className="text-xs text-gray-400">{s(`Machote: "${ct?.machote}" · Idioma: ${step1.planLanguage}`, `Template: "${ct?.machote}" · Language: ${step1.planLanguage}`)}</p>
        <p className="text-xs text-gray-400">{s('Se generará automáticamente y quedará disponible para descarga.', 'Auto-generated and available for download.')}</p>
      </div>

      {step5.status === 'error' && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{step5.error}
        </div>
      )}

      <div className="space-y-2">
        <Button onClick={saveCourse} disabled={step5.status === 'saving'}
          leftIcon={step5.status === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          className="w-full justify-center">
          {step5.status === 'saving' ? s('Creando curso...', 'Creating course...') : editingCourseId ? s('Actualizar Curso', 'Update Course') : s('Crear Curso con Lux Planner', 'Create Course with Lux Planner')}
        </Button>
        {!editingCourseId && step5.status !== 'saving' && (
          <p className="text-xs text-center text-gray-400">
            {s('El curso se alojará en Borradores y estará disponible para publicar cuando esté listo.', 'The course will be saved as a Draft and will be available to publish when ready.')}
          </p>
        )}
      </div>
    </div>
  );
}
