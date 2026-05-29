import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('../shared/db-dynamo', () => ({
  getCertificatesByUser: vi.fn(),
  getCertificate: vi.fn(),
  getCertificateByUserAndCourse: vi.fn(),
  saveCertificate: vi.fn(),
  getReflection: vi.fn(),
  getAllReflections: vi.fn(),
  getAllLessonProgress: vi.fn(),
  getAllQuizAttempts: vi.fn(),
  getAllEnrollments: vi.fn(),
  getEnrollments: vi.fn(),
  updateReflectionStatus: vi.fn(),
  setReflectionPriority: vi.fn(),
  createNotification: vi.fn(),
  getQuizAttempts: vi.fn(),
  getPushSubscriptionsByUserId: vi.fn(),
  createTask: vi.fn(),
  getTasksForUser: vi.fn(),
  getTasksByCourse: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  getLastSeenAll: vi.fn(),
  getSignature: vi.fn(),
  saveSignature: vi.fn(),
  TABLES: {},
  ddb: {},
}));

vi.mock('../shared/db-neon', () => ({
  getPrismaClient: vi.fn(),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class CognitoIdentityProviderClient {
    send = vi.fn().mockResolvedValue({ UserAttributes: [] });
  }
  return {
    CognitoIdentityProviderClient,
    AdminGetUserCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-ses', () => {
  class SESClient { send = vi.fn().mockResolvedValue({}); }
  return { SESClient, SendEmailCommand: vi.fn() };
});

vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  class BedrockRuntimeClient { send = vi.fn().mockResolvedValue({}); }
  return { BedrockRuntimeClient, InvokeModelCommand: vi.fn() };
});

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../reflection/detect-ai', () => ({ detectAI: vi.fn().mockResolvedValue({ score: 0 }) }));

vi.mock('../shared/response', async (importOriginal) => {
  const original = await importOriginal<typeof import('../shared/response')>();
  return original;
});

import { handler } from '../evaluator/handler';
import { getCertificatesByUser } from '../shared/db-dynamo';
import { getPrismaClient } from '../shared/db-neon';

// ── Helper ──────────────────────────────────────────────────────────────────
function makeEvent(method: string, path: string, role = 'EVALUATOR') {
  return {
    requestContext: {
      http: { method },
      authorizer: { lambda: { userId: 'evaluator-1', email: 'eval@test.com', role } },
    },
    rawPath: path,
    body: undefined,
    queryStringParameters: {},
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPrismaClient).mockResolvedValue({} as any);
});

// ── GET /evaluator/students/:userId/certificates ────────────────────────────
describe('GET /evaluator/students/:userId/certificates', () => {
  it('returns 403 for STUDENT role', async () => {
    const res = await handler(makeEvent('GET', '/evaluator/students/user-1/certificates', 'STUDENT')) as any;
    expect(res.statusCode).toBe(403);
  });

  it('returns empty array when no certificates exist', async () => {
    vi.mocked(getCertificatesByUser).mockResolvedValue([]);
    const res = await handler(makeEvent('GET', '/evaluator/students/user-1/certificates')) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toEqual([]);
  });

  it('returns certificate list when certs exist', async () => {
    const certs = [
      { certId: 'cert-1', userId: 'user-1', courseId: 'c-1', courseTitle: 'Curso A', issuedAt: '2025-01-01' },
      { certId: 'cert-2', userId: 'user-1', courseId: 'c-2', courseTitle: 'Curso B', issuedAt: '2025-02-01' },
    ];
    vi.mocked(getCertificatesByUser).mockResolvedValue(certs as any);
    const res = await handler(makeEvent('GET', '/evaluator/students/user-1/certificates')) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].certId).toBe('cert-1');
    expect(body.data[1].certId).toBe('cert-2');
  });

  it('calls getCertificatesByUser with the correct userId', async () => {
    vi.mocked(getCertificatesByUser).mockResolvedValue([]);
    await handler(makeEvent('GET', '/evaluator/students/specific-user-123/certificates'));
    expect(vi.mocked(getCertificatesByUser)).toHaveBeenCalledWith('specific-user-123');
  });

  it('works for ADMIN role as well', async () => {
    vi.mocked(getCertificatesByUser).mockResolvedValue([]);
    const res = await handler(makeEvent('GET', '/evaluator/students/user-1/certificates', 'ADMIN')) as any;
    expect(res.statusCode).toBe(200);
  });
});
