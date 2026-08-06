// ─── db-classes.ts ────────────────────────────────────────────────────────────
// Domain: Lux Mentor Class Sessions (DDB LuxClasses)
// PK: userId  SK: sessionId
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';

export interface ClassSession {
  userId: string;
  sessionId: string;
  courseId: string;
  moduleId: string;
  evaluationEventId?: string;
  vapiCallId?: string;
  /** pending → content_viewed → qa_started → completed | error */
  status: 'pending' | 'content_viewed' | 'qa_started' | 'completed' | 'error';
  transcript?: string;
  messages?: any[];
  aiAnalysis?: string;
  aiScore?: number;
  grade?: number;
  feedback?: string;
  gradedBy?: string;
  gradedAt?: string;
  durationSeconds?: number;
  /** true when Vapi ended early due to network failure — attempt is NOT consumed */
  voided?: boolean;
  voidedReason?: string;
  createdAt: string;
  completedAt?: string;
}

export async function createClassSession(item: ClassSession): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLES.CLASSES, Item: item }));
}

export async function getClassSession(userId: string, sessionId: string): Promise<ClassSession | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.CLASSES,
    Key: { userId, sessionId },
  }));
  return (result.Item as ClassSession) ?? null;
}

export async function getClassSessionByCallId(vapiCallId: string): Promise<ClassSession | null> {
  // No Limit — DDB Limit caps items READ before filtering, not items returned.
  const result = await ddb.send(new ScanCommand({
    TableName: TABLES.CLASSES,
    FilterExpression: 'vapiCallId = :cid',
    ExpressionAttributeValues: { ':cid': vapiCallId },
  }));
  return ((result.Items ?? [])[0] as ClassSession) ?? null;
}

export async function updateClassSession(
  userId: string,
  sessionId: string,
  patch: Partial<ClassSession>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => k !== 'userId' && k !== 'sessionId');
  if (!entries.length) return;
  const names: Record<string, string> = {};
  const vals: Record<string, any> = {};
  const parts: string[] = [];
  entries.forEach(([k, v], i) => {
    names[`#f${i}`] = k;
    vals[`:v${i}`] = v;
    parts.push(`#f${i} = :v${i}`);
  });
  await ddb.send(new UpdateCommand({
    TableName: TABLES.CLASSES,
    Key: { userId, sessionId },
    UpdateExpression: `SET ${parts.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

export async function listMyClassSessions(userId: string, moduleId: string): Promise<ClassSession[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.CLASSES,
    KeyConditionExpression: 'userId = :uid',
    FilterExpression: 'moduleId = :mid',
    ExpressionAttributeValues: { ':uid': userId, ':mid': moduleId },
    ScanIndexForward: false,
  }));
  return (result.Items ?? []) as ClassSession[];
}

export async function listClassSessionsForModule(moduleId: string): Promise<ClassSession[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.CLASSES,
    IndexName: 'moduleId-index',
    KeyConditionExpression: 'moduleId = :mid',
    ExpressionAttributeValues: { ':mid': moduleId },
    ScanIndexForward: false,
  }));
  return (result.Items ?? []) as ClassSession[];
}

export async function updateClassSessionGrade(
  userId: string,
  sessionId: string,
  grade: number,
  feedback: string,
  gradedBy: string,
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: TABLES.CLASSES,
    Key: { userId, sessionId },
    UpdateExpression: 'SET grade = :gr, feedback = :fb, gradedBy = :gb, gradedAt = :ga',
    ExpressionAttributeValues: {
      ':gr': grade,
      ':fb': feedback,
      ':gb': gradedBy,
      ':ga': new Date().toISOString(),
    },
  }));
}
