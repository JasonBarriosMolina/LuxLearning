'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, BookOpen, FlaskConical, FolderKanban,
  Clock, AlignLeft, Sparkles, Loader2, X, Upload, Image as ImageIcon,
  Globe, Tag, CheckCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useLanguage } from '@/lib/i18n';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'Identidad' },
  { n: 2, label: 'Calendario' },
  { n: 3, label: 'Evaluación' },
  { n: 4, label: 'Copilot IA' },
  { n: 5, label: 'Planeamiento' },
];

const COURSE_TYPES = [
  {
    id: 'TEORICO',
    icon: <BookOpen className="w-5 h-5" />,
    label: 'Teórico',
    labelEN: 'Theoretical',
    desc: 'Lecciones, quizzes y reflexiones. Evaluación conceptual.',
    descEN: 'Lessons, quizzes and reflections. Conceptual assessment.',
    machote: 'Carrera Internacional Teórico',
  },
  {
    id: 'TEORICO_PRACTICO',
    icon: <FlaskConical className="w-5 h-5" />,
    label: 'Teórico-Práctico',
    labelEN: 'Theoretical-Practical',
    desc: 'Combina lecciones con entregas de laboratorio o proyectos.',
    descEN: 'Combines lessons with lab or project deliverables.',
    machote: 'Carrera Internacional Práctico',
  },
  {
    id: 'PROYECTOS',
    icon: <FolderKanban className="w-5 h-5" />,
    label: 'Taller / Proyectos',
    labelEN: 'Workshop / Projects',
    desc: 'Proyecto 85% + Asistencia 15%. Anteproyecto, avances y defensa.',
    descEN: 'Project 85% + Attendance 15%. Proposal, progress, and defense.',
    machote: 'Planes Proyectos',
  },
  {
    id: 'PROGRAMA_ESPECIAL',
    icon: <Sparkles className="w-5 h-5" />,
    label: 'Programa Especial',
    labelEN: 'Special Program',
    desc: 'Disciplinas artísticas o técnicas. Cotidiano 50%, pruebas y tareas.',
    descEN: 'Artistic or technical disciplines. Daily 50%, tests and tasks.',
    machote: 'Plan Práctico P.E.',
  },
  {
    id: 'CURSO_CORTO',
    icon: <Clock className="w-5 h-5" />,
    label: 'Curso Corto',
    labelEN: 'Short Course',
    desc: '8 semanas. Asistencia mínima + proyecto final.',
    descEN: '8 weeks. Minimum attendance + final project.',
    machote: 'Plan Curso Corto',
  },
  {
    id: 'LIBRE',
    icon: <AlignLeft className="w-5 h-5" />,
    label: 'Curso Libre / Tutoría',
    labelEN: 'Free Course / Tutoring',
    desc: '6 meses. Contenido teórico y práctico por semana.',
    descEN: '6 months. Weekly theoretical and practical content.',
    machote: 'Plan Didáctico Libre',
  },
] as const;

type CourseTypeId = (typeof COURSE_TYPES)[number]['id'];

const MODALITIES = [
  { id: 'PRESENCIAL', label: 'Presencial', labelEN: 'In-Person' },
  { id: 'SINCRONICA', label: 'Sincrónica', labelEN: 'Synchronous' },
  { id: 'ASINCRONICA', label: 'Asincrónica', labelEN: 'Asynchronous' },
  { id: 'HIBRIDA', label: 'Híbrida', labelEN: 'Hybrid' },
] as const;

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const COLOR_PALETTE = [
  '#17527E', '#7C3AED', '#059669', '#DC2626',
  '#D97706', '#0891B2', '#BE185D', '#374151',
  '#1D4ED8', '#065F46', '#92400E', '#4C1D95',
];

const BORDER_PALETTE = [
  '#17527E', '#7C3AED', '#059669', '#DC2626',
  '#D97706', '#0891B2', '#1D4ED8', '#374151',
];

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-150 ${
              current > s.n
                ? 'bg-emerald-500 text-white'
                : current === s.n
                  ? 'bg-gradient-to-br from-cta-from to-cta-to text-white shadow-md'
                  : 'bg-gray-100 text-gray-400'
            }`}>
              {current > s.n ? <CheckCircle className="w-4 h-4" /> : s.n}
            </div>
            <span className={`text-[10px] font-medium whitespace-nowrap ${
              current === s.n ? 'text-cta-from' : 'text-gray-400'
            }`}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-0.5 w-12 mx-1 mb-4 transition-colors duration-150 ${
              current > s.n ? 'bg-emerald-400' : 'bg-gray-200'
            }`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{children}</p>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

interface Step1Data {
  // Identidad
  title: string;
  academicPeriod: string;
  classDays: string[];
  classSchedule: string;
  modality: string;
  startDate: string;
  planLanguage: 'ES' | 'EN';
  courseType: CourseTypeId | '';
  description: string;
  // Visual
  imageUrl: string;
  cardColor: string;
  cardBorderColor: string;
  cardLabels: string[];
}

const EMPTY_STEP1: Step1Data = {
  title: '',
  academicPeriod: '',
  classDays: [],
  classSchedule: '',
  modality: '',
  startDate: '',
  planLanguage: 'ES',
  courseType: '',
  description: '',
  imageUrl: '',
  cardColor: '',
  cardBorderColor: '',
  cardLabels: [],
};

export default function CourseWizardPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const isEN = lang === 'en';

  const [step, setStep] = useState(1);
  const [step1, setStep1] = useState<Step1Data>(EMPTY_STEP1);
  const [labelInput, setLabelInput] = useState('');
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const s = (es: string, en: string) => isEN ? en : es;

  // ── Helpers ────────────────────────────────────────────────────────────────

  const toggleDay = (day: string) => {
    setStep1((p) => ({
      ...p,
      classDays: p.classDays.includes(day)
        ? p.classDays.filter((d) => d !== day)
        : [...p.classDays, day],
    }));
  };

  const addLabel = () => {
    const val = labelInput.trim();
    if (!val || step1.cardLabels.includes(val)) return;
    setStep1((p) => ({ ...p, cardLabels: [...p.cardLabels, val] }));
    setLabelInput('');
  };

  const handleImageFile = async (file: File) => {
    if (!file) return;
    setImageUploading(true);
    setImageError('');
    try {
      // Create an object URL for local preview — actual upload happens on course save
      const objectUrl = URL.createObjectURL(file);
      setStep1((p) => ({ ...p, imageUrl: objectUrl, _imageFile: file } as any));
    } catch {
      setImageError(s('Error al cargar la imagen', 'Error loading image'));
    } finally {
      setImageUploading(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!step1.title) return;
    setImageGenerating(true);
    setImageError('');
    try {
      const promptText = step1.description
        ? `${step1.title}: ${step1.description}`
        : step1.title;
      const resp = await api.admin.courses.generateCover('wizard-temp', { promptText });
      const url = (resp as any)?.data?.imageUrl ?? (resp as any)?.imageUrl;
      if (url) setStep1((p) => ({ ...p, imageUrl: url }));
    } catch {
      setImageError(s('Error al generar la imagen', 'Error generando la imagen'));
    } finally {
      setImageGenerating(false);
    }
  };

  const step1Valid =
    step1.title.trim().length > 0 &&
    step1.courseType !== '' &&
    step1.modality !== '' &&
    step1.startDate !== '';

  // ── Render Step 1 ──────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <div className="space-y-8">

      {/* Language selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-charcoal">
          {s('Idioma del plan de estudios:', 'Study plan language:')}
        </span>
        <div className="flex gap-1 bg-surface rounded-lg p-0.5">
          {(['ES', 'EN'] as const).map((lng) => (
            <button
              key={lng}
              onClick={() => setStep1((p) => ({ ...p, planLanguage: lng }))}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-colors duration-150 ${
                step1.planLanguage === lng
                  ? 'bg-white text-cta-from shadow-sm'
                  : 'text-gray-400 hover:text-charcoal'
              }`}
            >
              {lng === 'ES' ? '🇨🇷 ES' : '🇺🇸 EN'}
            </button>
          ))}
        </div>
      </div>

      {/* Tipo de curso */}
      <div>
        <SectionLabel>{s('Tipo de curso', 'Course type')}</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {COURSE_TYPES.map((ct) => (
            <button
              key={ct.id}
              onClick={() => setStep1((p) => ({ ...p, courseType: ct.id }))}
              className={`text-left p-4 rounded-xl border-2 transition-all duration-150 ${
                step1.courseType === ct.id
                  ? 'border-cta-from bg-blue-50 dark:bg-blue-900/20'
                  : 'border-border hover:border-gray-300 hover:bg-surface'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${
                step1.courseType === ct.id ? 'bg-cta-from text-white' : 'bg-gray-100 text-gray-500'
              }`}>
                {ct.icon}
              </div>
              <p className="font-semibold text-charcoal text-sm">
                {step1.planLanguage === 'EN' ? ct.labelEN : ct.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                {step1.planLanguage === 'EN' ? ct.descEN : ct.desc}
              </p>
              {step1.courseType === ct.id && (
                <p className="text-[10px] text-cta-from font-medium mt-1.5">
                  Machote: {ct.machote}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Información básica */}
      <div>
        <SectionLabel>{s('Información del curso', 'Course information')}</SectionLabel>
        <div className="space-y-4">
          <Input
            label={s('Nombre del curso *', 'Course name *')}
            value={step1.title}
            onChange={(e) => setStep1((p) => ({ ...p, title: e.target.value }))}
            placeholder={s('Ej. Fundamentos de Programación', 'E.g. Programming Fundamentals')}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={s('Período académico', 'Academic period')}
              value={step1.academicPeriod}
              onChange={(e) => setStep1((p) => ({ ...p, academicPeriod: e.target.value }))}
              placeholder={s('Ej. I Cuatrimestre 2026', 'E.g. Spring 2026')}
            />
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">
                {s('Fecha de inicio *', 'Start date *')}
              </label>
              <input
                type="date"
                value={step1.startDate}
                onChange={(e) => setStep1((p) => ({ ...p, startDate: e.target.value }))}
                className="input-field w-full"
              />
            </div>
          </div>

          {/* Descripción */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">
              {s('Descripción del curso', 'Course description')}
            </label>
            <textarea
              value={step1.description}
              onChange={(e) => setStep1((p) => ({ ...p, description: e.target.value }))}
              placeholder={s(
                'Describe los objetivos generales y el enfoque del curso...',
                'Describe the general objectives and focus of the course...'
              )}
              className="input-field min-h-[80px] resize-y"
            />
          </div>
        </div>
      </div>

      {/* Logística */}
      <div>
        <SectionLabel>{s('Logística', 'Logistics')}</SectionLabel>
        <div className="space-y-4">
          {/* Días de clase */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">
              {s('Días de clase', 'Class days')}
            </label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((day, i) => {
                const label = step1.planLanguage === 'EN' ? DAYS_EN[i] : day;
                const active = step1.classDays.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all duration-150 ${
                      active
                        ? 'border-cta-from bg-cta-from text-white'
                        : 'border-border text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {label.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={s('Horario', 'Schedule')}
              value={step1.classSchedule}
              onChange={(e) => setStep1((p) => ({ ...p, classSchedule: e.target.value }))}
              placeholder={s('Ej. 6:00 pm – 8:00 pm', 'E.g. 6:00 PM – 8:00 PM')}
            />
            {/* Modalidad */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">
                {s('Modalidad *', 'Modality *')}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {MODALITIES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setStep1((p) => ({ ...p, modality: m.id }))}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium border-2 transition-all duration-150 ${
                      step1.modality === m.id
                        ? 'border-cta-from bg-blue-50 text-cta-from dark:bg-blue-900/20'
                        : 'border-border text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {step1.planLanguage === 'EN' ? m.labelEN : m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Portada del curso */}
      <div>
        <SectionLabel>{s('Portada del curso', 'Course cover')}</SectionLabel>
        <div className="space-y-3">
          {step1.imageUrl ? (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-border bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step1.imageUrl} alt="cover" className="w-full h-full object-cover" />
              <button
                onClick={() => setStep1((p) => ({ ...p, imageUrl: '' }))}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer hover:border-gray-300 hover:bg-surface transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) handleImageFile(file);
              }}
            >
              {imageUploading ? (
                <Loader2 className="w-8 h-8 text-gray-300 animate-spin" />
              ) : (
                <ImageIcon className="w-8 h-8 text-gray-300" />
              )}
              <div className="text-center">
                <p className="text-sm font-medium text-gray-500">
                  {imageUploading
                    ? s('Subiendo...', 'Uploading...')
                    : s('Arrastra o haz clic para subir', 'Drag or click to upload')}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {s('Proporción recomendada: 16:9', 'Recommended ratio: 16:9')}
                </p>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
          />
          {imageError && (
            <p className="text-xs text-red-500">{imageError}</p>
          )}
          {!step1.imageUrl && step1.title && (
            <button
              onClick={handleGenerateImage}
              disabled={imageGenerating}
              className="flex items-center gap-2 text-sm text-purple-600 hover:text-purple-800 font-medium transition-colors disabled:opacity-50"
            >
              {imageGenerating
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Sparkles className="w-4 h-4" />}
              {imageGenerating
                ? s('Generando con IA...', 'Generating with AI...')
                : s('Generar portada con IA', 'Generate cover with AI')}
            </button>
          )}
        </div>
      </div>

      {/* Personalización visual */}
      <div>
        <SectionLabel>{s('Personalización visual de la tarjeta', 'Card visual customization')}</SectionLabel>
        <div className="space-y-5">
          {/* Color de fondo */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">
              {s('Color de tinte de fondo', 'Background tint color')}
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setStep1((p) => ({ ...p, cardColor: '' }))}
                className={`w-7 h-7 rounded-full border-2 bg-white flex items-center justify-center transition-all ${
                  !step1.cardColor ? 'border-cta-from scale-110' : 'border-gray-200'
                }`}
              >
                <X className="w-3 h-3 text-gray-300" />
              </button>
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setStep1((p) => ({ ...p, cardColor: c }))}
                  style={{ backgroundColor: c }}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    step1.cardColor === c ? 'border-white scale-110 shadow-md' : 'border-transparent'
                  }`}
                />
              ))}
            </div>
            {step1.cardColor && (
              <div
                className="mt-2 h-8 rounded-lg border border-border text-xs text-center flex items-center justify-center text-gray-500"
                style={{ backgroundColor: step1.cardColor + '18' }}
              >
                {s('Vista previa del tinte', 'Tint preview')}
              </div>
            )}
          </div>

          {/* Color de borde */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal">
              {s('Color de borde al pasar el mouse', 'Hover border color')}
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setStep1((p) => ({ ...p, cardBorderColor: '' }))}
                className={`w-7 h-7 rounded-full border-2 bg-white flex items-center justify-center transition-all ${
                  !step1.cardBorderColor ? 'border-cta-from scale-110' : 'border-gray-200'
                }`}
              >
                <X className="w-3 h-3 text-gray-300" />
              </button>
              {BORDER_PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setStep1((p) => ({ ...p, cardBorderColor: c }))}
                  style={{ borderColor: c, backgroundColor: c + '22' }}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    step1.cardBorderColor === c ? 'scale-110 shadow-md' : ''
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Etiquetas personalizadas */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-charcoal flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-indigo-500" />
              {s('Etiquetas de la tarjeta', 'Card labels')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel(); } }}
                placeholder={s('Ej. Curso Core, Cupos Limitados…', 'E.g. Core Course, Limited Seats…')}
                className="input-field flex-1 text-sm py-2"
              />
              <button
                onClick={addLabel}
                className="px-3 py-2 rounded-xl border border-border text-sm text-gray-500 hover:bg-surface transition-colors"
              >
                +
              </button>
            </div>
            {step1.cardLabels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {step1.cardLabels.map((lb) => (
                  <span
                    key={lb}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium"
                  >
                    {lb}
                    <button
                      onClick={() => setStep1((p) => ({ ...p, cardLabels: p.cardLabels.filter((l) => l !== lb) }))}
                      className="text-indigo-400 hover:text-indigo-700 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400">
              {s(
                'Se mostrarán en la esquina de la tarjeta del curso.',
                'Displayed in the corner of the course card.'
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Placeholder steps ──────────────────────────────────────────────────────

  const renderComingSoon = (label: string) => (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <Sparkles className="w-7 h-7 text-gray-300" />
      </div>
      <p className="font-heading font-bold text-charcoal">{label}</p>
      <p className="text-sm text-gray-400 mt-1">
        {s('Esta sección se completa en la siguiente sesión.', 'This section is built in the next session.')}
      </p>
    </div>
  );

  // ── Navigation ─────────────────────────────────────────────────────────────

  const canNext = step === 1 ? step1Valid : true;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-b border-border px-6 py-3 flex items-center gap-4">
        <button
          onClick={() => router.push('/admin/courses')}
          className="p-2 rounded-lg text-gray-400 hover:text-charcoal hover:bg-surface transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <p className="font-heading font-bold text-charcoal text-sm">
            {s('Wizard de Creación de Curso', 'Course Creation Wizard')}
          </p>
          {step1.title && (
            <p className="text-xs text-gray-400">{step1.title}</p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        <StepBar current={step} />

        <div className="animate-fade-in">
          {step === 1 && renderStep1()}
          {step === 2 && renderComingSoon(s('Paso 2 — Calendario y Excepciones', 'Step 2 — Calendar & Exceptions'))}
          {step === 3 && renderComingSoon(s('Paso 3 — Configuración de Evaluación', 'Step 3 — Evaluation Setup'))}
          {step === 4 && renderComingSoon(s('Paso 4 — Copilot IA', 'Step 4 — AI Copilot'))}
          {step === 5 && renderComingSoon(s('Paso 5 — Planeamiento Curricular', 'Step 5 — Curriculum Plan'))}
        </div>

        {/* Bottom nav */}
        <div className="flex items-center justify-between mt-10 pt-6 border-t border-border">
          <Button
            variant="secondary"
            onClick={() => step > 1 ? setStep((s) => (s - 1) as typeof step) : router.push('/admin/courses')}
            leftIcon={<ArrowLeft className="w-4 h-4" />}
          >
            {s('Atrás', 'Back')}
          </Button>

          {step < 5 ? (
            <Button
              onClick={() => setStep((s) => (s + 1) as typeof step)}
              disabled={!canNext}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              {s('Siguiente', 'Next')}
            </Button>
          ) : (
            <Button
              leftIcon={<CheckCircle className="w-4 h-4" />}
              disabled
            >
              {s('Generar Planeamiento', 'Generate Plan')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
