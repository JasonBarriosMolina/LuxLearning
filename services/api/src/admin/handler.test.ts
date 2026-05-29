import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './handler';

// ── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('../shared/db-dynamo', () => ({
  createEnrollment: vi.fn(),
  getEnrollments: vi.fn(),
  deleteEnrollment: vi.fn(),
  createTask: vi.fn(),
  getAllReflections: vi.fn(),
  getAllLessonProgress: vi.fn(),
  getAllEnrollments: vi.fn(),
  saveAiJob: vi.fn(),
  getAiJob: vi.fn(),
}));

vi.mock('../shared/db-neon', () => ({
  getPrismaClient: vi.fn(),
}));

vi.mock('../shared/db-messages', () => ({
  upsertChat: vi.fn(),
  upsertMembership: vi.fn(),
}));

vi.mock('../shared/response', async (importOriginal) => {
  const original = await importOriginal<typeof import('../shared/response')>();
  return original;
});

// Mock AWS SDK clients — prevent real network calls
vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class CognitoIdentityProviderClient {
    send = vi.fn().mockResolvedValue({ UserAttributes: [] });
  }
  return {
    CognitoIdentityProviderClient,
    ListUsersCommand: vi.fn(),
    ListUsersInGroupCommand: vi.fn(),
    AdminCreateUserCommand: vi.fn(),
    AdminAddUserToGroupCommand: vi.fn(),
    AdminRemoveUserFromGroupCommand: vi.fn(),
    AdminDisableUserCommand: vi.fn(),
    AdminEnableUserCommand: vi.fn(),
    AdminDeleteUserCommand: vi.fn(),
    AdminGetUserCommand: vi.fn(),
    AdminUpdateUserAttributesCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-ses', () => {
  class SESClient {
    send = vi.fn().mockResolvedValue({});
  }
  return { SESClient, SendEmailCommand: vi.fn() };
});

vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  class BedrockRuntimeClient {
    send = vi.fn().mockResolvedValue({});
  }
  return { BedrockRuntimeClient, InvokeModelCommand: vi.fn() };
});

vi.mock('@aws-sdk/client-lambda', () => {
  class LambdaClient {
    send = vi.fn().mockResolvedValue({});
  }
  return { LambdaClient, InvokeCommand: vi.fn() };
});

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = vi.fn().mockResolvedValue({});
  }
  return { S3Client, PutObjectCommand: vi.fn() };
});

vi.mock('sharp', () => ({ default: vi.fn() }));
vi.mock('jsonrepair', () => ({ jsonrepair: vi.fn((s: string) => s) }));

import { createEnrollment, createTask } from '../shared/db-dynamo';
import { getPrismaClient } from '../shared/db-neon';
import { upsertMembership, upsertChat } from '../shared/db-messages';

// ── Helpers ────────────────────────────────────────────────────────────────
function makeEvent(method: string, path: string, body?: object, role = 'EVALUATOR') {
  return {
    requestContext: {
      http: { method },
      authorizer: { lambda: { userId: 'evaluator-1', email: 'eval@test.com', role } },
    },
    rawPath: path,
    body: body ? JSON.stringify(body) : undefined,
    queryStringParameters: {},
  } as any;
}

// ── Mock Prisma factory ────────────────────────────────────────────────────
function makePrisma(overrides: Record<string, any> = {}) {
  return {
    module: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    course: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    lesson: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    question: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createEnrollment).mockResolvedValue(undefined as any);
  vi.mocked(createTask).mockResolvedValue(undefined as any);
  vi.mocked(upsertMembership).mockResolvedValue(undefined as any);
  vi.mocked(upsertChat).mockResolvedValue(undefined as any);
  vi.mocked(getPrismaClient).mockReturnValue(makePrisma() as any);
});

// ── GET /admin/users/:username/enrollments ─────────────────────────────────
describe('GET /admin/users/:username/enrollments', () => {
  it('returns courseIds for a user', async () => {
    const { getEnrollments } = await import('../shared/db-dynamo');
    vi.mocked(getEnrollments).mockResolvedValue(['course-1', 'course-2'] as any);
    const res = await handler(makeEvent('GET', '/admin/users/student-1/enrollments')) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.courseIds).toEqual(['course-1', 'course-2']);
  });

  it('returns 403 for STUDENT role', async () => {
    const res = await handler(makeEvent('GET', '/admin/users/student-1/enrollments', undefined, 'STUDENT')) as any;
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /admin/users/:username/enrollments (M-7) ──────────────────────────
describe('POST /admin/users/:username/enrollments — M-7 auto-tasks', () => {
  const COURSE_ID = 'course-abc';
  const USERNAME = 'student-x';

  const modules = [
    { id: 'mod-1', title: 'Módulo 1', order: 1 },
    { id: 'mod-2', title: 'Módulo 2', order: 2 },
    { id: 'mod-3', title: 'Módulo 3', order: 3 },
  ];

  beforeEach(() => {
    vi.mocked(getPrismaClient).mockReturnValue(
      makePrisma({
        module: {
          findMany: vi.fn().mockResolvedValue(modules),
          count: vi.fn().mockResolvedValue(3),
        },
        course: {
          findUnique: vi.fn().mockResolvedValue({ title: 'Mi Curso' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
      }) as any,
    );
  });

  it('creates one task per module', async () => {
    const res = await handler(
      makeEvent('POST', `/admin/users/${USERNAME}/enrollments`, { courseId: COURSE_ID }),
    ) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.enrolled).toBe(true);
    expect(vi.mocked(createTask)).toHaveBeenCalledTimes(3);
  });

  it('assigns dueDate = enrollDate + 7×order days for each module', async () => {
    const before = new Date();
    await handler(
      makeEvent('POST', `/admin/users/${USERNAME}/enrollments`, { courseId: COURSE_ID }),
    );
    const after = new Date();

    const calls = vi.mocked(createTask).mock.calls;
    expect(calls).toHaveLength(3);

    for (const mod of modules) {
      const call = calls.find((c) => c[0].moduleId === mod.id);
      expect(call).toBeDefined();
      const task = call![0];

      // dueDate must be enrollDate + 7*order
      const dueDateStr = task.dueDate as string;
      const due = new Date(dueDateStr);

      const minExpected = new Date(before);
      minExpected.setDate(minExpected.getDate() + 7 * mod.order);
      const maxExpected = new Date(after);
      maxExpected.setDate(maxExpected.getDate() + 7 * mod.order);

      expect(due.toISOString().slice(0, 10)).toBe(minExpected.toISOString().slice(0, 10));
      expect(due >= new Date(minExpected.toISOString().slice(0, 10))).toBe(true);
      expect(due <= new Date(maxExpected.toISOString().slice(0, 10) + 'T23:59:59Z')).toBe(true);
    }
  });

  it('sets correct task fields (type, assignedBy, status, userId)', async () => {
    await handler(
      makeEvent('POST', `/admin/users/${USERNAME}/enrollments`, { courseId: COURSE_ID }),
    );
    const calls = vi.mocked(createTask).mock.calls;
    for (const [task] of calls) {
      expect(task.userId).toBe(USERNAME);
      expect(task.type).toBe('complete_module');
      expect(task.assignedBy).toBe('system');
      expect(task.status).toBe('PENDING');
      expect(task.courseId).toBe(COURSE_ID);
      expect(task.courseTitle).toBe('Mi Curso');
    }
  });

  it('task titles include module title', async () => {
    await handler(
      makeEvent('POST', `/admin/users/${USERNAME}/enrollments`, { courseId: COURSE_ID }),
    );
    const calls = vi.mocked(createTask).mock.calls;
    const titles = calls.map(([t]) => t.title as string);
    expect(titles).toContain('Completar módulo: Módulo 1');
    expect(titles).toContain('Completar módulo: Módulo 2');
    expect(titles).toContain('Completar módulo: Módulo 3');
  });

  it('taskIds follow auto-{courseId}-{moduleId} pattern', async () => {
    await handler(
      makeEvent('POST', `/admin/users/${USERNAME}/enrollments`, { courseId: COURSE_ID }),
    );
    const calls = vi.mocked(createTask).mock.calls;
    for (const [task] of calls) {
      expect(task.taskId).toMatch(/^auto-course-abc-mod-\d+$/);
    }
  });

  it('returns 400 when courseId is missing', async () => {
    const res = await handler(
      makeEvent('POST', `/admin/users/${USERNAME}/enrollments`, {}),
    ) as any;
    expect(res.statusCode).toBe(400);
    expect(vi.mocked(createTask)).not.toHaveBeenCalled();
  });

  it('still returns enrolled:true even if task creation throws (non-fatal)', async () => {
    vi.mocked(createTask).mockRejectedValue(new Error('DynamoDB timeout'));
    const res = await handler(
      makeEvent('POST', `/admin/users/${USERNAME}/enrollments`, { courseId: COURSE_ID }),
    ) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.enrolled).toBe(true);
  });

  it('calls createEnrollment with correct args', async () => {
    await handler(
      makeEvent('POST', `/admin/users/${USERNAME}/enrollments`, { courseId: COURSE_ID }),
    );
    expect(vi.mocked(createEnrollment)).toHaveBeenCalledWith(USERNAME, COURSE_ID);
  });
});

// ── DELETE /admin/users/:username/enrollments ──────────────────────────────
describe('DELETE /admin/users/:username/enrollments', () => {
  it('deletes enrollment successfully', async () => {
    const { deleteEnrollment } = await import('../shared/db-dynamo');
    vi.mocked(deleteEnrollment).mockResolvedValue(undefined as any);
    const res = await handler(
      makeEvent('DELETE', '/admin/users/student-1/enrollments', { courseId: 'course-1' }),
    ) as any;
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(deleteEnrollment)).toHaveBeenCalledWith('student-1', 'course-1');
  });
});

// ── POST /admin/modules/:moduleId/questions — shuffle correctIndex ─────────
describe('POST /admin/modules/:moduleId/questions — shuffle on creation', () => {
  const MODULE_ID = 'mod-shuffle-1';

  beforeEach(() => {
    vi.mocked(getPrismaClient).mockReturnValue(
      makePrisma({
        question: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'q-1', ...data })),
        },
      }) as any,
    );
  });

  it('returns 400 when text is missing', async () => {
    const res = await handler(
      makeEvent('POST', `/admin/modules/${MODULE_ID}/questions`, {
        options: ['A', 'B', 'C', 'D'], correctIndex: 0,
      }, 'ADMIN'),
    ) as any;
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when options has fewer than 2 items', async () => {
    const res = await handler(
      makeEvent('POST', `/admin/modules/${MODULE_ID}/questions`, {
        text: '¿Pregunta?', options: ['Solo una'], correctIndex: 0,
      }, 'ADMIN'),
    ) as any;
    expect(res.statusCode).toBe(400);
  });

  it('creates question and the correctIndex points to the correct answer text after shuffle', async () => {
    const options = ['Respuesta correcta', 'Opción B', 'Opción C', 'Opción D'];
    const correctIndex = 0; // Correct answer is initially at index 0

    const res = await handler(
      makeEvent('POST', `/admin/modules/${MODULE_ID}/questions`, {
        text: '¿Cuál es la correcta?', options, correctIndex,
      }, 'ADMIN'),
    ) as any;

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    // The saved correctIndex should still point to "Respuesta correcta"
    expect(body.data.options[body.data.correctIndex]).toBe('Respuesta correcta');
  });

  it('distributes correctIndex across positions over multiple calls', async () => {
    // Run 20 question creations — the correct answer position should not always be 0
    const positions = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const res = await handler(
        makeEvent('POST', `/admin/modules/${MODULE_ID}/questions`, {
          text: `¿Pregunta ${i}?`,
          options: ['Correcta', 'Opción B', 'Opción C', 'Opción D'],
          correctIndex: 0,
        }, 'ADMIN'),
      ) as any;
      const body = JSON.parse(res.body);
      positions.add(body.data.correctIndex);
    }
    // Over 20 calls, we expect the correct answer to land in more than 1 position
    expect(positions.size).toBeGreaterThan(1);
  });

  it('returns 403 for non-admin role', async () => {
    const res = await handler(
      makeEvent('POST', `/admin/modules/${MODULE_ID}/questions`, {
        text: '¿Pregunta?', options: ['A', 'B'], correctIndex: 0,
      }, 'STUDENT'),
    ) as any;
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /admin/courses?status — draft/archive filter ───────────────────────
describe('GET /admin/courses?status — draft/archive filter', () => {
  const draftCourse = { id: 'c-draft', title: 'Borrador', isDraft: true, isArchived: false, modules: [] };
  const activeCourse = { id: 'c-active', title: 'Activo', isDraft: false, isArchived: false, modules: [] };
  const archivedCourse = { id: 'c-arch', title: 'Archivado', isDraft: false, isArchived: true, modules: [] };

  beforeEach(() => {
    vi.mocked(getPrismaClient).mockReturnValue(
      makePrisma({
        course: {
          findMany: vi.fn().mockImplementation(({ where }: any) => {
            const all = [draftCourse, activeCourse, archivedCourse];
            if (where?.isDraft === true && where?.isArchived === false) return Promise.resolve([draftCourse]);
            if (where?.isArchived === true) return Promise.resolve([archivedCourse]);
            if (where?.isDraft === false && where?.isArchived === false) return Promise.resolve([activeCourse]);
            // default: isArchived: false
            if (where?.isArchived === false) return Promise.resolve([draftCourse, activeCourse]);
            return Promise.resolve(all);
          }),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'new-course', isDraft: true }),
          update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'course-1', ...data })),
        },
      }) as any,
    );
  });

  it('?status=draft returns only drafts', async () => {
    const res = await handler(makeEvent('GET', '/admin/courses?status=draft', undefined, 'ADMIN')) as any;
    // Note: queryStringParameters won't be set from the path string; set it explicitly
    const event = makeEvent('GET', '/admin/courses', undefined, 'ADMIN');
    event.queryStringParameters = { status: 'draft' };
    const res2 = await handler(event) as any;
    expect(res2.statusCode).toBe(200);
    const body = JSON.parse(res2.body);
    const ids = body.data.map((c: any) => c.id);
    expect(ids).toContain('c-draft');
    expect(ids).not.toContain('c-active');
    expect(ids).not.toContain('c-arch');
  });

  it('?status=archived returns only archived', async () => {
    const event = makeEvent('GET', '/admin/courses', undefined, 'ADMIN');
    event.queryStringParameters = { status: 'archived' };
    const res = await handler(event) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const ids = body.data.map((c: any) => c.id);
    expect(ids).toContain('c-arch');
    expect(ids).not.toContain('c-draft');
    expect(ids).not.toContain('c-active');
  });

  it('no status param excludes archived (default)', async () => {
    const event = makeEvent('GET', '/admin/courses', undefined, 'ADMIN');
    event.queryStringParameters = {};
    const res = await handler(event) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const ids = body.data.map((c: any) => c.id);
    expect(ids).not.toContain('c-arch');
  });

  it('POST /admin/courses creates with isDraft=true', async () => {
    const res = await handler(
      makeEvent('POST', '/admin/courses', {
        title: 'Mi Curso', slug: 'mi-curso', description: 'Desc',
      }, 'ADMIN'),
    ) as any;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.isDraft).toBe(true);
  });

  it('PUT /admin/courses/:id/publish sets isDraft=false', async () => {
    const res = await handler(
      makeEvent('PUT', '/admin/courses/course-1/publish', undefined, 'ADMIN'),
    ) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.isDraft).toBe(false);
  });

  it('PUT /admin/courses/:id/archive sets isArchived=true and isActive=false', async () => {
    const res = await handler(
      makeEvent('PUT', '/admin/courses/course-1/archive', undefined, 'ADMIN'),
    ) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.isArchived).toBe(true);
    expect(body.data.isActive).toBe(false);
  });

  it('publish returns 403 for non-admin', async () => {
    const res = await handler(
      makeEvent('PUT', '/admin/courses/course-1/publish', undefined, 'EVALUATOR'),
    ) as any;
    expect(res.statusCode).toBe(403);
  });

  it('archive returns 403 for non-admin', async () => {
    const res = await handler(
      makeEvent('PUT', '/admin/courses/course-1/archive', undefined, 'EVALUATOR'),
    ) as any;
    expect(res.statusCode).toBe(403);
  });
});
