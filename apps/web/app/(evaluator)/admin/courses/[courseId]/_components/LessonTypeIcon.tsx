'use client';

// ─── LessonTypeIcon.tsx ─────────────────────────────────────────────────────────
// Trello DmPpbrff, 2026-09-06 (Mack): every lesson row used the same PlayCircle icon
// regardless of type — "la idea es que se puedan identificar visualmente qué tipo de
// lecciones son cuáles." Text lessons want a book+pen, carousels a photo/sound cue,
// videos a video icon. One place so ModuleCard's preview modal and LessonRow's list
// row stay in sync.

import { NotebookPen, Images, Video, HelpCircle } from 'lucide-react';

const LESSON_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  text: NotebookPen,
  carousel: Images,
  video: Video,
};

export function LessonTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = LESSON_TYPE_ICONS[type] ?? HelpCircle;
  return <Icon className={className} />;
}
