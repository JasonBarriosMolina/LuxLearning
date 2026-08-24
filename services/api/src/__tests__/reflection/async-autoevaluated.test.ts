/**
 * Tests: async isAutoevaluated course flow in sqs-consumer.
 * Verifies: APPROVED bypass, REJECTED still works, evaluator path skipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockGetReflection = vi.fn();
const mockUpdateReflectionStatus = vi.fn();
const mockCreateNotification = vi.fn();
const mockGetUserLang = vi.fn().mockResolvedValue('es');
const mockDetectAI = vi.fn();

vi.mock('../../shared/db-dynamo', () => ({
  getReflection: mockGetReflection,
  updateReflectionStatus: mockUpdateReflectionStatus,
  createNotification: mockCreateNotification,
  getPushSubscriptionsByUserId: vi.fn().mockResolvedValue([]),
  getUserLang: mockGetUserLang,
  updateAttendanceRecord: vi.fn(),
}));

vi.mock('../../reflection/detect-ai', () => ({
  detectAI: mockDetectAI,
}));

vi.mock('../../shared/vapid', () => ({
  getVapidKeys: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../shared/env-context', () => ({
  setCurrentEnv: vi.fn(),
  getCurrentEnv: vi.fn().mockReturnValue('test'),
  AppEnv: {},
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { (this as any).send = vi.fn(); }),
  AdminGetUserCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function () { (this as any).send = vi.fn(); }),
  GetObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(function () { (this as any).send = vi.fn(); }),
  InvokeModelCommand: vi.fn(),
}));

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

vi.mock('../../shared/email', () => ({ sendTemplatedEmail: vi.fn() }));

// ── Import handler after mocks ────────────────────────────────────────────────
const { handler } = await import('../../reflection/sqs-consumer');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeSqsEvent(body: object) {
  return { Records: [{ body: JSON.stringify(body), messageId: 'msg-1' }] } as any;
}

const baseReflection = {
  userId: 'stu-1', moduleId: 'mod-1',
  text: 'Mi reflexión de prueba', wordCount: 10,
  status: 'PENDING_AI',
  submittedAt: new Date().toISOString(),
  moduleTitle: 'Módulo 1', courseTitle: 'Curso Test',
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('SQS Consumer — async isAutoevaluated bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserLang.mockResolvedValue('es');
  });

  it('approves automatically when isAutoevaluated=true and AI confidence < reject threshold', async () => {
    mockGetReflection.mockResolvedValue({ ...baseReflection, isAutoevaluated: true });
    mockDetectAI.mockResolvedValue({ isAI: false, confidence: 20 });

    await handler(makeSqsEvent({ userId: 'stu-1', moduleId: 'mod-1', isAutoevaluated: true }));

    expect(mockUpdateReflectionStatus).toHaveBeenCalledWith('stu-1', 'mod-1', expect.objectContaining({
      status: 'APPROVED',
    }));
    // Student gets notification
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'stu-1',
      message: expect.stringContaining('aprobada automáticamente'),
    }));
  });

  it('still rejects when AI confidence >= 85 even for isAutoevaluated courses', async () => {
    mockGetReflection.mockResolvedValue({ ...baseReflection, isAutoevaluated: true });
    mockDetectAI.mockResolvedValue({ isAI: true, confidence: 92 });

    await handler(makeSqsEvent({ userId: 'stu-1', moduleId: 'mod-1', isAutoevaluated: true }));

    expect(mockUpdateReflectionStatus).toHaveBeenCalledWith('stu-1', 'mod-1', expect.objectContaining({
      status: 'REJECTED',
    }));
  });

  it('goes to PENDING_EVAL when isAutoevaluated=false (normal course)', async () => {
    mockGetReflection.mockResolvedValue({ ...baseReflection, isAutoevaluated: false });
    mockDetectAI.mockResolvedValue({ isAI: false, confidence: 10 });

    await handler(makeSqsEvent({ userId: 'stu-1', moduleId: 'mod-1', isAutoevaluated: false }));

    expect(mockUpdateReflectionStatus).toHaveBeenCalledWith('stu-1', 'mod-1', expect.objectContaining({
      status: 'PENDING_EVAL',
    }));
    // No auto-approval notification
    expect(mockCreateNotification).not.toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('aprobada automáticamente'),
    }));
  });

  it('reads isAutoevaluated from reflection DynamoDB record as fallback', async () => {
    // SQS message doesn't have isAutoevaluated but reflection record does
    mockGetReflection.mockResolvedValue({ ...baseReflection, isAutoevaluated: true });
    mockDetectAI.mockResolvedValue({ isAI: false, confidence: 15 });

    // No isAutoevaluated in SQS message (legacy path)
    await handler(makeSqsEvent({ userId: 'stu-1', moduleId: 'mod-1' }));

    expect(mockUpdateReflectionStatus).toHaveBeenCalledWith('stu-1', 'mod-1', expect.objectContaining({
      status: 'APPROVED',
    }));
  });

  it('skips processing when reflection status is not PENDING_AI', async () => {
    mockGetReflection.mockResolvedValue({ ...baseReflection, status: 'APPROVED' });

    await handler(makeSqsEvent({ userId: 'stu-1', moduleId: 'mod-1' }));

    expect(mockDetectAI).not.toHaveBeenCalled();
    expect(mockUpdateReflectionStatus).not.toHaveBeenCalled();
  });
});
