import type { Translations } from '@/lib/i18n';

export type ModuleStat = {
  moduleId: string; title: string; order: number;
  totalLessons: number; completedLessons: number;
  quizPassed: boolean; reflectionStatus: string | null;
};

export type CourseStat = {
  courseId: string; title: string;
  totalLessons: number; completedLessons: number;
  progressPct: number; modulesApproved: number;
  modules: ModuleStat[];
};

export type ReminderSummary = { lastSent: string; sentBy: string; count: number };
export type ReminderEntry = { sentAt: string; sentBy: string; type: 'manual' | 'auto'; courseTitle?: string; count?: number };
export type Student = {
  userId: string;
  studentName?: string;
  studentEmail?: string | null;
  courses: CourseStat[];
  lastSeen?: string | null;
  presenceStatus?: 'online' | 'active' | 'inactive' | 'never_active' | 'disabled';
  enabled?: boolean;
  taskCounts?: { pending: number; overdue: number; completed: number } | null;
  lastManualReminder?: ReminderSummary | null;
  lastAutoReminder?: { lastSent: string; count: number } | null;
};

export type PresenceFilter = 'all' | 'online' | 'active' | 'inactive';

/** Shorthand for the studentsPage translation slice. */
export type SP = Translations['studentsPage'];
