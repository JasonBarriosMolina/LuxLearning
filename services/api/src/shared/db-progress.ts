// ─── db-progress.ts ──────────────────────────────────────────────────────────
// Domain: Lesson Progress, Quiz Attempts, weekly-pacing + module-unlock gate.
// Highlights/Favorites/Transcripts/Presence/Reminders/Onboarding/AI Jobs/
// Digital Signature live in db-progress-misc.ts (split out 2026-09-03 — this
// file's gate logic pushed it past CLAUDE.md's 400-line limit) and are
// re-exported below so every existing import path keeps working.
import { PutCommand, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createId } from '@paralleldrive/cuid2';
import type { LessonProgress, QuizAttempt } from '@lux/types';
import { ddb, TABLES } from './db-core';
import { getReflection } from './db-reflections';

export * from './db-progress-misc';

// ─── Lesson Progress ──────────────────────────────────────────────────────────

export async function markLessonComplete(data: LessonProgress) {
  const sk = `${data.courseId}#${data.moduleId}#${data.lessonId}`;
  await ddb.send(new PutCommand({
    TableName: TABLES.PROGRESS,
    Item: { userId: data.userId, sk, ...data },
  }));
}

export async function getLessonProgress(userId: string, courseId: string): Promise<LessonProgress[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.PROGRESS,
    KeyConditionExpression: 'userId = :uid AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':uid': userId, ':prefix': courseId },
  }));
  return (result.Items ?? []).map((item) => ({
    userId: item['userId'],
    courseId: item['courseId'],
    moduleId: item['moduleId'],
    lessonId: item['lessonId'],
    completedAt: item['completedAt'],
    durationMs: item['durationMs'],
  }));
}

export async function isLessonComplete(
  userId: string,
  courseId: string,
  moduleId: string,
  lessonId: string
): Promise<boolean> {
  const sk = `${courseId}#${moduleId}#${lessonId}`;
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId, sk },
  }));
  return !!result.Item;
}

// ─── Quiz Attempts ────────────────────────────────────────────────────────────

export async function saveQuizAttempt(attempt: QuizAttempt) {
  const sk = `${attempt.moduleId}#${createId()}`;
  await ddb.send(new PutCommand({
    TableName: TABLES.QUIZ,
    Item: { userId: attempt.userId, sk, ...attempt },
  }));
}

export async function getQuizAttempts(userId: string, moduleId: string): Promise<QuizAttempt[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.QUIZ,
    KeyConditionExpression: 'userId = :uid AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':uid': userId, ':prefix': moduleId },
  }));
  return (result.Items ?? []).map((item) => ({
    userId: item['userId'],
    moduleId: item['moduleId'],
    attemptNumber: item['attemptNumber'],
    score: item['score'],
    passed: item['passed'],
    answers: item['answers'],
    submittedAt: item['submittedAt'],
  }));
}

export async function hasPassedQuiz(userId: string, moduleId: string): Promise<boolean> {
  const attempts = await getQuizAttempts(userId, moduleId);
  return attempts.some((a) => a.passed);
}

export async function getAllLessonProgress(): Promise<LessonProgress[]> {
  const items: LessonProgress[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.PROGRESS,
      ExclusiveStartKey: lastKey,
    }));
    (result.Items ?? [])
      .filter((item) => !String(item['userId'] ?? '').startsWith('_'))
      .forEach((item) => items.push(item as unknown as LessonProgress));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
}

export async function getAllQuizAttemptsForUser(userId: string): Promise<QuizAttempt[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.QUIZ,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
  }));
  return (result.Items ?? []) as unknown as QuizAttempt[];
}

export async function getAllQuizAttempts(): Promise<QuizAttempt[]> {
  const items: QuizAttempt[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.QUIZ,
      ExclusiveStartKey: lastKey,
    }));
    (result.Items ?? []).forEach((item) => items.push(item as unknown as QuizAttempt));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
}

// Weekly-pacing gate (Trello DmPpbrff, 2026-09-01 01:48 — Mack): pure so it can be
// unit-tested without mocking Prisma/DynamoDB. Module order N maps 1:1 to calendar
// week N, anchored to the course's startDate (same for every student in the
// course — Jason, 2026-09-01). Disabled or missing startDate = always within window
// (i.e. no additional restriction beyond the sequential reflection gate).
export function isWithinPacingWindow(params: {
  moduleOrder: number;
  weeklyPacingEnabled: boolean | undefined | null;
  courseStartDate: Date | string | null | undefined;
  now?: Date;
}): boolean {
  const { moduleOrder, weeklyPacingEnabled, courseStartDate, now = new Date() } = params;
  if (!weeklyPacingEnabled || !courseStartDate) return true;
  const start = new Date(courseStartDate);
  if (isNaN(start.getTime())) return true; // malformed date — don't lock students out
  const weeksElapsed = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const currentWeek = weeksElapsed + 1; // week 1 starts on startDate itself
  return moduleOrder <= currentWeek;
}

export async function isModuleUnlocked(
  userId: string,
  moduleOrder: number,
  allModules: { id: string; order: number; lessonIds?: string[] }[],
  opts?: {
    weeklyPacingEnabled?: boolean | null;
    courseStartDate?: Date | string | null;
    // Trello DmPpbrff, 2026-09-02 (Mack, real repro course found): the sequential
    // gate always required the PREVIOUS module's reflection to be APPROVED, even
    // when that module never had a reflection planned at all — since such a
    // reflection can never be submitted, this permanently locked every module
    // after it. Now only enforced when the previous module actually has a
    // REFLECTION EvaluationEvent. `undefined` (caller not yet updated) keeps the
    // old conservative behavior — always required — so this is backward
    // compatible for any call site not explicitly passing it.
    reflectionPlannedModuleIds?: Set<string> | string[] | null;
    // Trello DmPpbrff, 2026-09-03 00:52/00:53 (Mack, real repro course): the gate
    // above was the ONLY check this function ever did. It never verified the
    // previous module's lessons were completed or its quiz (if planned) was
    // passed — a module with no reflection planned (common) skipped the gate
    // entirely, so a student could reach module 3 without opening a single
    // lesson of module 2. `undefined`/`null` skips each check (matches the old,
    // buggy behavior) — pass both on every call site touching student-facing
    // unlock state; omitting them silently re-opens this hole.
    completedLessonIds?: Set<string> | string[] | null;
    quizPlannedModuleIds?: Set<string> | string[] | null;
    // Most callers already compute a course-wide (or even account-wide, via
    // getAllQuizAttemptsForUser) quiz-passed set to show each module's own
    // quizPassed status — without this, the quiz check below would re-fetch
    // the PREVIOUS module's attempts from DynamoDB a second time for every
    // module boundary (code-review finding, 2026-09-03). Pass it when you
    // have it; omitted falls back to a direct hasPassedQuiz lookup.
    quizPassedModuleIds?: Set<string> | string[] | null;
  } | null,
): Promise<boolean> {
  const sorted = [...allModules].sort((a, b) => a.order - b.order);
  const currentIndex = sorted.findIndex((m) => m.order === moduleOrder);
  if (currentIndex > 0) {
    const prevModule = sorted[currentIndex - 1]!;

    if (prevModule.lessonIds && prevModule.lessonIds.length > 0 && opts?.completedLessonIds != null) {
      const completed = opts.completedLessonIds;
      const completedSet = completed instanceof Set ? completed : new Set(completed);
      if (!prevModule.lessonIds.every((id) => completedSet.has(id))) return false;
    }

    const quizPlanned = opts?.quizPlannedModuleIds;
    const quizIsPlanned = quizPlanned == null
      ? false
      : (quizPlanned instanceof Set ? quizPlanned.has(prevModule.id) : quizPlanned.includes(prevModule.id));
    if (quizIsPlanned) {
      const passedSet = opts?.quizPassedModuleIds;
      const quizPassed = passedSet != null
        ? (passedSet instanceof Set ? passedSet.has(prevModule.id) : passedSet.includes(prevModule.id))
        : await hasPassedQuiz(userId, prevModule.id);
      if (!quizPassed) return false;
    }

    const plannedIds = opts?.reflectionPlannedModuleIds;
    const reflectionPlanned = plannedIds == null
      ? true
      : (plannedIds instanceof Set ? plannedIds.has(prevModule.id) : plannedIds.includes(prevModule.id));
    if (reflectionPlanned) {
      const reflection = await getReflection(userId, prevModule.id);
      if (reflection?.status !== 'APPROVED') return false;
    }
  }
  return isWithinPacingWindow({
    moduleOrder,
    weeklyPacingEnabled: opts?.weeklyPacingEnabled,
    courseStartDate: opts?.courseStartDate,
  });
}
