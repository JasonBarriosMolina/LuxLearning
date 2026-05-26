import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './handler';

// ── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('../shared/db-dynamo', () => ({
  getTasksForUser: vi.fn(),
  updateTask: vi.fn(),
  createNotification: vi.fn(),
  createTask: vi.fn(),
}));
vi.mock('../shared/response', async (importOriginal) => {
  const original = await importOriginal<typeof import('../shared/response')>();
  return original; // use real implementations
});

import { getTasksForUser, updateTask, createNotification, createTask } from '../shared/db-dynamo';

// ── Helpers ────────────────────────────────────────────────────────────────
function makeEvent(method: string, path: string, body?: object, userId = 'user-1') {
  return {
    requestContext: {
      http: { method },
      authorizer: { lambda: { userId, email: 'test@test.com', role: 'STUDENT' } },
    },
    rawPath: path,
    body: body ? JSON.stringify(body) : undefined,
    queryStringParameters: {},
  } as any;
}

const TODAY = new Date().toISOString().split('T')[0]!;
const TOMORROW = new Date(Date.now() + 86400000).toISOString().split('T')[0]!;
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;

const baseTask = {
  userId: 'user-1',
  sk: `${TOMORROW}#task-1`,
  taskId: 'task-1',
  title: 'Tarea de prueba',
  type: 'custom',
  dueDate: TOMORROW,
  status: 'PENDING',
  assignedBy: 'evaluator-1',
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTasksForUser).mockResolvedValue([]);
  vi.mocked(updateTask).mockResolvedValue(undefined as any);
  vi.mocked(createNotification).mockResolvedValue(undefined as any);
  vi.mocked(createTask).mockResolvedValue(undefined as any);
});

// ── GET /tasks ─────────────────────────────────────────────────────────────
describe('GET /tasks', () => {
  it('returns normalized tasks list', async () => {
    vi.mocked(getTasksForUser).mockResolvedValue([{ ...baseTask }]);
    const res = await handler(makeEvent('GET', '/tasks')) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].taskId).toBe('task-1');
  });

  it('marks overdue tasks correctly', async () => {
    const overdueTask = { ...baseTask, dueDate: YESTERDAY, status: 'PENDING' };
    vi.mocked(getTasksForUser).mockResolvedValue([overdueTask]);
    const res = await handler(makeEvent('GET', '/tasks')) as any;
    const body = JSON.parse(res.body);
    expect(body.data[0].status).toBe('OVERDUE');
  });

  it('preserves SUBMITTED status (does not override to OVERDUE)', async () => {
    const submittedTask = { ...baseTask, dueDate: YESTERDAY, status: 'SUBMITTED' };
    vi.mocked(getTasksForUser).mockResolvedValue([submittedTask]);
    const res = await handler(makeEvent('GET', '/tasks')) as any;
    const body = JSON.parse(res.body);
    expect(body.data[0].status).toBe('SUBMITTED');
  });

  it('preserves COMPLETED status', async () => {
    const completedTask = { ...baseTask, status: 'COMPLETED' };
    vi.mocked(getTasksForUser).mockResolvedValue([completedTask]);
    const res = await handler(makeEvent('GET', '/tasks')) as any;
    const body = JSON.parse(res.body);
    expect(body.data[0].status).toBe('COMPLETED');
  });

  it('returns empty array when no tasks', async () => {
    const res = await handler(makeEvent('GET', '/tasks')) as any;
    const body = JSON.parse(res.body);
    expect(body.data).toEqual([]);
  });
});

// ── POST /tasks/:id/complete ───────────────────────────────────────────────
describe('POST /tasks/:id/complete', () => {
  it('marks task as COMPLETED', async () => {
    vi.mocked(getTasksForUser).mockResolvedValue([{ ...baseTask }]);
    const res = await handler(makeEvent('POST', '/tasks/task-1/complete')) as any;
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
      'user-1',
      baseTask.sk,
      expect.objectContaining({ status: 'COMPLETED' })
    );
    const body = JSON.parse(res.body);
    expect(body.data.completed).toBe(true);
  });

  it('returns 400 when task not found', async () => {
    vi.mocked(getTasksForUser).mockResolvedValue([]);
    const res = await handler(makeEvent('POST', '/tasks/nonexistent/complete')) as any;
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /tasks/:id/submit ─────────────────────────────────────────────────
describe('POST /tasks/:id/submit', () => {
  it('marks task as SUBMITTED and creates notification', async () => {
    vi.mocked(getTasksForUser).mockResolvedValue([{ ...baseTask }]);
    const res = await handler(makeEvent('POST', '/tasks/task-1/submit')) as any;
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
      'user-1',
      baseTask.sk,
      expect.objectContaining({ status: 'SUBMITTED' })
    );
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'evaluator-1' })
    );
    const body = JSON.parse(res.body);
    expect(body.data.submitted).toBe(true);
  });

  it('returns 400 when task not found', async () => {
    vi.mocked(getTasksForUser).mockResolvedValue([]);
    const res = await handler(makeEvent('POST', '/tasks/nonexistent/submit')) as any;
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /tasks/:id/undo ───────────────────────────────────────────────────
describe('POST /tasks/:id/undo', () => {
  it('reverts SUBMITTED task back to PENDING', async () => {
    const submittedTask = { ...baseTask, status: 'SUBMITTED' };
    vi.mocked(getTasksForUser).mockResolvedValue([submittedTask]);
    const res = await handler(makeEvent('POST', '/tasks/task-1/undo')) as any;
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
      'user-1',
      baseTask.sk,
      expect.objectContaining({ status: 'PENDING' })
    );
  });

  it('rejects undo when task is OVERDUE', async () => {
    const overdueTask = { ...baseTask, dueDate: YESTERDAY };
    vi.mocked(getTasksForUser).mockResolvedValue([overdueTask]);
    const res = await handler(makeEvent('POST', '/tasks/task-1/undo')) as any;
    expect(res.statusCode).toBe(400);
    expect(vi.mocked(updateTask)).not.toHaveBeenCalled();
  });

  it('returns 400 when task not found', async () => {
    vi.mocked(getTasksForUser).mockResolvedValue([]);
    const res = await handler(makeEvent('POST', '/tasks/nonexistent/undo')) as any;
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /student/tasks/import ─────────────────────────────────────────────
describe('POST /student/tasks/import', () => {
  it('creates tasks from valid ICS events', async () => {
    const events = [
      { summary: 'Evento 1', dtstart: '20260601' },
      { summary: 'Evento 2', dtstart: '20260701T120000Z' },
    ];
    const res = await handler(makeEvent('POST', '/student/tasks/import', { events })) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.created).toBe(2);
    expect(vi.mocked(createTask)).toHaveBeenCalledTimes(2);
  });

  it('normalizes dtstart with time component', async () => {
    const events = [{ summary: 'Tarea', dtstart: '20260601T120000Z' }];
    await handler(makeEvent('POST', '/student/tasks/import', { events }));
    expect(vi.mocked(createTask)).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: '2026-06-01' })
    );
  });

  it('skips events with invalid dtstart format', async () => {
    const events = [
      { summary: 'Válida', dtstart: '20260601' },
      { summary: 'Inválida', dtstart: 'not-a-date' },
    ];
    const res = await handler(makeEvent('POST', '/student/tasks/import', { events })) as any;
    const body = JSON.parse(res.body);
    expect(body.data.created).toBe(1);
  });

  it('skips events missing summary or dtstart', async () => {
    const events = [
      { summary: '', dtstart: '20260601' },
      { summary: 'Sin fecha', dtstart: '' },
    ];
    const res = await handler(makeEvent('POST', '/student/tasks/import', { events })) as any;
    const body = JSON.parse(res.body);
    expect(body.data.created).toBe(0);
  });

  it('limits import to 50 events', async () => {
    const events = Array.from({ length: 60 }, (_, i) => ({
      summary: `Evento ${i}`,
      dtstart: '20260601',
    }));
    await handler(makeEvent('POST', '/student/tasks/import', { events }));
    expect(vi.mocked(createTask)).toHaveBeenCalledTimes(50);
  });

  it('returns 400 for empty events array', async () => {
    const res = await handler(makeEvent('POST', '/student/tasks/import', { events: [] })) as any;
    expect(res.statusCode).toBe(400);
  });
});
