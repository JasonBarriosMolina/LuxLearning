// ─── db-attendance.ts ────────────────────────────────────────────────────────
// Domain: Attendance + Risk Scores (LuxAttendance table)
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'LATE_JUSTIFIED' | 'JUSTIFICATION_PENDING' | 'JUSTIFIED' | 'REJECTED';

export interface AttendanceRecord {
  courseId: string;
  sk: string;
  userId: string;
  sessionId: string;
  sessionDate: string;
  status: AttendanceStatus;
  observations?: string;
  justificationDeadline?: string;
  documentKey?: string;
  aiOcrData?: {
    extractedName?: string;
    extractedDate?: string;
    hasMedicalStamp?: boolean;
    issuer?: string;
    aiConfidenceScore?: number;
    aiRecommendation?: 'VALID_MATCH' | 'NEEDS_REVIEW' | 'REJECTED_AUTO';
    reasoning?: string;
  };
  evaluatorFeedback?: string;
  overriddenBy?: string;
  overrideReason?: string;
  createdAt: string;
  updatedAt: string;
}

export async function recordAttendance(record: AttendanceRecord): Promise<void> {
  const sk = `${record.userId}#${record.sessionId}`;
  const gsiSk = `${record.sessionId}#${record.courseId}`;
  await ddb.send(new PutCommand({
    TableName: TABLES.ATTENDANCE,
    Item: { ...record, sk, gsiSk },
  }));
}

// FIX #7: SK is userId#sessionId, NOT sessionId#userId — old begins_with(sk, sessionId+'#') always returned [].
// Use the gsiSk GSI where gsiSk = sessionId#courseId.
export async function getAttendanceForSession(courseId: string, sessionId: string): Promise<AttendanceRecord[]> {
  let items: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLES.ATTENDANCE,
      IndexName: 'gsiSk-index',
      KeyConditionExpression: 'gsiSk = :sk',
      ExpressionAttributeValues: { ':sk': `${sessionId}#${courseId}` },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items as AttendanceRecord[];
}

// FIX #4: DynamoDB returns max 1 MB per call — paginate to avoid silent truncation
export async function getAttendanceMatrix(courseId: string): Promise<AttendanceRecord[]> {
  const params = {
    TableName: TABLES.ATTENDANCE,
    KeyConditionExpression: 'courseId = :cid',
    ExpressionAttributeValues: { ':cid': courseId },
  };
  let items: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey: lastKey }));
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items as AttendanceRecord[];
}

export async function getMyAttendance(userId: string, courseId?: string): Promise<AttendanceRecord[]> {
  const params: any = {
    TableName: TABLES.ATTENDANCE,
    IndexName: 'StudentAttendanceIndex',
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
    ScanIndexForward: false,
  };
  if (courseId) {
    params.FilterExpression = 'courseId = :cid';
    params.ExpressionAttributeValues[':cid'] = courseId;
  }
  // FIX #4 + #14: Paginate to avoid 1 MB truncation.
  // TODO: Add courseId to GSI sort key to avoid full-user scan when filtering by courseId.
  let items: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey: lastKey }));
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items as AttendanceRecord[];
}

export async function updateAttendanceRecord(
  courseId: string,
  sk: string,
  updates: Partial<AttendanceRecord>,
): Promise<void> {
  const sets: string[] = [];
  const vals: Record<string, any> = {};
  const names: Record<string, string> = {};
  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined || key === 'courseId' || key === 'sk') continue;
    const alias = `#f_${key}`;
    const placeholder = `:v_${key}`;
    sets.push(`${alias} = ${placeholder}`);
    names[alias] = key;
    vals[placeholder] = val;
  }
  sets.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  vals[':updatedAt'] = new Date().toISOString();
  // FIX #20: Warn instead of silently returning when caller passes no fields
  if (sets.length <= 1) {
    console.warn('[updateAttendanceRecord] No fields to update — skipping');
    return;
  }
  await ddb.send(new UpdateCommand({
    TableName: TABLES.ATTENDANCE,
    Key: { courseId, sk },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

// FIX #4: Paginate both the per-course query and the global scan
export async function getPendingJustifications(courseId?: string): Promise<AttendanceRecord[]> {
  let items: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;
  if (courseId) {
    const params = {
      TableName: TABLES.ATTENDANCE,
      KeyConditionExpression: 'courseId = :cid',
      FilterExpression: '#st = :s',
      ExpressionAttributeValues: { ':cid': courseId, ':s': 'JUSTIFICATION_PENDING' },
      ExpressionAttributeNames: { '#st': 'status' },
    };
    do {
      const result = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey: lastKey }));
      items.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
  } else {
    const params = {
      TableName: TABLES.ATTENDANCE,
      FilterExpression: '#st = :s',
      ExpressionAttributeValues: { ':s': 'JUSTIFICATION_PENDING' },
      ExpressionAttributeNames: { '#st': 'status' },
    };
    do {
      const result = await ddb.send(new ScanCommand({ ...params, ExclusiveStartKey: lastKey }));
      items.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
  }
  return items as AttendanceRecord[];
}

export interface RiskScore {
  userId: string;
  name: string;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH';
  riskScore: number;
  absenceRate: number;
  reason: string;
  suggestedAction: string;
}

export async function saveRiskScores(courseId: string, scores: RiskScore[], cohortInsight: string): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.ATTENDANCE,
    Item: {
      courseId,
      sk: 'RISK_SCORES',
      scores,
      cohortInsight,
      generatedAt: new Date().toISOString(),
    },
  }));
}

export async function getRiskScores(courseId: string): Promise<{ scores: RiskScore[]; cohortInsight: string; generatedAt: string } | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.ATTENDANCE,
    Key: { courseId, sk: 'RISK_SCORES' },
  }));
  return result.Item ? (result.Item as any) : null;
}
