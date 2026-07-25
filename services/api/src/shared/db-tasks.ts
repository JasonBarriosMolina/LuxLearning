// ─── db-tasks.ts ─────────────────────────────────────────────────────────────
// Domain: Scheduled Tasks + LuxResources
import { PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';

// ─── Scheduled Tasks ──────────────────────────────────────────────────────────

export type TaskType =
  | 'custom' | 'complete_module' | 'submit_reflection' | 'pass_quiz'
  | 'upload_link' | 'watch_video' | 'read_resource'
  | 'report' | 'theoretical' | 'practical'
  | 'project_progress' | 'project_final'
  | 'portfolio' | 'presentation' | 'peer_review';

/** Task types that require a file upload from the student */
export const FILE_UPLOAD_TASK_TYPES: TaskType[] = [
  'report', 'practical', 'project_progress', 'project_final', 'portfolio', 'presentation',
];

export interface Task {
  userId: string;
  sk: string;           // dueDate#taskId
  taskId: string;
  title: string;
  description?: string;
  courseId?: string;
  moduleId?: string;
  courseTitle?: string;
  moduleTitle?: string;
  type: TaskType;
  resourceUrl?: string;
  submissionUrl?: string;
  submissionText?: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  dueDate: string;
  status: 'PENDING' | 'COMPLETED' | 'OVERDUE' | 'SUBMITTED';
  assignedBy: string;
  createdAt: string;
  completedAt?: string;
  submittedAt?: string;
  r5?: string;
  r3?: string;
}

export async function createTask(task: Omit<Task, 'sk'>): Promise<Task> {
  const sk = `${task.dueDate}#${task.taskId}`;
  const item: Task = { ...task, sk };
  await ddb.send(new PutCommand({ TableName: TABLES.TASKS, Item: item }));
  return item;
}

export async function getTasksForUser(userId: string): Promise<Task[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.TASKS,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
  }));
  return (result.Items ?? []) as Task[];
}

export async function getTasksByCourse(courseId: string): Promise<Task[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.TASKS,
    IndexName: 'courseId-index',
    KeyConditionExpression: 'courseId = :cid',
    ExpressionAttributeValues: { ':cid': courseId },
  }));
  return (result.Items ?? []) as Task[];
}

export async function updateTask(userId: string, sk: string, updates: Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'status' | 'completedAt' | 'submittedAt' | 'submissionText' | 'fileUrl' | 'fileName' | 'fileType' | 'r5' | 'r3'>>): Promise<void> {
  const exprs: string[] = [];
  const names: Record<string, string> = {};
  const vals: Record<string, any> = {};

  if (updates.title !== undefined) { exprs.push('#t = :t'); names['#t'] = 'title'; vals[':t'] = updates.title; }
  if (updates.description !== undefined) { exprs.push('#d = :d'); names['#d'] = 'description'; vals[':d'] = updates.description; }
  if (updates.dueDate !== undefined) { exprs.push('#dd = :dd'); names['#dd'] = 'dueDate'; vals[':dd'] = updates.dueDate; }
  if (updates.status !== undefined) { exprs.push('#s = :s'); names['#s'] = 'status'; vals[':s'] = updates.status; }
  if (updates.completedAt !== undefined) { exprs.push('#ca = :ca'); names['#ca'] = 'completedAt'; vals[':ca'] = updates.completedAt; }
  if (updates.submittedAt !== undefined) { exprs.push('#sa = :sa'); names['#sa'] = 'submittedAt'; vals[':sa'] = updates.submittedAt; }
  if (updates.submissionText !== undefined) { exprs.push('#st = :st'); names['#st'] = 'submissionText'; vals[':st'] = updates.submissionText; }
  if (updates.fileUrl !== undefined) { exprs.push('#fu = :fu'); names['#fu'] = 'fileUrl'; vals[':fu'] = updates.fileUrl; }
  if (updates.fileName !== undefined) { exprs.push('#fn = :fn'); names['#fn'] = 'fileName'; vals[':fn'] = updates.fileName; }
  if (updates.fileType !== undefined) { exprs.push('#ft = :ft'); names['#ft'] = 'fileType'; vals[':ft'] = updates.fileType; }
  if (updates.r5 !== undefined) { exprs.push('#r5 = :r5'); names['#r5'] = 'r5'; vals[':r5'] = updates.r5; }
  if (updates.r3 !== undefined) { exprs.push('#r3 = :r3'); names['#r3'] = 'r3'; vals[':r3'] = updates.r3; }

  if (!exprs.length) return;

  await ddb.send(new UpdateCommand({
    TableName: TABLES.TASKS,
    Key: { userId, sk },
    UpdateExpression: `SET ${exprs.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

export async function autoCompleteTasks(userId: string, triggerType: TaskType, refId: string): Promise<void> {
  try {
    const tasks = await getTasksForUser(userId);
    const now = new Date().toISOString();
    await Promise.all(
      tasks
        .filter((t) => t.status === 'PENDING' && t.type === triggerType && (t.moduleId === refId || t.courseId === refId))
        .map((t) => updateTask(userId, t.sk, { status: 'COMPLETED', completedAt: now }))
    );
  } catch (err) {
    console.warn('[autoCompleteTasks] Non-fatal error:', err);
  }
}

export async function getAllPendingTasks(): Promise<Task[]> {
  const result = await ddb.send(new ScanCommand({
    TableName: TABLES.TASKS,
    FilterExpression: '#s IN (:pending, :submitted)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':pending': 'PENDING', ':submitted': 'SUBMITTED' },
  }));
  return (result.Items ?? []) as Task[];
}

export async function deleteTask(userId: string, sk: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLES.TASKS, Key: { userId, sk } }));
}

// ─── LuxResources ─────────────────────────────────────────────────────────────

export interface Resource {
  evaluatorId: string;
  resourceId: string;
  title: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  folder?: string;
  courseIds: string[];
  archived: boolean;
  ttl?: number;
  createdAt: string;
  updatedAt: string;
}

export async function getResourcesByEvaluator(evaluatorId: string): Promise<Resource[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.RESOURCES,
    KeyConditionExpression: 'evaluatorId = :eid',
    ExpressionAttributeValues: { ':eid': evaluatorId },
  }));
  return (result.Items ?? []) as Resource[];
}

export async function getResourcesByCourse(courseId: string): Promise<Resource[]> {
  const result = await ddb.send(new ScanCommand({
    TableName: TABLES.RESOURCES,
    FilterExpression: 'contains(courseIds, :cid) AND (archived = :f OR attribute_not_exists(archived))',
    ExpressionAttributeValues: { ':cid': courseId, ':f': false },
  }));
  return (result.Items ?? []) as Resource[];
}

export async function saveResource(resource: Resource): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLES.RESOURCES, Item: resource }));
}

export async function updateResource(evaluatorId: string, resourceId: string, updates: Partial<Pick<Resource, 'title' | 'description' | 'folder' | 'courseIds' | 'archived' | 'ttl' | 'updatedAt'>>): Promise<void> {
  const exprs: string[] = [];
  const names: Record<string, string> = {};
  const vals: Record<string, any> = {};

  if (updates.title !== undefined) { exprs.push('#ti = :ti'); names['#ti'] = 'title'; vals[':ti'] = updates.title; }
  if (updates.description !== undefined) { exprs.push('#de = :de'); names['#de'] = 'description'; vals[':de'] = updates.description; }
  if (updates.folder !== undefined) { exprs.push('#fo = :fo'); names['#fo'] = 'folder'; vals[':fo'] = updates.folder; }
  if (updates.courseIds !== undefined) { exprs.push('#ci = :ci'); names['#ci'] = 'courseIds'; vals[':ci'] = updates.courseIds; }
  if (updates.archived !== undefined) { exprs.push('#ar = :ar'); names['#ar'] = 'archived'; vals[':ar'] = updates.archived; }
  if (updates.ttl !== undefined) { exprs.push('#tt = :tt'); names['#tt'] = 'ttl'; vals[':tt'] = updates.ttl; }
  if (updates.updatedAt !== undefined) { exprs.push('#ua = :ua'); names['#ua'] = 'updatedAt'; vals[':ua'] = updates.updatedAt; }

  if (!exprs.length) return;
  await ddb.send(new UpdateCommand({
    TableName: TABLES.RESOURCES,
    Key: { evaluatorId, resourceId },
    UpdateExpression: `SET ${exprs.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}
