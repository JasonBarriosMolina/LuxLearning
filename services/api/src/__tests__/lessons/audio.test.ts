/**
 * Tests for POST /lessons/audio (lux-lessons) — Trello DmPpbrff, 2026-08-31 19:54:
 * on-demand Amazon Polly narration for lessons that don't have one yet, instead of
 * the student falling back to the browser's free voice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: vi.fn() }; },
  InvokeModelCommand:   function (x: any) { return x; },
}));
vi.mock('youtube-transcript', () => ({ YoutubeTranscript: { fetchTranscript: vi.fn() } }));
vi.mock('../../shared/db-dynamo', () => ({
  markLessonComplete: vi.fn(), getLessonProgress: vi.fn(),
  getHighlights: vi.fn(), saveHighlights: vi.fn(),
  getFavorites: vi.fn(), toggleFavorite: vi.fn(),
  getTranscript: vi.fn(), saveTranscript: vi.fn(),
  updateLastSeen: vi.fn(), markOnboardingDone: vi.fn(), isOnboardingDone: vi.fn(),
  getTasksForUser: vi.fn(), updateTask: vi.fn(), autoCompleteTasks: vi.fn(),
  startSession: vi.fn(), updateSession: vi.fn(), endSession: vi.fn(), getActivity: vi.fn(),
  getAllQuizAttemptsForUser: vi.fn(), setInactivityReminder: vi.fn(),
  getAllEnrollments: vi.fn(), getEnrollments: vi.fn(),
  TABLES: {}, ddb: { send: vi.fn() },
}));
vi.mock('../../shared/email', () => ({ sendTemplatedEmail: vi.fn() }));
vi.mock('../../shared/carousel-pdf', () => ({ buildRecapPdf: vi.fn() }));

const lessonFindUniqueMock = vi.fn();
const lessonUpdateMock = vi.fn().mockResolvedValue({});
const moduleFindUniqueMock = vi.fn();
vi.mock('../../shared/db-neon', () => ({
  getPrismaClient: vi.fn(async () => ({
    lesson: { findUnique: (...a: any[]) => lessonFindUniqueMock(...a), update: (...a: any[]) => lessonUpdateMock(...a) },
    module: { findUnique: (...a: any[]) => moduleFindUniqueMock(...a) },
  })),
}));

const generateLessonAudioMock = vi.fn();
vi.mock('../../shared/polly-audio', () => ({
  generateLessonAudio: (...a: any[]) => generateLessonAudioMock(...a),
  defaultVoiceForLanguage: (lang: string | null | undefined) => (lang === 'EN' ? 'Danielle' : 'Mia'),
  defaultMaleVoiceForLanguage: (lang: string | null | undefined) => (lang === 'EN' ? 'Gregory' : 'Sergio'),
}));

import { handler } from '../../lessons/handler';

function makeEvent(body: any) {
  return {
    headers: {},
    requestContext: { http: { method: 'POST' }, authorizer: { lambda: { userId: 'student-1', email: 's@test.com', role: 'STUDENT' } } },
    rawPath: '/lessons/audio',
    body: JSON.stringify(body),
  } as any;
}

async function bodyOf(res: any) {
  return JSON.parse(res.body);
}

describe('POST /lessons/audio', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when lessonId is missing', async () => {
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the lesson does not exist', async () => {
    lessonFindUniqueMock.mockResolvedValue(null);
    const res = await handler(makeEvent({ lessonId: 'missing' }));
    expect(res.statusCode).toBe(404);
  });

  it('returns the cached audioUrl immediately without re-synthesizing, when already generated', async () => {
    lessonFindUniqueMock.mockResolvedValue({ id: 'l1', audioUrl: 'https://s3.example.com/cached.mp3' });
    const res = await handler(makeEvent({ lessonId: 'l1' }));
    expect(res.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.audioUrl).toBe('https://s3.example.com/cached.mp3');
    expect(generateLessonAudioMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the lesson has no content to narrate', async () => {
    lessonFindUniqueMock.mockResolvedValue({ id: 'l1', audioUrl: null, content: null });
    const res = await handler(makeEvent({ lessonId: 'l1' }));
    expect(res.statusCode).toBe(400);
    expect(generateLessonAudioMock).not.toHaveBeenCalled();
  });

  it('synthesizes with the voice matching the COURSE language and caches the result on first request', async () => {
    lessonFindUniqueMock.mockResolvedValue({
      id: 'l1', audioUrl: null, moduleId: 'm1', title: 'Lección 1',
      content: '<p>Contenido</p>', points: ['punto'], tip: 'consejo',
    });
    moduleFindUniqueMock.mockResolvedValue({ course: { planLanguage: 'EN' } });
    generateLessonAudioMock.mockResolvedValue('https://s3.example.com/fresh.mp3');

    const res = await handler(makeEvent({ lessonId: 'l1' }));
    expect(res.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.audioUrl).toBe('https://s3.example.com/fresh.mp3');
    expect(generateLessonAudioMock).toHaveBeenCalledWith('l1', expect.stringContaining('Contenido'), 'Danielle');
    expect(lessonUpdateMock).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { audioUrl: 'https://s3.example.com/fresh.mp3' } });
  });

  it('returns a server error when Polly synthesis fails, without caching anything', async () => {
    lessonFindUniqueMock.mockResolvedValue({ id: 'l1', audioUrl: null, moduleId: 'm1', content: '<p>Contenido</p>', points: [], tip: '' });
    moduleFindUniqueMock.mockResolvedValue({ course: { planLanguage: 'ES' } });
    generateLessonAudioMock.mockResolvedValue(null);

    const res = await handler(makeEvent({ lessonId: 'l1' }));
    expect(res.statusCode).toBe(500);
    expect(lessonUpdateMock).not.toHaveBeenCalled();
  });

  // Trello DmPpbrff, 2026-09-01 14:40 — Mack: only a male/female voice-model
  // toggle should exist, no browser-voice fallback exposed as a choice.
  describe('gender param — male voice requested', () => {
    it('synthesizes fresh with the male voice EVEN when a (female) audioUrl is already cached, and does NOT overwrite the cache', async () => {
      lessonFindUniqueMock.mockResolvedValue({
        id: 'l1', audioUrl: 'https://s3.example.com/cached-female.mp3', moduleId: 'm1',
        title: 'Lección 1', content: '<p>Contenido</p>', points: [], tip: '',
      });
      moduleFindUniqueMock.mockResolvedValue({ course: { planLanguage: 'ES' } });
      generateLessonAudioMock.mockResolvedValue('https://s3.example.com/fresh-male.mp3');

      const res = await handler(makeEvent({ lessonId: 'l1', gender: 'male' }));
      expect(res.statusCode).toBe(200);
      const body = await bodyOf(res);
      expect(body.data.audioUrl).toBe('https://s3.example.com/fresh-male.mp3');
      expect(generateLessonAudioMock).toHaveBeenCalledWith('l1', expect.stringContaining('Contenido'), 'Sergio');
      expect(lessonUpdateMock).not.toHaveBeenCalled();
    });

    it('uses the language-matched male voice (English course -> Gregory)', async () => {
      lessonFindUniqueMock.mockResolvedValue({ id: 'l1', audioUrl: null, moduleId: 'm1', content: '<p>Content</p>', points: [], tip: '' });
      moduleFindUniqueMock.mockResolvedValue({ course: { planLanguage: 'EN' } });
      generateLessonAudioMock.mockResolvedValue('https://s3.example.com/fresh-male-en.mp3');

      const res = await handler(makeEvent({ lessonId: 'l1', gender: 'male' }));
      expect(res.statusCode).toBe(200);
      expect(generateLessonAudioMock).toHaveBeenCalledWith('l1', expect.any(String), 'Gregory');
    });

    it('without gender (or gender=female), still returns the cached URL and never re-synthesizes', async () => {
      lessonFindUniqueMock.mockResolvedValue({ id: 'l1', audioUrl: 'https://s3.example.com/cached-female.mp3' });
      const res = await handler(makeEvent({ lessonId: 'l1', gender: 'female' }));
      expect(res.statusCode).toBe(200);
      const body = await bodyOf(res);
      expect(body.data.audioUrl).toBe('https://s3.example.com/cached-female.mp3');
      expect(generateLessonAudioMock).not.toHaveBeenCalled();
    });
  });
});
