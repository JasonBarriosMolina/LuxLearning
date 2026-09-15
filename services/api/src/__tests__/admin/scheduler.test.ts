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

const s3Send = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: function () { return { send: s3Send }; },
  PutObjectCommand: function (x: any) { return x; },
  GetObjectCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
}));

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
      body: { blocks: [{ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }], maxCoursesPerWeek: 3 },
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({ where: { evaluatorId: 'user-uuid' } });
    expect(createMany).toHaveBeenCalledWith({ data: [{ evaluatorId: 'user-uuid', dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }] });
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

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "si el profesor pone una lección
  // antes de las 6 de la tarde [entre semana], el sistema le debe indicar que
  // está incorrecto."
  it('PUT rejects a weekday block starting before 6pm', async () => {
    const prisma = makePrisma();
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/teachers/eval-1/availability'),
      method: 'PUT', path: '/admin/teachers/eval-1/availability', prisma,
      body: { blocks: [{ dayOfWeek: 2, startTime: '14:00', endTime: '16:00' }] }, // Tuesday 2pm
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(400);
  });

  it('PUT still allows a Saturday block starting before 6pm (institutional 8am-4pm rule unaffected)', async () => {
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({ teacherAvailability: { deleteMany, createMany }, teacherWorkload: { upsert } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'PUT', '/admin/teachers/eval-1/availability'),
      method: 'PUT', path: '/admin/teachers/eval-1/availability', prisma,
      body: { blocks: [{ dayOfWeek: 6, startTime: '08:00', endTime: '12:00' }] },
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(200);
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
      teacherAvailability: { findMany: vi.fn().mockResolvedValue([{ evaluatorId: 'eval-1', dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }]) },
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

  // Trello *LUX SCHEDULER*, 2026-09-10 (Mack): duration must be admin-configurable,
  // not the fixed 55/75 default.
  it('honors a custom individualMinutes duration from the request body', async () => {
    getAllEnrollmentsMock.mockResolvedValue([]);
    const prisma = makePrisma({
      course: {
        findMany: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Curso Virtual', evaluatorId: 'eval-1', modality: 'SINCRONICA' }]),
      },
      teacherAvailability: { findMany: vi.fn().mockResolvedValue([{ evaluatorId: 'eval-1', dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }]) },
      teacherWorkload: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/generate'),
      method: 'POST', path: '/admin/scheduler/generate', prisma,
      body: { academicPeriod: '2026-2', individualMinutes: 30 },
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    const session = body.data.proposals[0].sessions[0];
    const [sh, sm] = session.startTime.split(':').map(Number);
    const [eh, em] = session.endTime.split(':').map(Number);
    expect((eh * 60 + em) - (sh * 60 + sm)).toBe(30);
  });
});

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "probar los horarios no significa
// que deban publicarse; deben aprobarse... las opciones que tengo que tener
// son: enviar notificación a estudiantes / a evaluadores... el botón de
// publicar debe existir... después de enviar las notificaciones." Approve now
// only stores a candidate (ScheduleApproval) — no DB write to ScheduledClass,
// no emails, until notify/publish are called explicitly.
const sampleProposal = {
  label: 'Opción A', strategy: 'compact', unscheduledCourseIds: [],
  sessions: [{
    courseId: 'c1', evaluatorId: 'eval-1', dayOfWeek: 1, startTime: '18:00', endTime: '18:55',
    modality: 'VIRTUAL', classType: 'INDIVIDUAL', studentIds: ['student-1'],
  }],
};

describe('handleScheduler — POST /admin/scheduler/approve', () => {
  it('stores the candidate as ScheduleApproval, no ScheduledClass write and no emails', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({ scheduleApproval: { upsert } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/approve'),
      method: 'POST', path: '/admin/scheduler/approve', prisma,
      body: { academicPeriod: '2026-2', proposal: sampleProposal, courseTitles: { c1: 'Curso Virtual' }, teacherNames: { 'eval-1': 'Profe' } },
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { academicPeriod: '2026-2' } }));
    expect(sendTemplatedEmailMock).not.toHaveBeenCalled();
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

describe('handleScheduler — GET /admin/scheduler/approval', () => {
  it('returns the stored candidate for re-preview', async () => {
    const stored = { academicPeriod: '2026-2', proposalJson: { proposal: sampleProposal, courseTitles: {}, teacherNames: {} }, status: 'APPROVED' };
    const prisma = makePrisma({ scheduleApproval: { findUnique: vi.fn().mockResolvedValue(stored) } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/scheduler/approval', { qs: { academicPeriod: '2026-2' } }),
      method: 'GET', path: '/admin/scheduler/approval', prisma,
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(body.data.status).toBe('APPROVED');
  });

  it('returns 404 when nothing was approved for that period', async () => {
    const prisma = makePrisma({ scheduleApproval: { findUnique: vi.fn().mockResolvedValue(null) } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/scheduler/approval', { qs: { academicPeriod: '2026-2' } }),
      method: 'GET', path: '/admin/scheduler/approval', prisma,
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(404);
  });
});

describe('handleScheduler — POST /admin/scheduler/notify', () => {
  it('emails only the requested audience and marks it notified', async () => {
    const update = vi.fn().mockResolvedValue({});
    const stored = { academicPeriod: '2026-2', proposalJson: { proposal: sampleProposal, courseTitles: { c1: 'Curso Virtual' } } };
    const prisma = makePrisma({ scheduleApproval: { findUnique: vi.fn().mockResolvedValue(stored), update } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/notify'),
      method: 'POST', path: '/admin/scheduler/notify', prisma,
      body: { academicPeriod: '2026-2', audience: 'students' },
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(body.data.recipientCount).toBe(1); // only the 1 student, not the teacher
    expect(sendTemplatedEmailMock).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ where: { academicPeriod: '2026-2' }, data: { notifiedStudents: true } });
  });

  it('returns 404 when there is no approved candidate yet', async () => {
    const prisma = makePrisma({ scheduleApproval: { findUnique: vi.fn().mockResolvedValue(null) } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/notify'),
      method: 'POST', path: '/admin/scheduler/notify', prisma,
      body: { academicPeriod: '2026-2', audience: 'evaluators' },
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(404);
  });
});

describe('handleScheduler — POST /admin/scheduler/publish', () => {
  it('rejects publishing before any notification was sent', async () => {
    const stored = { academicPeriod: '2026-2', proposalJson: { proposal: sampleProposal }, notifiedStudents: false, notifiedEvaluators: false };
    const prisma = makePrisma({ scheduleApproval: { findUnique: vi.fn().mockResolvedValue(stored) } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/publish'),
      method: 'POST', path: '/admin/scheduler/publish', prisma,
      body: { academicPeriod: '2026-2' },
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(400);
  });

  it('writes ScheduledClass rows and marks the approval PUBLISHED once notified', async () => {
    const stored = { academicPeriod: '2026-2', proposalJson: { proposal: sampleProposal }, notifiedStudents: true, notifiedEvaluators: false };
    const prisma = makePrisma({
      scheduleApproval: { findUnique: vi.fn().mockResolvedValue(stored), update: vi.fn().mockResolvedValue({}) },
      scheduledClass: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/publish'),
      method: 'POST', path: '/admin/scheduler/publish', prisma,
      body: { academicPeriod: '2026-2' },
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(body.data.sessionCount).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalled();
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

  it('also clears the stored ScheduleApproval so a re-edit starts clean', async () => {
    const scheduleApprovalDeleteMany = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({
      scheduledClass: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      scheduleApproval: { deleteMany: scheduleApprovalDeleteMany },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'DELETE', '/admin/scheduler/2026-2'),
      method: 'DELETE', path: '/admin/scheduler/2026-2', prisma,
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(200);
    expect(scheduleApprovalDeleteMany).toHaveBeenCalledWith({ where: { academicPeriod: '2026-2' } });
  });
});

// Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "me indica que el nombre de ciertos
// evaluadores es un código en lugar del nombre" — a raw Cognito username/sub
// must never surface as a "name" when email is available as a better fallback.
describe('handleScheduler — teacher/evaluator display name fallback', () => {
  it('falls back to email (not the raw username) when the name attribute is unset', async () => {
    cognitoSend.mockResolvedValueOnce({ UserAttributes: [{ Name: 'email', Value: 'noname@test.com' }] });
    const prisma = makePrisma({
      course: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Curso', evaluatorId: 'eval-noname', modality: 'SINCRONICA' }]) },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/scheduler/courses', { qs: { academicPeriod: '2026-2' } }),
      method: 'GET', path: '/admin/scheduler/courses', prisma,
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(body.data.courses[0].teacherName).toBe('noname@test.com');
  });

  it('only falls back to the raw username as an absolute last resort (no name, no email)', async () => {
    cognitoSend.mockResolvedValueOnce({ UserAttributes: [] });
    const prisma = makePrisma({
      course: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Curso', evaluatorId: 'eval-bare-uuid', modality: 'SINCRONICA' }]) },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/scheduler/courses', { qs: { academicPeriod: '2026-2' } }),
      method: 'GET', path: '/admin/scheduler/courses', prisma,
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(body.data.courses[0].teacherName).toBe('eval-bare-uuid');
  });
});

describe('handleScheduler — GET /admin/scheduler/courses (Paso 3 preview)', () => {
  it('returns course catalog with engineModality + studentCount, before generating anything', async () => {
    getAllEnrollmentsMock.mockResolvedValue([{ userId: 's1', courseId: 'c1' }, { userId: 's2', courseId: 'c1' }]);
    const prisma = makePrisma({
      course: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'c1', title: 'Curso Presencial', evaluatorId: 'eval-1', modality: 'PRESENCIAL' },
          { id: 'c2', title: 'Curso Async', evaluatorId: 'eval-1', modality: 'ASINCRONICA' },
        ]),
      },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/scheduler/courses', { qs: { academicPeriod: '2026-2' } }),
      method: 'GET', path: '/admin/scheduler/courses', prisma,
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(body.data.courses).toEqual([
      { id: 'c1', title: 'Curso Presencial', evaluatorId: 'eval-1', teacherName: 'Prof Test', modality: 'PRESENCIAL', engineModality: 'PRESENCIAL', studentIds: ['s1', 's2'], studentCount: 2 },
      { id: 'c2', title: 'Curso Async', evaluatorId: 'eval-1', teacherName: 'Prof Test', modality: 'ASINCRONICA', engineModality: null, studentIds: [], studentCount: 0 },
    ]);
    // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "tampoco tengo opción de
    // eliminar estudiantes que estén en los cursos ya" — el catálogo ahora
    // trae nombres resueltos para poder listar/quitar el roster.
    expect(body.data.studentNames).toEqual({ s1: 'Prof Test', s2: 'Prof Test' });
  });
});

describe('handleScheduler — POST /admin/scheduler/courses (Paso 3, curso aún no creado)', () => {
  it('creates a draft Course with just title + evaluator, no schedule fields', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'new-course', title: 'Curso Nuevo', evaluatorId: 'eval-1', modality: null });
    const prisma = makePrisma({ course: { create } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/courses'),
      method: 'POST', path: '/admin/scheduler/courses', prisma,
      body: { academicPeriod: '2026-2', title: 'Curso Nuevo', evaluatorId: 'eval-1' },
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: 'Curso Nuevo', evaluatorId: 'eval-1', academicPeriod: '2026-2', isDraft: true, isActive: false, description: '' }),
    }));
    expect(body.data).toEqual({ id: 'new-course', title: 'Curso Nuevo', evaluatorId: 'eval-1', teacherName: 'Prof Test', modality: null, engineModality: 'VIRTUAL', studentIds: [], studentCount: 0 });
  });

  it('returns 400 when title is missing', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/courses'),
      method: 'POST', path: '/admin/scheduler/courses', prisma: makePrisma(),
      body: { academicPeriod: '2026-2', evaluatorId: 'eval-1' },
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(400);
  });
});

describe('handleScheduler — POST /admin/scheduler/validate (Paso 7 manual edit)', () => {
  it('re-checks a hand-edited session list and returns conflicts', async () => {
    const prisma = makePrisma();
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/validate'),
      method: 'POST', path: '/admin/scheduler/validate', prisma,
      body: {
        sessions: [
          { courseId: 'c1', evaluatorId: 'eval-1', dayOfWeek: 1, startTime: '08:00', endTime: '08:55', modality: 'VIRTUAL', classType: 'INDIVIDUAL', studentIds: [] },
          { courseId: 'c2', evaluatorId: 'eval-1', dayOfWeek: 1, startTime: '08:30', endTime: '09:25', modality: 'VIRTUAL', classType: 'INDIVIDUAL', studentIds: [] },
        ],
      },
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(body.data.conflicts.some((c: any) => c.type === 'TEACHER_OVERLAP')).toBe(true);
  });

  it('returns 400 when sessions is missing', async () => {
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'POST', '/admin/scheduler/validate'),
      method: 'POST', path: '/admin/scheduler/validate', prisma: makePrisma(),
      body: {},
    });
    const res = await handleScheduler(ctx as any);
    expect(res.statusCode).toBe(400);
  });
});

describe('handleScheduler — GET /admin/scheduler/export (Paso 8 Word)', () => {
  it('uploads a .docx to S3 and returns a presigned download URL', async () => {
    const prisma = makePrisma({
      scheduledClass: {
        findMany: vi.fn().mockResolvedValue([
          { courseId: 'c1', evaluatorId: 'eval-1', dayOfWeek: 1, startTime: '08:00', endTime: '08:55', modality: 'VIRTUAL', classType: 'INDIVIDUAL', studentIds: ['s1'] },
        ]),
      },
      course: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Curso Virtual' }]) },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/scheduler/export', { qs: { academicPeriod: '2026-2' } }),
      method: 'GET', path: '/admin/scheduler/export', prisma,
    });
    const res = await handleScheduler(ctx as any);
    const body = await bodyOf(res);
    expect(res.statusCode).toBe(200);
    expect(body.data.url).toBe('https://s3.example.com/presigned-url');
    expect(body.data.fileName).toBe('Horario_2026-2.docx');
    expect(s3Send).toHaveBeenCalled();
    const putCall = s3Send.mock.calls.find((c: any) => c[0].Key?.endsWith('.docx'));
    expect(putCall).toBeTruthy();
    expect(putCall[0].ContentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('returns 404 when nothing is published for that period', async () => {
    const prisma = makePrisma({ scheduledClass: { findMany: vi.fn().mockResolvedValue([]) } });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/scheduler/export', { qs: { academicPeriod: '2026-2' } }),
      method: 'GET', path: '/admin/scheduler/export', prisma,
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
