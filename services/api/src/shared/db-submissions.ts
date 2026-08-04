// ─── db-submissions.ts ───────────────────────────────────────────────────────
// Domain: Evidence Submissions + Interviews
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';

// ─── Evidence Submissions ─────────────────────────────────────────────────────

export interface Submission {
  userId: string;
  submissionId: string;
  courseId: string;
  moduleId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  s3Key: string;
  status: 'pending' | 'graded';
  grade?: number;
  feedback?: string;
  gradedBy?: string;
  gradedAt?: string;
  createdAt: string;
}

export async function createSubmission(sub: Submission): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.SUBMISSIONS,
    Item: sub,
  }));
}

export async function listMySubmissions(userId: string, moduleId: string): Promise<Submission[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.SUBMISSIONS,
    KeyConditionExpression: 'userId = :uid',
    FilterExpression: 'moduleId = :mid',
    ExpressionAttributeValues: { ':uid': userId, ':mid': moduleId },
    ScanIndexForward: false,
  }));
  return (result.Items ?? []) as Submission[];
}

export async function listSubmissionsForModule(moduleId: string): Promise<Submission[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.SUBMISSIONS,
    IndexName: 'moduleId-index',
    KeyConditionExpression: 'moduleId = :mid',
    ExpressionAttributeValues: { ':mid': moduleId },
    ScanIndexForward: false,
  }));
  return (result.Items ?? []) as Submission[];
}

export async function updateSubmissionGrade(
  userId: string,
  submissionId: string,
  grade: number,
  feedback: string,
  gradedBy: string,
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: TABLES.SUBMISSIONS,
    Key: { userId, submissionId },
    UpdateExpression: 'SET #st = :st, grade = :gr, feedback = :fb, gradedBy = :gb, gradedAt = :ga',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: {
      ':st': 'graded',
      ':gr': grade,
      ':fb': feedback,
      ':gb': gradedBy,
      ':ga': new Date().toISOString(),
    },
  }));
}

// ─── Interviews (Vapi) ────────────────────────────────────────────────────────

export interface Interview {
  userId: string;
  interviewId: string;
  courseId: string;
  moduleId: string;
  vapiCallId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  transcript?: string;
  messages?: any[];
  aiAnalysis?: string;
  aiScore?: number;
  grade?: number;
  feedback?: string;
  gradedBy?: string;
  gradedAt?: string;
  durationSeconds?: number;
  questionsAsked?: number;
  createdAt: string;
  completedAt?: string;
}

export async function createInterview(item: Interview): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLES.INTERVIEWS, Item: item }));
}

export async function getInterview(userId: string, interviewId: string): Promise<Interview | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.INTERVIEWS,
    Key: { userId, interviewId },
  }));
  return (result.Item as Interview) ?? null;
}

export async function getInterviewByCallId(vapiCallId: string): Promise<Interview | null> {
  // NOTE: No Limit here — DDB Scan's Limit caps items READ before filtering,
  // not items returned. Limit:1 would miss the record if it isn't the first
  // item scanned.
  const result = await ddb.send(new ScanCommand({
    TableName: TABLES.INTERVIEWS,
    FilterExpression: 'vapiCallId = :cid',
    ExpressionAttributeValues: { ':cid': vapiCallId },
  }));
  return ((result.Items ?? [])[0] as Interview) ?? null;
}

export async function updateInterview(
  userId: string,
  interviewId: string,
  patch: Partial<Interview>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => k !== 'userId' && k !== 'interviewId');
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
    TableName: TABLES.INTERVIEWS,
    Key: { userId, interviewId },
    UpdateExpression: `SET ${parts.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

export async function listMyInterviews(userId: string, moduleId: string): Promise<Interview[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.INTERVIEWS,
    KeyConditionExpression: 'userId = :uid',
    FilterExpression: 'moduleId = :mid',
    ExpressionAttributeValues: { ':uid': userId, ':mid': moduleId },
    ScanIndexForward: false,
  }));
  return (result.Items ?? []) as Interview[];
}

export async function listInterviewsForModule(moduleId: string): Promise<Interview[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.INTERVIEWS,
    IndexName: 'moduleId-index',
    KeyConditionExpression: 'moduleId = :mid',
    ExpressionAttributeValues: { ':mid': moduleId },
    ScanIndexForward: false,
  }));
  return (result.Items ?? []) as Interview[];
}

export async function updateInterviewGrade(
  userId: string,
  interviewId: string,
  grade: number,
  feedback: string,
  gradedBy: string,
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: TABLES.INTERVIEWS,
    Key: { userId, interviewId },
    UpdateExpression: 'SET grade = :gr, feedback = :fb, gradedBy = :gb, gradedAt = :ga',
    ExpressionAttributeValues: {
      ':gr': grade,
      ':fb': feedback,
      ':gb': gradedBy,
      ':ga': new Date().toISOString(),
    },
  }));
}
