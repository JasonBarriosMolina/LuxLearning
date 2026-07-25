// ─── db-notifications.ts ─────────────────────────────────────────────────────
// Domain: Notifications + Push Subscriptions + User Language Preference
import { createHash } from 'crypto';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { Notification } from '@lux/types';
import { ddb, TABLES } from './db-core';

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

// ─── Push Subscriptions ───────────────────────────────────────────────────────

export interface PushSubscriptionRecord {
  userId: string;
  endpoint: string;
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
