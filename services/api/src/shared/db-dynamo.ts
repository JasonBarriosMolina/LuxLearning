import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { LessonProgress, QuizAttempt, Reflection, Notification } from '@lux/types';

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
  updates: Partial<Pick<Reflection, 'status' | 'aiResult' | 'evaluatorFeedback' | 'reviewedAt'>>
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

  await ddb.send(new UpdateCommand({
    TableName: TABLES.REFLECTIONS,
    Key: { userId, sk: moduleId },
    UpdateExpression: `SET ${expressions.join(', ')}`,
    ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
    ExpressionAttributeValues: values,
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

export async function isModuleUnlocked(userId: string, moduleOrder: number, allModuleIds: string[]): Promise<boolean> {
  if (moduleOrder === 1) return true;
  const prevModuleId = allModuleIds[moduleOrder - 2]; // order is 1-based
  const reflection = await getReflection(userId, prevModuleId);
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
