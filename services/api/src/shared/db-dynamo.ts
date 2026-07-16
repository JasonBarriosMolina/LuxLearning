import { createHash } from 'crypto';
import { createId } from '@paralleldrive/cuid2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand, DeleteCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { LessonProgress, QuizAttempt, Reflection, Notification, Certificate } from '@lux/types';
import { getTableName } from './env-context';

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Table names (from env) ───────────────────────────────────────────────────
// BASE holds the prod table names read from env vars at cold start.
// TABLES is a Proxy that applies the per-request env suffix (e.g. '-Staging')
// transparently, so all existing TABLES.X references stay unchanged.
const BASE_TABLES = {
  PROGRESS: process.env.DYNAMO_TABLE_PROGRESS ?? 'LessonProgress',
  QUIZ: process.env.DYNAMO_TABLE_QUIZ ?? 'QuizAttempts',
  REFLECTIONS: process.env.DYNAMO_TABLE_REFLECTIONS ?? 'Reflections',
  NOTIFS: process.env.DYNAMO_TABLE_NOTIFS ?? 'Notifications',
  ENROLLMENTS: process.env.DYNAMO_TABLE_ENROLLMENTS ?? 'Enrollments',
  CERTIFICATES: process.env.DYNAMO_TABLE_CERTIFICATES ?? 'Certificates',
  PUSH_SUBS: process.env.DYNAMO_TABLE_PUSH_SUBS ?? 'PushSubscriptions',
  TASKS: process.env.DYNAMO_TABLE_TASKS ?? 'ScheduledTasks',
  REPORT_ANALYSIS: process.env.DYNAMO_TABLE_REPORT_ANALYSIS ?? 'ReportAnalysis',
  RECOMMENDATIONS: process.env.DYNAMO_TABLE_RECOMMENDATIONS ?? 'CurriculumRecommendations',
  ACTIVITY: process.env.DYNAMO_TABLE_ACTIVITY ?? 'LuxActivity',
  CERT_TEMPLATES: process.env.DYNAMO_TABLE_CERT_TEMPLATES ?? 'LuxCertTemplates',
  RESOURCES: process.env.DYNAMO_TABLE_RESOURCES ?? 'LuxResources',
  TRANSLATIONS: process.env.DYNAMO_TABLE_TRANSLATIONS ?? 'LuxTranslations',
  CALENDAR: process.env.DYNAMO_TABLE_CALENDAR ?? 'LuxCalendarEvents',
  USER_PROFILES: process.env.DYNAMO_TABLE_USER_PROFILES ?? 'LuxUserProfiles',
};

export const TABLES: typeof BASE_TABLES = new Proxy(BASE_TABLES, {
  get(target, key: string) {
    const base = target[key as keyof typeof target];
    return base ? getTableName(base) : base;
  },
}) as typeof BASE_TABLES;

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
  // Use a unique cuid2 instead of attemptNumber as the SK suffix to prevent
  // concurrent submissions from overwriting each other (race condition).
  // attemptNumber is stored as an attribute for display purposes only.
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
  updates: Partial<Pick<Reflection, 'status' | 'aiResult' | 'evaluatorFeedback' | 'reviewedAt' | 'analyzedAt' | 'qualityScore' | 'aiSuspect' | 'reconsideredBy' | 'reconsiderationReason'>>
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
  if (updates.aiSuspect !== undefined) {
    expressions.push('aiSuspect = :aiSuspect');
    values[':aiSuspect'] = updates.aiSuspect;
  }
  if (updates.reconsideredBy !== undefined) {
    expressions.push('reconsideredBy = :reconsideredBy');
    values[':reconsideredBy'] = updates.reconsideredBy;
  }
  if (updates.reconsiderationReason !== undefined) {
    expressions.push('reconsiderationReason = :reconsiderationReason');
    values[':reconsiderationReason'] = updates.reconsiderationReason;
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
    // Exclude internal cache entries (e.g. userId='_transcript')
    (result.Items ?? [])
      .filter((item) => !String(item['userId'] ?? '').startsWith('_'))
      .forEach((item) => items.push(item as unknown as LessonProgress));
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
  // Sort modules by order and find the one immediately before moduleOrder,
  // without assuming order values are contiguous (e.g. 1, 3, 5 is valid).
  const sorted = [...allModules].sort((a, b) => a.order - b.order);
  const currentIndex = sorted.findIndex((m) => m.order === moduleOrder);
  if (currentIndex <= 0) return true; // first module (or not found) is always unlocked
  const prevModule = sorted[currentIndex - 1]!;
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

export type TaskType =
  | 'custom' | 'complete_module' | 'submit_reflection' | 'pass_quiz'
  | 'upload_link' | 'watch_video' | 'read_resource'
  | 'report' | 'theoretical' | 'practical'
  | 'project_progress' | 'project_final'
  | 'portfolio' | 'presentation' | 'peer_review';

/** Task types that require a file upload from the student */
export const FILE_UPLOAD_TASK_TYPES: TaskType[] = [
  'report', 'practical', 'project_progress', 'project_final', 'portfolio', 'presentation',
];

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
  type: TaskType;
  resourceUrl?: string;
  submissionUrl?: string;
  submissionText?: string; // for theoretical / peer_review
  fileUrl?: string;        // S3 URL of uploaded file
  fileName?: string;       // original file name
  fileType?: string;       // MIME type
  dueDate: string;      // ISO date string (YYYY-MM-DD)
  status: 'PENDING' | 'COMPLETED' | 'OVERDUE' | 'SUBMITTED';
  assignedBy: string;
  createdAt: string;
  completedAt?: string;
  submittedAt?: string;
  r5?: string;          // ISO timestamp when 5-day reminder was sent
  r3?: string;          // ISO timestamp when 3-day reminder was sent
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

export async function updateTask(userId: string, sk: string, updates: Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'status' | 'completedAt' | 'submittedAt' | 'submissionText' | 'fileUrl' | 'fileName' | 'fileType' | 'r5' | 'r3'>>): Promise<void> {
  const exprs: string[] = [];
  const names: Record<string, string> = {};
  const vals: Record<string, any> = {};

  if (updates.title !== undefined) { exprs.push('#t = :t'); names['#t'] = 'title'; vals[':t'] = updates.title; }
  if (updates.description !== undefined) { exprs.push('#d = :d'); names['#d'] = 'description'; vals[':d'] = updates.description; }
  if (updates.dueDate !== undefined) { exprs.push('#dd = :dd'); names['#dd'] = 'dueDate'; vals[':dd'] = updates.dueDate; }
  if (updates.status !== undefined) { exprs.push('#s = :s'); names['#s'] = 'status'; vals[':s'] = updates.status; }
  if (updates.completedAt !== undefined) { exprs.push('#ca = :ca'); names['#ca'] = 'completedAt'; vals[':ca'] = updates.completedAt; }
  if (updates.submittedAt !== undefined) { exprs.push('#sa = :sa'); names['#sa'] = 'submittedAt'; vals[':sa'] = updates.submittedAt; }
  if (updates.submissionText !== undefined) { exprs.push('#st = :st'); names['#st'] = 'submissionText'; vals[':st'] = updates.submissionText; }
  if (updates.fileUrl !== undefined) { exprs.push('#fu = :fu'); names['#fu'] = 'fileUrl'; vals[':fu'] = updates.fileUrl; }
  if (updates.fileName !== undefined) { exprs.push('#fn = :fn'); names['#fn'] = 'fileName'; vals[':fn'] = updates.fileName; }
  if (updates.fileType !== undefined) { exprs.push('#ft = :ft'); names['#ft'] = 'fileType'; vals[':ft'] = updates.fileType; }
  if (updates.r5 !== undefined) { exprs.push('#r5 = :r5'); names['#r5'] = 'r5'; vals[':r5'] = updates.r5; }
  if (updates.r3 !== undefined) { exprs.push('#r3 = :r3'); names['#r3'] = 'r3'; vals[':r3'] = updates.r3; }

  if (!exprs.length) return;

  await ddb.send(new UpdateCommand({
    TableName: TABLES.TASKS,
    Key: { userId, sk },
    UpdateExpression: `SET ${exprs.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

/** Auto-complete PENDING tasks that match a given trigger type and reference ID (moduleId or courseId) */
export async function autoCompleteTasks(userId: string, triggerType: TaskType, refId: string): Promise<void> {
  try {
    const tasks = await getTasksForUser(userId);
    const now = new Date().toISOString();
    await Promise.all(
      tasks
        .filter((t) => t.status === 'PENDING' && t.type === triggerType && (t.moduleId === refId || t.courseId === refId))
        .map((t) => updateTask(userId, t.sk, { status: 'COMPLETED', completedAt: now }))
    );
  } catch (err) {
    console.warn('[autoCompleteTasks] Non-fatal error:', err);
  }
}

export async function getAllPendingTasks(): Promise<Task[]> {
  // Scan for PENDING and SUBMITTED tasks — used by reminders Lambda for due-date alerts
  const result = await ddb.send(new ScanCommand({
    TableName: TABLES.TASKS,
    FilterExpression: '#s IN (:pending, :submitted)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':pending': 'PENDING', ':submitted': 'SUBMITTED' },
  }));
  return (result.Items ?? []) as Task[];
}

export async function deleteTask(userId: string, sk: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLES.TASKS, Key: { userId, sk } }));
}

// ─── LuxResources ─────────────────────────────────────────────────────────────

export interface Resource {
  evaluatorId: string;
  resourceId: string;
  title: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  folder?: string;
  courseIds: string[];
  archived: boolean;
  ttl?: number;          // Unix seconds — set when archived for 60-day auto-delete
  createdAt: string;
  updatedAt: string;
}

export async function getResourcesByEvaluator(evaluatorId: string): Promise<Resource[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.RESOURCES,
    KeyConditionExpression: 'evaluatorId = :eid',
    ExpressionAttributeValues: { ':eid': evaluatorId },
  }));
  return (result.Items ?? []) as Resource[];
}

export async function getResourcesByCourse(courseId: string): Promise<Resource[]> {
  // Scan active resources that include this courseId
  const result = await ddb.send(new ScanCommand({
    TableName: TABLES.RESOURCES,
    FilterExpression: 'contains(courseIds, :cid) AND (archived = :f OR attribute_not_exists(archived))',
    ExpressionAttributeValues: { ':cid': courseId, ':f': false },
  }));
  return (result.Items ?? []) as Resource[];
}

export async function saveResource(resource: Resource): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLES.RESOURCES, Item: resource }));
}

export async function updateResource(evaluatorId: string, resourceId: string, updates: Partial<Pick<Resource, 'title' | 'description' | 'folder' | 'courseIds' | 'archived' | 'ttl' | 'updatedAt'>>): Promise<void> {
  const exprs: string[] = [];
  const names: Record<string, string> = {};
  const vals: Record<string, any> = {};

  if (updates.title !== undefined) { exprs.push('#ti = :ti'); names['#ti'] = 'title'; vals[':ti'] = updates.title; }
  if (updates.description !== undefined) { exprs.push('#de = :de'); names['#de'] = 'description'; vals[':de'] = updates.description; }
  if (updates.folder !== undefined) { exprs.push('#fo = :fo'); names['#fo'] = 'folder'; vals[':fo'] = updates.folder; }
  if (updates.courseIds !== undefined) { exprs.push('#ci = :ci'); names['#ci'] = 'courseIds'; vals[':ci'] = updates.courseIds; }
  if (updates.archived !== undefined) { exprs.push('#ar = :ar'); names['#ar'] = 'archived'; vals[':ar'] = updates.archived; }
  if (updates.ttl !== undefined) { exprs.push('#tt = :tt'); names['#tt'] = 'ttl'; vals[':tt'] = updates.ttl; }
  if (updates.updatedAt !== undefined) { exprs.push('#ua = :ua'); names['#ua'] = 'updatedAt'; vals[':ua'] = updates.updatedAt; }

  if (!exprs.length) return;
  await ddb.send(new UpdateCommand({
    TableName: TABLES.RESOURCES,
    Key: { evaluatorId, resourceId },
    UpdateExpression: `SET ${exprs.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

// ─── Report Analysis (nightly AI pre-compute) ─────────────────────────────────

export interface ReportAnalysis {
  moduleId: string;
  keyTopics: { topic: string; count: number; sentiment: 'positive' | 'neutral' | 'negative' }[];
  reflectionSummary: string;
  weakQuizTopics: { questionText: string; errorRate: number }[];
  reflectionCount: number;
  analyzedAt: string;
}

export async function getReportAnalysis(moduleId: string): Promise<ReportAnalysis | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.REPORT_ANALYSIS,
    Key: { moduleId, sk: 'ANALYSIS' },
  }));
  return result.Item ? (result.Item as unknown as ReportAnalysis) : null;
}

export async function saveReportAnalysis(analysis: ReportAnalysis): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.REPORT_ANALYSIS,
    Item: { moduleId: analysis.moduleId, sk: 'ANALYSIS', ...analysis },
  }));
}

// ─── Curriculum Recommendations ───────────────────────────────────────────────

export interface CurriculumResource {
  id: string;
  weakTopic: string;
  title: string;
  type: 'article' | 'book' | 'video' | 'link';
  url: string;
  description: string;
  aiGenerated: boolean;
}

export async function getRecommendations(moduleId: string): Promise<CurriculumResource[]> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.RECOMMENDATIONS,
    Key: { moduleId, sk: 'RECS' },
  }));
  return (result.Item?.items ?? []) as CurriculumResource[];
}

export async function saveRecommendations(moduleId: string, items: CurriculumResource[]): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.RECOMMENDATIONS,
    Item: { moduleId, sk: 'RECS', items, updatedAt: new Date().toISOString() },
  }));
}

// ─── Student Presence (heartbeat / lastSeen) ──────────────────────────────────
// Stored in PROGRESS table using special key: userId = userId, sk = 'HEARTBEAT'

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
// Stored in PROGRESS table: userId = userId, sk = 'INACTIVITY_REMINDER'
// count: how many inactivity emails have been sent (0 = none yet)
// lastSent: ISO timestamp of the last sent email

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
    // Reset: delete the tracking record
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

// ─── Onboarding ───────────────────────────────────────────────────────────────
// Stored in PROGRESS table: userId = userId, sk = 'ONBOARDING#done'

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
// Stored in PROGRESS table: userId = userId, sk = 'SIGNATURE'

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

// ─── Certificate Templates ────────────────────────────────────────────────────

export interface CertTemplate {
  logoUrl?: string;
  watermarkText?: string;
  primaryColor?: string;
  secondaryColor?: string;
  footerText?: string;
  fields?: { studentName: boolean; courseTitle: boolean; issuedAt: boolean; };
}

const CERT_TEMPLATE_PK = 'TEMPLATE';
const CERT_TEMPLATE_SK = 'GLOBAL';

export async function getCertTemplate(): Promise<CertTemplate | null> {
  const res = await ddb.send(new GetCommand({
    TableName: TABLES.CERT_TEMPLATES,
    Key: { pk: CERT_TEMPLATE_PK, sk: CERT_TEMPLATE_SK },
  }));
  if (!res.Item) return null;
  const { pk, sk, ...rest } = res.Item;
  return rest as CertTemplate;
}

export async function saveCertTemplate(template: CertTemplate): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.CERT_TEMPLATES,
    Item: { pk: CERT_TEMPLATE_PK, sk: CERT_TEMPLATE_SK, ...template, updatedAt: new Date().toISOString() },
  }));
}

// ─── Activity / Session Tracking ─────────────────────────────────────────────
// Table: LuxActivity, PK: userId, SK: SESSION#${timestamp}

export async function startSession(userId: string, sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  // TTL: 90 days from now
  const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
  await ddb.send(new PutCommand({
    TableName: TABLES.ACTIVITY,
    Item: { userId, sk: `SESSION#${sessionId}`, sessionId, startedAt: now, durationSeconds: 0, ttl },
  }));
}

export async function updateSession(userId: string, sessionId: string, durationSeconds: number): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: TABLES.ACTIVITY,
    Key: { userId, sk: `SESSION#${sessionId}` },
    UpdateExpression: 'SET durationSeconds = :d, lastUpdatedAt = :ts',
    ExpressionAttributeValues: { ':d': durationSeconds, ':ts': new Date().toISOString() },
  })).catch(() => {});
}

export async function endSession(userId: string, sessionId: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: TABLES.ACTIVITY,
    Key: { userId, sk: `SESSION#${sessionId}` },
    UpdateExpression: 'SET endedAt = :ts',
    ExpressionAttributeValues: { ':ts': new Date().toISOString() },
  })).catch(() => {});
}

export async function getActivity(userId: string, days = 30): Promise<any[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.ACTIVITY,
    KeyConditionExpression: 'userId = :uid AND sk >= :since',
    ExpressionAttributeValues: { ':uid': userId, ':since': `SESSION#${since}` },
    ScanIndexForward: false,
  }));
  return result.Items ?? [];
}

// ─── User Language Preference ─────────────────────────────────────────────────
// Stored in PushSubscriptions table: userId = userId, sk = 'PREF_LANG'

export async function setUserLang(userId: string, lang: string): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.PUSH_SUBS,
    Item: { userId, sk: 'PREF_LANG', lang },
  }));
}

export async function getUserLang(userId: string): Promise<string> {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: TABLES.PUSH_SUBS,
      Key: { userId, sk: 'PREF_LANG' },
    }));
    const lang = result.Item?.lang as string | undefined;
    return lang === 'en' || lang === 'es' ? lang : 'es';
  } catch {
    return 'es';
  }
}

// ─── Calendar Events ──────────────────────────────────────────────────────────
// Table: LuxCalendarEvents, PK: creatorId, SK: eventId

export interface CalendarEvent {
  creatorId: string;
  eventId: string;
  title: string;
  description?: string;
  type: 'class' | 'meeting' | 'event' | 'deadline' | 'reminder' | 'other';
  startDate: string;   // ISO datetime
  endDate: string;     // ISO datetime
  allDay: boolean;
  visibility: 'private' | 'evaluators' | 'students' | 'community' | 'course_mine' | 'course_all';
  color?: string;
  location?: string;
  targetCourseId?: string;
  creatorName?: string;
  creatorRole?: string;
  createdAt: string;
  // Recurrence
  recurrence?: 'none' | 'weekly' | 'monthly' | 'weekdays' | 'custom_days';
  recurrenceDays?: number[];  // 0=Sun … 6=Sat, used with custom_days
  recurrenceEndDate?: string; // ISO date — last possible occurrence
  recurrenceGroupId?: string; // shared across all instances of a recurring series
  // Reminder tracking (set by lux-reminders after sending)
  reminder48hSent?: boolean;
  reminder2hSent?: boolean;
}

export async function createCalendarEvent(event: CalendarEvent): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.CALENDAR,
    Item: event,
  }));
}

export async function batchCreateCalendarEvents(events: CalendarEvent[]): Promise<void> {
  const CHUNK = 25;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [TABLES.CALENDAR]: chunk.map((ev) => ({ PutRequest: { Item: ev } })),
      },
    }));
  }
}

// Used by lux-reminders to find upcoming events needing reminder emails
export async function scanCalendarEventsInRange(fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  const items: CalendarEvent[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.CALENDAR,
      FilterExpression: 'startDate BETWEEN :from AND :to AND visibility <> :priv',
      ExpressionAttributeValues: { ':from': fromIso, ':to': toIso, ':priv': 'private' },
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    items.push(...((result.Items ?? []) as CalendarEvent[]));
    lastKey = result.LastEvaluatedKey as Record<string, any> | undefined;
  } while (lastKey);
  return items;
}

export async function getCalendarEventsByCreator(creatorId: string): Promise<CalendarEvent[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.CALENDAR,
    KeyConditionExpression: 'creatorId = :cid',
    ExpressionAttributeValues: { ':cid': creatorId },
  }));
  return (result.Items ?? []) as CalendarEvent[];
}

export async function getAllVisibleCalendarEvents(
  requestorId: string,
  requestorRole: string,
): Promise<CalendarEvent[]> {
  // Scan all events; filter by visibility + ownership
  const items: CalendarEvent[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.CALENDAR,
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    items.push(...((result.Items ?? []) as CalendarEvent[]));
    lastKey = result.LastEvaluatedKey as Record<string, any> | undefined;
  } while (lastKey);
  const isAdmin = requestorRole === 'ADMIN' || requestorRole === 'SUPER_ADMIN';
  return items.filter((ev) => {
    if (ev.creatorId === requestorId) return true;
    if (isAdmin) return true;
    if (ev.visibility === 'evaluators') return true;
    if (ev.visibility === 'students') return true;
    if (ev.visibility === 'community') return true;
    if (ev.visibility === 'course_mine') return true;   // evaluators see all course-scoped events
    if (ev.visibility === 'course_all') return true;
    return false;
  });
}

export async function updateCalendarEvent(creatorId: string, eventId: string, updates: Partial<Omit<CalendarEvent, 'creatorId' | 'eventId' | 'createdAt'>>): Promise<void> {
  const sets: string[] = [];
  const vals: Record<string, any> = {};
  const names: Record<string, string> = {};
  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined) continue;
    const alias = `#f_${key}`;
    const placeholder = `:v_${key}`;
    sets.push(`${alias} = ${placeholder}`);
    names[alias] = key;
    vals[placeholder] = val;
  }
  if (sets.length === 0) return;
  await ddb.send(new UpdateCommand({
    TableName: TABLES.CALENDAR,
    Key: { creatorId, eventId },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

export async function deleteCalendarEvent(creatorId: string, eventId: string): Promise<void> {
  await ddb.send(new DeleteCommand({
    TableName: TABLES.CALENDAR,
    Key: { creatorId, eventId },
  }));
}

export async function getCalendarEventById(creatorId: string, eventId: string): Promise<CalendarEvent | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.CALENDAR,
    Key: { creatorId, eventId },
  }));
  return (result.Item as CalendarEvent) ?? null;
}

// ─── Extended User Profiles ───────────────────────────────────────────────────
// Table: LuxUserProfiles, PK: userId — stores fields not available in Cognito

export interface UserProfileExtended {
  userId: string;
  phone?: string;
  bio?: string;
  university?: string;
  career?: string;
  semester?: string;
  title?: string;
  specialty?: string;
  experience?: string;
  socialLinks?: { platform: string; url: string }[];
  updatedAt?: string;
}

export async function getUserProfile(userId: string): Promise<UserProfileExtended | null> {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: TABLES.USER_PROFILES,
      Key: { userId },
    }));
    return (result.Item as UserProfileExtended) ?? null;
  } catch {
    return null;
  }
}

export async function saveUserProfile(userId: string, data: Omit<UserProfileExtended, 'userId'>): Promise<void> {
  const sets: string[] = [];
  const vals: Record<string, any> = {};
  const names: Record<string, string> = {};

  for (const [key, val] of Object.entries(data)) {
    if (val === undefined) continue;
    const alias = `#f_${key}`;
    const placeholder = `:v_${key}`;
    sets.push(`${alias} = ${placeholder}`);
    names[alias] = key;
    vals[placeholder] = val;
  }
  sets.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  vals[':updatedAt'] = new Date().toISOString();

  if (sets.length <= 1) return;
  await ddb.send(new UpdateCommand({
    TableName: TABLES.USER_PROFILES,
    Key: { userId },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}
