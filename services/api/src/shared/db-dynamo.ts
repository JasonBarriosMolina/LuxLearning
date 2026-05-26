import { createHash } from 'crypto';
import { createId } from '@paralleldrive/cuid2';
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
  REPORT_ANALYSIS: process.env.DYNAMO_TABLE_REPORT_ANALYSIS ?? 'ReportAnalysis',
  RECOMMENDATIONS: process.env.DYNAMO_TABLE_RECOMMENDATIONS ?? 'CurriculumRecommendations',
  ACTIVITY: process.env.DYNAMO_TABLE_ACTIVITY ?? 'LuxActivity',
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
  type: 'custom' | 'complete_module' | 'submit_reflection' | 'pass_quiz' | 'upload_link' | 'watch_video' | 'read_resource';
  resourceUrl?: string;
  submissionUrl?: string;
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

export async function updateTask(userId: string, sk: string, updates: Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'status' | 'completedAt' | 'submittedAt' | 'r5' | 'r3'>>): Promise<void> {
  const exprs: string[] = [];
  const names: Record<string, string> = {};
  const vals: Record<string, any> = {};

  if (updates.title !== undefined) { exprs.push('#t = :t'); names['#t'] = 'title'; vals[':t'] = updates.title; }
  if (updates.description !== undefined) { exprs.push('#d = :d'); names['#d'] = 'description'; vals[':d'] = updates.description; }
  if (updates.dueDate !== undefined) { exprs.push('#dd = :dd'); names['#dd'] = 'dueDate'; vals[':dd'] = updates.dueDate; }
  if (updates.status !== undefined) { exprs.push('#s = :s'); names['#s'] = 'status'; vals[':s'] = updates.status; }
  if (updates.completedAt !== undefined) { exprs.push('#ca = :ca'); names['#ca'] = 'completedAt'; vals[':ca'] = updates.completedAt; }
  if (updates.submittedAt !== undefined) { exprs.push('#sa = :sa'); names['#sa'] = 'submittedAt'; vals[':sa'] = updates.submittedAt; }
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
  const result = await ddb.send(new ScanCommand({
    TableName: TABLES.PROGRESS,
    FilterExpression: 'sk = :hb',
    ExpressionAttributeValues: { ':hb': 'HEARTBEAT' },
    ProjectionExpression: 'userId, lastSeen',
  }));
  return (result.Items ?? []).map((item) => ({
    userId: String(item['userId'] ?? ''),
    lastSeen: String(item['lastSeen'] ?? ''),
  })).filter((item) => item.userId && !item.userId.startsWith('_'));
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
