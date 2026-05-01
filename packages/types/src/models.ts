// ─── Neon / Prisma Models ────────────────────────────────────────────────────

export interface Course {
  id: string;
  title: string;
  slug: string;
  description: string;
  imageUrl?: string;
  isActive: boolean;
  isPilot: boolean;
  createdAt: string;
  modules?: Module[];
}

export interface Module {
  id: string;
  courseId: string;
  order: number;
  title: string;
  description: string;
  duration: string;
  passingScore: number;
  lessons?: Lesson[];
  questions?: Question[];
}

export interface Lesson {
  id: string;
  moduleId: string;
  order: number;
  title: string;
  duration: string;
  youtubeId: string;
  imageUrl?: string;
  points: string[];
  tip: string;
}

export interface Question {
  id: string;
  moduleId: string;
  order: number;
  text: string;
  options: string[];
  correctIndex: number;
}

// ─── DynamoDB Models ─────────────────────────────────────────────────────────

export interface LessonProgress {
  userId: string;
  // SK: courseId#moduleId#lessonId
  courseId: string;
  moduleId: string;
  lessonId: string;
  completedAt: string;
  durationMs?: number;
}

export interface QuizAttempt {
  userId: string;
  moduleId: string;
  attemptNumber: number;
  score: number;
  passed: boolean;
  answers: number[];
  submittedAt: string;
}

export type ReflectionStatus =
  | 'PENDING_AI'
  | 'PENDING_EVAL'
  | 'APPROVED'
  | 'REJECTED';

export interface Reflection {
  userId: string;
  moduleId: string;
  text: string;
  wordCount: number;
  aiResult?: AIDetectionResult;
  status: ReflectionStatus;
  evaluatorFeedback?: string;
  submittedAt: string;
  deadline?: string;   // ISO — submittedAt + 48h, set at submission time
  analyzedAt?: string;
  reviewedAt?: string;
}

export interface AIDetectionResult {
  isAI: boolean;
  confidence: number;
  signals: string[];
  verdict: 'HUMANO' | 'IA_DETECTADA';
}

export interface Notification {
  userId: string;
  notifId: string;
  type: 'REFLECTION_APPROVED' | 'REFLECTION_REJECTED' | 'MODULE_UNLOCKED' | 'GENERAL';
  message: string;
  read: boolean;
  createdAt: string;
}

export interface Certificate {
  certId: string;       // PK — unique certificate ID (cuid)
  userId: string;       // student's userId (GSI PK)
  courseId: string;     // GSI SK
  studentName: string;  // resolved at generation time
  courseTitle: string;
  issuedAt: string;     // ISO timestamp
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'STUDENT' | 'EVALUATOR' | 'ADMIN';

export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole;
  name?: string;
}
