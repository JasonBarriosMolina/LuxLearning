// ─── db-study-plans.ts ───────────────────────────────────────────────────────
// Domain: Weekly Study Plans (LuxStudyPlans table)
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';

export interface PlanItem {
  id: string;
  type: 'lesson' | 'quiz' | 'reflection' | 'review' | 'custom';
  title: string;
  description?: string;
  courseId?: string;
  moduleId?: string;
  lessonId?: string;
  pinned: boolean;
  completed: boolean;
  estimatedMinutes?: number;
  source: 'auto' | 'evaluator' | 'student';
}

export interface DayPlan {
  dayIndex: number; // 0=Mon … 6=Sun
  date: string;     // ISO date
  items: PlanItem[];
}

export interface BedrockSuggestion {
  title: string;
  type: 'article' | 'video' | 'exercise' | 'book' | 'strategy';
  description: string;
  moduleId?: string;
  url?: string;
}

export interface StudyPlan {
  userId: string;
  weekOf: string;          // ISO Monday date e.g. "2026-08-04"
  planId: string;
  days: DayPlan[];
  lockedBy?: string;       // evaluator/admin userId
  lockedByName?: string;
  changeRequested?: boolean;
  changeRequestNote?: string;
  bedrockSuggestions?: BedrockSuggestion[];
  suggestionsStatus?: 'processing' | 'done' | 'error';
  generatedBy: 'auto' | 'evaluator' | 'student';
  createdAt: string;
  updatedAt: string;
}

/** ISO date of the Monday for any given date */
export function getMonday(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function getStudyPlan(userId: string, weekOf: string): Promise<StudyPlan | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.STUDY_PLANS,
    Key: { userId, weekOf },
  }));
  return (result.Item as StudyPlan) ?? null;
}

export async function saveStudyPlan(plan: StudyPlan): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.STUDY_PLANS,
    Item: plan,
  }));
}

/** Returns last `limit` weeks, newest first */
export async function getStudyPlans(userId: string, limit = 4): Promise<StudyPlan[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.STUDY_PLANS,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (result.Items ?? []) as StudyPlan[];
}

/** Remove specific top-level attributes from a plan (use for clearing optional fields) */
export async function removeStudyPlanAttributes(userId: string, weekOf: string, attrs: string[]): Promise<void> {
  if (attrs.length === 0) return;
  const removeExpr = attrs.map((a) => `#rm_${a}`).join(', ');
  const names: Record<string, string> = {};
  attrs.forEach((a) => { names[`#rm_${a}`] = a; });
  await ddb.send(new UpdateCommand({
    TableName: TABLES.STUDY_PLANS,
    Key: { userId, weekOf },
    UpdateExpression: `REMOVE ${removeExpr}`,
    ExpressionAttributeNames: names,
  }));
}

export async function updateStudyPlanField(
  userId: string,
  weekOf: string,
  updates: Partial<Omit<StudyPlan, 'userId' | 'weekOf'>>,
): Promise<void> {
  const sets: string[] = [];
  const vals: Record<string, any> = {};
  const names: Record<string, string> = {};
  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined) continue;
    sets.push(`#f_${key} = :v_${key}`);
    names[`#f_${key}`] = key;
    vals[`:v_${key}`] = val;
  }
  if (sets.length === 0) return;
  await ddb.send(new UpdateCommand({
    TableName: TABLES.STUDY_PLANS,
    Key: { userId, weekOf },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}
