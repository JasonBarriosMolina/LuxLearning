import { createHash } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { LessonProgress, QuizAttempt, Reflection, Notification, Certificate } from '@lux/types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Table names (from env) ───────────────────────────────────────────────────
export const TABLES = {
  PROGRESS: process.env.DYNAMO_TABLE_PROGRESS ?? 'LessonProgress',
  QUIZ: process.env.DYNAMO_TABLE_QUIZ ?? 'QuizAttempts',
  REFLECTIONS: process.env.DYNAMO_TABLE_REFLECTIONS ?? 'Reflections',
  NOTIFS: process.env.DYNAMO_TABLE_NOTIFS ?? 'Notifications',
  ENROLLMENTS: process.env.DYNAMO_TABLE_ENROLLMENTS ?? 'Enrollments',
  CERTIFICATES: process.env.DYNAMO_TABLE_CERTIFICATES ?? 'Certificates',
  PUSH_SUBS: process.env.DYNAMO_TABLE_PUSH_SUBS ?? 'PushSubscriptions',
  TASKS: process.env.DYNAMO_TABLE_TASKS ?? 'ScheduledTasks',
} as const;

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
  const sk = `${attempt.moduleId}#${String(attempt.attemptNumber).padStart(4, '0')}`;
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

// ─── Reflections ──────────────────────────────────────────────────────────────

export async function saveReflection(reflection: Reflection) {
  await ddb.send(new PutCommand({
    TableName: TABLES.REFLECTIONS,
    Item: { userId: reflection.userId, sk: reflection.moduleId, ...reflection },
  }));
}

export async function getReflection(userId: string, moduleId: string): Promise<Reflection | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.REFLECTIONS,
    Key: { userId, sk: moduleId },
  }));
  if (!result.Item) return null;
  return result.Item as unknown as Reflection;
}

export async function updateReflectionStatus(
  userId: string,
  moduleId: string,
  updates: Partial<Pick<Reflection, 'status' | 'aiResult' | 'evaluatorFeedback' | 'reviewedAt' | 'analyzedAt' | 'qualityScore'>>
) {
  const expressions: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  if (updates.status !== undefined) {
    expressions.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = updates.status;
  }
  if (updates.aiResult !== undefined) {
    expressions.push('aiResult = :aiResult');
    values[':aiResult'] = updates.aiResult;
  }
  if (updates.evaluatorFeedback !== undefined) {
    expressions.push('evaluatorFeedback = :feedback');
    values[':feedback'] = updates.evaluatorFeedback;
  }
  if (updates.reviewedAt !== undefined) {
    expressions.push('reviewedAt = :reviewedAt');
    values[':reviewedAt'] = updates.reviewedAt;
  }
  if (updates.analyzedAt !== undefined) {
    expressions.push('analyzedAt = :analyzedAt');
    values[':analyzedAt'] = updates.analyzedAt;
  }
  if (updates.qualityScore !== undefined) {
    expressions.push('qualityScore = :qualityScore');
    values[':qualityScore'] = updates.qualityScore;
  }

  await ddb.send(new UpdateCommand({
    TableName: TABLES.REFLECTIONS,
    Key: { userId, sk: moduleId },
    UpdateExpression: `SET ${expressions.join(', ')}`,
    ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
    ExpressionAttributeValues: values,
  }));
}

export async function setReflectionPriority(userId: string, moduleId: string, priority: boolean) {
  await ddb.send(new UpdateCommand({
    TableName: TABLES.REFLECTIONS,
    Key: { userId, sk: moduleId },
    UpdateExpression: 'SET priority = :p',
    ExpressionAttributeValues: { ':p': priority },
  }));
}

export async function getPendingReflections(): Promise<Reflection[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.REFLECTIONS,
    IndexName: 'status-index',
    KeyConditionExpression: '#status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': 'PENDING_EVAL' },
    ScanIndexForward: false, // Newest first
  }));
  return (result.Items ?? []) as unknown as Reflection[];
}

export async function getAllLessonProgress(): Promise<LessonProgress[]> {
  const items: LessonProgress[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.PROGRESS,
      ExclusiveStartKey: lastKey,
    }));
    (result.Items ?? []).forEach((item) => items.push(item as unknown as LessonProgress));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
}

export async function getAllReflections(): Promise<Reflection[]> {
  const items: Reflection[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.REFLECTIONS,
      ExclusiveStartKey: lastKey,
    }));
    (result.Items ?? []).forEach((item) => items.push(item as unknown as Reflection));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
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
  if (moduleOrder === 1) return true;
  // Find the module whose order is exactly one before this one.
  // Using order values (not array indices) is safe when orders are non-contiguous.
  const prevModule = allModules.find((m) => m.order === moduleOrder - 1);
  if (!prevModule) return false; // previous module doesn't exist — treat as locked
  const reflection = await getReflection(userId, prevModule.id);
  return reflection?.status === 'APPROVED';
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function createNotification(notif: Notification) {
  await ddb.send(new PutCommand({
    TableName: TABLES.NOTIFS,
    Item: { userId: notif.userId, sk: notif.notifId, ...notif },
  }));
}

export async function getNotifications(userId: string): Promise<Notification[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.NOTIFS,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
    ScanIndexForward: false,
    Limit: 50,
  }));
  return (result.Items ?? []) as unknown as Notification[];
}

export async function markNotificationRead(userId: string, notifId: string) {
  await ddb.send(new UpdateCommand({
    TableName: TABLES.NOTIFS,
    Key: { userId, sk: notifId },
    UpdateExpression: 'SET #read = :true',
    ExpressionAttributeNames: { '#read': 'read' },
    ExpressionAttributeValues: { ':true': true },
  }));
}

// ─── Enrollments ──────────────────────────────────────────────────────────────

export async function createEnrollment(userId: string, courseId: string) {
  await ddb.send(new PutCommand({
    TableName: TABLES.ENROLLMENTS,
    Item: { userId, sk: `COURSE#${courseId}`, courseId, enrolledAt: new Date().toISOString() },
  }));
}

export async function getEnrollments(userId: string): Promise<string[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.ENROLLMENTS,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
  }));
  return (result.Items ?? []).map((item) => item['courseId'] as string);
}

export async function deleteEnrollment(userId: string, courseId: string) {
  await ddb.send(new DeleteCommand({
    TableName: TABLES.ENROLLMENTS,
    Key: { userId, sk: `COURSE#${courseId}` },
  }));
}

export async function getAllEnrollments(): Promise<{ userId: string; courseId: string }[]> {
  const items: { userId: string; courseId: string }[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.ENROLLMENTS,
      ExclusiveStartKey: lastKey,
    }));
    (result.Items ?? []).forEach((item) =>
      items.push({ userId: item['userId'] as string, courseId: item['courseId'] as string })
    );
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
}

// ─── Certificates ─────────────────────────────────────────────────────────────

export async function saveCertificate(cert: Certificate) {
  await ddb.send(new PutCommand({
    TableName: TABLES.CERTIFICATES,
    Item: { certId: cert.certId, ...cert },
  }));
}

export async function getCertificate(certId: string): Promise<Certificate | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.CERTIFICATES,
    Key: { certId },
  }));
  return result.Item ? (result.Item as unknown as Certificate) : null;
}

export async function getCertificateByUserAndCourse(userId: string, courseId: string): Promise<Certificate | null> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.CERTIFICATES,
    IndexName: 'userId-courseId-index',
    KeyConditionExpression: 'userId = :uid AND courseId = :cid',
    ExpressionAttributeValues: { ':uid': userId, ':cid': courseId },
    Limit: 1,
  }));
  return result.Items && result.Items.length > 0 ? (result.Items[0] as unknown as Certificate) : null;
}

export async function getCertificatesByUser(userId: string): Promise<Certificate[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.CERTIFICATES,
    IndexName: 'userId-courseId-index',
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
  }));
  return (result.Items ?? []) as unknown as Certificate[];
}

// ─── Push Subscriptions ───────────────────────────────────────────────────────

export interface PushSubscriptionRecord {
  userId: string;    // PK
  endpoint: string;  // SK (unique per browser/device)
  keys: { p256dh: string; auth: string };
  role: string;
  createdAt: string;
}

/** Deterministic, collision-free SK from endpoint URL (SHA-256 hex, 64 chars). */
function endpointSK(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

export async function savePushSubscription(sub: PushSubscriptionRecord) {
  const sk = endpointSK(sub.endpoint);
  await ddb.send(new PutCommand({
    TableName: TABLES.PUSH_SUBS,
    Item: { userId: sub.userId, sk, endpoint: sub.endpoint, keys: sub.keys, role: sub.role, createdAt: sub.createdAt },
  }));
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  const sk = endpointSK(endpoint);
  await ddb.send(new DeleteCommand({
    TableName: TABLES.PUSH_SUBS,
    Key: { userId, sk },
  }));
}

export async function getPushSubscriptionsByRole(role: string): Promise<PushSubscriptionRecord[]> {
  // Scan filtered by role — table is small (evaluators only)
  const result = await ddb.send(new ScanCommand({
    TableName: TABLES.PUSH_SUBS,
    FilterExpression: '#role = :role',
    ExpressionAttributeNames: { '#role': 'role' },
    ExpressionAttributeValues: { ':role': role },
  }));
  return (result.Items ?? []) as unknown as PushSubscriptionRecord[];
}

export async function getPushSubscriptionsByUserId(userId: string): Promise<PushSubscriptionRecord[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.PUSH_SUBS,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
  }));
  return (result.Items ?? []) as unknown as PushSubscriptionRecord[];
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
    return false; // removed
  } else {
    await ddb.send(new PutCommand({
      TableName: TABLES.PROGRESS,
      Item: { userId, sk, data: { ...item, createdAt: new Date().toISOString() } },
    }));
    return true; // added
  }
}

// ─── Transcripts ──────────────────────────────────────────────────────────────
// Stored with userId='_transcript' (shared, not per-user) and sk=lessonId

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

// ─── Scheduled Tasks ──────────────────────────────────────────────────────────

export interface Task {
  userId: string;
  sk: string;           // dueDate#taskId
  taskId: string;
  title: string;
  description?: string;
  courseId?: string;
  moduleId?: string;
  courseTitle?: string;
  moduleTitle?: string;
  type: 'custom' | 'complete_module' | 'submit_reflection' | 'pass_quiz';
  dueDate: string;      // ISO date string (YYYY-MM-DD)
  status: 'PENDING' | 'COMPLETED' | 'OVERDUE';
  assignedBy: string;
  createdAt: string;
  completedAt?: string;
}

export async function createTask(task: Omit<Task, 'sk'>): Promise<Task> {
  const sk = `${task.dueDate}#${task.taskId}`;
  const item: Task = { ...task, sk };
  await ddb.send(new PutCommand({ TableName: TABLES.TASKS, Item: item }));
  return item;
}

export async function getTasksForUser(userId: string): Promise<Task[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.TASKS,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
  }));
  return (result.Items ?? []) as Task[];
}

export async function getTasksByCourse(courseId: string): Promise<Task[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.TASKS,
    IndexName: 'courseId-index',
    KeyConditionExpression: 'courseId = :cid',
    ExpressionAttributeValues: { ':cid': courseId },
  }));
  return (result.Items ?? []) as Task[];
}

export async function updateTask(userId: string, sk: string, updates: Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'status' | 'completedAt'>>): Promise<void> {
  const exprs: string[] = [];
  const names: Record<string, string> = {};
  const vals: Record<string, any> = {};

  if (updates.title !== undefined) { exprs.push('#t = :t'); names['#t'] = 'title'; vals[':t'] = updates.title; }
  if (updates.description !== undefined) { exprs.push('#d = :d'); names['#d'] = 'description'; vals[':d'] = updates.description; }
  if (updates.dueDate !== undefined) { exprs.push('#dd = :dd'); names['#dd'] = 'dueDate'; vals[':dd'] = updates.dueDate; }
  if (updates.status !== undefined) { exprs.push('#s = :s'); names['#s'] = 'status'; vals[':s'] = updates.status; }
  if (updates.completedAt !== undefined) { exprs.push('#ca = :ca'); names['#ca'] = 'completedAt'; vals[':ca'] = updates.completedAt; }

  if (!exprs.length) return;

  await ddb.send(new UpdateCommand({
    TableName: TABLES.TASKS,
    Key: { userId, sk },
    UpdateExpression: `SET ${exprs.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

export async function deleteTask(userId: string, sk: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLES.TASKS, Key: { userId, sk } }));
}
