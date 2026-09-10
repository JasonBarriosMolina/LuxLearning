/**
 * Tests for admin/scheduler.ts — teacher availability CRUD, schedule generation
 * (delegates to scheduler-engine.ts, covered separately), and approve/publish.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAdminCtx, makePrisma, makeEvent, bodyOf } from '../helpers/ctx';

const cognitoSend = vi.hoisted(() => vi.fn().mockResolvedValue({
  UserAttributes: [{ Name: 'email', Value: 'teacher@test.com' }, { Name: 'name', Value: 'Prof Test' }],
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return { send: cognitoSend }; },
  AdminGetUserCommand: function (x: any) { return x; },
}));

const sendTemplatedEmailMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../shared/email', () => ({ sendTemplatedEmail: sendTemplatedEmailMock }));

const getAllEnrollmentsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('../../shared/db-dynamo', () => ({ getAllEnrollments: getAllEnrollmentsMock }));

import { handleScheduler } from '../../admin/scheduler';

describe('handleScheduler — teacher availability', () => {
  it('GET returns empty blocks and default cap 5 for a teacher with no data yet', async () => {
    const prisma = makePrisma({
      teacherAvailability: { findMany: vi.fn().mockResolvedValue([]) },
      teacherWorkload: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/teachers/eval-1/availability'),
      method: 'GET', path: '/admin/teachers/eval-1/availability', prisma,
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(body.data).toEqual({ blocks: [], maxCoursesPerWeek: 5 });
  });

  it('PUT replaces blocks and upserts the workload cap in a transaction', async () => {
    // makeEvent's authorizer.lambda.userId is hardcoded to 'user-uuid' — target that
    // same id in the URL to exercise the "editing own availability" allowed path.
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({
      teacherAvailability: { deleteMany, createMany },
      teacherWorkload: { upsert },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR', 'PUT', '/admin/teachers/user-uuid/availability'),
      method: 'PUT', path: '/admin/teachers/user-uuid/availability', prisma,
      body: { blocks: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }], maxCoursesPerWeek: 3 },
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({ where: { evaluatorId: 'user-uuid' } });
    expect(createMany).toHaveBeenCalledWith({ data: [{ evaluatorId: 'user-uuid', dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }] });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { evaluatorId: 'user-uuid' } }));
  });

  it('PUT rejects a non-admin editing someone else\'s availability', async () => {
    const prisma = makePrisma();
    const ctx = makeAdminCtx({
      event: makeEvent('EVALUATOR', 'PUT', '/admin/teachers/eval-2/availability'),
      method: 'PUT', path: '/admin/teachers/eval-2/availability', prisma,
      userId: 'eval-1', // NOT eval-2
      body: { blocks: [] },
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(403);
  });

  it('PUT rejects malformed time blocks', async () => {
    const prisma = makePrisma();
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/teachers/eval-1/availability'),
      method: 'PUT', path: '/admin/teachers/eval-1/availability', prisma,
      body: { blocks: [{ dayOfWeek: 1, startTime: '12:00', endTime: '08:00' }] }, // end before start
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(400);
  });
});

describe('handleScheduler — POST /admin/scheduler/generate', () => {
  beforeEach(() => { getAllEnrollmentsMock.mockResolvedValue([]); });

  it('returns 400 when no courses have an evaluator in that academic period', async () => {
    const prisma = makePrisma({ course: { findMany: vi.fn().mockResolvedValue([]) } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/generate'),
      method: 'POST', path: '/admin/scheduler/generate', prisma,
      body: { academicPeriod: '2026-2' },
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(400);
  });

  it('generates proposals for sync courses, skips async ones, resolves teacher names', async () => {
    getAllEnrollmentsMock.mockResolvedValue([{ userId: 'student-1', courseId: 'c1' }]);
    const prisma = makePrisma({
      course: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'c1', title: 'Curso Virtual', evaluatorId: 'eval-1', modality: 'SINCRONICA' },
          { id: 'c2', title: 'Curso Async', evaluatorId: 'eval-1', modality: 'ASINCRONICA' },
        ]),
      },
      teacherAvailability: { findMany: vi.fn().mockResolvedValue([{ evaluatorId: 'eval-1', dayOfWeek: 1, startTime: '08:00', endTime: '10:00' }]) },
      teacherWorkload: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/generate'),
      method: 'POST', path: '/admin/scheduler/generate', prisma,
      body: { academicPeriod: '2026-2' },
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(body.data.proposals).toHaveLength(3);
    expect(body.data.skippedAsyncCourseIds).toEqual(['c2']);
    expect(body.data.courseTitles.c1).toBe('Curso Virtual');
    expect(body.data.teacherNames['eval-1']).toBe('Prof Test');
    for (const p of body.data.proposals) {
      expect(p.sessions.some((s: any) => s.courseId === 'c1')).toBe(true);
      expect(p.sessions.some((s: any) => s.courseId === 'c2')).toBe(false);
    }
  });
});

describe('handleScheduler — POST /admin/scheduler/approve', () => {
  it('persists ScheduledClass rows and emails only each recipient\'s own sessions', async () => {
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({
      scheduledClass: { deleteMany, createMany },
      course: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Curso Virtual' }]) },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/approve'),
      method: 'POST', path: '/admin/scheduler/approve', prisma,
      body: {
        academicPeriod: '2026-2',
        proposal: {
          label: 'Opción A', strategy: 'compact', unscheduledCourseIds: [],
          sessions: [{
            courseId: 'c1', evaluatorId: 'eval-1', dayOfWeek: 1, startTime: '08:00', endTime: '08:55',
            modality: 'VIRTUAL', classType: 'INDIVIDUAL', studentIds: ['student-1'],
          }],
        },
      },
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(body.data.sessionCount).toBe(1);
    expect(body.data.recipientCount).toBe(2); // teacher + 1 student
    expect(deleteMany).toHaveBeenCalledWith({ where: { academicPeriod: '2026-2' } });
    expect(createMany).toHaveBeenCalled();
    // Each recipient gets exactly one email with only their own session, never a full dump.
    expect(sendTemplatedEmailMock).toHaveBeenCalledTimes(2);
    for (const call of sendTemplatedEmailMock.mock.calls) {
      expect(call[1]).toBe('SCHEDULE_PUBLISHED');
      expect(call[2].scheduleRows).toContain('Curso Virtual');
    }
  });

  it('returns 400 when the proposal has no sessions', async () => {
    const prisma = makePrisma();
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/approve'),
      method: 'POST', path: '/admin/scheduler/approve', prisma,
      body: { academicPeriod: '2026-2', proposal: { sessions: [] } },
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(400);
  });
});

describe('handleScheduler — DELETE /admin/scheduler/:academicPeriod', () => {
  it('unpublishes and returns 404 when nothing was published for that period', async () => {
    const prisma = makePrisma({ scheduledClass: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'DELETE', '/admin/scheduler/2026-2'),
      method: 'DELETE', path: '/admin/scheduler/2026-2', prisma,
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(404);
  });
});

describe('Non-scheduler routes return null', () => {
  it('GET /admin/courses returns null from handleScheduler', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/courses' });
    const res = await handleScheduler(ctx as any);
    expect(res).toBeNull();
  });
});
