export interface PlanItem {
  id: string;
  type: 'lesson' | 'quiz' | 'reflection' | 'review' | 'custom';
  title: string;
  description?: string;
  courseId?: string;
  // Trello Nk0XDBvJ, 2026-08-18 (Mack): grouping/badging by course needs the title as
  // its own field — used by WeeklyGrid's course headers and PlanCard's course badge.
  courseTitle?: string;
  moduleId?: string;
  lessonId?: string;
  pinned: boolean;
  completed: boolean;
  estimatedMinutes?: number;
  source: 'auto' | 'evaluator' | 'student';
}

export interface DayPlan {
  dayIndex: number;
  date: string;
  items: PlanItem[];
}

export interface BedrockSuggestion {
  title: string;
  type: 'article' | 'video' | 'exercise' | 'book' | 'strategy';
  description: string;
  moduleId?: string;
  url?: string;
}

export interface StudyPlan {
  userId: string;
  weekOf: string;
  planId: string;
  days: DayPlan[];
  lockedBy?: string;
  lockedByName?: string;
  changeRequested?: boolean;
  changeRequestNote?: string;
  bedrockSuggestions?: BedrockSuggestion[];
  suggestionsStatus?: 'processing' | 'done' | 'error';
  generatedBy: 'auto' | 'evaluator' | 'student';
  createdAt: string;
  updatedAt: string;
}
