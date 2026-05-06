import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { getTasksForUser, updateTask } from '../shared/db-dynamo';
import { ok, badRequest, serverError, cors } from '../shared/response';

/** Minimal JWT payload decode (no signature verification — used only for .ics, low-risk) */
function decodeJwtUserId(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    return payload.sub ?? null;
  } catch { return null; }
}

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

function buildICS(tasks: ReturnType<typeof normalizeTask>[]): string {
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const foldLine = (line: string): string => {
    // RFC 5545: fold lines > 75 octets
    const result: string[] = [];
    while (line.length > 75) { result.push(line.slice(0, 75)); line = ' ' + line.slice(75); }
    result.push(line);
    return result.join('\r\n');
  };

  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const events = tasks.map((t) => {
    // Due date as all-day event
    const dueClean = t.dueDate.replace(/-/g, '');
    // Next day for DTEND (exclusive end of all-day event)
    const dueEnd = new Date(t.dueDate + 'T00:00:00Z');
    dueEnd.setUTCDate(dueEnd.getUTCDate() + 1);
    const dueEndClean = dueEnd.toISOString().split('T')[0].replace(/-/g, '');

    const desc = [
      t.courseTitle ? `Curso: ${t.courseTitle}` : '',
      t.moduleTitle ? `Módulo: ${t.moduleTitle}` : '',
      t.description ?? '',
    ].filter(Boolean).join(' | ');

    const lines = [
      'BEGIN:VEVENT',
      `UID:${t.taskId}@luxlearning.com`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dueClean}`,
      `DTEND;VALUE=DATE:${dueEndClean}`,
      foldLine(`SUMMARY:${escape(t.title)}`),
      desc ? foldLine(`DESCRIPTION:${escape(desc)}`) : '',
      `STATUS:${t.status === 'COMPLETED' ? 'COMPLETED' : 'CONFIRMED'}`,
      'END:VEVENT',
    ].filter(Boolean);

    return lines.join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lux Learning//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Lux Learning — Mis Tareas',
    'X-WR-TIMEZONE:UTC',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

function normalizeTask(item: any) {
  const now = new Date().toISOString().split('T')[0];
  const status = item.status === 'COMPLETED'
    ? 'COMPLETED'
    : item.dueDate < now
    ? 'OVERDUE'
    : 'PENDING';
  return { ...item, status } as {
    userId: string; sk: string; taskId: string; title: string; description?: string;
    courseId?: string; moduleId?: string; courseTitle?: string; moduleTitle?: string;
    type: string; dueDate: string; status: 'PENDING' | 'COMPLETED' | 'OVERDUE';
    assignedBy: string; createdAt: string; completedAt?: string;
  };
}

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const userId = event.requestContext.authorizer?.lambda?.userId!;
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // GET /tasks — list tasks for the current student
    if (method === 'GET' && path === '/tasks') {
      const rawTasks = await getTasksForUser(userId);
      const now = new Date().toISOString().split('T')[0];
      const tasks = rawTasks.map(normalizeTask);

      // Auto-update OVERDUE status in DB (fire-and-forget)
      const toMark = tasks.filter((t) => t.status === 'OVERDUE' && t.dueDate < now);
      Promise.allSettled(
        toMark.map((t) => updateTask(t.userId, t.sk, { status: 'OVERDUE' }))
      ).catch(() => {});

      tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      return ok(tasks);
    }

    // POST /tasks/:taskId/complete — student marks a task complete
    const completeMatch = path.match(/^\/tasks\/([^/]+)\/complete$/);
    if (method === 'POST' && completeMatch) {
      const taskId = completeMatch[1]!;
      const rawTasks = await getTasksForUser(userId);
      const task = rawTasks.find((t: any) => t.taskId === taskId);
      if (!task) return badRequest('Tarea no encontrada');
      await updateTask(userId, task.sk, { status: 'COMPLETED', completedAt: new Date().toISOString() });
      return ok({ completed: true });
    }

    // GET /tasks/calendar.ics — download .ics file (public route, token in query param)
    if (method === 'GET' && path === '/tasks/calendar.ics') {
      const tokenParam = event.queryStringParameters?.token;
      const icsUserId = userId || (tokenParam ? decodeJwtUserId(tokenParam) : null);
      if (!icsUserId) return { statusCode: 401, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Unauthorized' };
      const rawTasks = await getTasksForUser(icsUserId);
      const tasks = rawTasks.map(normalizeTask);
      const ics = buildICS(tasks);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'attachment; filename="lux-tareas.ics"',
          'Access-Control-Allow-Origin': '*',
        },
        body: ics,
      };
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
