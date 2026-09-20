// Gamification helpers — XP tracking for lesson challenges.
// Table LuxGamification: PK=userId, SK=TOTAL (aggregate) | CHALLENGE#id (per-answer).
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core.js';

export interface GamificationTotal { totalXp: number; challengesCompleted: number }

export async function getGamificationTotal(userId: string): Promise<GamificationTotal> {
  const res = await ddb.send(new GetCommand({ TableName: TABLES.GAMIFICATION, Key: { userId, sk: 'TOTAL' } }));
  const item = res.Item;
  return { totalXp: item?.totalXp ?? 0, challengesCompleted: item?.challengesCompleted ?? 0 };
}

// Returns xpEarned (0 if already answered or isCorrect=false).
export async function recordChallengeAnswer(
  userId: string, challengeId: string, lessonId: string, moduleId: string,
  isCorrect: boolean, xpReward: number,
): Promise<{ xpEarned: number; totalXp: number }> {
  if (!isCorrect) {
    const total = await getGamificationTotal(userId);
    return { xpEarned: 0, totalXp: total.totalXp };
  }

  const sk = `CHALLENGE#${challengeId}`;
  const existing = await ddb.send(new GetCommand({ TableName: TABLES.GAMIFICATION, Key: { userId, sk } }));
  if (existing.Item) {
    const total = await getGamificationTotal(userId);
    return { xpEarned: 0, totalXp: total.totalXp };
  }

  await ddb.send(new PutCommand({
    TableName: TABLES.GAMIFICATION,
    Item: { userId, sk, challengeId, lessonId, moduleId, xpEarned: xpReward, earnedAt: new Date().toISOString() },
    ConditionExpression: 'attribute_not_exists(sk)',
  }).catch(() => null as any));

  const res = await ddb.send(new UpdateCommand({
    TableName: TABLES.GAMIFICATION,
    Key: { userId, sk: 'TOTAL' },
    UpdateExpression: 'SET totalXp = if_not_exists(totalXp, :z) + :xp, challengesCompleted = if_not_exists(challengesCompleted, :z) + :one',
    ExpressionAttributeValues: { ':xp': xpReward, ':one': 1, ':z': 0 },
    ReturnValues: 'ALL_NEW',
  }));
  return { xpEarned: xpReward, totalXp: res.Attributes?.totalXp ?? xpReward };
}
