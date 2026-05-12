'use client';

import { useEffect, useState, useRef } from 'react';
import {
  BarChart2, Users, AlertTriangle, CheckCircle, XCircle, Clock, Star,
  TrendingUp, Download, Mail, Flame, BookOpen, ChevronDown, Edit2, Save, X,
  Loader2, Send, FileText,
} from 'lucide-react';
import { api } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'master' | 'student' | 'course';

type Summary = {
  totalReflections: number; totalApproved: number; totalRejected: number;
  totalPending: number; overallApprovalRate: number; totalEnrolled: number;
  activeStudents: number; atRiskStudents: number; neverStarted: number; avgQuality: number | null;
};

type ModuleStat = {
  moduleId: string; title: string; courseTitle: string; total: number;
  approved: number; rejected: number; approvalRate: number | null; avgHoursToReview: number | null;
};

type HeatMapEntry = {
  moduleId: string; moduleTitle: string; courseTitle: string;
  questions: { index: number; text: string; errorRate: number; totalAttempts: number }[];
};

type StudentProgress = {
  userId: string; studentName: string; reflectionsApproved: number; reflectionsTotal: number;
  avgQuizScore: number; integratedScore: number; lastActivity: string | null;
};

type AnalysisEntry = {
  moduleId: string; moduleTitle: string;
  keyTopics: { topic: string; count: number; sentiment: string }[];
  reflectionSummary: string;
  weakQuizTopics: { questionText: string; errorRate: number }[];
  analyzedAt: string;
};

type RecommendationEntry = {
  moduleId: string; moduleTitle: string;
  items: { id: string; weakTopic: string; title: string; type: string; url: string; description: string; aiGenerated: boolean }[];
};

type ReportData = {
  summary: Summary; moduleStats: ModuleStat[]; heatMap: HeatMapEntry[];
  studentProgress: StudentProgress[]; analysis: AnalysisEntry[]; recommendations: RecommendationEntry[];
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function heatColor(rate: number): string {
  if (rate >= 70) return 'bg-red-500 text-white';
  if (rate >= 50) return 'bg-orange-400 text-white';
  if (rate >= 30) return 'bg-amber-300 text-charcoal';
  return 'bg-emerald-100 text-emerald-700';
}

function scoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-500';
}

function sentimentColor(s: string) {
  if (s === 'positive') return 'bg-emerald-100 text-emerald-700';
  if (s === 'negative') return 'bg-red-100 text-red-600';
  return 'bg-gray-100 text-gray-600';
}

function typeIcon(type: string) {
  const icons: Record<string, string> = { article: '📄', book: '📚', video: '🎥', link: '🔗' };
  return icons[type] ?? '🔗';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [mode, setMode] = useState<Mode>('master');
  const [filterStudentId, setFilterStudentId] = useState('');
  const [filterCourseId, setFilterCourseId] = useState('');
  const [filterStudentCourseId, setFilterStudentCourseId] = useState(''); // sub-filtro curso en modo individual
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  // Students + courses for filter selectors
  const [studentOptions, setStudentOptions] = useState<{ userId: string; studentName: string }[]>([]);
  const [courseOptions, setCourseOptions] = useState<{ id: string; title: string }[]>([]);

  // Email
  const [emailTo, setEmailTo] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState('');

  // Recommendations editing
  const [editingRecs, setEditingRecs] = useState<string | null>(null); // moduleId
  const [editedItems, setEditedItems] = useState<any[]>([]);
  const [savingRecs, setSavingRecs] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  // Load filter options once
  useEffect(() => {
    // Load students from Cognito (all STUDENT-role users, regardless of activity)
    // and courses from admin endpoint
    Promise.all([
      api.admin.users.list(),
      api.admin.courses.list(),
    ]).then(([usersRes, coursesRes]: any[]) => {
      const users = Array.isArray(usersRes) ? usersRes : (usersRes?.data ?? []);
      const allCourses = Array.isArray(coursesRes) ? coursesRes : (coursesRes?.data ?? []);
      setStudentOptions(
        users
          .filter((u: any) => u.role === 'STUDENT')
          .map((u: any) => ({
            userId: u.username,
            studentName: u.name || u.email,
          }))
      );
      setCourseOptions(allCourses.map((c: any) => ({ id: c.id, title: c.title })));
    }).catch(() => {});
  }, []);

  // Resetear sub-filtro de curso cuando cambia el estudiante
  useEffect(() => { setFilterStudentCourseId(''); }, [filterStudentId]);

  // Load report data when filters change
  useEffect(() => {
    if ((mode === 'student' && !filterStudentId) || (mode === 'course' && !filterCourseId)) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    setData(null);
    const params: any = { mode };
    if (mode === 'student' && filterStudentId) {
      params.studentId = filterStudentId;
      if (filterStudentCourseId) params.courseId = filterStudentCourseId;
    }
    if (mode === 'course' && filterCourseId) params.courseId = filterCourseId;

    api.admin.reportsV2(params).then((res: any) => {
      setData(res?.data ?? res);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [mode, filterStudentId, filterCourseId, filterStudentCourseId]);

  const canLoad = mode === 'master' || (mode === 'student' && filterStudentId) || (mode === 'course' && filterCourseId);

  // ── PDF / Print ──────────────────────────────────────────────────────────
  const handlePrint = () => window.print();

  // ── Email ────────────────────────────────────────────────────────────────
  const buildEmailSubject = () => {
    if (mode === 'student') {
      const s = studentOptions.find((s) => s.userId === filterStudentId);
      const c = filterStudentCourseId ? courseOptions.find((c) => c.id === filterStudentCourseId) : null;
      return c
        ? `Reporte de progreso — ${s?.studentName ?? filterStudentId} · ${c.title}`
        : `Reporte de progreso — ${s?.studentName ?? filterStudentId}`;
    }
    if (mode === 'course') {
      const c = courseOptions.find((c) => c.id === filterCourseId);
      return `Reporte del curso — ${c?.title ?? filterCourseId}`;
    }
    return `Reporte maestro — Lux Learning — ${new Date().toLocaleDateString('es-ES')}`;
  };

  const buildEmailHtml = () => {
    if (!data) return '';
    const { summary } = data;
    return `
<h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;">Resumen ejecutivo</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
  <tr><td style="padding:8px;border:1px solid #eee;color:#555;">Tasa de aprobación</td><td style="padding:8px;border:1px solid #eee;font-weight:bold;color:#00B4D8;">${summary.overallApprovalRate}%</td></tr>
  <tr><td style="padding:8px;border:1px solid #eee;color:#555;">Reflexiones totales</td><td style="padding:8px;border:1px solid #eee;">${summary.totalReflections}</td></tr>
  <tr><td style="padding:8px;border:1px solid #eee;color:#555;">Pendientes de revisión</td><td style="padding:8px;border:1px solid #eee;">${summary.totalPending}</td></tr>
  <tr><td style="padding:8px;border:1px solid #eee;color:#555;">Estudiantes activos</td><td style="padding:8px;border:1px solid #eee;">${summary.activeStudents} de ${summary.totalEnrolled}</td></tr>
  <tr><td style="padding:8px;border:1px solid #eee;color:#555;">En riesgo de abandono</td><td style="padding:8px;border:1px solid #eee;color:${summary.atRiskStudents > 0 ? '#dc2626' : '#555'};">${summary.atRiskStudents}</td></tr>
  ${summary.avgQuality != null ? `<tr><td style="padding:8px;border:1px solid #eee;color:#555;">Calidad promedio</td><td style="padding:8px;border:1px solid #eee;">${summary.avgQuality}/10</td></tr>` : ''}
</table>
${data.analysis.length > 0 ? `
<h3 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:24px;">Temas clave por módulo</h3>
${data.analysis.slice(0, 5).map((a) => `
<p><strong>${a.moduleTitle}</strong>: ${a.reflectionSummary}</p>
<p style="color:#888;font-size:13px;">Temas: ${a.keyTopics.map((t) => t.topic).join(', ')}</p>
`).join('')}` : ''}
    `.trim();
  };

  const sendEmail = async () => {
    if (!emailTo || !data) return;
    setEmailSending(true);
    setEmailError('');
    try {
      await api.admin.sendReportEmail({ to: emailTo, subject: buildEmailSubject(), htmlBody: buildEmailHtml() });
      setEmailSent(true);
      setTimeout(() => setEmailSent(false), 4000);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('not verified') || msg.includes('sandbox')) {
        setEmailError('El destinatario no está verificado en SES (modo sandbox). Usa jason.rbm@gmail.com.');
      } else {
        setEmailError('Error al enviar el correo. Verifica la dirección e intenta de nuevo.');
      }
      setTimeout(() => setEmailError(''), 6000);
    }
    setEmailSending(false);
  };

  // ── Recommendations editing ───────────────────────────────────────────────
  const startEditRecs = (moduleId: string, items: any[]) => {
    setEditingRecs(moduleId);
    setEditedItems(JSON.parse(JSON.stringify(items)));
  };
  const saveRecs = async (moduleId: string) => {
    setSavingRecs(true);
    try {
      await api.admin.updateRecommendations(moduleId, editedItems);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          recommendations: prev.recommendations.map((r) =>
            r.moduleId === moduleId ? { ...r, items: editedItems } : r
          ),
        };
      });
      setEditingRecs(null);
    } catch {}
    setSavingRecs(false);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => <div key={n} className="card h-28" />)}
        </div>
        {[1, 2, 3].map((n) => <div key={n} className="card h-48" />)}
      </div>
    );
  }

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          /* Ocultar chrome de la app */
          nav, aside, header, .no-print { display: none !important; }

          /* Liberar el layout del AppShell para que todo el contenido sea imprimible */
          html, body {
            height: auto !important;
            overflow: visible !important;
            background: white !important;
          }
          /* AppShell outer wrapper (flex h-screen overflow-hidden) */
          body > div {
            display: block !important;
            height: auto !important;
            overflow: visible !important;
          }
          /* AppShell inner content column */
          body > div > div {
            display: block !important;
            height: auto !important;
            overflow: visible !important;
          }
          /* main scroll container */
          main {
            overflow: visible !important;
            height: auto !important;
            padding: 0 !important;
          }

          @page { margin: 1.5cm; }

          .card {
            box-shadow: none !important;
            border: 1px solid #ddd !important;
            page-break-inside: avoid;
            margin-bottom: 16px !important;
          }
          .print-area { display: block !important; }
        }
      `}</style>

      <div ref={printRef} className="max-w-6xl mx-auto space-y-8 animate-fade-in">

        {/* ── Header + Mode Tabs ─────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">Reportes</h1>
            <p className="text-gray-500 mt-1 text-sm">Análisis pedagógico de la plataforma</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-semibold text-gray-600 hover:bg-surface transition-colors">
              <FileText className="w-4 h-4" /> PDF
            </button>
          </div>
        </div>

        {/* Mode selector */}
        <div className="flex gap-2 no-print">
          {(['master', 'student', 'course'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setFilterStudentId(''); setFilterCourseId(''); setFilterStudentCourseId(''); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${mode === m ? 'bg-cta-from text-white' : 'bg-surface text-gray-600 hover:bg-gray-100'}`}
            >
              {m === 'master' ? '📊 Maestro' : m === 'student' ? '👤 Individual' : '📚 Por Curso'}
            </button>
          ))}
        </div>

        {/* Filters */}
        {mode === 'student' && (
          <div className="no-print flex flex-wrap gap-3 items-center">
            {/* Selector de estudiante */}
            <select
              value={filterStudentId}
              onChange={(e) => setFilterStudentId(e.target.value)}
              className="w-full sm:w-72 px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cta-from"
            >
              <option value="">Selecciona un estudiante…</option>
              {studentOptions.map((s) => (
                <option key={s.userId} value={s.userId}>{s.studentName}</option>
              ))}
            </select>

            {/* Sub-filtro de curso — solo aparece si hay estudiante seleccionado */}
            {filterStudentId && (
              <select
                value={filterStudentCourseId}
                onChange={(e) => setFilterStudentCourseId(e.target.value)}
                className="w-full sm:w-64 px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cta-from"
              >
                <option value="">Todos los cursos</option>
                {courseOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            )}
          </div>
        )}
        {mode === 'course' && (
          <div className="no-print">
            <select
              value={filterCourseId}
              onChange={(e) => setFilterCourseId(e.target.value)}
              className="w-full sm:w-80 px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cta-from"
            >
              <option value="">Selecciona un curso…</option>
              {courseOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
        )}

        {!canLoad && (
          <div className="card text-center py-12 text-gray-400">
            Selecciona {mode === 'student' ? 'un estudiante' : 'un curso'} para ver el reporte
          </div>
        )}

        {canLoad && !data && !loading && (
          <div className="card text-center py-12 text-gray-400">Sin datos disponibles</div>
        )}

        {data && canLoad && (
          <>
            {/* Banner: course/students with no activity yet */}
            {data.summary.totalReflections === 0 && data.summary.activeStudents === 0 && data.summary.totalEnrolled > 0 && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <p className="font-semibold">Sin actividad registrada aún</p>
                  <p className="text-amber-700 mt-0.5">
                    Hay {data.summary.totalEnrolled} estudiante{data.summary.totalEnrolled !== 1 ? 's' : ''} inscrito{data.summary.totalEnrolled !== 1 ? 's' : ''} pero ninguno ha iniciado el curso todavía. Los reportes se poblarán cuando comiencen a avanzar.
                  </p>
                </div>
              </div>
            )}
            {data.summary.totalEnrolled === 0 && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-600 text-sm">
                <BookOpen className="w-5 h-5 shrink-0 mt-0.5 text-gray-400" />
                <div>
                  <p className="font-semibold">Sin estudiantes inscritos</p>
                  <p className="text-gray-500 mt-0.5">Asigna estudiantes a este curso desde <strong>Asignar Cursos</strong> para ver estadísticas.</p>
                </div>
              </div>
            )}
            {/* ── 1. KPIs ─────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Tasa de aprobación', value: `${data.summary.overallApprovalRate}%`, sub: `${data.summary.totalApproved} de ${data.summary.totalReflections}`, icon: <CheckCircle className="w-5 h-5 text-emerald-500" />, bg: 'bg-emerald-50', color: 'text-emerald-600' },
                { label: 'Pendientes de revisión', value: data.summary.totalPending, sub: `${data.summary.totalRejected} rechazadas`, icon: <Clock className="w-5 h-5 text-amber-500" />, bg: 'bg-amber-50', color: 'text-amber-600' },
                { label: 'Estudiantes activos', value: data.summary.activeStudents, sub: `de ${data.summary.totalEnrolled} inscritos`, icon: <Users className="w-5 h-5 text-cta-from" />, bg: 'bg-blue-50', color: 'text-cta-from' },
                { label: 'En riesgo de abandono', value: data.summary.atRiskStudents, sub: data.summary.neverStarted > 0 ? `${data.summary.neverStarted} aún no han iniciado` : 'inactivos >7 días habiendo iniciado', icon: <AlertTriangle className="w-5 h-5 text-red-500" />, bg: data.summary.atRiskStudents > 0 ? 'bg-red-50' : 'bg-gray-50', color: data.summary.atRiskStudents > 0 ? 'text-red-600' : 'text-gray-400' },
              ].map((card) => (
                <div key={card.label} className="card">
                  <div className={`w-10 h-10 ${card.bg} rounded-xl flex items-center justify-center mb-3`}>{card.icon}</div>
                  <p className={`font-heading font-bold text-2xl ${card.color}`}>{card.value}</p>
                  <p className="text-xs font-semibold text-charcoal mt-0.5">{card.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* ── 2. Progreso integral por estudiante ─────────────────────────── */}
            {data.studentProgress.length > 0 && (
              <div className="card">
                <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
                  <TrendingUp className="w-5 h-5 text-cta-from" /> Progreso Integral por Estudiante
                  <span className="text-xs font-normal text-gray-400 ml-1">(60% reflexiones + 40% quiz)</span>
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-gray-500">
                        <th className="text-left py-2 pr-4 font-semibold">Estudiante</th>
                        <th className="text-right py-2 pr-4 font-semibold">Reflexiones</th>
                        <th className="text-right py-2 pr-4 font-semibold">Quiz prom.</th>
                        <th className="text-right py-2 pr-4 font-semibold">Score integral</th>
                        <th className="text-right py-2 font-semibold hidden sm:table-cell">Última actividad</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.studentProgress.map((s) => (
                        <tr key={s.userId} className="hover:bg-surface transition-colors">
                          <td className="py-3 pr-4 font-medium text-charcoal">{s.studentName}</td>
                          <td className="py-3 pr-4 text-right text-gray-600">
                            {s.reflectionsApproved}/{s.reflectionsTotal}
                          </td>
                          <td className="py-3 pr-4 text-right text-gray-600">{s.avgQuizScore > 0 ? `${s.avgQuizScore}%` : '—'}</td>
                          <td className={`py-3 pr-4 text-right font-bold text-lg ${scoreColor(s.integratedScore)}`}>{s.integratedScore > 0 ? `${s.integratedScore}%` : '—'}</td>
                          <td className="py-3 text-right text-gray-400 text-xs hidden sm:table-cell">
                            {s.lastActivity ? new Date(s.lastActivity).toLocaleDateString('es-ES') : 'Sin actividad'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── 3. Estado de reflexiones ─────────────────────────────────────── */}
            <div className="card">
              <h2 className="font-heading font-bold text-base text-charcoal mb-4">Estado de reflexiones</h2>
              <div className="space-y-3">
                {[
                  { label: 'Aprobadas', count: data.summary.totalApproved, color: 'bg-emerald-400' },
                  { label: 'Rechazadas', count: data.summary.totalRejected, color: 'bg-red-400' },
                  { label: 'Pendientes', count: data.summary.totalPending, color: 'bg-amber-400' },
                ].map(({ label, count, color }) => {
                  const pct = data.summary.totalReflections > 0 ? Math.round((count / data.summary.totalReflections) * 100) : 0;
                  return (
                    <div key={label} className="flex items-center gap-4">
                      <span className="text-sm text-gray-600 w-24 shrink-0">{label}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div className={`${color} h-3 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-semibold text-charcoal w-20 text-right">{count} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
              {data.summary.avgQuality != null && (
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <span className="text-sm text-gray-600">Calidad promedio:</span>
                  <span className="font-semibold text-charcoal">{data.summary.avgQuality}/10</span>
                </div>
              )}
            </div>

            {/* ── 4. Análisis cualitativo (temas clave IA) ────────────────────── */}
            {data.analysis.length > 0 && (
              <div className="card">
                <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
                  <BarChart2 className="w-5 h-5 text-purple-500" /> Análisis Cualitativo por Módulo
                  <span className="text-xs font-normal text-gray-400 ml-1">Generado automáticamente por IA · actualización nocturna</span>
                </h2>
                <div className="space-y-6">
                  {data.analysis.map((a) => (
                    <div key={a.moduleId} className="border border-border rounded-xl p-4">
                      <p className="font-semibold text-charcoal mb-1">{a.moduleTitle}</p>
                      {a.reflectionSummary && (
                        <p className="text-sm text-gray-600 mb-3 italic">"{a.reflectionSummary}"</p>
                      )}
                      {a.keyTopics.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {a.keyTopics.map((t, i) => (
                            <span key={i} className={`px-2.5 py-1 rounded-full text-xs font-medium ${sentimentColor(t.sentiment)}`}>
                              {t.topic} <span className="opacity-60">×{t.count}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {a.analyzedAt && (
                        <p className="text-xs text-gray-400 mt-2">Analizado: {new Date(a.analyzedAt).toLocaleDateString('es-ES')}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 5. Mapa de calor — errores de quiz ──────────────────────────── */}
            {data.heatMap.filter((h) => h && h.questions.some((q) => q.totalAttempts > 0)).length > 0 && (
              <div className="card">
                <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
                  <Flame className="w-5 h-5 text-orange-500" /> Mapa de Calor — Errores en Quiz
                  <span className="text-xs font-normal text-gray-400 ml-1">% de respuestas incorrectas por pregunta</span>
                </h2>
                <div className="space-y-5">
                  {data.heatMap.filter((h) => h && h.questions.some((q) => q.totalAttempts > 0)).map((mod) => (
                    <div key={mod.moduleId}>
                      <p className="font-medium text-sm text-charcoal mb-2">{mod.moduleTitle} <span className="text-gray-400 font-normal">· {mod.courseTitle}</span></p>
                      <div className="grid gap-2">
                        {mod.questions.filter((q) => q.totalAttempts > 0).map((q) => (
                          <div key={q.index} className="flex items-center gap-3">
                            <span className="text-xs text-gray-500 w-6 shrink-0 text-right">{q.index + 1}.</span>
                            <div className="flex-1 text-xs text-gray-600 truncate" title={q.text}>{q.text}</div>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg shrink-0 ${heatColor(q.errorRate)}`}>
                              {q.errorRate}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border text-xs text-gray-500">
                  <span>Escala:</span>
                  {[['<30%', 'bg-emerald-100'], ['30-49%', 'bg-amber-300'], ['50-69%', 'bg-orange-400'], ['≥70%', 'bg-red-500']].map(([label, cls]) => (
                    <span key={label} className="flex items-center gap-1">
                      <span className={`w-3 h-3 rounded ${cls}`} /> {label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── 6. Recomendaciones curriculares ─────────────────────────────── */}
            {data.recommendations.length > 0 && (
              <div className="card">
                <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
                  <BookOpen className="w-5 h-5 text-cta-from" /> Recomendaciones Curriculares
                  <span className="text-xs font-normal text-gray-400 ml-1">Generadas por IA · editables por el evaluador</span>
                </h2>
                <div className="space-y-6">
                  {data.recommendations.map((rec) => (
                    <div key={rec.moduleId} className="border border-border rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-semibold text-charcoal">{rec.moduleTitle}</p>
                        {editingRecs !== rec.moduleId ? (
                          <button
                            onClick={() => startEditRecs(rec.moduleId, rec.items)}
                            className="no-print flex items-center gap-1 text-xs text-gray-500 hover:text-cta-from transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" /> Editar
                          </button>
                        ) : (
                          <div className="no-print flex items-center gap-2">
                            <button
                              onClick={() => saveRecs(rec.moduleId)}
                              disabled={savingRecs}
                              className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700"
                            >
                              {savingRecs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar
                            </button>
                            <button onClick={() => setEditingRecs(null)} className="text-xs text-gray-400 hover:text-gray-600">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {editingRecs === rec.moduleId ? (
                        <div className="space-y-3">
                          {editedItems.map((item, i) => (
                            <div key={item.id} className="bg-surface rounded-lg p-3 space-y-2">
                              <div className="flex gap-2">
                                <input value={item.title} onChange={(e) => { const n = [...editedItems]; n[i] = { ...n[i], title: e.target.value }; setEditedItems(n); }}
                                  className="flex-1 text-sm px-3 py-1.5 border border-border rounded-lg" placeholder="Título" />
                                <select value={item.type} onChange={(e) => { const n = [...editedItems]; n[i] = { ...n[i], type: e.target.value }; setEditedItems(n); }}
                                  className="text-sm px-2 py-1.5 border border-border rounded-lg">
                                  {['article', 'book', 'video', 'link'].map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                              <input value={item.url} onChange={(e) => { const n = [...editedItems]; n[i] = { ...n[i], url: e.target.value }; setEditedItems(n); }}
                                className="w-full text-sm px-3 py-1.5 border border-border rounded-lg" placeholder="URL" />
                              <input value={item.description} onChange={(e) => { const n = [...editedItems]; n[i] = { ...n[i], description: e.target.value }; setEditedItems(n); }}
                                className="w-full text-sm px-3 py-1.5 border border-border rounded-lg" placeholder="Descripción" />
                              <button onClick={() => setEditedItems(editedItems.filter((_, j) => j !== i))}
                                className="text-xs text-red-400 hover:text-red-600">Eliminar</button>
                            </div>
                          ))}
                          <button
                            onClick={() => setEditedItems([...editedItems, { id: Date.now().toString(), weakTopic: '', title: '', type: 'link', url: '', description: '', aiGenerated: false }])}
                            className="text-xs text-cta-from hover:underline"
                          >+ Añadir recurso</button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {rec.items.map((item) => (
                            <div key={item.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                              <span className="text-lg shrink-0">{typeIcon(item.type)}</span>
                              <div className="min-w-0">
                                <a href={item.url} target="_blank" rel="noreferrer"
                                  className="text-sm font-medium text-cta-from hover:underline">{item.title}</a>
                                <p className="text-xs text-gray-500 mt-0.5">{item.weakTopic}</p>
                                {item.description && <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>}
                              </div>
                              {item.aiGenerated && <span className="shrink-0 text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">IA</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Por módulo (estadísticas) ────────────────────────────────────── */}
            {data.moduleStats.length > 0 && (
              <div className="card">
                <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
                  <BarChart2 className="w-5 h-5 text-cta-from" /> Estadísticas por Módulo
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-gray-500">
                        <th className="text-left py-2 pr-4 font-semibold">Módulo</th>
                        <th className="text-left py-2 pr-4 font-semibold hidden sm:table-cell">Curso</th>
                        <th className="text-right py-2 pr-4 font-semibold">Total</th>
                        <th className="text-right py-2 pr-4 font-semibold">Tasa</th>
                        <th className="text-right py-2 font-semibold">Prom. revisión</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.moduleStats.map((m) => {
                        const rate = m.approvalRate;
                        const rc = rate == null ? 'text-gray-400' : rate >= 70 ? 'text-emerald-600' : rate >= 40 ? 'text-amber-600' : 'text-red-600';
                        return (
                          <tr key={m.moduleId} className="hover:bg-surface transition-colors">
                            <td className="py-3 pr-4 font-medium text-charcoal">{m.title}</td>
                            <td className="py-3 pr-4 text-gray-500 hidden sm:table-cell">{m.courseTitle}</td>
                            <td className="py-3 pr-4 text-right">{m.total}</td>
                            <td className={`py-3 pr-4 text-right font-bold ${rc}`}>{rate != null ? `${rate}%` : '—'}</td>
                            <td className="py-3 text-right text-gray-600">{m.avgHoursToReview != null ? `${m.avgHoursToReview}h` : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Export bar ───────────────────────────────────────────────────── */}
            <div className="card no-print">
              <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
                <Send className="w-5 h-5 text-cta-from" /> Exportar reporte
              </h2>
              <div className="flex flex-col gap-2">
                <div className="flex flex-col sm:flex-row gap-4">
                {/* Email */}
                <div className="flex-1 flex gap-2">
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cta-from"
                  />
                  <button
                    onClick={sendEmail}
                    disabled={!emailTo || emailSending}
                    className="flex items-center gap-2 px-4 py-2.5 bg-cta-gradient text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity"
                  >
                    {emailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    {emailSent ? '¡Enviado!' : 'Enviar por email'}
                  </button>
                </div>
                {/* PDF */}
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-gray-600 hover:bg-surface transition-colors"
                >
                  <FileText className="w-4 h-4" /> Descargar PDF
                </button>
              </div>
              {emailError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{emailError}</p>
              )}
              {emailSent && (
                <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ Correo enviado correctamente</p>
              )}
              </div>
            </div>

          </>
        )}
      </div>
    </>
  );
}
