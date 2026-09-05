/**
 * Tests: POST /reflection — the quiz-passed gate.
 *
 * Trello DmPpbrff, 2026-09-05 (Mack): a module with NO quiz planned at all
 * permanently blocked its reflection with "You must pass the quiz before
 * submitting a reflection". hasPassedQuiz checks DynamoDB QuizAttempts, which
 * can never contain a passed attempt for a quiz that doesn't exist — the gate
 * needs to only apply when the module actually has one planned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHasPassedQuiz = vi.fn();
const mockIsModuleUnlocked = vi.fn().mockResolvedValue(true);
const mockGetReflection = vi.fn().mockResolvedValue(null);
const mockSaveReflection = vi.fn().mockResolvedValue(undefined);
const mockGetLessonProgress = vi.fn().mockResolvedValue([]);
const mockGetPushSubscriptionsByRole = vi.fn().mockResolvedValue([]);

vi.mock('../../shared/db-dynamo', () => ({
  saveReflection: mockSaveReflection,
  getReflection: mockGetReflection,
  updateReflectionStatus: vi.fn(),
  hasPassedQuiz: mockHasPassedQuiz,
  isModuleUnlocked: mockIsModuleUnlocked,
  getPushSubscriptionsByRole: mockGetPushSubscriptionsByRole,
  getLessonProgress: mockGetLessonProgress,
}));

const mockModuleFindUnique = vi.fn();
vi.mock('../../shared/db-neon', () => ({
  getPrismaClient: vi.fn().mockResolvedValue({ module: { findUnique: mockModuleFindUnique } }),
}));

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(function (this: any) { this.send = vi.fn().mockResolvedValue({}); }),
  SendMessageCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(function (this: any) { this.send = vi.fn(); }),
  InvokeModelCommand: function (x: any) { return x; },
}));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));
vi.mock('../../shared/vapid', () => ({ getVapidKeys: vi.fn().mockResolvedValue(null) }));
vi.mock('../../shared/env-context', () => ({
  setRequestOrigin: vi.fn(), setEnvironmentFromOrigin: vi.fn(), getCurrentEnv: vi.fn().mockReturnValue('test'),
}));
vi.mock('../../shared/prompt-safety', () => ({ wrapUntrustedText: (t: string) => t }));

const { handler } = await import('../../reflection/handler');

function makeEvent(body: any) {
  return {
    headers: {},
    requestContext: { http: { method: 'POST' }, authorizer: { lambda: { userId: 'stu-1', email: 's@test.com', role: 'STUDENT' } } },
    rawPath: '/reflection',
    body: JSON.stringify(body),
  } as any;
}

const longText = 'palabra '.repeat(90); // MIN_WORDS = 80

const baseModule = {
  id: 'mod-1', title: 'Módulo 1', order: 1,
  course: {
    id: 'course-1', title: 'Curso 1', startDate: null, weeklyPacingEnabled: false, isAutoevaluated: false, evaluatorId: null,
    modules: [{ id: 'mod-1', order: 1, lessons: [] }],
    evaluationEvents: [] as { type: string; moduleId: string }[],
  },
};

describe('POST /reflection — quiz gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsModuleUnlocked.mockResolvedValue(true);
    mockGetReflection.mockResolvedValue(null);
  });

  it('blocks submission when a quiz IS planned for the module and not passed', async () => {
    mockModuleFindUnique.mockResolvedValue({
      ...baseModule,
      course: { ...baseModule.course, evaluationEvents: [{ type: 'QUIZ', moduleId: 'mod-1' }] },
    });
    mockHasPassedQuiz.mockResolvedValue(false);

    const res = await handler(makeEvent({ moduleId: 'mod-1', text: longText }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/pass the quiz/i);
    expect(mockSaveReflection).not.toHaveBeenCalled();
  });

  it('allows submission when a quiz IS planned and already passed', async () => {
    mockModuleFindUnique.mockResolvedValue({
      ...baseModule,
      course: { ...baseModule.course, evaluationEvents: [{ type: 'QUIZ', moduleId: 'mod-1' }] },
    });
    mockHasPassedQuiz.mockResolvedValue(true);

    const res = await handler(makeEvent({ moduleId: 'mod-1', text: longText }));
    expect(res.statusCode).toBe(200);
    expect(mockSaveReflection).toHaveBeenCalled();
  });

  it('allows submission when NO quiz is planned for the module at all (the reported bug)', async () => {
    mockModuleFindUnique.mockResolvedValue(baseModule); // evaluationEvents: []
    mockHasPassedQuiz.mockResolvedValue(false); // would fail if the gate wrongly ran anyway

    const res = await handler(makeEvent({ moduleId: 'mod-1', text: longText }));
    expect(res.statusCode).toBe(200);
    expect(mockSaveReflection).toHaveBeenCalled();
    // The whole point of the fix: hasPassedQuiz must not even be consulted when
    // there's no quiz to have passed.
    expect(mockHasPassedQuiz).not.toHaveBeenCalled();
  });

  it('still enforces the module-lock check independently of the quiz gate', async () => {
    mockModuleFindUnique.mockResolvedValue(baseModule);
    mockIsModuleUnlocked.mockResolvedValue(false);

    const res = await handler(makeEvent({ moduleId: 'mod-1', text: longText }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/locked/i);
  });
});
