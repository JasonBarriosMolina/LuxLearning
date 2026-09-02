/**
 * Tests for courses/vapi-webhook.ts.
 * Focus: async-course interview auto-grading + evaluator notification
 * (Trello GTYQ3v1M, 2026-08-29 01:25).
 */
import { createHmac } from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../shared/vapi-keys', () => ({
  getVapiKeys: vi.fn().mockResolvedValue({ webhookSecret: 'test-webhook-secret' }),
}));
vi.mock('../../shared/vapid', () => ({
  getVapidKeys: vi.fn().mockResolvedValue(null), // push disabled by default in these tests
}));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () {
    return {
      send: vi.fn().mockResolvedValue({
        body: Buffer.from(JSON.stringify({ content: [{ text: '{"score": 85, "analysis": "Buen desempeño."}' }] })),
      }),
    };
  },
  InvokeModelCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: function () { return { send: vi.fn().mockResolvedValue({}) }; },
  SendEmailCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return { send: vi.fn().mockResolvedValue({ UserAttributes: [{ Name: 'email', Value: 'eval@test.com' }] }) }; },
  AdminGetUserCommand: function (x: any) { return x; },
}));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue(undefined) },
}));

const getInterviewByCallIdMock = vi.fn();
const updateInterviewMock = vi.fn().mockResolvedValue(undefined);
const getClassSessionByCallIdMock = vi.fn().mockResolvedValue(null);
const updateClassSessionMock = vi.fn().mockResolvedValue(undefined);
const createNotificationMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../shared/db-dynamo', () => ({
  getInterviewByCallId: (...args: any[]) => getInterviewByCallIdMock(...args),
  updateInterview: (...args: any[]) => updateInterviewMock(...args),
  getClassSessionByCallId: (...args: any[]) => getClassSessionByCallIdMock(...args),
  updateClassSession: (...args: any[]) => updateClassSessionMock(...args),
  getPushSubscriptionsByUserId: vi.fn().mockResolvedValue([]),
  createNotification: (...args: any[]) => createNotificationMock(...args),
}));

import { handleVapiWebhook } from '../../courses/vapi-webhook';

const WEBHOOK_SECRET = 'test-webhook-secret';

function makeSignedEvent(payload: any) {
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return { body: rawBody, headers: { 'x-vapi-signature': signature } };
}

async function flushAsync() {
  await new Promise((r) => setTimeout(r, 10));
}

function endOfCallPayload(overrides: any = {}) {
  return {
    message: {
      type: 'end-of-call-report',
      call: { id: 'call-1', startedAt: '2026-08-30T10:00:00Z', endedAt: '2026-08-30T10:05:00Z', endedReason: 'assistant-ended-call' },
      artifact: { transcript: 'Estudiante: Respondí bien. Mentor: Gracias.', messages: [{ role: 'assistant', content: 'Pregunta 1' }, { role: 'user', content: 'Respuesta 1' }] },
      ...overrides,
    },
  };
}

describe('handleVapiWebhook', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects with 401 when the signature is invalid', async () => {
    const event = { body: JSON.stringify(endOfCallPayload()), headers: { 'x-vapi-signature': 'bad-signature' } };
    const res = await handleVapiWebhook(event, {});
    expect(res.statusCode).toBe(401);
  });

  it('auto-grades the interview for an async (isAutoevaluated) course', async () => {
    getInterviewByCallIdMock.mockResolvedValue({ userId: 'u1', interviewId: 'i1', courseId: 'c1' });
    const prisma = { course: { findUnique: vi.fn().mockResolvedValue({ evaluatorId: 'eval-1', isAutoevaluated: true, title: 'Curso Async' }) } };
    const event = makeSignedEvent(endOfCallPayload());

    const res = await handleVapiWebhook(event, prisma);
    expect(res.statusCode).toBe(200);
    await flushAsync();

    expect(updateInterviewMock).toHaveBeenCalledWith('u1', 'i1', expect.objectContaining({
      status: 'completed', grade: 85, feedback: 'Buen desempeño.', gradedBy: 'AI_AUTO',
    }));
  });

  it('does NOT auto-grade for a non-async course — leaves it for manual evaluator grading', async () => {
    getInterviewByCallIdMock.mockResolvedValue({ userId: 'u1', interviewId: 'i1', courseId: 'c1' });
    const prisma = { course: { findUnique: vi.fn().mockResolvedValue({ evaluatorId: 'eval-1', isAutoevaluated: false, title: 'Curso Sync' }) } };
    const event = makeSignedEvent(endOfCallPayload());

    await handleVapiWebhook(event, prisma);
    await flushAsync();

    const call = updateInterviewMock.mock.calls[0]?.[2];
    expect(call.grade).toBeUndefined();
    expect(call.gradedBy).toBeUndefined();
    expect(call.status).toBe('completed');
  });

  it('notifies the evaluator in-app when different from the student', async () => {
    getInterviewByCallIdMock.mockResolvedValue({ userId: 'student-1', interviewId: 'i1', courseId: 'c1' });
    const prisma = { course: { findUnique: vi.fn().mockResolvedValue({ evaluatorId: 'eval-1', isAutoevaluated: false, title: 'Curso X' }) } };
    const event = makeSignedEvent(endOfCallPayload());

    await handleVapiWebhook(event, prisma);
    await flushAsync();

    expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'eval-1', actionUrl: '/evaluator/interviews',
    }));
  });

  it('does not notify when the course has no evaluatorId', async () => {
    getInterviewByCallIdMock.mockResolvedValue({ userId: 'student-1', interviewId: 'i1', courseId: 'c1' });
    const prisma = { course: { findUnique: vi.fn().mockResolvedValue({ evaluatorId: null, isAutoevaluated: false, title: 'Curso X' }) } };
    const event = makeSignedEvent(endOfCallPayload());

    await handleVapiWebhook(event, prisma);
    await flushAsync();

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('marks the interview voided on a short/no-audio call instead of grading it', async () => {
    getInterviewByCallIdMock.mockResolvedValue({ userId: 'u1', interviewId: 'i1', courseId: 'c1' });
    const prisma = { course: { findUnique: vi.fn().mockResolvedValue({ evaluatorId: 'eval-1', isAutoevaluated: true, title: 'Curso' }) } };
    const event = makeSignedEvent(endOfCallPayload({ call: { id: 'call-1', endedReason: 'customer-did-not-give-audio' } }));

    await handleVapiWebhook(event, prisma);
    await flushAsync();

    expect(updateInterviewMock).toHaveBeenCalledWith('u1', 'i1', expect.objectContaining({ status: 'error', voided: true }));
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('falls back to the class-session path when no interview matches the callId', async () => {
    getInterviewByCallIdMock.mockResolvedValue(null);
    getClassSessionByCallIdMock.mockResolvedValue({ userId: 'u2', sessionId: 's1' });
    const event = makeSignedEvent(endOfCallPayload());

    await handleVapiWebhook(event, {});
    await flushAsync();

    expect(updateClassSessionMock).toHaveBeenCalledWith('u2', 's1', expect.objectContaining({ status: 'completed', hasCompletedQA: true }));
    // Evaluator notification is interview-only — a class session must not trigger it
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  // Trello DmPpbrff, 2026-09-02 00:53 (Mack): "la transcripción de la clase no está
  // disponible... ya que sí está ahí [en Vapi]." Root cause: `??` doesn't fall through
  // on an empty (but present) string/array — only `||` does.
  it('falls back to message.transcript when artifact.transcript is present but empty', async () => {
    getClassSessionByCallIdMock.mockResolvedValue({ userId: 'u3', sessionId: 's2' });
    const event = makeSignedEvent(endOfCallPayload({
      artifact: { transcript: '', messages: [] },
      transcript: 'Estudiante: Hola. Mentor: ¿Listo para empezar?',
    }));

    await handleVapiWebhook(event, {});
    await flushAsync();

    expect(updateClassSessionMock).toHaveBeenCalledWith('u3', 's2', expect.objectContaining({
      transcript: 'Estudiante: Hola. Mentor: ¿Listo para empezar?',
    }));
  });

  it('falls back to message.messages when artifact.messages is present but empty', async () => {
    getClassSessionByCallIdMock.mockResolvedValue({ userId: 'u4', sessionId: 's3' });
    const fallbackMessages = [{ role: 'assistant', content: 'Pregunta desde message.messages' }];
    const event = makeSignedEvent(endOfCallPayload({
      artifact: { transcript: 'algo', messages: [] },
      messages: fallbackMessages,
    }));

    await handleVapiWebhook(event, {});
    await flushAsync();

    expect(updateClassSessionMock).toHaveBeenCalledWith('u4', 's3', expect.objectContaining({
      messages: fallbackMessages,
    }));
  });
});
