// ─── audit.ts ─────────────────────────────────────────────────────────────────
// Lightweight audit log using LuxActivity DynamoDB table.
// Keys: userId=AUDIT#actorId, sk=ISO#randomId for chronological sort.
// TTL: 90 days. Non-fatal — audit failure never blocks the main action.
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';

export type AuditAction =
  | 'REFLECTION_APPROVED'
  | 'REFLECTION_REJECTED'
  | 'REFLECTION_RECONSIDERED'
  | 'COURSE_CREATED'
  | 'COURSE_DELETED'
  | 'MODULE_DELETED'
  | 'STUDENT_ENROLLED'
  | 'STUDENT_UNENROLLED'
  | 'CERT_TEMPLATE_UPDATED'
  | 'USER_ROLE_CHANGED';

export interface AuditEntry {
  actorId: string;       // who performed the action
  action: AuditAction;
  targetId?: string;     // e.g. studentId, courseId, certId
  targetType?: string;   // e.g. 'reflection', 'course', 'user'
  metadata?: Record<string, unknown>;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  const now = new Date().toISOString();
  const sk = `${now}#${Math.random().toString(36).slice(2, 8)}`;
  try {
    await ddb.send(new PutCommand({
      TableName: TABLES.ACTIVITY,
      Item: {
        userId: `AUDIT#${entry.actorId}`,
        sk,
        action: entry.action,
        actorId: entry.actorId,
        targetId: entry.targetId ?? null,
        targetType: entry.targetType ?? null,
        metadata: entry.metadata ?? {},
        createdAt: now,
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days
      },
    }));
  } catch (e) {
    // Non-fatal — log to CloudWatch but never throw
    console.warn('[Audit] Failed to write audit log:', e);
  }
}
