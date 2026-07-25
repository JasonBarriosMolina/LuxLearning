'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Plus, BookOpen, ShieldCheck, GraduationCap, Sparkles,
  RefreshCw, Loader2, CheckCircle2, AlertCircle, ExternalLink,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ModuleCard } from './_components/ModuleCard';
import { EMPTY_MODULE } from './_components/types';
import type { ModuleForm } from './_components/types';

export default function AdminCourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [moduleModal, setModuleModal] = useState(false);
  const [moduleForm, setModuleForm] = useState<ModuleForm>(EMPTY_MODULE);
  const [savingModule, setSavingModule] = useState(false);
  const [moduleError, setModuleError] = useState('');

  // ── AI module generation ─────────────────────────────────────────────────────
  const [aiModuleOpen, setAiModuleOpen] = useState(false);
  const [aiModuleTopic, setAiModuleTopic] = useState('');
  const [aiModuleLoading, setAiModuleLoading] = useState(false);
  const [aiModuleError, setAiModuleError] = useState('');
  const aiModuleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleAiModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiModuleTopic.trim()) return;
    setAiModuleLoading(true); setAiModuleError('');
    try {
      const res = await api.admin.modules.aiGenerate(courseId, { topic: aiModuleTopic.trim() });
      const jobId = (res as any)?.data?.jobId ?? (res as any)?.jobId;
      if (!jobId) { setAiModuleOpen(false); setAiModuleTopic(''); await load(); return; }
      // Poll every 3 s, give up after 120 s
      let elapsed = 0;
      aiModuleIntervalRef.current = setInterval(async () => {
        elapsed += 3;
        try {
          const poll = await api.admin.courses.aiJob(jobId);
          const status = (poll as any)?.data?.status ?? (poll as any)?.status;
          if (status === 'done') {
            clearInterval(aiModuleIntervalRef.current!); aiModuleIntervalRef.current = null;
            setAiModuleLoading(false); setAiModuleOpen(false); setAiModuleTopic(''); await load();
          } else if (status === 'error') {
            clearInterval(aiModuleIntervalRef.current!); aiModuleIntervalRef.current = null;
            setAiModuleLoading(false);
            setAiModuleError('Error al generar módulo. Intenta de nuevo.');
          } else if (elapsed >= 120) {
            clearInterval(aiModuleIntervalRef.current!); aiModuleIntervalRef.current = null;
            setAiModuleLoading(false);
            setAiModuleError('Tiempo de espera agotado. Recarga la página para ver si el módulo fue creado.');
          }
        } catch { /* network hiccup — keep polling */ }
      }, 3000);
    } catch (err: any) {
      setAiModuleError(err.message ?? 'Error al generar módulo');
      setAiModuleLoading(false);
    }
  };

  // ── Validate videos ──────────────────────────────────────────────────────────
  const [validateOpen, setValidateOpen] = useState(false);
  const [validateLoading, setValidateLoading] = useState(false);
  const [validateResult, setValidateResult] = useState<{ videos: any[]; broken: number; total: number } | null>(null);

  const handleValidateVideos = async (force = false) => {
    setValidateOpen(true);
    if (validateResult && !force) return; // use cache unless forced
    setValidateLoading(true);
    setValidateResult(null);
    try {
      const res = await api.admin.courses.validateVideos(courseId);
      setValidateResult((res as any).data);
    } catch {
      setValidateResult({ videos: [], broken: 0, total: 0 });
    } finally {
      setValidateLoading(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await api.admin.courses.get(courseId);
      setCourse((res as any).data);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { return () => { if (aiModuleIntervalRef.current) clearInterval(aiModuleIntervalRef.current); }; }, []);

  const handleAddModule = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingModule(true); setModuleError('');
    try {
      await api.admin.modules.create(courseId, moduleForm);
      setModuleModal(false); setModuleForm(EMPTY_MODULE); await load();
    } catch (err: any) {
      setModuleError(err.message ?? 'Error al crear módulo');
    } finally { setSavingModule(false); }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        {[1, 2, 3].map((n) => <div key={n} className="h-20 bg-gray-100 rounded-2xl" />)}
      </div>
    );
  }
  if (!course) return (
    <div className="max-w-4xl mx-auto py-16 text-center space-y-3">
      <p className="text-gray-500 text-sm">No se pudo cargar el curso. Puede que no exista o no tengas acceso.</p>
      <Link href="/admin/courses" className="inline-flex items-center gap-1.5 text-sm text-cta-from hover:underline">
        <ArrowLeft className="w-4 h-4" /> Volver a cursos
      </Link>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="space-y-3">
        {/* Title row */}
        <div className="flex items-start gap-3">
          <Link href="/admin/courses" className="p-2 rounded-lg hover:bg-surface mt-0.5 shrink-0">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h1 className="font-heading font-bold text-2xl text-charcoal">{course.title}</h1>
              <Badge variant={course.isActive ? 'success' : 'default'}>{course.isActive ? 'Activo' : 'Inactivo'}</Badge>
              {course.isPilot && <Badge variant="info">Piloto</Badge>}
            </div>
            <p className="text-sm text-gray-500 leading-relaxed">{course.description}</p>
            <p className="text-xs text-gray-400 mt-1">{course.modules?.length ?? 0} módulos • {course.modules?.reduce((s: number, m: any) => s + (m.lessons?.length ?? 0), 0) ?? 0} lecciones • {course.modules?.reduce((s: number, m: any) => s + (m.questions?.length ?? 0), 0) ?? 0} preguntas totales</p>
          </div>
        </div>
        {/* Action buttons — scroll horizontally on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pl-11">
          <Button
            variant="secondary"
            leftIcon={<GraduationCap className="w-4 h-4" />}
            onClick={() => router.push(`/admin/courses/${courseId}/preview`)}
            className="shrink-0"
          >
            Ver como Estudiante
          </Button>
          <Button
            variant="secondary"
            leftIcon={<ShieldCheck className="w-4 h-4" />}
            onClick={handleValidateVideos}
            className="shrink-0"
          >
            Validar videos
          </Button>
          <Button
            variant="secondary"
            leftIcon={<Sparkles className="w-4 h-4 text-purple-500" />}
            onClick={() => { setAiModuleTopic(''); setAiModuleError(''); setAiModuleOpen(true); }}
            className="shrink-0"
          >
            Módulo con IA
          </Button>
          <Button
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => { setModuleForm({ ...EMPTY_MODULE, order: (course.modules?.length ?? 0) + 1 }); setModuleModal(true); }}
            className="shrink-0"
          >
            Nuevo módulo
          </Button>
        </div>
      </div>

      {/* Modules */}
      {(course.modules?.length ?? 0) === 0 ? (
        <div className="card text-center py-16">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">Sin módulos todavía</p>
          <p className="text-gray-500 text-sm mt-1">Agrega el primer módulo con el botón de arriba.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {course.modules?.map((mod: any) => (
            <ModuleCard key={mod.id} mod={mod} courseId={courseId} onRefresh={load} />
          ))}
        </div>
      )}

      {/* Validate videos modal */}
      <Modal open={validateOpen} onClose={() => setValidateOpen(false)} title="Validar videos del curso" size="md">
        {validateLoading ? (
          <div className="flex flex-col items-center py-10 gap-3 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-sm">Verificando enlaces de YouTube…</span>
          </div>
        ) : validateResult ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
              <span>{validateResult.total} videos •</span>
              {validateResult.broken === 0
                ? <span className="text-green-600 font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Todos disponibles</span>
                : <span className="text-red-600 font-semibold flex items-center gap-1"><AlertCircle className="w-4 h-4" /> {validateResult.broken} roto{validateResult.broken !== 1 ? 's' : ''}</span>
              }
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {validateResult.videos.map((v: any) => (
                <div key={v.lessonId} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${v.ok ? 'bg-green-50 dark:bg-green-900/10' : 'bg-red-50 dark:bg-red-900/10'}`}>
                  {v.ok
                    ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                    : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  }
                  <span className={`flex-1 truncate ${v.ok ? 'text-gray-700 dark:text-gray-200' : 'text-red-700 dark:text-red-300 font-medium'}`}>{v.title}</span>
                  <a href={`https://www.youtube.com/watch?v=${v.youtubeId}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:text-cta-from flex items-center gap-0.5 shrink-0">
                    {v.youtubeId} <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
              {validateResult.total === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Este curso no tiene lecciones con youtubeId.</p>
              )}
            </div>
            <div className="flex justify-end pt-2 gap-2">
              <Button variant="secondary" size="sm" onClick={() => handleValidateVideos(true)}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Verificar de nuevo
              </Button>
              <Button size="sm" onClick={() => setValidateOpen(false)}>Cerrar</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* AI module generation modal */}
      <Modal open={aiModuleOpen} onClose={() => setAiModuleOpen(false)} title="Crear módulo con IA" size="sm">
        <form onSubmit={handleAiModule} className="space-y-4">
          <p className="text-sm text-gray-500">La IA generará un módulo completo (10 lecciones + 10 preguntas de quiz) sobre el tema que indiques.</p>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Tema del módulo</label>
            <input
              autoFocus
              value={aiModuleTopic}
              onChange={(e) => setAiModuleTopic(e.target.value)}
              placeholder="ej. Estrategias de comunicación efectiva"
              className="input-field text-sm w-full"
              required
            />
          </div>
          {aiModuleError && <p className="text-xs text-red-500">{aiModuleError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => setAiModuleOpen(false)}>Cancelar</Button>
            <Button type="submit" size="sm" loading={aiModuleLoading} leftIcon={<Sparkles className="w-3.5 h-3.5" />}>
              Generar módulo
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add module modal */}
      <Modal open={moduleModal} onClose={() => setModuleModal(false)} title="Nuevo módulo" size="lg">
        <form onSubmit={handleAddModule} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Input label="Título" value={moduleForm.title} onChange={(e) => setModuleForm({ ...moduleForm, title: e.target.value })} placeholder="ej. Introducción a StaffPad" required />
            </div>
            <Input label="Duración" value={moduleForm.duration} onChange={(e) => setModuleForm({ ...moduleForm, duration: e.target.value })} placeholder="ej. 45 min" required />
            <Input label="Nota mínima (%)" type="number" value={moduleForm.passingScore} onChange={(e) => setModuleForm({ ...moduleForm, passingScore: Number(e.target.value) })} min={1} max={100} required />
            <Input label="Orden" type="number" value={moduleForm.order} onChange={(e) => setModuleForm({ ...moduleForm, order: Number(e.target.value) })} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Descripción</label>
            <textarea value={moduleForm.description} onChange={(e) => setModuleForm({ ...moduleForm, description: e.target.value })} className="input-field resize-y min-h-[80px]" placeholder="Descripción del módulo..." required />
          </div>
          {moduleError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{moduleError}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModuleModal(false)}>Cancelar</Button>
            <Button type="submit" loading={savingModule}>Crear módulo</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
