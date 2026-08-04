'use client';

import Link from 'next/link';
import { Pin, CheckCircle2, Circle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanItem } from '../types';

interface Props {
  item: PlanItem;
  locked: boolean;
  onTogglePin: (id: string, pinned: boolean) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
}

// Left-border accent by type — color hint without text noise
const TYPE_BORDER: Record<string, string> = {
  lesson:     'border-l-blue-400',
  quiz:       'border-l-purple-500',
  reflection: 'border-l-emerald-400',
  review:     'border-l-amber-400',
  custom:     'border-l-gray-300 dark:border-l-gray-600',
};

// Dot color for the type indicator
const TYPE_DOT: Record<string, string> = {
  lesson:     'bg-blue-400',
  quiz:       'bg-purple-500',
  reflection: 'bg-emerald-400',
  review:     'bg-amber-400',
  custom:     'bg-gray-300 dark:bg-gray-600',
};

function getItemHref(item: PlanItem): string | null {
  if (!item.courseId || !item.moduleId) return null;
  if (item.lessonId) return `/courses/${item.courseId}/modules/${item.moduleId}/lessons/${item.lessonId}`;
  if (item.type === 'reflection') return `/courses/${item.courseId}/modules/${item.moduleId}/reflection`;
  if (item.type === 'quiz') return `/courses/${item.courseId}/modules/${item.moduleId}/quiz`;
  return `/courses/${item.courseId}/modules/${item.moduleId}`;
}

export function PlanCard({ item, locked, onTogglePin, onToggleDone, onRemove }: Props) {
  const isDone = item.completed;
  const isPinned = item.pinned;
  const href = !isDone ? getItemHref(item) : null;

  const cardClass = cn(
    'group/card relative flex items-center gap-2 rounded-lg border-l-4 pl-2.5 pr-2 py-2 transition-all',
    TYPE_BORDER[item.type] ?? TYPE_BORDER.custom,
    isDone
      ? 'bg-gray-50 dark:bg-white/5 border-r border-t border-b border-gray-200 dark:border-white/10 opacity-50'
      : isPinned
        ? 'bg-blue-50 dark:bg-blue-950/30 border-r border-t border-b border-[#17527E]/20'
        : 'bg-white dark:bg-white/5 border-r border-t border-b border-gray-200 dark:border-white/10',
    href ? 'hover:border-r-[#17527E]/30 hover:shadow-sm cursor-pointer' : '',
  );

  const inner = (
    <>
      {/* Done toggle */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleDone(item.id, !isDone); }}
        className="shrink-0 text-gray-300 hover:text-green-500 transition-colors"
        title={isDone ? 'Marcar pendiente' : 'Marcar hecho'}
      >
        {isDone
          ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
          : <Circle className="w-3.5 h-3.5" />}
      </button>

      {/* Title */}
      <p className={cn(
        'flex-1 text-xs font-medium leading-tight truncate',
        isDone ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200',
      )}>
        {item.title}
      </p>

      {/* Time + actions */}
      <div className="flex items-center gap-1 shrink-0">
        {item.estimatedMinutes && (
          <span className="text-[10px] text-gray-400">{item.estimatedMinutes}m</span>
        )}
        {!locked && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin(item.id, !isPinned); }}
              className={cn('p-0.5 rounded transition-colors', isPinned ? 'text-[#17527E] dark:text-blue-300' : 'text-gray-300 hover:text-[#17527E]')}
              title={isPinned ? 'Desfijar' : 'Fijar'}
            >
              <Pin className="w-3 h-3" />
            </button>
            {item.source === 'student' && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(item.id); }}
                className="p-0.5 rounded text-gray-300 hover:text-red-500 transition-colors"
                title="Eliminar"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );

  return href ? (
    <Link href={href} className={cardClass}>{inner}</Link>
  ) : (
    <div className={cardClass}>{inner}</div>
  );
}
