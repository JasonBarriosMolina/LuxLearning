'use client';

import Link from 'next/link';
import { BookOpen, HelpCircle, MessageSquare, CheckCircle, Sparkles, ArrowRight, Loader2 } from 'lucide-react';

const ITEM_ICON: Record<string, React.ReactNode> = {
  lesson: <BookOpen className="w-3.5 h-3.5" />,
  quiz: <HelpCircle className="w-3.5 h-3.5" />,
  reflection: <MessageSquare className="w-3.5 h-3.5" />,
  review: <BookOpen className="w-3.5 h-3.5" />,
  custom: <Sparkles className="w-3.5 h-3.5" />,
};

function getItemHref(item: any): string | null {
  if (!item.courseId || !item.moduleId) return null;
  if (item.lessonId) return `/courses/${item.courseId}/modules/${item.moduleId}/lessons/${item.lessonId}`;
  if (item.type === 'reflection') return `/courses/${item.courseId}/modules/${item.moduleId}/reflection`;
  if (item.type === 'quiz') return `/courses/${item.courseId}/modules/${item.moduleId}/quiz`;
  return `/courses/${item.courseId}/modules/${item.moduleId}`;
}

interface Props {
  currentPlan: any;
  planLoading: boolean;
  lang: string;
}

export function StudyPlanWidget({ currentPlan, planLoading, lang }: Props) {
  const todayDayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const todayItems: any[] = currentPlan?.days?.find((d: any) => d.dayIndex === todayDayIdx)?.items ?? [];
  const doneCount = todayItems.filter((i: any) => i.completed).length;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-heading font-semibold text-base text-charcoal flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-500" />
          {lang === 'en' ? "Today's plan" : 'Plan de hoy'}
        </h2>
        <Link href="/plan" className="text-xs text-cta-from font-medium hover:underline">
          {lang === 'en' ? 'Full week →' : 'Ver semana →'}
        </Link>
      </div>

      {planLoading ? (
        <div className="flex items-center justify-center py-4 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : !currentPlan ? (
        <div className="text-center py-4 space-y-3">
          <p className="text-sm text-gray-400">{lang === 'en' ? 'No active plan yet.' : 'Sin plan activo aún.'}</p>
          <Link href="/plan" className="btn-primary text-xs px-4 py-2 inline-flex">{lang === 'en' ? 'Go to Plan' : 'Ir al Plan'}</Link>
        </div>
      ) : (
        <div className="space-y-0.5">
          {todayItems.length > 0 && (
            <p className="text-xs text-gray-400 mb-2">
              {lang === 'en' ? `${doneCount} of ${todayItems.length} done` : `${doneCount} de ${todayItems.length} completadas`}
            </p>
          )}
          {todayItems.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-2">
              {lang === 'en' ? 'Rest day — no activities scheduled.' : 'Día libre, sin actividades.'}
            </p>
          ) : (
            <>
              {todayItems.slice(0, 4).map((item: any) => {
                const href = getItemHref(item);
                const navigable = href && !item.completed;
                const row = (
                  <div className={`flex items-center gap-2.5 px-2 py-2 rounded-lg ${item.completed ? 'opacity-50' : navigable ? 'hover:bg-gray-50 dark:hover:bg-white/5' : ''}`}>
                    <span className={item.completed ? 'text-emerald-500 shrink-0' : 'text-gray-400 shrink-0'}>
                      {item.completed ? <CheckCircle className="w-4 h-4" /> : (ITEM_ICON[item.type] ?? ITEM_ICON.custom)}
                    </span>
                    <span className={`flex-1 text-sm truncate ${item.completed ? 'line-through text-gray-400' : 'text-charcoal'}`}>
                      {item.title}
                    </span>
                    {item.estimatedMinutes && <span className="text-xs text-gray-400 shrink-0">{item.estimatedMinutes}min</span>}
                    {navigable && <ArrowRight className="w-3 h-3 text-gray-300 shrink-0" />}
                  </div>
                );
                return navigable ? <Link key={item.id} href={href}>{row}</Link> : <div key={item.id}>{row}</div>;
              })}
              {todayItems.length > 4 && (
                <Link href="/plan" className="block text-xs text-center text-gray-400 hover:text-cta-from pt-1">
                  +{todayItems.length - 4} {lang === 'en' ? 'more' : 'más'}
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
