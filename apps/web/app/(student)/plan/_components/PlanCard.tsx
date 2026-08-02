'use client';

import { Pin, CheckCircle2, Circle, Trash2, BookOpen, HelpCircle, MessageSquare, RotateCcw, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanItem } from '../types';

interface Props {
  item: PlanItem;
  locked: boolean;
  onTogglePin: (id: string, pinned: boolean) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  lesson: <BookOpen className="w-3.5 h-3.5" />,
  quiz: <HelpCircle className="w-3.5 h-3.5" />,
  reflection: <MessageSquare className="w-3.5 h-3.5" />,
  review: <RotateCcw className="w-3.5 h-3.5" />,
  custom: <Pencil className="w-3.5 h-3.5" />,
};

const TYPE_COLOR: Record<string, string> = {
  lesson: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  quiz: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  reflection: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  review: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  custom: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export function PlanCard({ item, locked, onTogglePin, onToggleDone, onRemove }: Props) {
  const isDone = item.completed;
  const isPinned = item.pinned;

  return (
    <div className={cn(
      'group relative rounded-lg border px-3 py-2 text-sm transition-all',
      isDone
        ? 'border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5 opacity-60'
        : isPinned
          ? 'border-[#17527E]/30 bg-blue-50 dark:border-blue-400/20 dark:bg-blue-950/30'
          : 'border-gray-200 bg-white dark:border-white/10 dark:bg-white/5',
    )}>
      {/* Top row */}
      <div className="flex items-start gap-2">
        {/* Done toggle */}
        <button
          onClick={() => onToggleDone(item.id, !isDone)}
          className="mt-0.5 shrink-0 text-gray-400 hover:text-green-500 transition-colors"
          title={isDone ? 'Marcar pendiente' : 'Marcar hecho'}
        >
          {isDone
            ? <CheckCircle2 className="w-4 h-4 text-green-500" />
            : <Circle className="w-4 h-4" />}
        </button>

        {/* Title + type badge */}
        <div className="flex-1 min-w-0">
          <p className={cn('font-medium leading-tight truncate', isDone && 'line-through text-gray-400')}>
            {item.title}
          </p>
          {item.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{item.description}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium', TYPE_COLOR[item.type] ?? TYPE_COLOR.custom)}>
              {TYPE_ICON[item.type]}
              {item.type}
            </span>
            {item.estimatedMinutes && (
              <span className="text-xs text-gray-400">{item.estimatedMinutes} min</span>
            )}
            {isPinned && (
              <span className="text-xs text-[#17527E] dark:text-blue-300 font-medium flex items-center gap-0.5">
                <Pin className="w-2.5 h-2.5" /> Fijado
              </span>
            )}
          </div>
        </div>

        {/* Actions — show on hover */}
        {!locked && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={() => onTogglePin(item.id, !isPinned)}
              className={cn('p-1 rounded hover:bg-gray-100 dark:hover:bg-white/10 transition-colors', isPinned ? 'text-[#17527E] dark:text-blue-300' : 'text-gray-400')}
              title={isPinned ? 'Desfijar' : 'Fijar'}
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
            {item.source === 'student' && (
              <button
                onClick={() => onRemove(item.id)}
                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                title="Eliminar"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
