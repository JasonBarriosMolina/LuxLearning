'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, Search, Clock, AlertTriangle, ArrowUpDown, Flag, X } from 'lucide-react';
import { api } from '@/lib/api';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { formatDate } from '@/lib/utils';
import type { Reflection, ReflectionStatus } from '@lux/types';
import { useLanguage } from '@/lib/i18n';

type EnrichedReflection = Reflection & { moduleTitle?: string; courseId?: string | null; courseTitle?: string; studentName?: string };

type StatusFilter = { labelKey: 'filterAll' | 'filterPending' | 'filterApproved' | 'filterRejected'; value: ReflectionStatus | 'ALL' };

const STATUS_FILTERS: StatusFilter[] = [
  { labelKey: 'filterAll', value: 'ALL' },
  { labelKey: 'filterPending', value: 'PENDING_EVAL' },
  { labelKey: 'filterApproved', value: 'APPROVED' },
  { labelKey: 'filterRejected', value: 'REJECTED' },
];

const DEADLINE_HOURS = 48;

function getTimeRemaining(submittedAt: string, deadlineIso: string | undefined, tEval: { overdueAgo: (h: number) => string; timeLeft: (h: number, m: number) => string; hoursLeft2: (h: number) => string }): { label: string; urgent: boolean; overdue: boolean } {
  const deadline = deadlineIso
    ? new Date(deadlineIso).getTime()
    : new Date(submittedAt).getTime() + DEADLINE_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  const diffMs = deadline - now;

  if (diffMs <= 0) {
    const overdueH = Math.abs(Math.floor(diffMs / (1000 * 60 * 60)));
    return { label: tEval.overdueAgo(overdueH), urgent: true, overdue: true };
  }

  const h = Math.floor(diffMs / (1000 * 60 * 60));
  const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (h < 12) return { label: tEval.timeLeft(h, m), urgent: true, overdue: false };
  return { label: tEval.hoursLeft2(h), urgent: false, overdue: false };
}

function EvaluatorReflectionsInner() {
  const { t, lang } = useLanguage();
  const searchParams = useSearchParams();
  const courseIdFilter = searchParams.get('courseId');
  const [reflections, setReflections] = useState<EnrichedReflection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReflectionStatus | 'ALL'>(() => {
    const fromQuery = searchParams.get('status');
    const valid: (ReflectionStatus | 'ALL')[] = ['ALL', 'PENDING_EVAL', 'APPROVED', 'REJECTED'];
    return (valid.includes(fromQuery as any) ? fromQuery : 'PENDING_EVAL') as ReflectionStatus | 'ALL';
  });
  const [sortByUrgent, setSortByUrgent] = useState(true);

  useEffect(() => {
    api.evaluator.reflections().then((res) => {
      setReflections((res as any).data ?? []);
      setLoading(false);
    });
  }, []);

  const filtered = reflections
    .filter((r) => {
      const matchesStatus = statusFilter === 'ALL' || r.status === statusFilter;
      const matchesCourse = !courseIdFilter || r.courseId === courseIdFilter;
      const matchesSearch =
        search === '' ||
        (r.studentName ?? r.userId).toLowerCase().includes(search.toLowerCase()) ||
        r.moduleTitle?.toLowerCase().includes(search.toLowerCase()) ||
        r.courseTitle?.toLowerCase().includes(search.toLowerCase());
      return matchesStatus && matchesCourse && matchesSearch;
    })
    .sort((a, b) => {
      if (!sortByUrgent) return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
      // Pending first, then by oldest submitted
      if (a.status === 'PENDING_EVAL' && b.status !== 'PENDING_EVAL') return -1;
      if (b.status === 'PENDING_EVAL' && a.status !== 'PENDING_EVAL') return 1;
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    });

  const activeCourseTitle = courseIdFilter
    ? reflections.find((r) => r.courseId === courseIdFilter)?.courseTitle
    : null;

  const pendingCount = reflections.filter((r) => r.status === 'PENDING_EVAL').length;
  const urgentCount = reflections.filter((r) => {
    if (r.status !== 'PENDING_EVAL') return false;
    const info = getTimeRemaining(r.submittedAt, (r as any).deadline, t.evaluator);
    return info.urgent;
  }).length;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">{t.nav.evaluations}</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {t.evaluator.pendingCount(pendingCount)}
            {urgentCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-red-600 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" /> {t.evaluator.urgentCount(urgentCount)}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Course filter badge */}
      {courseIdFilter && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold">
            <ClipboardList className="w-3.5 h-3.5" />
            {activeCourseTitle ?? 'Curso seleccionado'}
            <a href="/evaluator/reflections" className="ml-1 hover:text-purple-900">
              <X className="w-3.5 h-3.5" />
            </a>
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder={t.evaluator.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                statusFilter === f.value
                  ? 'bg-cta-gradient text-white'
                  : 'bg-white border border-border text-gray-600 hover:border-cta-from'
              }`}
            >
              {t.evaluator[f.labelKey]}
              {f.value === 'PENDING_EVAL' && pendingCount > 0 && (
                <span className="ml-1.5 bg-white/30 text-xs px-1.5 py-0.5 rounded-full">
                  {statusFilter === 'PENDING_EVAL' ? '' : pendingCount}
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => setSortByUrgent(!sortByUrgent)}
            className={`px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-1.5 ${
              sortByUrgent
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-white border border-border text-gray-600 hover:border-cta-from'
            }`}
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            {sortByUrgent ? t.evaluator.sortByUrgency : t.evaluator.sortByDate}
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((n) => <div key={n} className="card h-14 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <ClipboardList className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">{t.evaluator.noReflectionsFound}</p>
          <p className="text-gray-500 text-sm mt-1">{t.evaluator.adjustFilters}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-border shadow-card overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-4 px-5 py-3 bg-surface border-b border-border text-xs font-semibold text-gray-400 uppercase tracking-wide">
            <span>{t.evaluator.colStudent}</span>
            <span>{t.evaluator.colModuleCourse}</span>
            <span>{t.evaluator.colSent}</span>
            <span>{t.evaluator.colTimeRemaining}</span>
            <span>{t.evaluator.colStatus}</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-border">
            {filtered.map((r) => {
              const timeInfo = r.status === 'PENDING_EVAL' ? getTimeRemaining(r.submittedAt, (r as any).deadline, t.evaluator) : null;
              const studentDisplay = r.studentName ?? r.userId;

              return (
                <Link
                  key={`${r.userId}-${r.moduleId}`}
                  href={`/evaluator/reflections/${encodeURIComponent(r.userId)}?moduleId=${r.moduleId}`}
                  className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-4 px-5 py-4 hover:bg-surface transition-colors items-center"
                >
                  {/* Student */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-cta-gradient flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {studentDisplay[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-charcoal truncate">{studentDisplay}</span>
                        {(r as any).priority && (
                          <span title={t.evaluator.highPriority}>
                            <Flag className="w-3.5 h-3.5 text-red-500 fill-red-500 shrink-0" />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Module / Course */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-charcoal truncate">{r.moduleTitle ?? t.evaluator.moduleLabel}</p>
                    {r.courseTitle && (
                      <p className="text-xs text-gray-400 truncate">{r.courseTitle}</p>
                    )}
                  </div>

                  {/* Submitted */}
                  <div className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-gray-300" />
                    {formatDate(r.submittedAt)}
                  </div>

                  {/* Time remaining */}
                  <div>
                    {timeInfo ? (
                      <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${
                        timeInfo.overdue
                          ? 'bg-red-100 text-red-700'
                          : timeInfo.urgent
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {timeInfo.label}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <ReflectionStatusBadge status={r.status} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EvaluatorReflectionsPage() {
  return (
    <Suspense>
      <EvaluatorReflectionsInner />
    </Suspense>
  );
}
