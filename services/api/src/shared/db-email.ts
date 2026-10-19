// ─── db-email.ts ─────────────────────────────────────────────────────────────
// Domain: Sent Emails (admin outbound via SES)
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';

export interface SentEmail {
  sentBy: string;
  emailId: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  courseId?: string;
  sentAt: string;
  status: 'sent' | 'failed';
  recipientCount: number;
}

export async function saveEmail(email: SentEmail): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLES.SENT_EMAILS, Item: email }));
}

export async function listSentEmails(sentBy: string, limit = 50): Promise<SentEmail[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.SENT_EMAILS,
    KeyConditionExpression: 'sentBy = :sb',
    ExpressionAttributeValues: { ':sb': sentBy },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (result.Items ?? []) as SentEmail[];
}
