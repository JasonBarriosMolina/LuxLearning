// ─── rate-limit.ts ───────────────────────────────────────────────────────────
// Sliding-window rate limiter using LuxActivity DynamoDB table.
// Keyed by userId + action + time window — no extra table needed.
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';
import { getCurrentEnv } from './env-context';

/**
 * Increment a counter for (userId, action) in the current time window.
 * Returns true if the request is within the allowed limit, false if exceeded.
 * Fails open on DynamoDB error — never blocks a user due to infra failure.
 * Rate limiting is disabled in test and staging environments.
 */
export async function checkRateLimit(
  userId: string,
  action: string,
  maxPerWindow: number,
  windowSecs: number
): Promise<boolean> {
  // Disable rate limiting in non-production environments
  if (getCurrentEnv() !== 'prod') return true;
  const windowId = Math.floor(Date.now() / 1000 / windowSecs);
  const pk = `rl#${userId}#${action}#${windowId}`;
  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLES.ACTIVITY,
      Key: { userId: pk, sk: 'count' },
      UpdateExpression: 'ADD #n :one SET #ttl = if_not_exists(#ttl, :exp)',
      ExpressionAttributeNames: { '#n': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':one': 1,
        ':exp': Math.floor(Date.now() / 1000) + windowSecs + 60, // TTL: window + 1 min grace
      },
      ReturnValues: 'ALL_NEW',
    }));
    const count = (res.Attributes?.count as number) ?? 1;
    return count <= maxPerWindow;
  } catch {
    return true; // fail open — infra error must never block users
  }
}

export function tooManyRequests(): { statusCode: number; headers: Record<string, string>; body: string } {
  return {
    statusCode: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
    body: JSON.stringify({ error: 'Demasiadas solicitudes. Límite: 20 por hora.', statusCode: 429 }),
  };
}
