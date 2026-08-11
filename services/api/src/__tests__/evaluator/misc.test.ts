/**
 * Tests for evaluator/misc.ts — verifies quiz-audit uses ctx.prisma (not getPrismaClient).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEvalCtx, makePrisma, makeEvent, bodyOf } from '../helpers/ctx';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient:        function() { return { send: vi.fn().mockResolvedValue({}) }; },
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
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function() { return { send: vi.fn() }; },
  AdminGetUserCommand:           function(x: any) { return x; },
}));

vi.mock('../../shared/db-dynamo', () => ({
  getQuizAttempts: vi.fn().mockResolvedValue([
    { score: 80, answers: [0, 1, 2], submittedAt: '2024-01-01T00:00:00Z' },
  ]),
}));

// getPrismaClient should NOT be called (we fixed that bug)
const getPrismaClientMock = vi.fn().mockRejectedValue(new Error('getPrismaClient should NOT be called from misc.ts — use ctx.prisma'));
vi.mock('../../shared/db-neon', () => ({ getPrismaClient: getPrismaClientMock }));

import { handleMisc } from '../../evaluator/misc';

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /evaluator/quiz-audit', () => {
  const MODULE_ID = 'mod-abc';
  const STUDENT_ID = 'student-xyz';

  function makeAuditCtx() {
    const prisma = makePrisma({
      module: {
        findUnique: vi.fn().mockResolvedValue({
          id: MODULE_ID, title: 'Módulo de Prueba', passingScore: 70,
          questions: [
            { id: 'q1', text: '¿Qué es X?', options: ['A', 'B', 'C', 'D'], correctIndex: 0, order: 1 },
            { id: 'q2', text: '¿Qué es Y?', options: ['A', 'B', 'C', 'D'], correctIndex: 1, order: 2 },
            { id: 'q3', text: '¿Qué es Z?', options: ['A', 'B', 'C', 'D'], correctIndex: 2, order: 3 },
          ],
        }),
      },
    });

    return makeEvalCtx({
      method: 'GET',
      path: '/evaluator/quiz-audit',
      prisma,
      event: makeEvent('EVALUATOR', 'GET', '/evaluator/quiz-audit', {
        qs: { userId: STUDENT_ID, moduleId: MODULE_ID },
      }),
    });
  }

  beforeEach(() => {
    getPrismaClientMock.mockClear();
  });

  it('returns 400 when userId is missing', async () => {
    const ctx = makeEvalCtx({
      method: 'GET', path: '/evaluator/quiz-audit',
      event: makeEvent('EVALUATOR', 'GET', '/evaluator/quiz-audit', { qs: { moduleId: MODULE_ID } }),
    });
    const res = await handleMisc(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when moduleId is missing', async () => {
    const ctx = makeEvalCtx({
      method: 'GET', path: '/evaluator/quiz-audit',
      event: makeEvent('EVALUATOR', 'GET', '/evaluator/quiz-audit', { qs: { userId: STUDENT_ID } }),
    });
    const res = await handleMisc(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 404 when module is not found', async () => {
    const ctx = makeEvalCtx({
      method: 'GET', path: '/evaluator/quiz-audit',
      event: makeEvent('EVALUATOR', 'GET', '/evaluator/quiz-audit', { qs: { userId: STUDENT_ID, moduleId: MODULE_ID } }),
      // prisma.module.findUnique returns null by default in makePrisma
    });
    const res = await handleMisc(ctx);
    expect(res?.statusCode).toBe(404);
  });

  it('uses ctx.prisma — getPrismaClient is NEVER called', async () => {
    const ctx = makeAuditCtx();
    await handleMisc(ctx);
    expect(getPrismaClientMock).not.toHaveBeenCalled();
  });

  it('returns 200 with enriched attempts and question details', async () => {
    const ctx = makeAuditCtx();
    const res = await handleMisc(ctx);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('attempts');
    expect(body.data).toHaveProperty('passingScore', 70);
    expect(body.data).toHaveProperty('moduleTitle', 'Módulo de Prueba');
    expect(body.data).toHaveProperty('totalQuestions', 3);
    // Each attempt has enriched results
    expect(body.data.attempts[0].results).toHaveLength(3);
    expect(body.data.attempts[0].results[0]).toHaveProperty('questionText');
    expect(body.data.attempts[0].results[0]).toHaveProperty('isCorrect');
  });
});

describe('POST /evaluator/reminder', () => {
  it('returns 400 when userId is missing', async () => {
    const ctx = makeEvalCtx({
      method: 'POST', path: '/evaluator/reminder',
      body: { studentEmail: 'student@test.com' },
    });
    const res = await handleMisc(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when studentEmail is missing', async () => {
    const ctx = makeEvalCtx({
      method: 'POST', path: '/evaluator/reminder',
      body: { userId: 'student-uid' },
    });
    const res = await handleMisc(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 200 when email is sent (or non-fatal SES failure)', async () => {
    const ctx = makeEvalCtx({
      method: 'POST', path: '/evaluator/reminder',
      body: { userId: 'student-uid', studentEmail: 'student@test.com', courseTitle: 'Curso X' },
    });
    const res = await handleMisc(ctx);
    // Either 200 {sent:true} or 200 {sent:false} — never 500
    expect(res?.statusCode).toBe(200);
  });
});

describe('POST /evaluator/translate', () => {
  it('returns 400 when text is missing', async () => {
    const ctx = makeEvalCtx({
      method: 'POST', path: '/evaluator/translate',
      body: { targetLang: 'en' },
    });
    const res = await handleMisc(ctx);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 for unsupported targetLang', async () => {
    const ctx = makeEvalCtx({
      method: 'POST', path: '/evaluator/translate',
      body: { text: 'Hola mundo', targetLang: 'zh' },
    });
    const res = await handleMisc(ctx);
    expect(res?.statusCode).toBe(400);
  });
});
