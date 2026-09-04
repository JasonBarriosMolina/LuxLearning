// ─── db-progress-misc.ts ────────────────────────────────────────────────────
// Domain: Highlights, Favorites, Transcripts, Heartbeat/Presence, Inactivity
//         Reminders, Manual Reminders, Onboarding, AI Jobs, Digital Signature.
// Split out of db-progress.ts (2026-09-03, code-review finding) — that file's
// core Lesson Progress / Quiz Attempts / module-unlock gate logic pushed it
// past CLAUDE.md's 400-line limit for shared/db-*.ts helpers. Re-exported
// through db-progress.ts so every existing import path keeps working.
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';

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
