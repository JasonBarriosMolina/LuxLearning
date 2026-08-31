/**
 * Tests for admin/ai-audio-worker.ts.
 * Focus: dispatch (self-invoke) + the background worker that generates Polly
 * audio per lesson. Trello DmPpbrff item 4 (2026-08-30 20:20).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAdminCtx, makePrisma } from '../helpers/ctx';

const lambdaSendMock = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient:  function () { return { send: (...args: any[]) => lambdaSendMock(...args) }; },
  InvokeCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: vi.fn() }; },
  InvokeModelCommand:   function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-ses',   () => ({ SESClient: function () { return {}; } }));
vi.mock('@aws-sdk/client-s3',    () => ({
  S3Client: function () { return { send: vi.fn() }; },
  PutObjectCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: function () { return { send: vi.fn() }; },
  SynthesizeSpeechCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return {}; },
  AdminGetUserCommand: function (x: any) { return x; },
}));

const generateLessonAudioMock = vi.fn();
vi.mock('../../admin/ctx', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, generateLessonAudio: (...args: any[]) => generateLessonAudioMock(...args) };
});

import { dispatchLessonAudioGeneration, handleAIAudioWorker } from '../../admin/ai-audio-worker';

describe('dispatchLessonAudioGeneration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('self-invokes with the lesson-audio-gen action and courseId', async () => {
    await dispatchLessonAudioGeneration('course-1');
    expect(lambdaSendMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(lambdaSendMock.mock.calls[0][0].Payload.toString());
    expect(payload._action).toBe('lesson-audio-gen');
    expect(payload.courseId).toBe('course-1');
  });

  it('does not throw when the self-invoke fails', async () => {
    lambdaSendMock.mockRejectedValueOnce(new Error('throttled'));
    await expect(dispatchLessonAudioGeneration('course-1')).resolves.toBeUndefined();
  });
});

describe('handleAIAudioWorker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for unrelated actions', async () => {
    const ctx = makeAdminCtx({ action: 'wizard-lessons-bulk' });
    const result = await handleAIAudioWorker(ctx as any);
    expect(result).toBeNull();
  });

  it('generates audio for lessons with content and no audioUrl yet, using the Spanish voice by default', async () => {
    generateLessonAudioMock.mockResolvedValue('https://s3.example.com/audio.mp3');
    const prisma = makePrisma();
    prisma.course.findUnique = vi.fn().mockResolvedValue({
      planLanguage: 'ES',
      modules: [{ lessons: [{ id: 'l1', content: '<p>Hola</p>', audioUrl: null }] }],
    });
    const ctx = makeAdminCtx({ action: 'lesson-audio-gen', body: { courseId: 'course-1' }, prisma });
    const result = await handleAIAudioWorker(ctx as any);
    expect(result?.statusCode).toBe(200);
    expect(generateLessonAudioMock).toHaveBeenCalledWith('l1', '<p>Hola</p>', 'Mia');
    expect(prisma.lesson.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { audioUrl: 'https://s3.example.com/audio.mp3' } });
  });

  it('uses the English voice for an English course', async () => {
    generateLessonAudioMock.mockResolvedValue('https://s3.example.com/audio-en.mp3');
    const prisma = makePrisma();
    prisma.course.findUnique = vi.fn().mockResolvedValue({
      planLanguage: 'EN',
      modules: [{ lessons: [{ id: 'l1', content: 'Hello', audioUrl: null }] }],
    });
    const ctx = makeAdminCtx({ action: 'lesson-audio-gen', body: { courseId: 'course-1' }, prisma });
    await handleAIAudioWorker(ctx as any);
    expect(generateLessonAudioMock).toHaveBeenCalledWith('l1', 'Hello', 'Danielle');
  });

  it('skips lessons that already have audio or have no content', async () => {
    const prisma = makePrisma();
    prisma.course.findUnique = vi.fn().mockResolvedValue({
      planLanguage: 'ES',
      modules: [{ lessons: [
        { id: 'has-audio', content: '<p>x</p>', audioUrl: 'https://already.example/a.mp3' },
        { id: 'no-content', content: null, audioUrl: null },
      ] }],
    });
    const ctx = makeAdminCtx({ action: 'lesson-audio-gen', body: { courseId: 'course-1' }, prisma });
    await handleAIAudioWorker(ctx as any);
    expect(generateLessonAudioMock).not.toHaveBeenCalled();
  });

  it('keeps going and returns 200 even when one lesson fails', async () => {
    generateLessonAudioMock
      .mockRejectedValueOnce(new Error('Polly error'))
      .mockResolvedValueOnce('https://s3.example.com/audio2.mp3');
    const prisma = makePrisma();
    prisma.course.findUnique = vi.fn().mockResolvedValue({
      planLanguage: 'ES',
      modules: [{ lessons: [
        { id: 'l1', content: '<p>Uno</p>', audioUrl: null },
        { id: 'l2', content: '<p>Dos</p>', audioUrl: null },
      ] }],
    });
    const ctx = makeAdminCtx({ action: 'lesson-audio-gen', body: { courseId: 'course-1' }, prisma });
    const result = await handleAIAudioWorker(ctx as any);
    expect(result?.statusCode).toBe(200);
    expect(prisma.lesson.update).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the course is not found', async () => {
    const prisma = makePrisma();
    prisma.course.findUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeAdminCtx({ action: 'lesson-audio-gen', body: { courseId: 'missing' }, prisma });
    const result = await handleAIAudioWorker(ctx as any);
    expect(result?.statusCode).toBe(200);
  });
});
