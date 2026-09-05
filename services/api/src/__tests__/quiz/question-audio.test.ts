/**
 * Tests for POST /quiz/question-audio (lux-quiz) — Trello DmPpbrff, 2026-09-03:
 * on-demand Amazon Polly narration for quiz/exam questions, which fell back to
 * the browser's free voice because TextToSpeechButton's Polly upgrade only ever
 * fired for lessons (needs a row to cache the generated audio against).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: vi.fn() }; },
  InvokeModelCommand:   function (x: any) { return x; },
}));
vi.mock('../../shared/db-dynamo', () => ({
  saveQuizAttempt: vi.fn(), getQuizAttempts: vi.fn(), getLessonProgress: vi.fn(), autoCompleteTasks: vi.fn(),
}));
vi.mock('../../shared/email', () => ({ sendTemplatedEmail: vi.fn() }));

const questionFindUniqueMock = vi.fn();
const questionUpdateMock = vi.fn().mockResolvedValue({});
vi.mock('../../shared/db-neon', () => ({
  getPrismaClient: vi.fn(async () => ({
    question: { findUnique: (...a: any[]) => questionFindUniqueMock(...a), update: (...a: any[]) => questionUpdateMock(...a) },
  })),
}));

const generateLessonAudioMock = vi.fn();
vi.mock('../../shared/polly-audio', () => ({
  generateLessonAudio: (...a: any[]) => generateLessonAudioMock(...a),
  defaultVoiceForLanguage: (lang: string | null | undefined) => (lang === 'EN' ? 'Danielle' : 'Mia'),
  defaultMaleVoiceForLanguage: (lang: string | null | undefined) => (lang === 'EN' ? 'Gregory' : 'Pedro'),
}));

import { handler } from '../../quiz/handler';

function makeEvent(body: any) {
  return {
    headers: {},
    requestContext: { http: { method: 'POST' }, authorizer: { lambda: { userId: 'student-1', email: 's@test.com', role: 'STUDENT' } } },
    rawPath: '/quiz/question-audio',
    body: JSON.stringify(body),
  } as any;
}

async function bodyOf(res: any) {
  return JSON.parse(res.body);
}

describe('POST /quiz/question-audio', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when questionId is missing', async () => {
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the question does not exist', async () => {
    questionFindUniqueMock.mockResolvedValue(null);
    const res = await handler(makeEvent({ questionId: 'missing' }));
    expect(res.statusCode).toBe(404);
  });

  it('returns the cached audioUrl immediately without re-synthesizing, when already generated', async () => {
    questionFindUniqueMock.mockResolvedValue({ id: 'q1', audioUrl: 'https://s3.example.com/cached.mp3' });
    const res = await handler(makeEvent({ questionId: 'q1' }));
    expect(res.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.audioUrl).toBe('https://s3.example.com/cached.mp3');
    expect(generateLessonAudioMock).not.toHaveBeenCalled();
  });

  it('synthesizes with the voice matching the COURSE language and caches the result on first request', async () => {
    questionFindUniqueMock.mockResolvedValue({
      id: 'q1', audioUrl: null, text: '¿Cuánto es 2+2?', options: ['3', '4', '5'],
      module: { course: { planLanguage: 'EN' } },
    });
    generateLessonAudioMock.mockResolvedValue('https://s3.example.com/fresh.mp3');

    const res = await handler(makeEvent({ questionId: 'q1' }));
    expect(res.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.audioUrl).toBe('https://s3.example.com/fresh.mp3');
    expect(generateLessonAudioMock).toHaveBeenCalledWith('question-q1', expect.stringContaining('2+2'), 'Danielle');
    expect(questionUpdateMock).toHaveBeenCalledWith({ where: { id: 'q1' }, data: { audioUrl: 'https://s3.example.com/fresh.mp3' } });
  });

  it('returns a server error when Polly synthesis fails, without caching anything', async () => {
    questionFindUniqueMock.mockResolvedValue({ id: 'q1', audioUrl: null, text: 'Pregunta', options: [], module: { course: { planLanguage: 'ES' } } });
    generateLessonAudioMock.mockResolvedValue(null);

    const res = await handler(makeEvent({ questionId: 'q1' }));
    expect(res.statusCode).toBe(500);
    expect(questionUpdateMock).not.toHaveBeenCalled();
  });

  describe('gender param — male voice requested', () => {
    it('synthesizes fresh with the male voice and caches it separately (audioUrlMale), without touching the female cache', async () => {
      questionFindUniqueMock.mockResolvedValue({
        id: 'q1', audioUrl: 'https://s3.example.com/cached-female.mp3', audioUrlMale: null,
        text: 'Pregunta', options: ['a', 'b'], module: { course: { planLanguage: 'ES' } },
      });
      generateLessonAudioMock.mockResolvedValue('https://s3.example.com/fresh-male.mp3');

      const res = await handler(makeEvent({ questionId: 'q1', gender: 'male' }));
      expect(res.statusCode).toBe(200);
      const body = await bodyOf(res);
      expect(body.data.audioUrl).toBe('https://s3.example.com/fresh-male.mp3');
      expect(generateLessonAudioMock).toHaveBeenCalledWith('question-q1', expect.any(String), 'Pedro');
      expect(questionUpdateMock).toHaveBeenCalledWith({ where: { id: 'q1' }, data: { audioUrlMale: 'https://s3.example.com/fresh-male.mp3' } });
    });

    it('returns the cached male audioUrl immediately without re-synthesizing, when already generated', async () => {
      questionFindUniqueMock.mockResolvedValue({ id: 'q1', audioUrl: null, audioUrlMale: 'https://s3.example.com/cached-male.mp3' });
      const res = await handler(makeEvent({ questionId: 'q1', gender: 'male' }));
      expect(res.statusCode).toBe(200);
      const body = await bodyOf(res);
      expect(body.data.audioUrl).toBe('https://s3.example.com/cached-male.mp3');
      expect(generateLessonAudioMock).not.toHaveBeenCalled();
    });
  });
});
