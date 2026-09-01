/**
 * Tests for POST /lessons/carousel-recap (lux-lessons) — Trello N1bbWdz0,
 * 2026-08-31 15:21: on-demand "Lux Recap" PDF instead of building it eagerly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: vi.fn() }; },
  InvokeModelCommand:   function (x: any) { return x; },
}));
vi.mock('youtube-transcript', () => ({ YoutubeTranscript: { fetchTranscript: vi.fn() } }));
const createNotificationMock = vi.fn().mockResolvedValue(undefined);
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
  createNotification: (...a: any[]) => createNotificationMock(...a),
  getPushSubscriptionsByUserId: vi.fn().mockResolvedValue([]),
  TABLES: {}, ddb: { send: vi.fn() },
}));
vi.mock('../../shared/email', () => ({ sendTemplatedEmail: vi.fn() }));
// @aws-sdk/client-secrets-manager is a Lambda-provided runtime dep (esbuild
// --external), not in local node_modules — shared/vapid.ts imports it, and
// lessons/handler.ts now imports shared/vapid.ts for the carousel-recap
// notification, so every test importing the handler needs this mocked.
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: function () { return { send: vi.fn() }; },
  GetSecretValueCommand: function (x: any) { return x; },
}));
vi.mock('../../shared/vapid', () => ({ getVapidKeys: vi.fn().mockRejectedValue(new Error('not configured in tests')) }));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));

const lessonFindUniqueMock = vi.fn();
const lessonUpdateMock = vi.fn().mockResolvedValue({});
const moduleFindUniqueMock = vi.fn();
vi.mock('../../shared/db-neon', () => ({
  getPrismaClient: vi.fn(async () => ({
    lesson: { findUnique: (...a: any[]) => lessonFindUniqueMock(...a), update: (...a: any[]) => lessonUpdateMock(...a) },
    module: { findUnique: (...a: any[]) => moduleFindUniqueMock(...a) },
  })),
}));

const buildRecapPdfMock = vi.fn();
vi.mock('../../shared/carousel-pdf', () => ({ buildRecapPdf: (...a: any[]) => buildRecapPdfMock(...a) }));

import { handler } from '../../lessons/handler';

function makeEvent(body: any) {
  return {
    headers: {},
    requestContext: { http: { method: 'POST' }, authorizer: { lambda: { userId: 'student-1', email: 's@test.com', role: 'STUDENT' } } },
    rawPath: '/lessons/carousel-recap',
    body: JSON.stringify(body),
  } as any;
}

async function bodyOf(res: any) {
  return JSON.parse(res.body);
}

describe('POST /lessons/carousel-recap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when lessonId is missing', async () => {
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the lesson is not a carousel', async () => {
    lessonFindUniqueMock.mockResolvedValue({ id: 'l1', type: 'text', pdfRecapUrl: null });
    const res = await handler(makeEvent({ lessonId: 'l1' }));
    expect(res.statusCode).toBe(404);
    expect(buildRecapPdfMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the lesson does not exist', async () => {
    lessonFindUniqueMock.mockResolvedValue(null);
    const res = await handler(makeEvent({ lessonId: 'missing' }));
    expect(res.statusCode).toBe(404);
  });

  it('returns the cached URL immediately without rebuilding, when already generated', async () => {
    lessonFindUniqueMock.mockResolvedValue({ id: 'l1', type: 'carousel', pdfRecapUrl: 'https://s3.example.com/cached.pdf' });
    const res = await handler(makeEvent({ lessonId: 'l1' }));
    expect(res.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.pdfRecapUrl).toBe('https://s3.example.com/cached.pdf');
    expect(buildRecapPdfMock).not.toHaveBeenCalled();
    expect(lessonUpdateMock).not.toHaveBeenCalled();
    // No new notification for a cache hit — the student already saw this earlier.
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('builds the PDF on first request and caches it on the Lesson row', async () => {
    lessonFindUniqueMock.mockResolvedValue({
      id: 'l1', type: 'carousel', pdfRecapUrl: null, moduleId: 'm1', title: 'Lux Carrousel: Mod',
      carouselSlides: [{ onScreenText: { title: 'A', bullets: [] }, imageUrl: 'https://s3.example.com/a.jpg' }],
    });
    moduleFindUniqueMock.mockResolvedValue({ title: 'Mod 1' });
    buildRecapPdfMock.mockResolvedValue('https://s3.example.com/fresh.pdf');

    const res = await handler(makeEvent({ lessonId: 'l1' }));
    expect(res.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.pdfRecapUrl).toBe('https://s3.example.com/fresh.pdf');
    expect(buildRecapPdfMock).toHaveBeenCalledWith('Mod 1', expect.any(Array));
    expect(lessonUpdateMock).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { pdfRecapUrl: 'https://s3.example.com/fresh.pdf' } });
    // Trello DmPpbrff, 2026-09-01 00:57 — Mack: notify the student (push + in-app)
    // once the PDF is ready.
    expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'student-1', actionUrl: 'https://s3.example.com/fresh.pdf',
    }));
  });

  it('returns a server error when PDF generation fails, without caching anything', async () => {
    lessonFindUniqueMock.mockResolvedValue({ id: 'l1', type: 'carousel', pdfRecapUrl: null, moduleId: 'm1', carouselSlides: [] });
    moduleFindUniqueMock.mockResolvedValue({ title: 'Mod 1' });
    buildRecapPdfMock.mockResolvedValue(null);

    const res = await handler(makeEvent({ lessonId: 'l1' }));
    expect(res.statusCode).toBe(500);
    expect(lessonUpdateMock).not.toHaveBeenCalled();
  });
});
