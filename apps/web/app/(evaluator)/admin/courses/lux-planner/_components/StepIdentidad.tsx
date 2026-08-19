'use client';

import { X, Image as ImageIcon, Tag, Sparkles, Loader2, Plus } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { api } from '@/lib/api';
import {
  Step1Data, Step3Data, CourseTypeId, PlanLang,
  COURSE_TYPES, MODALITIES, DAYS_ES, DAYS_EN,
  COLOR_PALETTE, BORDER_PALETTE, TIME_SLOTS,
} from './constants';
import { SectionLabel } from './StepBar';

interface StepIdentidadProps {
  step1: Step1Data;
  setStep1: React.Dispatch<React.SetStateAction<Step1Data>>;
  setStep3: React.Dispatch<React.SetStateAction<Step3Data>>;
  editingCourseId: string | null;
  periods: { id: string; name: string }[];
  setPeriods: React.Dispatch<React.SetStateAction<{ id: string; name: string }[]>>;
  newPeriodInput: string;
  setNewPeriodInput: React.Dispatch<React.SetStateAction<string>>;
  showNewPeriod: boolean;
  setShowNewPeriod: React.Dispatch<React.SetStateAction<boolean>>;
  scheduleStart: string;
  setScheduleStart: React.Dispatch<React.SetStateAction<string>>;
  scheduleEnd: string;
  setScheduleEnd: React.Dispatch<React.SetStateAction<string>>;
  schedulesPerDay: Record<string, { start: string; end: string }>;
  setSchedulesPerDay: React.Dispatch<React.SetStateAction<Record<string, { start: string; end: string }>>>;
  labelInput: string;
  setLabelInput: React.Dispatch<React.SetStateAction<string>>;
  imageGenerating: boolean;
  imageError: string;
  setImageError: React.Dispatch<React.SetStateAction<string>>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleImageFile: (file: File) => Promise<void>;
  handleGenerateImage: () => Promise<void>;
  isEN: boolean;
}

export function StepIdentidad({
  step1, setStep1, setStep3, editingCourseId,
  periods, setPeriods,
  newPeriodInput, setNewPeriodInput,
  showNewPeriod, setShowNewPeriod,
  scheduleStart, setScheduleStart,
  scheduleEnd, setScheduleEnd,
  schedulesPerDay, setSchedulesPerDay,
  labelInput, setLabelInput,
  imageGenerating, imageError, setImageError,
  fileInputRef, handleImageFile, handleGenerateImage,
  isEN,
}: StepIdentidadProps) {
  const s = (es: string, en: string) => isEN ? en : es;
  const planEN = step1.planLanguage === 'EN';
  const isAsync = step1.modality === 'ASINCRONICA';
  const multiDay = step1.classDays.length > 1;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-charcoal">{s('Idioma del plan:', 'Plan language:')}</span>
        <div className="flex gap-1 bg-surface rounded-lg p-0.5">
          {(['ES', 'EN'] as PlanLang[]).map((lng) => (
            <button key={lng} onClick={() => setStep1((p) => ({ ...p, planLanguage: lng }))}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${step1.planLanguage === lng ? 'bg-white text-cta-from shadow-sm' : 'text-gray-400 hover:text-charcoal'}`}>
              {lng === 'ES' ? '🇨🇷 ES' : '🇺🇸 EN'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>{s('Tipo de curso', 'Course type')}</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {COURSE_TYPES.map((ct) => (
            <button key={ct.id} onClick={() => { const changing = step1.courseType !== ct.id; setStep1((p) => ({ ...p, courseType: ct.id })); if (changing && !editingCourseId) setStep3({ items: [], luxMentorWeeks: [] }); }}
              className={`text-left p-4 rounded-xl border-2 transition-all ${step1.courseType === ct.id ? 'border-cta-from bg-blue-50 dark:bg-blue-900/20' : 'border-border hover:border-gray-300 hover:bg-surface'}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${step1.courseType === ct.id ? 'bg-cta-from text-white' : 'bg-gray-100 text-gray-500'}`}>{ct.icon}</div>
              <p className="font-semibold text-charcoal text-sm">{planEN ? ct.labelEN : ct.label}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-snug">{planEN ? ct.descEN : ct.desc}</p>
              {step1.courseType === ct.id && <p className="text-[10px] text-cta-from font-medium mt-1.5">Machote: {ct.machote}</p>}
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>{s('Información del curso', 'Course information')}</SectionLabel>
        <div className="space-y-4">
          <Input label={s('Nombre del curso *', 'Course name *')} value={step1.title} onChange={(e) => setStep1((p) => ({ ...p, title: e.target.value }))} placeholder={s('Ej. Fundamentos de Programación', 'E.g. Programming Fundamentals')} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{s('Período académico', 'Academic period')}</label>
              {showNewPeriod ? (
                <div className="flex gap-1.5">
                  <input autoFocus type="text" value={newPeriodInput} onChange={(e) => setNewPeriodInput(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!newPeriodInput.trim()) return;
                        try {
                          const res = await api.admin.periods.create(newPeriodInput.trim()) as any;
                          const created = res?.data ?? res;
                          setPeriods((p) => [created, ...p]);
                          setStep1((prev) => {
                            const labelsWithoutOld = prev.cardLabels.filter((l) => l !== prev.academicPeriod);
                            const newLabels = created.name && !labelsWithoutOld.includes(created.name)
                              ? [created.name, ...labelsWithoutOld]
                              : labelsWithoutOld;
                            return { ...prev, academicPeriod: created.name, cardLabels: newLabels };
                          });
                          setNewPeriodInput(''); setShowNewPeriod(false);
                        } catch {
                          setImageError('No se pudo crear el período. Intenta de nuevo.');
                        }
                      } else if (e.key === 'Escape') { setShowNewPeriod(false); setNewPeriodInput(''); }
                    }}
                    placeholder={s('Ej. I Cuatrimestre 2026', 'E.g. Spring 2026')}
                    className="input-field flex-1 text-sm py-2" />
                  <button onClick={() => { setShowNewPeriod(false); setNewPeriodInput(''); }} className="px-2 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <select value={step1.academicPeriod} onChange={(e) => {
                    const newPeriod = e.target.value;
                    setStep1((p) => {
                      const labelsWithoutOld = p.cardLabels.filter((l) => l !== p.academicPeriod);
                      const newLabels = newPeriod && !labelsWithoutOld.includes(newPeriod)
                        ? [newPeriod, ...labelsWithoutOld]
                        : labelsWithoutOld;
                      return { ...p, academicPeriod: newPeriod, cardLabels: newLabels };
                    });
                  }} className="input-field flex-1 text-sm py-2">
                    <option value="">{s('— Seleccionar —', '— Select —')}</option>
                    {periods.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                  <button onClick={() => setShowNewPeriod(true)} title={s('Crear nuevo', 'Create new')} className="px-2 text-cta-from hover:text-cta-to"><Plus className="w-4 h-4" /></button>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{s('Fecha de inicio *', 'Start date *')}</label>
              <input type="date" value={step1.startDate} onChange={(e) => setStep1((p) => ({ ...p, startDate: e.target.value }))} className="input-field w-full" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">{s('Descripción', 'Description')}</label>
            <textarea value={step1.description} onChange={(e) => setStep1((p) => ({ ...p, description: e.target.value }))} placeholder={s('Describe los objetivos generales...', 'Describe the general objectives...')} className="input-field min-h-[70px] resize-y" />
          </div>
        </div>
      </div>

      <div>
        <SectionLabel>{s('Logística', 'Logistics')}</SectionLabel>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">{s('Modalidad *', 'Modality *')}</label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {MODALITIES.map((m) => (
                <button key={m.id} onClick={() => setStep1((p) => ({ ...p, modality: m.id }))}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium border-2 transition-all ${step1.modality === m.id ? 'border-cta-from bg-blue-50 text-cta-from dark:bg-blue-900/20' : 'border-border text-gray-500 hover:border-gray-300'}`}>
                  {planEN ? m.labelEN : m.label}
                </button>
              ))}
            </div>
          </div>
          {!isAsync && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-charcoal">{s('Días de clase', 'Class days')}</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_ES.map((day, i) => {
                    const label = planEN ? DAYS_EN[i] : day;
                    const active = step1.classDays.includes(day);
                    return (
                      <button key={day} onClick={() => setStep1((p) => ({ ...p, classDays: active ? p.classDays.filter((d) => d !== day) : [...p.classDays, day] }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all ${active ? 'border-cta-from bg-cta-from text-white' : 'border-border text-gray-500 hover:border-gray-300'}`}>
                        {(label ?? day).slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-charcoal">{s('Horario de clase', 'Class schedule')}</label>
                <datalist id="wiz-time-slots">
                  {TIME_SLOTS.map((t) => <option key={t} value={t} />)}
                </datalist>
                {multiDay ? (
                  <div className="space-y-2">
                    {step1.classDays.map((day, i) => {
                      const label = planEN ? DAYS_EN[DAYS_ES.indexOf(day)] ?? day : day;
                      const vals = schedulesPerDay[day] ?? { start: '', end: '' };
                      return (
                        <div key={day} className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-500 w-10 shrink-0">{label.slice(0, 3)}</span>
                          <input type="text" list="wiz-time-slots" value={vals.start}
                            onChange={(e) => setSchedulesPerDay((p) => ({ ...p, [day]: { ...vals, start: e.target.value } }))}
                            placeholder={s('Inicio', 'Start')} className="input-field flex-1 text-sm py-1.5" />
                          <span className="text-gray-400 text-sm shrink-0">–</span>
                          <input type="text" list="wiz-time-slots" value={vals.end}
                            onChange={(e) => setSchedulesPerDay((p) => ({ ...p, [day]: { ...vals, end: e.target.value } }))}
                            placeholder={s('Fin', 'End')} className="input-field flex-1 text-sm py-1.5" />
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-gray-400">{s('Cada día puede tener un horario diferente.', 'Each day can have a different schedule.')}</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input type="text" list="wiz-time-slots"
                      value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)}
                      placeholder={s('Inicio (ej. 8:00 AM)', 'Start (e.g. 8:00 AM)')}
                      className="input-field flex-1 text-sm py-2" />
                    <span className="text-gray-400 text-sm shrink-0">–</span>
                    <input type="text" list="wiz-time-slots"
                      value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)}
                      placeholder={s('Fin (ej. 10:00 AM)', 'End (e.g. 10:00 AM)')}
                      className="input-field flex-1 text-sm py-2" />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>{s('Portada del curso', 'Course cover')}</SectionLabel>
        <div className="space-y-3">
          {step1.imageUrl ? (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-border bg-surface max-w-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step1.imageUrl} alt="cover" className="w-full h-full object-cover" />
              <button onClick={() => setStep1((p) => ({ ...p, imageUrl: '' }))} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer hover:border-gray-300 hover:bg-surface transition-colors max-w-sm"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) handleImageFile(f); }}>
              <ImageIcon className="w-7 h-7 text-gray-300" />
              <p className="text-sm font-medium text-gray-400">{s('Arrastra o haz clic', 'Drag or click')}</p>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }} />
          {imageError && <p className="text-xs text-red-500">{imageError}</p>}
          {!step1.imageUrl && step1.title && (
            <button onClick={handleGenerateImage} disabled={imageGenerating} className="flex items-center gap-2 text-sm text-purple-600 hover:text-purple-800 font-medium transition-colors disabled:opacity-50">
              {imageGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {imageGenerating ? s('Generando...', 'Generating...') : s('Generar con IA', 'Generate with AI')}
            </button>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>{s('Personalización visual', 'Visual customization')}</SectionLabel>
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">{s('Color de tinte', 'Tint color')}</label>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setStep1((p) => ({ ...p, cardColor: '' }))} className={`w-6 h-6 rounded-full border-2 bg-white flex items-center justify-center ${!step1.cardColor ? 'border-cta-from scale-110' : 'border-gray-200'}`}><X className="w-2.5 h-2.5 text-gray-300" /></button>
              {COLOR_PALETTE.map((c) => (<button key={c} onClick={() => setStep1((p) => ({ ...p, cardColor: c }))} style={{ backgroundColor: c }} className={`w-6 h-6 rounded-full border-2 transition-all ${step1.cardColor === c ? 'border-white scale-110 shadow-md' : 'border-transparent'}`} />))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">{s('Color de borde hover', 'Hover border')}</label>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setStep1((p) => ({ ...p, cardBorderColor: '' }))} className={`w-6 h-6 rounded-full border-2 bg-white flex items-center justify-center ${!step1.cardBorderColor ? 'border-cta-from scale-110' : 'border-gray-200'}`}><X className="w-2.5 h-2.5 text-gray-300" /></button>
              {BORDER_PALETTE.map((c) => (<button key={c} onClick={() => setStep1((p) => ({ ...p, cardBorderColor: c }))} style={{ borderColor: c, backgroundColor: c + '22' }} className={`w-6 h-6 rounded-full border-2 transition-all ${step1.cardBorderColor === c ? 'scale-110 shadow-md' : ''}`} />))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-indigo-500" />{s('Etiquetas de Curso', 'Course Labels')}</label>
            <div className="flex gap-2">
              <input type="text" value={labelInput} onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = labelInput.trim(); if (v && !step1.cardLabels.includes(v)) { setStep1((p) => ({ ...p, cardLabels: [...p.cardLabels, v] })); setLabelInput(''); } } }}
                placeholder={s('Ej. Curso Core…', 'E.g. Core Course…')} className="input-field flex-1 text-sm py-2" />
              <button onClick={() => { const v = labelInput.trim(); if (v && !step1.cardLabels.includes(v)) { setStep1((p) => ({ ...p, cardLabels: [...p.cardLabels, v] })); setLabelInput(''); } }} className="px-3 py-2 rounded-xl border border-border text-sm text-gray-500 hover:bg-surface transition-colors">+</button>
            </div>
            {step1.cardLabels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {step1.cardLabels.map((lb) => (
                  <span key={lb} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
                    {lb}<button onClick={() => setStep1((p) => ({ ...p, cardLabels: p.cardLabels.filter((l) => l !== lb) }))} className="text-indigo-400 hover:text-indigo-700"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
