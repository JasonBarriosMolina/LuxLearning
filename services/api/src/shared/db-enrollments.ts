// ─── db-enrollments.ts ───────────────────────────────────────────────────────
// Domain: Enrollments + Certificates tables
import { PutCommand, GetCommand, QueryCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { Certificate } from '@lux/types';
import { ddb, TABLES } from './db-core';

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
