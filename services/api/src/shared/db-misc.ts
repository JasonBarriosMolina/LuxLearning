// ─── db-misc.ts ──────────────────────────────────────────────────────────────
// Domain: Report Analysis, Curriculum Recommendations, Cert Templates,
//         Extended User Profiles, Activity/Sessions
import { PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';

// ─── Report Analysis ──────────────────────────────────────────────────────────

export interface ReportAnalysis {
  moduleId: string;
  keyTopics: { topic: string; count: number; sentiment: 'positive' | 'neutral' | 'negative' }[];
  reflectionSummary: string;
  weakQuizTopics: { questionText: string; errorRate: number }[];
  reflectionCount: number;
  analyzedAt: string;
}

export async function getReportAnalysis(moduleId: string): Promise<ReportAnalysis | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.REPORT_ANALYSIS,
    Key: { moduleId, sk: 'ANALYSIS' },
  }));
  return result.Item ? (result.Item as unknown as ReportAnalysis) : null;
}

export async function saveReportAnalysis(analysis: ReportAnalysis): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.REPORT_ANALYSIS,
    Item: { moduleId: analysis.moduleId, sk: 'ANALYSIS', ...analysis },
  }));
}

// ─── Curriculum Recommendations ───────────────────────────────────────────────

export interface CurriculumResource {
  id: string;
  weakTopic: string;
  title: string;
  type: 'article' | 'book' | 'video' | 'link';
  url: string;
  description: string;
  aiGenerated: boolean;
}

export async function getRecommendations(moduleId: string): Promise<CurriculumResource[]> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.RECOMMENDATIONS,
    Key: { moduleId, sk: 'RECS' },
  }));
  return (result.Item?.items ?? []) as CurriculumResource[];
}

export async function saveRecommendations(moduleId: string, items: CurriculumResource[]): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.RECOMMENDATIONS,
    Item: { moduleId, sk: 'RECS', items, updatedAt: new Date().toISOString() },
  }));
}

// ─── Certificate Templates ────────────────────────────────────────────────────

export interface CertTemplate {
  logoUrl?: string;
  watermarkText?: string;
  primaryColor?: string;
  secondaryColor?: string;
  footerText?: string;
  fields?: { studentName: boolean; courseTitle: boolean; issuedAt: boolean; };
}

const CERT_TEMPLATE_PK = 'TEMPLATE';
const CERT_TEMPLATE_SK = 'GLOBAL';

export async function getCertTemplate(): Promise<CertTemplate | null> {
  const res = await ddb.send(new GetCommand({
    TableName: TABLES.CERT_TEMPLATES,
    Key: { pk: CERT_TEMPLATE_PK, sk: CERT_TEMPLATE_SK },
  }));
  if (!res.Item) return null;
  const { pk, sk, ...rest } = res.Item;
  return rest as CertTemplate;
}

export async function saveCertTemplate(template: CertTemplate): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.CERT_TEMPLATES,
    Item: { pk: CERT_TEMPLATE_PK, sk: CERT_TEMPLATE_SK, ...template, updatedAt: new Date().toISOString() },
  }));
}

// ─── Extended User Profiles ───────────────────────────────────────────────────

export interface UserProfileExtended {
  userId: string;
  phone?: string;
  bio?: string;
  university?: string;
  career?: string;
  semester?: string;
  title?: string;
  specialty?: string;
  experience?: string;
  socialLinks?: { platform: string; url: string }[];
  updatedAt?: string;
}

export async function getUserProfile(userId: string): Promise<UserProfileExtended | null> {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: TABLES.USER_PROFILES,
      Key: { userId },
    }));
    return (result.Item as UserProfileExtended) ?? null;
  } catch {
    return null;
  }
}

export async function saveUserProfile(userId: string, data: Omit<UserProfileExtended, 'userId'>): Promise<void> {
  const sets: string[] = [];
  const vals: Record<string, any> = {};
  const names: Record<string, string> = {};

  for (const [key, val] of Object.entries(data)) {
    if (val === undefined) continue;
    const alias = `#f_${key}`;
    const placeholder = `:v_${key}`;
    sets.push(`${alias} = ${placeholder}`);
    names[alias] = key;
    vals[placeholder] = val;
  }
  sets.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  vals[':updatedAt'] = new Date().toISOString();

  if (sets.length <= 1) return;
  await ddb.send(new UpdateCommand({
    TableName: TABLES.USER_PROFILES,
    Key: { userId },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

// ─── Activity / Session Tracking ─────────────────────────────────────────────

export async function startSession(userId: string, sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
  await ddb.send(new PutCommand({
    TableName: TABLES.ACTIVITY,
    Item: { userId, sk: `SESSION#${sessionId}`, sessionId, startedAt: now, durationSeconds: 0, ttl },
  }));
}

export async function updateSession(userId: string, sessionId: string, durationSeconds: number): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: TABLES.ACTIVITY,
    Key: { userId, sk: `SESSION#${sessionId}` },
    UpdateExpression: 'SET durationSeconds = :d, lastUpdatedAt = :ts',
    ExpressionAttributeValues: { ':d': durationSeconds, ':ts': new Date().toISOString() },
  })).catch(() => {});
}

export async function endSession(userId: string, sessionId: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: TABLES.ACTIVITY,
    Key: { userId, sk: `SESSION#${sessionId}` },
    UpdateExpression: 'SET endedAt = :ts',
    ExpressionAttributeValues: { ':ts': new Date().toISOString() },
  })).catch(() => {});
}

export async function getActivity(userId: string, days = 30): Promise<any[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.ACTIVITY,
    KeyConditionExpression: 'userId = :uid AND sk >= :since',
    ExpressionAttributeValues: { ':uid': userId, ':since': `SESSION#${since}` },
    ScanIndexForward: false,
  }));
  return result.Items ?? [];
}
