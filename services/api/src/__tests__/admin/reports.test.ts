import { describe, it, expect, vi } from 'vitest';
import { makeAdminCtx, makePrisma, makeEvent, bodyOf } from '../helpers/ctx';

// Trello DmPpbrff, 2026-09-07 (Mack): "el dashboard... solo brinda información
// acerca de los estudiantes... debería incluir información relevante... también
// de los evaluadores... métricas o indicadores clave."
const listUsersInGroupMock = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return { send: listUsersInGroupMock }; },
  ListUsersInGroupCommand: function (x: any) { return x; },
  AdminGetUserCommand: function (x: any) { return x; },
}));

const dynamoMocks = vi.hoisted(() => ({
  getAllReflections: vi.fn().mockResolvedValue([]),
  getAllLessonProgress: vi.fn().mockResolvedValue([]),
  getAllEnrollments: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../shared/db-dynamo', () => dynamoMocks);

import { handleReports } from '../../admin/reports';

function evaluatorUser(username: string, name: string) {
  return { Username: username, Attributes: [{ Name: 'name', Value: name }, { Name: 'email', Value: `${username}@test.com` }] };
}

describe('GET /admin/reports — evaluatorStats', () => {
  it('omits evaluatorStats entirely for an EVALUATOR caller (peer review data stays admin-only)', async () => {
    listUsersInGroupMock.mockResolvedValue({ Users: [] });
    const prisma = makePrisma({ course: { findMany: vi.fn().mockResolvedValue([]) } });
    const ctx = makeAdminCtx({ event: makeEvent('EVALUATOR', 'GET', '/admin/reports'), method: 'GET', path: '/admin/reports', prisma });
    const res = await handleReports(ctx);
    const body = await bodyOf(res);
    expect(body.data.evaluatorStats).toBeUndefined();
    expect(listUsersInGroupMock).not.toHaveBeenCalled();
  });

  it('builds per-evaluator stats for an ADMIN caller — courses managed, students managed, review counts, avg review time', async () => {
    listUsersInGroupMock.mockResolvedValue({ Users: [evaluatorUser('eval-1', 'Maria Lopez'), evaluatorUser('eval-2', 'Carlos Ruiz')] });
    dynamoMocks.getAllReflections.mockResolvedValue([
      { moduleId: 'm1', userId: 'student-a', evaluatorId: 'eval-1', status: 'APPROVED', submittedAt: '2026-09-01T00:00:00Z', reviewedAt: '2026-09-01T02:00:00Z' },
      { moduleId: 'm1', userId: 'student-b', evaluatorId: 'eval-1', status: 'REJECTED', submittedAt: '2026-09-02T00:00:00Z', reviewedAt: '2026-09-02T06:00:00Z' },
      { moduleId: 'm2', userId: 'student-c', evaluatorId: 'eval-1', status: 'PENDING_EVAL', submittedAt: '2026-09-03T00:00:00Z' },
      // eval-2 has zero reflections — should still appear with zeroed stats, not be dropped
    ]);
    dynamoMocks.getAllEnrollments.mockResolvedValue([
      { userId: 'student-a', courseId: 'c1' },
      { userId: 'student-b', courseId: 'c1' },
      { userId: 'student-d', courseId: 'c2' }, // c2 belongs to eval-2
    ]);
    const prisma = makePrisma({
      course: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'c1', evaluatorId: 'eval-1', modules: [{ id: 'm1', title: 'Mod 1', lessons: [] }, { id: 'm2', title: 'Mod 2', lessons: [] }] },
          { id: 'c2', evaluatorId: 'eval-2', modules: [] },
        ]),
      },
    });
    const ctx = makeAdminCtx({ event: makeEvent('ADMIN', 'GET', '/admin/reports'), method: 'GET', path: '/admin/reports', prisma });
    const res = await handleReports(ctx);
    const body = await bodyOf(res);

    expect(body.data.evaluatorStats).toEqual([
      {
        evaluatorId: 'eval-1', name: 'Maria Lopez',
        coursesManaged: 1, studentsManaged: 2,
        totalReviewed: 2, approved: 1, rejected: 1, avgHoursToReview: 4,
      },
      {
        evaluatorId: 'eval-2', name: 'Carlos Ruiz',
        coursesManaged: 1, studentsManaged: 1,
        totalReviewed: 0, approved: 0, rejected: 0, avgHoursToReview: null,
      },
    ]);
  });
});
