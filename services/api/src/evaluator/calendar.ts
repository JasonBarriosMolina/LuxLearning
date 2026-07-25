// Calendar domain handler for lux-evaluator.
import { EvalCtx, cognito, ses, USER_POOL_ID, FROM_EMAIL, sendCalendarEventEmails } from './ctx';
import {
  createCalendarEvent, batchCreateCalendarEvents, getAllVisibleCalendarEvents,
  updateCalendarEvent, deleteCalendarEvent, getCalendarEventById,
} from '../shared/db-dynamo';
import { ok, badRequest, notFound } from '../shared/response';
import { createId } from '@paralleldrive/cuid2';

export async function handleCalendar(ctx: EvalCtx): Promise<any | null> {
  const { event, method, path, userId, role } = ctx;

  // ── GET /evaluator/calendar/events ──────────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/calendar/events') {
    const calEvents = await getAllVisibleCalendarEvents(userId, role);
    return ok(calEvents);
  }

  // ── POST /evaluator/calendar/events ─────────────────────────────────────────
  if (method === 'POST' && path === '/evaluator/calendar/events') {
    const body = JSON.parse(event.body ?? '{}');
    const {
      title, description, type, startDate, endDate, allDay,
      visibility, color, location, targetCourseId, targetStudentIds, targetEvaluatorIds,
      recurrence, recurrenceDays, recurrenceEndDate,
    } = body as {
      title?: string; description?: string;
      type?: 'class' | 'meeting' | 'event' | 'deadline' | 'reminder' | 'other';
      startDate?: string; endDate?: string; allDay?: boolean;
      visibility?: 'private' | 'evaluators' | 'students' | 'community' | 'course_mine' | 'course_all';
      color?: string; location?: string; targetCourseId?: string; targetStudentIds?: string[]; targetEvaluatorIds?: string[];
      recurrence?: 'none' | 'weekly' | 'monthly' | 'weekdays' | 'custom_days';
      recurrenceDays?: number[];
      recurrenceEndDate?: string;
    };
    if (!title || !startDate || !endDate) return badRequest('title, startDate y endDate son requeridos');

    const effectiveRecurrence = recurrence ?? 'none';
    const baseId = createId();
    const recurrenceGroupId = effectiveRecurrence !== 'none' ? baseId : undefined;

    const buildCalEvent = (start: string, end: string, eid: string) => ({
      creatorId: userId,
      eventId: eid,
      title: title.trim(),
      ...(description ? { description: description.trim() } : {}),
      type: type ?? 'event',
      startDate: start,
      endDate: end,
      allDay: allDay ?? false,
      visibility: visibility ?? 'private',
      ...(color ? { color } : {}),
      ...(location ? { location: location.trim() } : {}),
      ...(targetCourseId ? { targetCourseId } : {}),
      ...(targetStudentIds && targetStudentIds.length > 0 ? { targetStudentIds } : {}),
      ...(targetEvaluatorIds && targetEvaluatorIds.length > 0 ? { targetEvaluatorIds } : {}),
      creatorRole: role,
      createdAt: new Date().toISOString(),
      ...(effectiveRecurrence !== 'none' ? { recurrence: effectiveRecurrence } : {}),
      ...(recurrenceDays ? { recurrenceDays } : {}),
      ...(recurrenceEndDate ? { recurrenceEndDate } : {}),
      ...(recurrenceGroupId ? { recurrenceGroupId } : {}),
    });

    const calEvents: ReturnType<typeof buildCalEvent>[] = [];
    if (effectiveRecurrence === 'none') {
      calEvents.push(buildCalEvent(startDate, endDate, baseId));
    } else {
      const startMs = new Date(startDate).getTime();
      const durationMs = new Date(endDate).getTime() - startMs;
      const limitDate = recurrenceEndDate
        ? new Date(recurrenceEndDate).getTime() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000
        : startMs + 180 * 24 * 60 * 60 * 1000;
      const MAX_OCCURRENCES = 52;
      let cursor = new Date(startDate);
      let count = 0;

      if (effectiveRecurrence === 'weekly') {
        while (cursor.getTime() <= limitDate && count < MAX_OCCURRENCES) {
          const ocStart = cursor.toISOString();
          const ocEnd = new Date(cursor.getTime() + durationMs).toISOString();
          calEvents.push(buildCalEvent(ocStart, ocEnd, count === 0 ? baseId : createId()));
          count++;
          cursor.setDate(cursor.getDate() + 7);
        }
      } else if (effectiveRecurrence === 'monthly') {
        while (cursor.getTime() <= limitDate && count < MAX_OCCURRENCES) {
          const ocStart = cursor.toISOString();
          const ocEnd = new Date(cursor.getTime() + durationMs).toISOString();
          calEvents.push(buildCalEvent(ocStart, ocEnd, count === 0 ? baseId : createId()));
          count++;
          cursor.setMonth(cursor.getMonth() + 1);
        }
      } else {
        while (cursor.getTime() <= limitDate && count < MAX_OCCURRENCES) {
          const day = cursor.getDay();
          const include = effectiveRecurrence === 'weekdays'
            ? day >= 1 && day <= 5
            : (recurrenceDays ?? []).includes(day);
          if (include) {
            const ocStart = cursor.toISOString();
            const ocEnd = new Date(cursor.getTime() + durationMs).toISOString();
            calEvents.push(buildCalEvent(ocStart, ocEnd, count === 0 ? baseId : createId()));
            count++;
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }
    }

    if (calEvents.length === 1) {
      await createCalendarEvent(calEvents[0] as any);
    } else {
      await batchCreateCalendarEvents(calEvents as any);
    }

    if (visibility && visibility !== 'private') {
      sendCalendarEventEmails(calEvents[0] as any, 'created', cognito, ses, USER_POOL_ID, FROM_EMAIL).catch(() => {});
    }

    return ok({ events: calEvents, count: calEvents.length });
  }

  // ── PUT /evaluator/calendar/events/:eventId ──────────────────────────────────
  const calEditMatch = path.match(/^\/evaluator\/calendar\/events\/([^/]+)$/);
  if (method === 'PUT' && calEditMatch) {
    const body = JSON.parse(event.body ?? '{}');
    const eventId = calEditMatch[1]!;
    const existing = await getCalendarEventById(userId, eventId);
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
    if (!existing) {
      if (!isAdmin) return notFound('Evento no encontrado');
      const { creatorId: bodyCreatorId } = body as { creatorId?: string };
      if (!bodyCreatorId) return badRequest('creatorId requerido para admin');
      const adminExisting = await getCalendarEventById(bodyCreatorId, eventId);
      if (!adminExisting) return notFound('Evento no encontrado');
      const { creatorId: _c, eventId: _e, createdAt: _t, ...rest } = body as any;
      await updateCalendarEvent(bodyCreatorId, eventId, rest);
      if (rest.visibility && rest.visibility !== 'private') {
        sendCalendarEventEmails({ ...adminExisting, ...rest }, 'updated', cognito, ses, USER_POOL_ID, FROM_EMAIL).catch(() => {});
      }
      return ok({ updated: true });
    }
    const { creatorId: _c, eventId: _e, createdAt: _t, ...updates } = body as any;
    await updateCalendarEvent(userId, eventId, updates);
    if (updates.visibility && updates.visibility !== 'private') {
      sendCalendarEventEmails({ ...existing, ...updates }, 'updated', cognito, ses, USER_POOL_ID, FROM_EMAIL).catch(() => {});
    }
    return ok({ updated: true });
  }

  // ── DELETE /evaluator/calendar/events/:eventId ───────────────────────────────
  const calDeleteMatch = path.match(/^\/evaluator\/calendar\/events\/([^/]+)$/);
  if (method === 'DELETE' && calDeleteMatch) {
    const body = JSON.parse(event.body ?? '{}');
    const eventId = calDeleteMatch[1]!;
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const existing = await getCalendarEventById(userId, eventId);
    if (!existing) {
      if (!isAdmin) return notFound('Evento no encontrado');
      const { creatorId: bodyCreatorId } = body as { creatorId?: string };
      if (!bodyCreatorId) return badRequest('creatorId requerido para admin');
      await deleteCalendarEvent(bodyCreatorId, eventId);
      return ok({ deleted: true });
    }
    await deleteCalendarEvent(userId, eventId);
    return ok({ deleted: true });
  }

  return null; // not handled by this domain
}
