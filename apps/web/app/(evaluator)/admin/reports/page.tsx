'use client';

import { useEffect, useState, useRef } from 'react';
import {
  CheckCircle, Clock, Users, AlertTriangle, BookOpen, FileText, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import { StudentProgressTable } from './_components/StudentProgressTable';
import { ReflectionStatusCard } from './_components/ReflectionStatusCard';
import { QualitativeAnalysisCard } from './_components/QualitativeAnalysisCard';
import { HeatMapCard } from './_components/HeatMapCard';
import { RecommendationsCard } from './_components/RecommendationsCard';
import { ModuleStatsTable } from './_components/ModuleStatsTable';
import { ExportBar } from './_components/ExportBar';

type Mode = 'master' | 'student' | 'course';

type Summary = {
  totalReflections: number; totalApproved: number; totalRejected: number;
  totalPending: number; overallApprovalRate: number; totalEnrolled: number;
  activeStudents: number; atRiskStudents: number; neverStarted: number; avgQuality: number | null;
};

type ReportData = {
  summary: Summary;
  moduleStats: any[];
  heatMap: any[];
  studentProgress: any[];
  analysis: any[];
  recommendations: any[];
};

export default function ReportsPage() {
  const { t, lang } = useLanguage();
  const [mode, setMode] = useState<Mode>('master');
  const [filterStudentId, setFilterStudentId] = useState('');
  const [filterCourseId, setFilterCourseId] = useState('');
  const [filterStudentCourseId, setFilterStudentCourseId] = useState('');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const [studentOptions, setStudentOptions] = useState<{ userId: string; studentName: string }[]>([]);
  const [courseOptions, setCourseOptions] = useState<{ id: string; title: string }[]>([]);

  const [emailTo, setEmailTo] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState('');

  const [editingRecs, setEditingRecs] = useState<string | null>(null);
  const [editedItems, setEditedItems] = useState<any[]>([]);
  const [savingRecs, setSavingRecs] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api.admin.users.list(), api.admin.courses.list()]).then(([usersRes, coursesRes]: any[]) => {
      const users = Array.isArray(usersRes) ? usersRes : (usersRes?.data ?? []);
      const allCourses = Array.isArray(coursesRes) ? coursesRes : (coursesRes?.data ?? []);
      setStudentOptions(users.filter((u: any) => u.role === 'STUDENT').map((u: any) => ({ userId: u.username, studentName: u.name || u.email })));
      setCourseOptions(allCourses.map((c: any) => ({ id: c.id, title: c.title })));
    }).catch(() => {});
  }, []);

  useEffect(() => { setFilterStudentCourseId(''); }, [filterStudentId]);

  useEffect(() => {
    if ((mode === 'student' && !filterStudentId) || (mode === 'course' && !filterCourseId)) {
      setLoading(false); setData(null); return;
    }
    setLoading(true); setData(null);
    const params: any = { mode };
    if (mode === 'student' && filterStudentId) {
      params.studentId = filterStudentId;
      if (filterStudentCourseId) params.courseId = filterStudentCourseId;
    }
    if (mode === 'course' && filterCourseId) params.courseId = filterCourseId;
    api.admin.reportsV2(params).then((res: any) => { setData(res?.data ?? res); setLoading(false); }).catch(() => setLoading(false));
  }, [mode, filterStudentId, filterCourseId, filterStudentCourseId]);

  const canLoad = mode === 'master' || (mode === 'student' && filterStudentId) || (mode === 'course' && filterCourseId);

  const handlePrint = () => window.print();

  const buildEmailSubject = () => {
    if (mode === 'student') {
      const s = studentOptions.find((s) => s.userId === filterStudentId);
      const c = filterStudentCourseId ? courseOptions.find((c) => c.id === filterStudentCourseId) : null;
      const name = c ? `${s?.studentName ?? filterStudentId} · ${c.title}` : (s?.studentName ?? filterStudentId);
      return t.admin.reportsEmailSubjectProgress(name);
    }
    if (mode === 'course') {
      const c = courseOptions.find((c) => c.id === filterCourseId);
      return t.admin.reportsEmailSubjectCourse(c?.title ?? filterCourseId);
    }
    return t.admin.reportsEmailSubjectMaster(new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES'));
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
${data.analysis.slice(0, 5).map((a: any) => `
<p><strong>${a.moduleTitle}</strong>: ${a.reflectionSummary}</p>
<p style="color:#888;font-size:13px;">Temas: ${a.keyTopics.map((t: any) => t.topic).join(', ')}</p>
`).join('')}` : ''}
    `.trim();
  };

  const sendEmail = async () => {
    if (!emailTo || !data) return;
    setEmailSending(true); setEmailError('');
    try {
      await api.admin.sendReportEmail({ to: emailTo, subject: buildEmailSubject(), htmlBody: buildEmailHtml() });
      setEmailSent(true);
      setTimeout(() => setEmailSent(false), 4000);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('not verified') || msg.includes('sandbox')) {
        setEmailError(t.admin.reportsEmailSandboxError);
      } else {
        setEmailError(t.admin.reportsEmailError);
      }
      setTimeout(() => setEmailError(''), 6000);
    }
    setEmailSending(false);
  };

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
        return { ...prev, recommendations: prev.recommendations.map((r: any) => r.moduleId === moduleId ? { ...r, items: editedItems } : r) };
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
      <style>{`
        @media print {
          nav, aside, header, .no-print { display: none !important; }
          html, body { height: auto !important; overflow: visible !important; background: white !important; }
          body > div { display: block !important; height: auto !important; overflow: visible !important; }
          body > div > div { display: block !important; height: auto !important; overflow: visible !important; }
          main { overflow: visible !important; height: auto !important; padding: 0 !important; }
          @page { margin: 1.5cm; }
          .card { box-shadow: none !important; border: 1px solid #ddd !important; page-break-inside: avoid; margin-bottom: 16px !important; }
          .print-area { display: block !important; }
        }
      `}</style>

      <div ref={printRef} className="max-w-6xl mx-auto space-y-8 animate-fade-in">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">{t.admin.reportsPageTitle}</h1>
            <p className="text-gray-500 mt-1 text-sm">{t.admin.reportsPageSubtitle}</p>
          </div>
          <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-semibold text-gray-600 hover:bg-surface transition-colors">
            <FileText className="w-4 h-4" /> PDF
          </button>
        </div>

        {/* Mode selector */}
        <div className="flex gap-2 no-print">
          {(['master', 'student', 'course'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setFilterStudentId(''); setFilterCourseId(''); setFilterStudentCourseId(''); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${mode === m ? 'bg-cta-from text-white' : 'bg-surface text-gray-600 hover:bg-gray-100'}`}
            >
              {m === 'master' ? t.admin.reportsModemaster : m === 'student' ? t.admin.reportsModeStudent : t.admin.reportsModeCourse}
            </button>
          ))}
        </div>

        {/* Filters */}
        {mode === 'student' && (
          <div className="no-print flex flex-wrap gap-3 items-center">
            <select value={filterStudentId} onChange={(e) => setFilterStudentId(e.target.value)}
              className="w-full sm:w-72 px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cta-from">
              <option value="">{t.admin.reportsSelectStudent}</option>
              {studentOptions.map((s) => <option key={s.userId} value={s.userId}>{s.studentName}</option>)}
            </select>
            {filterStudentId && (
              <select value={filterStudentCourseId} onChange={(e) => setFilterStudentCourseId(e.target.value)}
                className="w-full sm:w-64 px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cta-from">
                <option value="">{t.admin.reportsAllCourses}</option>
                {courseOptions.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
          </div>
        )}
        {mode === 'course' && (
          <div className="no-print">
            <select value={filterCourseId} onChange={(e) => setFilterCourseId(e.target.value)}
              className="w-full sm:w-80 px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cta-from">
              <option value="">{t.admin.reportsSelectCourse}</option>
              {courseOptions.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        )}

        {!canLoad && (
          <div className="card text-center py-12 text-gray-400">{t.admin.reportsSelectFirst(mode)}</div>
        )}
        {canLoad && !data && !loading && (
          <div className="card text-center py-12 text-gray-400">{t.admin.reportsNoData}</div>
        )}

        {data && canLoad && (
          <>
            {/* Activity banners */}
            {data.summary.totalReflections === 0 && data.summary.activeStudents === 0 && data.summary.totalEnrolled > 0 && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <p className="font-semibold">{t.admin.reportsNoActivity}</p>
                  <p className="text-amber-700 mt-0.5">{t.admin.reportsNoActivityMsg(data.summary.totalEnrolled)}</p>
                </div>
              </div>
            )}
            {data.summary.totalEnrolled === 0 && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-600 text-sm">
                <BookOpen className="w-5 h-5 shrink-0 mt-0.5 text-gray-400" />
                <div>
                  <p className="font-semibold">{t.admin.reportsNoEnrolled}</p>
                  <p className="text-gray-500 mt-0.5">{t.admin.reportsNoEnrolledMsg}</p>
                </div>
              </div>
            )}

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: t.admin.reportsApprovalRate,   value: `${data.summary.overallApprovalRate}%`, sub: t.admin.reportsOf(data.summary.totalApproved, data.summary.totalReflections),   icon: <CheckCircle className="w-5 h-5 text-emerald-500" />, bg: 'bg-emerald-50', color: 'text-emerald-600' },
                { label: t.admin.reportsPendingReview,  value: data.summary.totalPending,              sub: t.admin.reportsRejected(data.summary.totalRejected),                             icon: <Clock className="w-5 h-5 text-amber-500" />,         bg: 'bg-amber-50',   color: 'text-amber-600' },
                { label: t.admin.reportsActiveStudents, value: data.summary.activeStudents,            sub: t.admin.reportsEnrolled(data.summary.totalEnrolled),                             icon: <Users className="w-5 h-5 text-cta-from" />,          bg: 'bg-blue-50',    color: 'text-cta-from' },
                { label: t.admin.reportsAtRisk,         value: data.summary.atRiskStudents,            sub: data.summary.neverStarted > 0 ? t.admin.reportsNeverStarted(data.summary.neverStarted) : t.admin.reportsInactiveDays, icon: <AlertTriangle className="w-5 h-5 text-red-500" />, bg: data.summary.atRiskStudents > 0 ? 'bg-red-50' : 'bg-gray-50', color: data.summary.atRiskStudents > 0 ? 'text-red-600' : 'text-gray-400' },
              ].map((card) => (
                <div key={card.label} className="card">
                  <div className={`w-10 h-10 ${card.bg} rounded-xl flex items-center justify-center mb-3`}>{card.icon}</div>
                  <p className={`font-heading font-bold text-2xl ${card.color}`}>{card.value}</p>
                  <p className="text-xs font-semibold text-charcoal mt-0.5">{card.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
                </div>
              ))}
            </div>

            <StudentProgressTable
              studentProgress={data.studentProgress}
              lang={lang}
              labels={{
                title: t.admin.reportsIntegratedTitle,
                hint: t.admin.reportsIntegratedHint,
                colStudent: t.admin.reportsColStudent,
                colReflections: t.admin.reportsColReflections,
                colQuiz: t.admin.reportsColQuiz,
                colScore: t.admin.reportsColScore,
                colActivity: t.admin.reportsColActivity,
                noActivityRow: t.admin.reportsNoActivityRow,
              }}
            />

            <ReflectionStatusCard
              summary={data.summary}
              labels={{
                title: t.admin.reportsReflectionStatus,
                approved: t.admin.reportsApproved,
                rejected: t.admin.reportsRejectedLabel,
                pending: t.admin.reportsPending,
                avgQuality: t.admin.reportsAvgQuality,
              }}
            />

            <QualitativeAnalysisCard
              analysis={data.analysis}
              lang={lang}
              labels={{
                title: t.admin.reportsQualitativeTitle,
                hint: t.admin.reportsQualitativeHint,
                analyzedAt: t.admin.reportsAnalyzedAt,
              }}
            />

            <HeatMapCard
              heatMap={data.heatMap}
              labels={{
                title: t.admin.reportsHeatMapTitle,
                hint: t.admin.reportsHeatMapHint,
                scale: t.admin.reportsHeatMapScale,
              }}
            />

            <RecommendationsCard
              recommendations={data.recommendations}
              editingRecs={editingRecs}
              editedItems={editedItems}
              savingRecs={savingRecs}
              onStartEdit={startEditRecs}
              onSave={saveRecs}
              onCancelEdit={() => setEditingRecs(null)}
              onSetEditedItems={setEditedItems}
              labels={{
                title: t.admin.reportsRecsTitle,
                hint: t.admin.reportsRecsHint,
                editBtn: t.admin.reportsEditBtn,
                saveBtn: t.admin.reportsSaveBtn,
                titlePlaceholder: t.admin.reportsTitlePlaceholder,
                urlPlaceholder: t.admin.reportsUrlPlaceholder,
                descPlaceholder: t.admin.reportsDescPlaceholder,
                deleteItem: t.admin.reportsDeleteItem,
                addResource: t.admin.reportsAddResource,
              }}
            />

            <ModuleStatsTable
              moduleStats={data.moduleStats}
              labels={{
                title: t.admin.reportsModuleStatsTitle,
                colModule: t.admin.reportsColModule,
                colCourse: t.admin.reportsColCourse,
                colTotal: t.admin.reportsColTotal,
                colRate: t.admin.reportsColRate,
                colAvgReview: t.admin.reportsColAvgReview,
              }}
            />

            <ExportBar
              emailTo={emailTo}
              setEmailTo={setEmailTo}
              emailSending={emailSending}
              emailSent={emailSent}
              emailError={emailError}
              onSendEmail={sendEmail}
              onPrint={handlePrint}
              labels={{
                title: t.admin.reportsExportTitle,
                emailPlaceholder: t.admin.reportsEmailPlaceholder,
                sendEmailBtn: t.admin.reportsSendEmailBtn,
                sent: t.admin.reportsSent,
                downloadPdf: t.admin.reportsDownloadPdf,
                emailSentMsg: t.admin.reportsEmailSentMsg,
              }}
            />
          </>
        )}
      </div>
    </>
  );
}
