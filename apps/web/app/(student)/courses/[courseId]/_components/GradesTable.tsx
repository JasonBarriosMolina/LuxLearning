'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Star, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useLanguage } from '@/lib/i18n';
import { getModulePrereq, type BlockingStep } from '../modulePrereq';

// Trello DmPpbrff, 2026-09-07 (Mack): "el estudiante debe poder ver todo
// categorizado... trabajo cotidiano todo junto, las tareas todas juntas..." —
// EvaluationEvent has no separate "category" field; "Trabajo Cotidiano" and
// "Tareas" are both type EVIDENCE, distinguished only by `name` (see
// ai-wizard.ts's defaultEvalItems / EvalItem.name). When an item has more than
// one delivery instance, each row is saved as "<name> <n>" (e.g. "Tareas 1",
// "Tareas 2") — strip that numeric suffix to recover the shared category name.
function categoryName(name: string): string {
  return name.replace(/\s+\d+$/, '').trim();
}

interface EvalCategory { name: string; items: any[]; totalWeight: number }

function groupByCategory(events: any[]): EvalCategory[] {
  const order: string[] = [];
  const map = new Map<string, any[]>();
  for (const ev of events) {
    const key = categoryName(ev.name ?? '');
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key)!.push(ev);
  }
  return order.map((name) => {
    const items = map.get(name)!;
    return { name, items, totalWeight: items.reduce((sum, ev) => sum + (Number(ev.weight) || 0), 0) };
  });
}

// Trello DmPpbrff, 2026-09-04 (Mack): "en sistema de evaluación, debe poder verse el
// número de semana correspondiente a la fecha del entregable" — same week math the
// admin-side WeekAwareDatePicker already uses (course.startDate + 7-day buckets),
// inlined here rather than imported across the admin/student route-group boundary for
// one small pure function.
function weekNumberForDate(dateStr: string | null | undefined, courseStartDate: string | null | undefined): number | null {
  if (!dateStr || !courseStartDate) return null;
  const date = new Date(dateStr);
  const start = new Date(courseStartDate);
  if (isNaN(date.getTime()) || isNaN(start.getTime())) return null;
  const diffDays = Math.floor((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return null;
  return Math.floor(diffDays / 7) + 1;
}

// Extracted out of page.tsx (2026-09-03) — was pushing the parent page past the
// 500-line file-size limit, and this table + its non-summative split is a
// self-contained unit with no state the parent needs.
export function GradesTable({ course, courseId }: { course: any; courseId: string }) {
  const { t, lang } = useLanguage();
  // Trello DmPpbrff, 2026-09-03 (Mack): "los quizzes... que tienen 0% o cualquier
  // evaluación en 0% no deberían aparecer... más bien como no sumativa, hacer una
  // sección especial, dropdown aparte." A weight of 0 (or missing) means it never
  // counts toward the final grade — split those into a separate, collapsed-by-
  // default section instead of mixing them into the main graded table.
  const [showNonSummative, setShowNonSummative] = useState(false);
  // Categories default expanded — most courses have 3-4 (cotidiano/tareas/pruebas/
  // asistencia), collapsing by default would hide grades behind an extra click for
  // the common case. Collapsed state is opt-in per category.
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const toggleCategory = (name: string) => setCollapsedCategories((prev) => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  if ((course.evaluationEvents?.length ?? 0) === 0) return null;

  const summative: any[] = [];
  const nonSummative: any[] = [];
  for (const ev of course.evaluationEvents) {
    (Number(ev.weight) > 0 ? summative : nonSummative).push(ev);
  }

  const today = new Date();
  const typeColor: Record<string, string> = { QUIZ: 'bg-amber-100 text-amber-700', EVIDENCE: 'bg-orange-100 text-orange-700', PROYECTO: 'bg-indigo-100 text-indigo-700', INTERVIEW: 'bg-purple-100 text-purple-700' };

  const getGradeForEvent = (ev: any): number | null => {
    // PROYECTO (2026-09-03, code-review finding): reuses the EVIDENCE
    // submission/grading shape 1:1 — same graded-submission average.
    if (ev.type !== 'EVIDENCE' && ev.type !== 'PROYECTO') return null;
    const mods = ev.moduleId
      ? [course.modules?.find((m: any) => m.id === ev.moduleId)]
      : (course.modules ?? []);
    const subs = mods.flatMap((m: any) => m?.submissions ?? []).filter((s: any) => s.status === 'graded');
    if (subs.length === 0) return null;
    return Math.round(subs.reduce((sum: number, s: any) => sum + (s.grade ?? 0), 0) / subs.length);
  };

  // Same prerequisite hierarchy as the module page's blockingStep (lessons →
  // class → quiz → reflection → interview) — was missing here entirely, so
  // "Ir al quiz"/"Presentar" let students skip straight past unfinished
  // lessons/classes/quiz (Trello DmPpbrff item 3, 2026-08-30 20:18).
  const prereqHint = (step: BlockingStep) =>
    step === 'class' ? t.moduleView.finishClassFirst
      : step === 'quiz' ? t.moduleView.passQuizFirst
      : t.moduleView.finishLessonsFirst;

  const getActionCell = (ev: any) => {
    const isOverdue = ev.dueDate && new Date(ev.dueDate) < today;
    if (isOverdue) return <span className="text-xs text-red-400 font-medium">{t.courseGrades.overdue}</span>;
    // Course locked: content not available yet
    if (course.isCourseLocked) {
      return <span className="text-xs text-amber-500 font-medium">Bloqueado</span>;
    }
    if (!ev.moduleId) {
      // Course-level evaluation (no module assigned yet) — show pending
      return <span className="text-xs text-gray-400">{t.courseGrades.pending}</span>;
    }
    const modPath = `/courses/${courseId}/modules/${ev.moduleId}`;
    if (ev.type === 'QUIZ') {
      const { quizReady, blockingStep } = getModulePrereq(ev.moduleId, course.modules, course.evaluationEvents);
      if (!quizReady) return <span className="text-xs text-gray-400">{prereqHint(blockingStep)}</span>;
      return (
        <Link href={`${modPath}/quiz`}>
          <Button size="sm" variant="secondary">{t.courseGrades.goToQuiz}</Button>
        </Link>
      );
    }
    if (ev.type === 'INTERVIEW') {
      const { interviewReady } = getModulePrereq(ev.moduleId, course.modules, course.evaluationEvents);
      if (!interviewReady) return <span className="text-xs text-gray-400">{t.moduleView.interviewLockedHint}</span>;
      return (
        <Link href={modPath}>
          <Button size="sm" variant="secondary">{t.courseGrades.present}</Button>
        </Link>
      );
    }
    // PROYECTO (2026-09-03, code-review finding): reuses EVIDENCE's
    // submission flow 1:1 — same EvidenceCard, same action button.
    if (ev.type === 'EVIDENCE' || ev.type === 'PROYECTO') return (
      <Link href={modPath}>
        <Button size="sm" variant="secondary">{t.courseGrades.submit}</Button>
      </Link>
    );
    return null;
  };

  const row = (ev: any) => {
    const grade = getGradeForEvent(ev);
    return (
      <tr key={ev.id} className="py-2">
        <td className="py-2.5 pr-4">
          <p className="font-medium text-charcoal">{ev.name}</p>
          <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${typeColor[ev.type] ?? 'bg-gray-100 text-gray-600'}`}>{t.courseGrades.typeNames[ev.type] ?? ev.type}</span>
        </td>
        <td className="py-2.5 px-4 text-center text-gray-600">{t.courseGrades.weight(ev.weight)}</td>
        <td className="py-2.5 px-4 text-center text-gray-500 text-xs whitespace-nowrap">
          {ev.dueDate ? (
            <>
              {new Date(ev.dueDate).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short' })}
              {(() => {
                const wk = weekNumberForDate(ev.dueDate, course.startDate);
                return wk != null ? <span className="text-gray-400"> · {lang === 'en' ? 'W' : 'S'}{wk}</span> : null;
              })()}
            </>
          ) : '—'}
        </td>
        <td className="py-2.5 px-4 text-right">
          {grade !== null
            ? <Badge variant="success">{t.courseGrades.gradeValue(grade)}</Badge>
            : <span className="text-xs text-gray-400">{t.courseGrades.pending}</span>
          }
        </td>
        <td className="py-2.5 pl-4 text-right">{getActionCell(ev)}</td>
      </tr>
    );
  };

  const categorySection = (cat: EvalCategory) => {
    // A category with a single, one-off item (e.g. "Examen Final", "Asistencia"
    // with no repeated instances) has nothing to group — an accordion header
    // would just repeat the row's own name right above it. Render it as a bare
    // row instead; the accordion is for categories that actually have several
    // instances ("Tareas 1", "Tareas 2"...).
    if (cat.items.length === 1) {
      return (
        <div key={cat.name} className="overflow-x-auto">
          <table className="w-full text-sm">
            {tableHead}
            <tbody className="divide-y divide-gray-50">{row(cat.items[0])}</tbody>
          </table>
        </div>
      );
    }
    const collapsed = collapsedCategories.has(cat.name);
    return (
      <div key={cat.name} className="border border-gray-100 rounded-lg overflow-hidden">
        <button
          onClick={() => toggleCategory(cat.name)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-50/60 hover:bg-gray-100/60 transition-colors text-left"
        >
          <span className="flex items-center gap-1.5 font-semibold text-sm text-charcoal">
            {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronUp className="w-3.5 h-3.5 text-gray-400" />}
            {cat.name} <span className="font-normal text-gray-400">({cat.items.length})</span>
          </span>
          <span className="text-xs text-gray-500 font-medium">{t.courseGrades.weight(cat.totalWeight)}</span>
        </button>
        {!collapsed && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {tableHead}
              <tbody className="divide-y divide-gray-50">{cat.items.map(row)}</tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const tableHead = (
    <thead>
      <tr className="text-xs text-gray-400 border-b border-gray-100">
        <th className="text-left pb-2 pr-4 font-semibold">{t.courseGrades.evalHeader}</th>
        <th className="text-center pb-2 px-4 font-semibold">{t.courseGrades.weightHeader}</th>
        <th className="text-center pb-2 px-4 font-semibold">{t.courseGrades.dueDateHeader}</th>
        <th className="text-right pb-2 px-4 font-semibold">{t.courseGrades.gradeHeader}</th>
        <th className="text-right pb-2 pl-4 font-semibold">{t.courseGrades.actionHeader}</th>
      </tr>
    </thead>
  );

  return (
    <div className="card space-y-3">
      <h3 className="font-heading font-bold text-base text-charcoal flex items-center gap-2">
        <Star className="w-4 h-4 text-amber-500" /> {t.courseGrades.title}
      </h3>
      {summative.length > 0 && (
        <div className="space-y-2">{groupByCategory(summative).map(categorySection)}</div>
      )}

      {nonSummative.length > 0 && (
        <div className="border-t border-gray-100 pt-2">
          <button
            onClick={() => setShowNonSummative((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-charcoal transition-colors"
          >
            {showNonSummative ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {t.courseGrades.nonSummativeToggle(nonSummative.length)}
            <span className="font-normal text-gray-400">— {t.courseGrades.nonSummativeHint}</span>
          </button>
          {showNonSummative && (
            <div className="space-y-2 mt-2">{groupByCategory(nonSummative).map(categorySection)}</div>
          )}
        </div>
      )}
    </div>
  );
}
