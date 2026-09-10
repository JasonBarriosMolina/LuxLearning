/**
 * Tests for evaluator/tasks.ts — covers the course-wide assignment path, which
 * used to Query a DynamoDB GSI (`courseId-users-index`) that doesn't exist on
 * the Enrollments table. It always threw and fell back to a Scan; now it Scans
 * directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEvalCtx, makeEvent, bodyOf } from '../helpers/ctx';

const ddbSend = vi.hoisted(() => vi.fn());
const createTaskMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: function (x: any) { return x; },
  ScanCommand:  function (x: any) { return { ...x, __isScan: true }; },
}));

vi.mock('../../shared/db-dynamo', () => ({
  TABLES: { ENROLLMENTS: 'Enrollments', TASKS: 'ScheduledTasks' },
  ddb: { send: ddbSend },
  createTask: createTaskMock,
  getTasksForUser: vi.fn().mockResolvedValue([]),
  updateTask: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getPushSubscriptionsByUserId: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../shared/email', () => ({
  sendTemplatedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { handleTasks } from '../../evaluator/tasks';

describe('handleTasks — POST /evaluator/tasks (assignTo: course)', () => {
  // Mocks are module-level (vi.hoisted) and shared across tests in this file —
  // clear call counts so each test's toHaveBeenCalledTimes assertion is self-contained.
  beforeEach(() => {
    ddbSend.mockClear();
    createTaskMock.mockClear();
  });

  it('Scans Enrollments directly (no GSI query) and creates one task per enrolled student', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [{ userId: 'student-1' }, { userId: 'student-2' }, { userId: 'student-1' }], // dup on purpose
    });

    const ctx = makeEvalCtx({
      event: makeEvent('EVALUATOR', 'POST', '/evaluator/tasks', {
        body: {
          title: 'Entrega final', dueDate: '2026-10-01',
          assignTo: 'course', targetCourseId: 'course-abc',
        },
      }),
      method: 'POST', path: '/evaluator/tasks',
      body: { title: 'Entrega final', dueDate: '2026-10-01', assignTo: 'course', targetCourseId: 'course-abc' },
    });

    const res = await handleTasks(ctx as any);
    const body = await bodyOf(res);

    expect(res.statusCode).toBe(200);
    expect(body.data.created).toBe(2); // deduped

    // Only one ddb call — a Scan, never a failing Query-then-fallback round trip
    expect(ddbSend).toHaveBeenCalledTimes(1);
    expect(ddbSend.mock.calls[0][0].__isScan).toBe(true);
    expect(ddbSend.mock.calls[0][0].TableName).toBe('Enrollments');
    expect(ddbSend.mock.calls[0][0].FilterExpression).toBe('courseId = :cid');

    expect(createTaskMock).toHaveBeenCalledTimes(2);
  });

  it('paginates through a Scan spanning multiple pages (1MB scan limit) without dropping students', async () => {
    ddbSend
      .mockResolvedValueOnce({ Items: [{ userId: 'student-1' }], LastEvaluatedKey: { userId: 'student-1' } })
      .mockResolvedValueOnce({ Items: [{ userId: 'student-2' }], LastEvaluatedKey: { userId: 'student-2' } })
      .mockResolvedValueOnce({ Items: [{ userId: 'student-3' }] }); // no LastEvaluatedKey — final page

    const ctx = makeEvalCtx({
      event: makeEvent('EVALUATOR', 'POST', '/evaluator/tasks', {
        body: { title: 'Entrega', dueDate: '2026-10-01', assignTo: 'course', targetCourseId: 'big-course' },
      }),
      method: 'POST', path: '/evaluator/tasks',
      body: { title: 'Entrega', dueDate: '2026-10-01', assignTo: 'course', targetCourseId: 'big-course' },
    });

    const res = await handleTasks(ctx as any);
    const body = await bodyOf(res);

    expect(res.statusCode).toBe(200);
    expect(body.data.created).toBe(3);
    expect(ddbSend).toHaveBeenCalledTimes(3); // one call per page
    expect(createTaskMock).toHaveBeenCalledTimes(3);
  });

  it('returns 400 when no students are enrolled in the target course', async () => {
    ddbSend.mockResolvedValueOnce({ Items: [] });

    const ctx = makeEvalCtx({
      event: makeEvent('EVALUATOR', 'POST', '/evaluator/tasks', {
        body: { title: 'x', dueDate: '2026-10-01', assignTo: 'course', targetCourseId: 'empty-course' },
      }),
      method: 'POST', path: '/evaluator/tasks',
      body: { title: 'x', dueDate: '2026-10-01', assignTo: 'course', targetCourseId: 'empty-course' },
    });

    const res = await handleTasks(ctx as any);
    expect(res.statusCode).toBe(400);
  });
});
