// ─── db-reflections.ts ───────────────────────────────────────────────────────
// Domain: Reflections table
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { Reflection } from '@lux/types';
import { ddb, TABLES } from './db-core';

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
    ScanIndexForward: false,
  }));
  return (result.Items ?? []) as unknown as Reflection[];
}

export async function getAllReflections(): Promise<Reflection[]> {
  const items: Reflection[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.REFLECTIONS,
      ExclusiveStartKey: lastKey,
      // Exclude 'text' (reflection body, 1000+ words) from list scan — only load on individual fetch
      ProjectionExpression: 'userId, moduleId, #s, evaluatorId, submittedAt, deadline, aiSuspect, wordCount, studentEmail, moduleTitle, courseTitle, analyzedAt, reviewedAt, aiResult, qualityScore, reconsiderationReason',
      ExpressionAttributeNames: { '#s': 'status' },
    }));
    (result.Items ?? []).forEach((item) => items.push(item as unknown as Reflection));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
}
