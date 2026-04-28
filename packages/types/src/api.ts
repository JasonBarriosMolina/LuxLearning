import type { Course, Module, Lesson, QuizAttempt, Reflection, LessonProgress, Notification } from './models';

// ─── API Response wrapper ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  error: string;
  code?: string;
  statusCode: number;
}

// ─── Courses ─────────────────────────────────────────────────────────────────

export type GetCoursesResponse = ApiResponse<Course[]>;
export type GetCourseResponse = ApiResponse<Course & { modules: (Module & { lessons: Lesson[] })[] }>;

// ─── Lessons ─────────────────────────────────────────────────────────────────

export interface MarkLessonCompleteRequest {
  courseId: string;
  moduleId: string;
  lessonId: string;
  durationMs?: number;
}
export type MarkLessonCompleteResponse = ApiResponse<LessonProgress>;

export type GetLessonProgressResponse = ApiResponse<LessonProgress[]>;

// ─── Quiz ─────────────────────────────────────────────────────────────────────

export interface SubmitQuizRequest {
  moduleId: string;
  answers: number[];
}

export interface SubmitQuizResponse {
  score: number;
  passed: boolean;
  passingScore: number;
  attempt: number;
  correctCount: number;
  totalQuestions: number;
}

export type GetQuizAttemptsResponse = ApiResponse<QuizAttempt[]>;

// ─── Reflection ───────────────────────────────────────────────────────────────

export interface SubmitReflectionRequest {
  moduleId: string;
  text: string;
}
export type SubmitReflectionResponse = ApiResponse<Reflection>;
export type GetReflectionResponse = ApiResponse<Reflection | null>;

// ─── Evaluator ───────────────────────────────────────────────────────────────

export type GetPendingReflectionsResponse = ApiResponse<
  (Reflection & { userEmail?: string; moduleTitle?: string; courseTitle?: string })[]
>;

export interface ReviewReflectionRequest {
  userId: string;
  moduleId: string;
  action: 'APPROVE' | 'REJECT';
  feedback: string;
}
export type ReviewReflectionResponse = ApiResponse<Reflection>;

// ─── Progress ────────────────────────────────────────────────────────────────

export interface ModuleProgress {
  moduleId: string;
  moduleTitle: string;
  lessonsDone: number;
  lessonsTotal: number;
  quizPassed: boolean;
  reflectionStatus: string | null;
  unlocked: boolean;
}

export type GetProgressResponse = ApiResponse<ModuleProgress[]>;

// ─── Notifications ────────────────────────────────────────────────────────────

export type GetNotificationsResponse = ApiResponse<Notification[]>;
export interface MarkNotifReadRequest { notifId: string }
