'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pin, CheckCircle2, Circle, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanItem } from '../types';

interface Props {
  item: PlanItem;
  locked: boolean;
  onTogglePin: (id: string, pinned: boolean) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
}

const TYPE_BORDER: Record<string, string> = {
  lesson:     'border-l-blue-400',
  quiz:       'border-l-purple-500',
  reflection: 'border-l-emerald-400',
  review:     'border-l-amber-400',
  custom:     'border-l-gray-300 dark:border-l-gray-600',
};

const TYPE_LABEL: Record<string, string> = {
  lesson:     'Lección',
  quiz:       'Quiz',
  reflection: 'Reflexión',
  review:     'Repaso',
  custom:     'Personalizado',
};

function getItemHref(item: PlanItem): string | null {
  if (!item.courseId || !item.moduleId) return null;
  if (item.lessonId) return `/courses/${item.courseId}/modules/${item.moduleId}/lessons/${item.lessonId}`;
  if (item.type === 'reflection') return `/courses/${item.courseId}/modules/${item.moduleId}/reflection`;
  if (item.type === 'quiz') return `/courses/${item.courseId}/modules/${item.moduleId}/quiz`;
  return `/courses/${item.courseId}/modules/${item.moduleId}`;
}

// lesson/quiz/reflection completion is controlled by real progress — manual toggle disabled
const AUTO_COMPLETED_TYPES = new Set(['lesson', 'quiz', 'reflection']);

export function PlanCard({ item, locked, onTogglePin, onToggleDone, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isDone = item.completed;
  const isPinned = item.pinned;
  const href = !isDone ? getItemHref(item) : null;
  const hasDescription = !!(item.description);
  const isAutoType = AUTO_COMPLETED_TYPES.has(item.type);
  // Expand button only needed for description or removable student items (actions)
  const hasExtra = hasDescription || (!locked && item.source === 'student');

  return (
    <div className={cn(
      'flex flex-col gap-1.5 rounded-lg border-l-4 px-3 py-2.5 transition-all',
      TYPE_BORDER[item.type] ?? TYPE_BORDER.custom,
      isDone
        ? 'bg-gray-50 dark:bg-white/5 border-r border-t border-b border-gray-200 dark:border-white/10 opacity-60'
        : isPinned
          ? 'bg-blue-50 dark:bg-blue-950/30 border-r border-t border-b border-[#17527E]/20'
          : 'bg-white dark:bg-white/5 border-r border-t border-b border-gray-200 dark:border-white/10',
    )}>
      {/* Row 1: done toggle + title + expand */}
      <div className="flex items-start gap-2">
        {/* Completion indicator: auto-types show read-only icon; manual types show toggle */}
        {isAutoType ? (
          <span
            className="shrink-0 mt-0.5 p-0.5 -ml-0.5"
            title={isDone ? 'Completado automáticamente' : 'Se actualizará al completar la actividad'}
          >
            {isDone
              ? <CheckCircle2 className="w-4 h-4 text-green-500" />
              : <Circle className="w-4 h-4 text-gray-300" />}
          </span>
        ) : (
          <button
            onClick={() => onToggleDone(item.id, !isDone)}
            className="shrink-0 mt-0.5 text-gray-300 hover:text-green-500 active:text-green-600 transition-colors p-0.5 -ml-0.5 touch-manipulation"
            title={isDone ? 'Marcar pendiente' : 'Marcar hecho'}
          >
            {isDone
              ? <CheckCircle2 className="w-4 h-4 text-green-500" />
              : <Circle className="w-4 h-4" />}
          </button>
        )}

        {/* Title — wraps, no truncate; clickable when linked */}
        {href ? (
          <Link
            href={href}
            className={cn(
              'flex-1 text-sm font-medium leading-snug hover:text-[#17527E] dark:hover:text-blue-300 transition-colors',
              isDone ? 'line-through text-gray-400 pointer-events-none' : 'text-gray-800 dark:text-gray-200',
            )}
          >
            {item.title}
          </Link>
        ) : (
          <p className={cn(
            'flex-1 text-sm font-medium leading-snug',
            isDone ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200',
          )}>
            {item.title}
          </p>
        )}

        {/* Expand toggle */}
        {hasExtra && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 mt-0.5 text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 transition-colors p-0.5 touch-manipulation"
            title={expanded ? 'Colapsar' : 'Ver más'}
          >
            {expanded
              ? <ChevronUp className="w-3.5 h-3.5" />
              : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Row 2: type badge + time + pin indicator */}
      <div className="flex items-center gap-2 pl-6">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
          {TYPE_LABEL[item.type] ?? item.type}
        </span>
        {item.estimatedMinutes && (
          <span className="text-[10px] text-gray-400">{item.estimatedMinutes} min</span>
        )}
        {isPinned && !isDone && (
          <span className="text-[10px] text-[#17527E] dark:text-blue-300 font-semibold flex items-center gap-0.5">
            <Pin className="w-2.5 h-2.5 inline" /> Fijado
          </span>
        )}
      </div>

      {/* Expanded: description + navigation link + actions */}
      {expanded && (
        <div className="pl-6 space-y-2 pt-0.5">
          {hasDescription && (
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{item.description}</p>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            {!locked && (
              <>
                <button
                  onClick={() => onTogglePin(item.id, !isPinned)}
                  className={cn(
                    'flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors',
                    isPinned
                      ? 'bg-[#17527E]/10 text-[#17527E] dark:text-blue-300'
                      : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:text-[#17527E]',
                  )}
                >
                  <Pin className="w-3 h-3" />
                  {isPinned ? 'Desfijar' : 'Fijar'}
                </button>
                {item.source === 'student' && (
                  <button
                    onClick={() => onRemove(item.id)}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Eliminar
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
