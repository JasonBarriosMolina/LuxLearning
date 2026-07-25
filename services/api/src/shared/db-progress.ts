// ─── db-progress.ts ──────────────────────────────────────────────────────────
// Domain: Lesson Progress, Quiz Attempts, Highlights, Favorites, Transcripts,
//         Heartbeat/Presence, Inactivity Reminders, Manual Reminders,
//         Onboarding, AI Jobs, Digital Signature
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createId } from '@paralleldrive/cuid2';
import type { LessonProgress, QuizAttempt } from '@lux/types';
import { ddb, TABLES } from './db-core';
import { getReflection } from './db-reflections';

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

export async function isModuleUnlocked(
  userId: string,
  moduleOrder: number,
  allModules: { id: string; order: number }[]
): Promise<boolean> {
  const sorted = [...allModules].sort((a, b) => a.order - b.order);
  const currentIndex = sorted.findIndex((m) => m.order === moduleOrder);
  if (currentIndex <= 0) return true;
  const prevModule = sorted[currentIndex - 1]!;
  const reflection = await getReflection(userId, prevModule.id);
  return reflection?.status === 'APPROVED';
}

// ─── Highlights ───────────────────────────────────────────────────────────────

export interface HighlightItem {
  id: string;
  text: string;
  color: string;
  createdAt: string;
}

export async function getHighlights(userId: string, lessonId: string): Promise<HighlightItem[]> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId, sk: `HL#${lessonId}` },
  }));
  return (result.Item?.items ?? []) as HighlightItem[];
}

export async function saveHighlights(userId: string, lessonId: string, items: HighlightItem[]): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.PROGRESS,
    Item: { userId, sk: `HL#${lessonId}`, items, updatedAt: new Date().toISOString() },
  }));
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export interface FavoriteItem {
  type: 'lesson' | 'module';
  id: string;
  title: string;
  courseId?: string;
  moduleId?: string;
  createdAt: string;
}

export async function getFavorites(userId: string): Promise<FavoriteItem[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.PROGRESS,
    KeyConditionExpression: 'userId = :uid AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':uid': userId, ':prefix': 'FAV#' },
  }));
  return (result.Items ?? []).map((item) => item['data'] as FavoriteItem);
}

export async function toggleFavorite(userId: string, item: FavoriteItem): Promise<boolean> {
  const sk = `FAV#${item.type}#${item.id}`;
  const existing = await ddb.send(new GetCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId, sk },
  }));
  if (existing.Item) {
    await ddb.send(new DeleteCommand({ TableName: TABLES.PROGRESS, Key: { userId, sk } }));
    return false;
  } else {
    await ddb.send(new PutCommand({
      TableName: TABLES.PROGRESS,
      Item: { userId, sk, data: { ...item, createdAt: new Date().toISOString() } },
    }));
    return true;
  }
}

// ─── Transcripts ──────────────────────────────────────────────────────────────

export async function getTranscript(lessonId: string): Promise<string | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId: '_transcript', sk: lessonId },
  }));
  return result.Item?.text ?? null;
}

export async function saveTranscript(lessonId: string, text: string): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.PROGRESS,
    Item: { userId: '_transcript', sk: lessonId, text, generatedAt: new Date().toISOString() },
  }));
}

// ─── Student Presence (heartbeat / lastSeen) ──────────────────────────────────

export async function updateLastSeen(userId: string): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.PROGRESS,
    Item: { userId, sk: 'HEARTBEAT', lastSeen: new Date().toISOString() },
  }));
}

export async function getLastSeenAll(): Promise<{ userId: string; lastSeen: string }[]> {
  const byUser = new Map<string, string>();
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.PROGRESS,
      FilterExpression: 'attribute_exists(userId) AND NOT begins_with(sk, :onb) AND sk <> :ir AND userId <> :job',
      ExpressionAttributeValues: { ':onb': 'ONBOARDING#', ':ir': 'INACTIVITY_REMINDER', ':job': '_AIJOB' },
      ProjectionExpression: 'userId, sk, lastSeen, completedAt',
      ExclusiveStartKey: lastKey,
    }));
    for (const item of result.Items ?? []) {
      const uid = String(item['userId'] ?? '');
      if (!uid || uid.startsWith('_')) continue;
      const ts = String(item['lastSeen'] ?? item['completedAt'] ?? '');
      if (!ts) continue;
      const prev = byUser.get(uid);
      if (!prev || ts > prev) byUser.set(uid, ts);
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return Array.from(byUser.entries()).map(([userId, lastSeen]) => ({ userId, lastSeen }));
}

// ─── Inactivity Reminder Tracking ────────────────────────────────────────────

export async function getInactivityReminder(userId: string): Promise<{ count: number; lastSent: string | null }> {
  const res = await ddb.send(new GetCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId, sk: 'INACTIVITY_REMINDER' },
  }));
  if (!res.Item) return { count: 0, lastSent: null };
  return { count: Number(res.Item['count'] ?? 0), lastSent: res.Item['lastSent'] ?? null };
}

export async function setInactivityReminder(userId: string, count: number, lastSent: string | null): Promise<void> {
  if (count === 0) {
    await ddb.send(new DeleteCommand({
      TableName: TABLES.PROGRESS,
      Key: { userId, sk: 'INACTIVITY_REMINDER' },
    })).catch(() => {});
    return;
  }
  await ddb.send(new PutCommand({
    TableName: TABLES.PROGRESS,
    Item: { userId, sk: 'INACTIVITY_REMINDER', count, lastSent },
  }));
}

// ─── Manual Reminder Tracking ─────────────────────────────────────────────────

export interface ManualReminderSummary {
  lastSent: string;
  sentBy: string;
  count: number;
}

export interface ManualReminderEntry {
  sentAt: string;
  sentBy: string;
  type: 'manual' | 'auto';
  courseTitle?: string;
}

export async function getLastManualReminder(userId: string): Promise<ManualReminderSummary | null> {
  const res = await ddb.send(new GetCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId, sk: 'LAST_MANUAL_REMINDER' },
  }));
  if (!res.Item) return null;
  return { lastSent: res.Item['lastSent'], sentBy: res.Item['sentBy'], count: Number(res.Item['count'] ?? 1) };
}

export async function setManualReminder(userId: string, sentBy: string, courseTitle?: string): Promise<void> {
  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId, sk: 'LAST_MANUAL_REMINDER' },
    UpdateExpression: 'SET lastSent = :ts, sentBy = :by, #cnt = if_not_exists(#cnt, :zero) + :one',
    ExpressionAttributeNames: { '#cnt': 'count' },
    ExpressionAttributeValues: { ':ts': now, ':by': sentBy, ':zero': 0, ':one': 1 },
  }));
  await ddb.send(new PutCommand({
    TableName: TABLES.PROGRESS,
    Item: { userId, sk: `MANUAL_REMINDER#${now}`, sentAt: now, sentBy, type: 'manual', ...(courseTitle ? { courseTitle } : {}) },
  }));
}

export async function getManualReminderHistory(userId: string): Promise<ManualReminderEntry[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: TABLES.PROGRESS,
    KeyConditionExpression: 'userId = :uid AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':uid': userId, ':prefix': 'MANUAL_REMINDER#' },
    ScanIndexForward: false,
  }));
  return (res.Items ?? []).map((item) => ({
    sentAt: item['sentAt'],
    sentBy: item['sentBy'],
    type: 'manual' as const,
    courseTitle: item['courseTitle'],
  }));
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

export async function markOnboardingDone(userId: string): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.PROGRESS,
    Item: { userId, sk: 'ONBOARDING#done', completedAt: new Date().toISOString() },
  }));
}

export async function isOnboardingDone(userId: string): Promise<boolean> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId, sk: 'ONBOARDING#done' },
  }));
  return !!result.Item;
}

// ─── AI Generation Jobs ───────────────────────────────────────────────────────

export async function saveAiJob(jobId: string, data: { status: 'processing' | 'done' | 'error'; result?: any; error?: string }): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.PROGRESS,
    Item: { userId: '_AIJOB', sk: jobId, ...data, updatedAt: new Date().toISOString() },
  }));
}

export async function getAiJob(jobId: string): Promise<{ status: string; result?: any; error?: string } | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId: '_AIJOB', sk: jobId },
  }));
  return result.Item ? (result.Item as any) : null;
}

// ─── Digital Signature ────────────────────────────────────────────────────────

export async function getSignature(userId: string): Promise<string | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId, sk: 'SIGNATURE' },
  }));
  return result.Item?.signature ?? null;
}

export async function saveSignature(userId: string, signature: string): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.PROGRESS,
    Item: { userId, sk: 'SIGNATURE', signature, updatedAt: new Date().toISOString() },
  }));
}
