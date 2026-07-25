// ─── db-calendar.ts ──────────────────────────────────────────────────────────
// Domain: Calendar Events (LuxCalendarEvents table)
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db-core';

export interface CalendarEvent {
  creatorId: string;
  eventId: string;
  title: string;
  description?: string;
  type: 'class' | 'meeting' | 'event' | 'deadline' | 'reminder' | 'other';
  startDate: string;
  endDate: string;
  allDay: boolean;
  visibility: 'private' | 'evaluators' | 'students' | 'community' | 'course_mine' | 'course_all';
  color?: string;
  location?: string;
  targetCourseId?: string;
  targetStudentIds?: string[];
  targetEvaluatorIds?: string[];
  creatorName?: string;
  creatorRole?: string;
  createdAt: string;
  recurrence?: 'none' | 'weekly' | 'monthly' | 'weekdays' | 'custom_days';
  recurrenceDays?: number[];
  recurrenceEndDate?: string;
  recurrenceGroupId?: string;
  reminder48hSent?: boolean;
  reminder2hSent?: boolean;
}

export async function createCalendarEvent(event: CalendarEvent): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLES.CALENDAR,
    Item: event,
  }));
}

export async function batchCreateCalendarEvents(events: CalendarEvent[]): Promise<void> {
  const CHUNK = 25;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [TABLES.CALENDAR]: chunk.map((ev) => ({ PutRequest: { Item: ev } })),
      },
    }));
  }
}

export async function scanCalendarEventsInRange(fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  const items: CalendarEvent[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.CALENDAR,
      FilterExpression: 'startDate BETWEEN :from AND :to AND visibility <> :priv',
      ExpressionAttributeValues: { ':from': fromIso, ':to': toIso, ':priv': 'private' },
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    items.push(...((result.Items ?? []) as CalendarEvent[]));
    lastKey = result.LastEvaluatedKey as Record<string, any> | undefined;
  } while (lastKey);
  return items;
}

export async function getCalendarEventsByCreator(creatorId: string): Promise<CalendarEvent[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.CALENDAR,
    KeyConditionExpression: 'creatorId = :cid',
    ExpressionAttributeValues: { ':cid': creatorId },
  }));
  return (result.Items ?? []) as CalendarEvent[];
}

export async function getAllVisibleCalendarEvents(
  requestorId: string,
  requestorRole: string,
): Promise<CalendarEvent[]> {
  const items: CalendarEvent[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLES.CALENDAR,
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    items.push(...((result.Items ?? []) as CalendarEvent[]));
    lastKey = result.LastEvaluatedKey as Record<string, any> | undefined;
  } while (lastKey);
  const isAdmin = requestorRole === 'ADMIN' || requestorRole === 'SUPER_ADMIN';
  return items.filter((ev) => {
    if (ev.creatorId === requestorId) return true;
    if (isAdmin) return true;
    if (ev.visibility === 'evaluators') return true;
    if (ev.visibility === 'students') {
      if (ev.targetStudentIds && ev.targetStudentIds.length > 0) {
        return ev.targetStudentIds.includes(requestorId);
      }
      return true;
    }
    if (ev.visibility === 'community') return true;
    if (ev.visibility === 'course_mine') return true;
    if (ev.visibility === 'course_all') return true;
    return false;
  });
}

export async function updateCalendarEvent(creatorId: string, eventId: string, updates: Partial<Omit<CalendarEvent, 'creatorId' | 'eventId' | 'createdAt'>>): Promise<void> {
  const sets: string[] = [];
  const vals: Record<string, any> = {};
  const names: Record<string, string> = {};
  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined) continue;
    const alias = `#f_${key}`;
    const placeholder = `:v_${key}`;
    sets.push(`${alias} = ${placeholder}`);
    names[alias] = key;
    vals[placeholder] = val;
  }
  if (sets.length === 0) return;
  await ddb.send(new UpdateCommand({
    TableName: TABLES.CALENDAR,
    Key: { creatorId, eventId },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

export async function deleteCalendarEvent(creatorId: string, eventId: string): Promise<void> {
  await ddb.send(new DeleteCommand({
    TableName: TABLES.CALENDAR,
    Key: { creatorId, eventId },
  }));
}

export async function deleteWizardCalendarEvents(courseId: string): Promise<void> {
  const syntheticCreatorId = `wiz-${courseId}`;
  const events = await getCalendarEventsByCreator(syntheticCreatorId);
  await Promise.all(events.map((e) => deleteCalendarEvent(syntheticCreatorId, e.eventId)));
}

export async function getCalendarEventById(creatorId: string, eventId: string): Promise<CalendarEvent | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.CALENDAR,
    Key: { creatorId, eventId },
  }));
  return (result.Item as CalendarEvent) ?? null;
}
