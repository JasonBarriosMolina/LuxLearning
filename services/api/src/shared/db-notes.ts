// ─── db-notes.ts ──────────────────────────────────────────────────────────────
// Student notes — Trello DmPpbrff, 2026-09-04 (Mack): lesson highlights should be
// summarizable into "Mis notas", persisted server-side (not the old class-notes
// localStorage — "el estudiante revisite la app cuando desee ver estas notas").
// Reuses the existing LessonProgress/PROGRESS DynamoDB table (same pattern already
// used there for Highlights/Favorites/Transcripts — a new sk prefix, no new table,
// no new per-environment infra to provision) instead of a dedicated Notes table.
import { PutCommand, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { createId } from '@paralleldrive/cuid2';
import { ddb, TABLES } from './db-core';

export type NoteContextType = 'lesson' | 'class';
export type NoteSource = 'manual' | 'highlight-summary';

export interface NoteItem {
  noteId: string;
  contextType: NoteContextType;
  contextId: string;
  text: string;
  tags: string[];
  source: NoteSource;
  createdAt: string;
  updatedAt: string;
}

const skFor = (contextType: NoteContextType, contextId: string, noteId: string) => `NOTE#${contextType}#${contextId}#${noteId}`;
const skPrefix = (contextType: NoteContextType, contextId: string) => `NOTE#${contextType}#${contextId}#`;

export async function listNotes(userId: string, contextType: NoteContextType, contextId: string): Promise<NoteItem[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.PROGRESS,
    KeyConditionExpression: 'userId = :uid AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':uid': userId, ':prefix': skPrefix(contextType, contextId) },
  }));
  const items = (result.Items ?? []).map((item: Record<string, any>) => ({
    noteId: item['noteId'],
    contextType: item['contextType'],
    contextId: item['contextId'],
    text: item['text'],
    tags: item['tags'] ?? [],
    source: item['source'] ?? 'manual',
    createdAt: item['createdAt'],
    updatedAt: item['updatedAt'],
  })) as NoteItem[];
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
}

/** Creates a new note (omit `noteId`) or updates an existing one (pass `noteId`) —
 *  an update preserves the original createdAt by reading the existing item first. */
export async function saveNote(
  userId: string,
  note: { noteId?: string; contextType: NoteContextType; contextId: string; text: string; tags?: string[]; source?: NoteSource },
): Promise<NoteItem> {
  const noteId = note.noteId ?? createId();
  const now = new Date().toISOString();
  let createdAt = now;
  if (note.noteId) {
    const existing = await ddb.send(new GetCommand({
      TableName: TABLES.PROGRESS,
      Key: { userId, sk: skFor(note.contextType, note.contextId, noteId) },
    }));
    if (existing.Item?.['createdAt']) createdAt = existing.Item['createdAt'];
  }
  const item: NoteItem & { userId: string; sk: string } = {
    userId, sk: skFor(note.contextType, note.contextId, noteId),
    noteId, contextType: note.contextType, contextId: note.contextId,
    text: note.text, tags: note.tags ?? [], source: note.source ?? 'manual',
    createdAt, updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLES.PROGRESS, Item: item }));
  const { userId: _u, sk: _s, ...rest } = item;
  return rest;
}

export async function deleteNote(userId: string, contextType: NoteContextType, contextId: string, noteId: string): Promise<void> {
  await ddb.send(new DeleteCommand({
    TableName: TABLES.PROGRESS,
    Key: { userId, sk: skFor(contextType, contextId, noteId) },
  }));
}
