/**
 * Tests for evaluator/groups.ts — covers the upsertMembership shape bug and
 * upsertChat type case bug fixed in the refactor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEvalCtx, makePrisma, bodyOf } from '../helpers/ctx';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// vi.hoisted so the factory closure can reference this before import hoisting
const cognitoSend = vi.hoisted(() => vi.fn().mockResolvedValue({
  UserAttributes: [
    { Name: 'email', Value: 'student@test.com' },
    { Name: 'name', Value: 'Student Name' },
  ],
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function() { return { send: cognitoSend }; },
  AdminGetUserCommand:           function(x: any) { return x; },
  ListUsersInGroupCommand:       function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient:        function() { return { send: vi.fn() }; },
  SendEmailCommand: function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function() { return { send: vi.fn() }; },
  InvokeModelCommand:   function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient:  function() { return { send: vi.fn() }; },
  InvokeCommand: function(x: any) { return x; },
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: function() { return { send: vi.fn() }; },
}));
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient:             function() { return { send: vi.fn() }; },
  SynthesizeSpeechCommand: function(x: any) { return x; },
}));

vi.mock('../../shared/db-dynamo', () => ({
  getAllEnrollments:  vi.fn().mockResolvedValue([]),
  createEnrollment:  vi.fn().mockResolvedValue(undefined),
  getEnrollments:    vi.fn().mockResolvedValue([]),
  createTask:        vi.fn().mockResolvedValue(undefined),
  getPushSubscriptionsByUserId: vi.fn().mockResolvedValue([]),
}));

// Captures for assertion — must use vi.hoisted so factories can reference them
const upsertChatMock       = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const upsertMembershipMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../shared/db-messages', () => ({
  upsertChat:       upsertChatMock,
  upsertMembership: upsertMembershipMock,
}));

vi.mock('../../shared/email', () => ({
  sendTemplatedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { handleGroups } from '../../evaluator/groups';
import { createTask }   from '../../shared/db-dynamo';

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /evaluator/groups/:id/enroll', () => {
  const GROUP_ID  = 'group-abc';
  const COURSE_ID = 'course-xyz';
  const USER_ID   = 'student-uid';

  function makeEnrollCtx(bodyOverride?: Record<string, any>) {
    const prisma = makePrisma({
      studentGroupEvaluator: {
        findUnique: vi.fn().mockResolvedValue({ groupId: GROUP_ID, evaluatorId: 'eval-uuid' }),
      },
      studentGroup: {
        findUnique: vi.fn().mockResolvedValue({ id: GROUP_ID, createdByEvaluatorId: 'eval-uuid' }),
      },
      course: {
        findUnique: vi.fn().mockResolvedValue({
          id: COURSE_ID, title: 'Curso de Prueba',
          modules: [{ id: 'm1', title: 'Módulo 1', order: 1, lessons: [] }],
        }),
      },
      studentGroupMember: {
        findUnique: vi.fn().mockResolvedValue(null),
        update:     vi.fn().mockResolvedValue({}),
      },
    });

    return makeEvalCtx({
      method: 'POST',
      path:   `/evaluator/groups/${GROUP_ID}/enroll`,
      prisma,
      body:   bodyOverride ?? { userIds: [USER_ID], courseId: COURSE_ID },
      userId: 'eval-uuid',
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cognitoSend.mockResolvedValue({
      UserAttributes: [
        { Name: 'email', Value: 'student@test.com' },
        { Name: 'name', Value: 'Student Name' },
      ],
    });
  });

  it('calls upsertChat with uppercase GROUP type', async () => {
    const ctx = makeEnrollCtx();
    await handleGroups(ctx);

    const chatCall = upsertChatMock.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('group_')
    );
    expect(chatCall).toBeDefined();
    expect(chatCall![1].type).toBe('GROUP');
  });

  it('calls upsertMembership with chatName and chatType (not role/name)', async () => {
    const ctx = makeEnrollCtx();
    await handleGroups(ctx);

    const membershipCall = upsertMembershipMock.mock.calls.find(
      (c: any[]) => typeof c[1] === 'string' && c[1].startsWith('group_')
    );
    expect(membershipCall).toBeDefined();
    const meta = membershipCall![2];
    expect(meta).toHaveProperty('chatName');
    expect(meta).toHaveProperty('chatType');
    expect(meta).not.toHaveProperty('role');
    expect(meta).not.toHaveProperty('name');
    expect(meta.chatType).toBe('GROUP');
  });

  it('upsertMembership chatName contains course title', async () => {
    const ctx = makeEnrollCtx();
    await handleGroups(ctx);

    const membershipCall = upsertMembershipMock.mock.calls.find(
      (c: any[]) => typeof c[1] === 'string' && c[1].startsWith('group_')
    );
    expect(membershipCall![2].chatName).toContain('Curso de Prueba');
  });

  it('createTask receives courseTitle and moduleTitle', async () => {
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockClear();

    const ctx = makeEnrollCtx();
    await handleGroups(ctx);

    expect(createTaskMock).toHaveBeenCalled();
    const taskArg = createTaskMock.mock.calls[0]![0] as any;
    expect(taskArg).toHaveProperty('courseTitle', 'Curso de Prueba');
    expect(taskArg).toHaveProperty('moduleTitle', 'Módulo 1');
  });

  it('createTask dueDate matches YYYY-MM-DD format', async () => {
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockClear();

    const ctx = makeEnrollCtx();
    await handleGroups(ctx);

    expect(createTaskMock).toHaveBeenCalled();
    const taskArg = createTaskMock.mock.calls[0]![0] as any;
    expect(taskArg.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns 400 when userIds is missing', async () => {
    const ctx = makeEnrollCtx({ courseId: COURSE_ID });
    const res = await handleGroups(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when courseId is missing', async () => {
    const ctx = makeEnrollCtx({ userIds: [USER_ID] });
    const res = await handleGroups(ctx);
    expect(res?.statusCode).toBe(400);
  });
});

describe('GET /evaluator/groups — returns groups list', () => {
  it('returns 200 with groups array', async () => {
    const prisma = makePrisma({
      studentGroupEvaluator: {
        findMany: vi.fn().mockResolvedValue([
          { groupId: 'g1', group: { id: 'g1', name: 'Grupo A', _count: { members: 5 } } },
        ]),
      },
      studentGroup: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const ctx = makeEvalCtx({ method: 'GET', path: '/evaluator/groups', prisma });
    const res = await handleGroups(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
