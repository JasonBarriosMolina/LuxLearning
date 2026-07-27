import { vi } from 'vitest';

/** Builds a mock Prisma client where every model method is a spy returning sensible defaults. */
export function makePrisma(overrides: Record<string, Partial<ReturnType<typeof mockModel>>> = {}) {
  function mockModel() {
    return {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany:   vi.fn().mockResolvedValue([]),
      create:     vi.fn().mockResolvedValue({ id: 'obj-id' }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update:     vi.fn().mockResolvedValue({ id: 'obj-id' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete:     vi.fn().mockResolvedValue({ id: 'obj-id' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count:      vi.fn().mockResolvedValue(0),
      upsert:     vi.fn().mockResolvedValue({ id: 'obj-id' }),
    };
  }
  const base = {
    course:                 mockModel(),
    module:                 mockModel(),
    lesson:                 mockModel(),
    question:               mockModel(),
    studentGroup:           mockModel(),
    studentGroupMember:     mockModel(),
    studentGroupEvaluator:  mockModel(),
    evaluationEvent:        mockModel(),
    courseSession:          mockModel(),
    enrollment:             mockModel(),
    $transaction:           vi.fn().mockResolvedValue([]),
  };
  for (const [k, v] of Object.entries(overrides)) {
    (base as any)[k] = { ...(base as any)[k], ...v };
  }
  return base;
}

/** Builds a fake APIGatewayProxyEventV2 with the given role */
export function makeEvent(role = 'ADMIN', method = 'GET', path = '/', opts: { body?: any; qs?: Record<string, string> } = {}) {
  return {
    requestContext: {
      http: { method },
      authorizer: { lambda: { role, userId: 'user-uuid', email: 'admin@test.com' } },
    },
    rawPath: path,
    headers: { origin: 'https://lux-learning-mentor.vercel.app' },
    queryStringParameters: opts.qs ?? {},
    body: opts.body != null ? JSON.stringify(opts.body) : null,
  } as any;
}

/** Admin ctx — default role ADMIN */
export function makeAdminCtx(overrides: Record<string, any> = {}) {
  return {
    event:   makeEvent('ADMIN'),
    method:  'GET',
    path:    '/',
    prisma:  makePrisma(),
    body:    {},
    action:  undefined as string | undefined,
    userId:  'user-uuid',
    ...overrides,
  };
}

/** Evaluator ctx — default role EVALUATOR */
export function makeEvalCtx(overrides: Record<string, any> = {}) {
  return {
    event:       makeEvent('EVALUATOR'),
    method:      'GET',
    path:        '/',
    prisma:      makePrisma(),
    body:        {},
    userId:      'eval-uuid',
    isAdminRole: false,
    ...overrides,
  };
}

/** Parse JSON body from a handler response */
export async function bodyOf(res: any): Promise<any> {
  if (!res?.body) return null;
  try { return JSON.parse(res.body); } catch { return res.body; }
}
