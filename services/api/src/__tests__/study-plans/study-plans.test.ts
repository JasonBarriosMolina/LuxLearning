/**
 * Tests for the Weekly Study Plan system.
 * Covers: getMonday helper, student CRUD routes, evaluator generate/unlock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEvalCtx, makePrisma, bodyOf } from '../helpers/ctx';

// ── Shared mocks ──────────────────────────────────────────────────────────────

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: vi.fn() }; },
  InvokeModelCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: function () { return { send: vi.fn().mockResolvedValue({}) }; },
  InvokeCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return { send: vi.fn().mockResolvedValue({ Users: [] }) }; },
  ListUsersInGroupCommand: function (x: any) { return x; },
}));

// DDB helpers — default: plan not found
const mockGetStudyPlan = vi.fn().mockResolvedValue(null);
const mockGetStudyPlans = vi.fn().mockResolvedValue([]);
const mockSaveStudyPlan = vi.fn().mockResolvedValue(undefined);
const mockUpdateStudyPlanField = vi.fn().mockResolvedValue(undefined);
const mockRemoveStudyPlanAttributes = vi.fn().mockResolvedValue(undefined);

vi.mock('../../shared/db-study-plans', async () => {
  const real = await vi.importActual<typeof import('../../shared/db-study-plans')>('../../shared/db-study-plans');
  return {
    ...real,              // keeps getMonday, type exports
    getStudyPlan:              (...a: any[]) => mockGetStudyPlan(...a),
    getStudyPlans:             (...a: any[]) => mockGetStudyPlans(...a),
    saveStudyPlan:             (...a: any[]) => mockSaveStudyPlan(...a),
    updateStudyPlanField:      (...a: any[]) => mockUpdateStudyPlanField(...a),
    removeStudyPlanAttributes: (...a: any[]) => mockRemoveStudyPlanAttributes(...a),
  };
});

const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
const mockGetEnrollments = vi.fn().mockResolvedValue([]);
const mockGetLessonProgress = vi.fn().mockResolvedValue([]);
const mockGetAllQuizAttempts = vi.fn().mockResolvedValue([]);

vi.mock('../../shared/db-dynamo', () => ({
  createNotification: (...a: any[]) => mockCreateNotification(...a),
  getEnrollments: (...a: any[]) => mockGetEnrollments(...a),
  getLessonProgress: (...a: any[]) => mockGetLessonProgress(...a),
  getAllQuizAttemptsForUser: (...a: any[]) => mockGetAllQuizAttempts(...a),
}));

vi.mock('../../shared/db-neon', () => ({
  getPrismaClient: vi.fn().mockResolvedValue(makePrisma()),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { getMonday } from '../../shared/db-study-plans';
import { handleStudyPlans } from '../../study-plans/plans';
import { handleEvalStudyPlans } from '../../evaluator/study-plans';

// ── Helper ────────────────────────────────────────────────────────────────────
function makePlanCtx(method: string, path: string, opts: { body?: any; qs?: Record<string, string>; userId?: string } = {}) {
  return {
    event: { queryStringParameters: opts.qs ?? {}, requestContext: { http: { method } } },
    method,
    path,
    body: opts.body ?? {},
    userId: opts.userId ?? 'student-id',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. getMonday — pure function
// ─────────────────────────────────────────────────────────────────────────────
describe('getMonday()', () => {
  it('returns Monday for a Monday input', () => {
    const monday = new Date('2026-08-03T12:00:00Z'); // known Monday
    expect(getMonday(monday)).toBe('2026-08-03');
  });

  it('returns the previous Monday for mid-week days', () => {
    const wed = new Date('2026-08-05T00:00:00Z'); // Wednesday
    expect(getMonday(wed)).toBe('2026-08-03');
  });

  it('returns the previous Monday for Sunday', () => {
    const sun = new Date('2026-08-09T00:00:00Z'); // Sunday
    expect(getMonday(sun)).toBe('2026-08-03');
  });

  it('returns the previous Monday for Saturday', () => {
    const sat = new Date('2026-08-08T00:00:00Z'); // Saturday
    expect(getMonday(sat)).toBe('2026-08-03');
  });

  it('returns the same Monday for any day in that week', () => {
    const dates = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
    const mondays = dates.map((d) => getMonday(new Date(d + 'T10:00:00Z')));
    expect(new Set(mondays).size).toBe(1);
    expect(mondays[0]).toBe('2026-08-03');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Student routes — handleStudyPlans
// ─────────────────────────────────────────────────────────────────────────────
describe('handleStudyPlans — student routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStudyPlan.mockResolvedValue(null);
    mockGetStudyPlans.mockResolvedValue([]);
    mockGetEnrollments.mockResolvedValue([]);
    mockGetAllQuizAttempts.mockResolvedValue([]);
  });

  describe('GET /study-plan', () => {
    it('returns plan list', async () => {
      const fakePlan = { userId: 'student-id', weekOf: '2026-08-03', planId: 'p1', days: [], generatedBy: 'auto', createdAt: '', updatedAt: '' };
      mockGetStudyPlans.mockResolvedValue([fakePlan]);
      const ctx = makePlanCtx('GET', '/study-plan', { qs: { weeks: '2' } });
      const res = await handleStudyPlans(ctx);
      expect(res.statusCode).toBe(200);
      const { data } = await bodyOf(res);
      expect(data).toHaveLength(1);
      expect(data[0].planId).toBe('p1');
    });

    it('caps weeks at 12', async () => {
      mockGetStudyPlans.mockResolvedValue([]);
      const ctx = makePlanCtx('GET', '/study-plan', { qs: { weeks: '999' } });
      await handleStudyPlans(ctx);
      expect(mockGetStudyPlans).toHaveBeenCalledWith('student-id', 12);
    });
  });

  describe('GET /study-plan/current', () => {
    it('returns existing plan without creating a new one', async () => {
      const existing = { userId: 'student-id', weekOf: getMonday(), planId: 'existing', days: [], generatedBy: 'student', createdAt: '', updatedAt: '' };
      mockGetStudyPlan.mockResolvedValue(existing);
      const ctx = makePlanCtx('GET', '/study-plan/current');
      const res = await handleStudyPlans(ctx);
      expect(mockSaveStudyPlan).not.toHaveBeenCalled();
      const { data } = await bodyOf(res);
      expect(data.planId).toBe('existing');
    });

    it('creates a new plan if none exists', async () => {
      mockGetStudyPlan.mockResolvedValue(null);
      const ctx = makePlanCtx('GET', '/study-plan/current');
      const res = await handleStudyPlans(ctx);
      expect(mockSaveStudyPlan).toHaveBeenCalledOnce();
      const saved = mockSaveStudyPlan.mock.calls[0][0];
      expect(saved.generatedBy).toBe('student');
      expect(saved.days).toHaveLength(7);
    });

    it('new plan has exactly 7 days in order 0-6', async () => {
      mockGetStudyPlan.mockResolvedValue(null);
      const ctx = makePlanCtx('GET', '/study-plan/current');
      await handleStudyPlans(ctx);
      const saved = mockSaveStudyPlan.mock.calls[0][0];
      const indices = saved.days.map((d: any) => d.dayIndex);
      expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
  });

  describe('GET /study-plan/suggestions', () => {
    it('returns none when plan does not exist', async () => {
      mockGetStudyPlan.mockResolvedValue(null);
      const ctx = makePlanCtx('GET', '/study-plan/suggestions');
      const res = await handleStudyPlans(ctx);
      const { data } = await bodyOf(res);
      expect(data.status).toBe('none');
      expect(data.suggestions).toEqual([]);
    });

    it('returns done status and suggestions when ready', async () => {
      mockGetStudyPlan.mockResolvedValue({
        userId: 'student-id', weekOf: getMonday(), planId: 'p', days: [],
        suggestionsStatus: 'done',
        bedrockSuggestions: [{ title: 'Artículo X', type: 'article', description: 'Desc' }],
        generatedBy: 'student', createdAt: '', updatedAt: '',
      });
      const ctx = makePlanCtx('GET', '/study-plan/suggestions');
      const res = await handleStudyPlans(ctx);
      const { data } = await bodyOf(res);
      expect(data.status).toBe('done');
      expect(data.suggestions).toHaveLength(1);
    });
  });

  describe('PUT /study-plan/:weekOf/items/:itemId', () => {
    const WEEK = '2026-08-03';
    const ITEM_ID = 'item-abc';

    it('returns 400 if plan not found', async () => {
      mockGetStudyPlan.mockResolvedValue(null);
      const ctx = makePlanCtx('PUT', `/study-plan/${WEEK}/items/${ITEM_ID}`, { body: { completed: true } });
      const res = await handleStudyPlans(ctx);
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 if plan locked by another user', async () => {
      mockGetStudyPlan.mockResolvedValue({
        userId: 'student-id', weekOf: WEEK, planId: 'p', lockedBy: 'eval-id',
        days: [{ dayIndex: 0, date: '2026-08-03', items: [{ id: ITEM_ID, type: 'lesson', title: 'L', pinned: false, completed: false, source: 'auto' }] }],
        generatedBy: 'evaluator', createdAt: '', updatedAt: '',
      });
      const ctx = makePlanCtx('PUT', `/study-plan/${WEEK}/items/${ITEM_ID}`, { body: { completed: true } });
      const res = await handleStudyPlans(ctx);
      expect(res.statusCode).toBe(400);
    });

    it('updates completion flag on item', async () => {
      mockGetStudyPlan.mockResolvedValue({
        userId: 'student-id', weekOf: WEEK, planId: 'p',
        days: [{ dayIndex: 0, date: '2026-08-03', items: [{ id: ITEM_ID, type: 'lesson', title: 'L', pinned: false, completed: false, source: 'auto' }] }],
        generatedBy: 'student', createdAt: '', updatedAt: '',
      });
      const ctx = makePlanCtx('PUT', `/study-plan/${WEEK}/items/${ITEM_ID}`, { body: { completed: true } });
      const res = await handleStudyPlans(ctx);
      expect(res.statusCode).toBe(200);
      const updateCall = mockUpdateStudyPlanField.mock.calls[0];
      const updatedDays = updateCall[2].days;
      const item = updatedDays[0].items.find((i: any) => i.id === ITEM_ID);
      expect(item.completed).toBe(true);
    });
  });

  describe('POST /study-plan/:weekOf/items', () => {
    const WEEK = '2026-08-03';

    it('returns 400 if dayIndex or title missing', async () => {
      mockGetStudyPlan.mockResolvedValue({ userId: 'student-id', weekOf: WEEK, planId: 'p', days: [], generatedBy: 'student', createdAt: '', updatedAt: '' });
      const ctx = makePlanCtx('POST', `/study-plan/${WEEK}/items`, { body: { title: '' } });
      const res = await handleStudyPlans(ctx);
      expect(res.statusCode).toBe(400);
    });

    it('adds item with source=student', async () => {
      mockGetStudyPlan.mockResolvedValue({
        userId: 'student-id', weekOf: WEEK, planId: 'p',
        days: [{ dayIndex: 0, date: '2026-08-03', items: [] }],
        generatedBy: 'student', createdAt: '', updatedAt: '',
      });
      const ctx = makePlanCtx('POST', `/study-plan/${WEEK}/items`, { body: { dayIndex: 0, title: 'Revisar notas', type: 'custom' } });
      const res = await handleStudyPlans(ctx);
      expect(res.statusCode).toBe(200);
      const { data } = await bodyOf(res);
      expect(data.item.source).toBe('student');
      expect(data.item.title).toBe('Revisar notas');
    });
  });

  describe('POST /study-plan/request-change', () => {
    const WEEK = '2026-08-03';

    it('returns alreadyUnlocked if plan has no lock', async () => {
      mockGetStudyPlan.mockResolvedValue({ userId: 'student-id', weekOf: WEEK, planId: 'p', days: [], generatedBy: 'student', createdAt: '', updatedAt: '' });
      const ctx = makePlanCtx('POST', '/study-plan/request-change', { body: { weekOf: WEEK } });
      const res = await handleStudyPlans(ctx);
      const { data } = await bodyOf(res);
      expect(data.alreadyUnlocked).toBe(true);
    });

    it('sends notification to evaluator and sets changeRequested', async () => {
      mockGetStudyPlan.mockResolvedValue({
        userId: 'student-id', weekOf: WEEK, planId: 'p', lockedBy: 'eval-id',
        days: [], generatedBy: 'evaluator', createdAt: '', updatedAt: '',
      });
      const ctx = makePlanCtx('POST', '/study-plan/request-change', { body: { weekOf: WEEK, note: 'Quiero cambiar el jueves' } });
      const res = await handleStudyPlans(ctx);
      const { data } = await bodyOf(res);
      expect(data.requested).toBe(true);
      expect(mockCreateNotification).toHaveBeenCalledOnce();
      const notif = mockCreateNotification.mock.calls[0][0];
      expect(notif.userId).toBe('eval-id');
      expect(notif.type).toBe('STUDY_PLAN_CHANGE_REQUEST');
    });
  });

  describe('DELETE /study-plan/:weekOf/items/:itemId', () => {
    const WEEK = '2026-08-03';
    const ITEM_ID = 'del-item';

    it('removes item from days', async () => {
      mockGetStudyPlan.mockResolvedValue({
        userId: 'student-id', weekOf: WEEK, planId: 'p',
        days: [{ dayIndex: 0, date: '2026-08-03', items: [{ id: ITEM_ID, type: 'custom', title: 'Old', pinned: false, completed: false, source: 'student' }] }],
        generatedBy: 'student', createdAt: '', updatedAt: '',
      });
      const ctx = makePlanCtx('DELETE', `/study-plan/${WEEK}/items/${ITEM_ID}`);
      const res = await handleStudyPlans(ctx);
      expect(res.statusCode).toBe(200);
      const updateCall = mockUpdateStudyPlanField.mock.calls[0];
      const updatedDays = updateCall[2].days;
      expect(updatedDays[0].items).toHaveLength(0);
    });
  });

  it('returns null for unrecognized routes', async () => {
    const ctx = makePlanCtx('GET', '/study-plan/unknown-path');
    const res = await handleStudyPlans(ctx);
    expect(res).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Evaluator routes — handleEvalStudyPlans
// ─────────────────────────────────────────────────────────────────────────────
describe('handleEvalStudyPlans — evaluator routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStudyPlan.mockResolvedValue(null);
    mockGetEnrollments.mockResolvedValue([]);
    mockGetAllQuizAttempts.mockResolvedValue([]);
  });

  describe('POST /evaluator/students/:studentId/study-plan', () => {
    it('generates and saves a locked plan', async () => {
      const ctx = makeEvalCtx({
        method: 'POST',
        path: '/evaluator/students/student-123/study-plan',
        body: {},
      });
      const res = await handleEvalStudyPlans(ctx);
      expect(res.statusCode).toBe(200);
      expect(mockSaveStudyPlan).toHaveBeenCalledOnce();
      const saved = mockSaveStudyPlan.mock.calls[0][0];
      expect(saved.lockedBy).toBe('eval-uuid');
      expect(saved.generatedBy).toBe('evaluator');
      expect(saved.days).toHaveLength(7);
    });

    it('notifies student after locking', async () => {
      const ctx = makeEvalCtx({
        method: 'POST',
        path: '/evaluator/students/student-123/study-plan',
        body: {},
      });
      await handleEvalStudyPlans(ctx);
      expect(mockCreateNotification).toHaveBeenCalledOnce();
      const notif = mockCreateNotification.mock.calls[0][0];
      expect(notif.userId).toBe('student-123');
      expect(notif.type).toBe('STUDY_PLAN_LOCKED');
    });

    it('uses custom items when provided', async () => {
      const ctx = makeEvalCtx({
        method: 'POST',
        path: '/evaluator/students/student-123/study-plan',
        body: { items: [{ dayIndex: 2, title: 'Lección especial', type: 'lesson', estimatedMinutes: 45 }] },
      });
      await handleEvalStudyPlans(ctx);
      const saved = mockSaveStudyPlan.mock.calls[0][0];
      const dayItems = saved.days[2].items;
      expect(dayItems).toHaveLength(1);
      expect(dayItems[0].title).toBe('Lección especial');
      expect(dayItems[0].source).toBe('evaluator');
      expect(dayItems[0].pinned).toBe(true);
    });

    it('clamps dayIndex within 0-6 for custom items', async () => {
      const ctx = makeEvalCtx({
        method: 'POST',
        path: '/evaluator/students/student-123/study-plan',
        body: { items: [{ dayIndex: 99, title: 'Out of bounds', type: 'custom' }] },
      });
      await handleEvalStudyPlans(ctx);
      const saved = mockSaveStudyPlan.mock.calls[0][0];
      // dayIndex 99 clamped to 6
      expect(saved.days[6].items).toHaveLength(1);
    });

    it('preserves existing planId on re-generate', async () => {
      mockGetStudyPlan.mockResolvedValue({
        userId: 'student-123', weekOf: getMonday(), planId: 'original-id',
        days: [], generatedBy: 'student', createdAt: '2026-08-03T00:00:00Z', updatedAt: '2026-08-03T00:00:00Z',
      });
      const ctx = makeEvalCtx({
        method: 'POST',
        path: '/evaluator/students/student-123/study-plan',
        body: {},
      });
      await handleEvalStudyPlans(ctx);
      const saved = mockSaveStudyPlan.mock.calls[0][0];
      expect(saved.planId).toBe('original-id');
    });
  });

  describe('GET /evaluator/students/:studentId/study-plan', () => {
    it('returns plans for student', async () => {
      const fakePlans = [
        { userId: 'student-123', weekOf: '2026-08-03', planId: 'p1', days: [], generatedBy: 'evaluator', createdAt: '', updatedAt: '' },
      ];
      mockGetStudyPlans.mockResolvedValue(fakePlans);
      const ctx = makeEvalCtx({
        method: 'GET',
        path: '/evaluator/students/student-123/study-plan',
        event: { queryStringParameters: { weeks: '2' }, requestContext: { http: { method: 'GET' } } },
      });
      const res = await handleEvalStudyPlans(ctx);
      expect(res.statusCode).toBe(200);
      const { data } = await bodyOf(res);
      expect(data).toHaveLength(1);
      expect(data[0].planId).toBe('p1');
    });
  });

  describe('POST /evaluator/students/:studentId/study-plan/unlock', () => {
    it('removes lock attributes and notifies student', async () => {
      const ctx = makeEvalCtx({
        method: 'POST',
        path: '/evaluator/students/student-123/study-plan/unlock',
        body: { weekOf: '2026-08-03' },
      });
      const res = await handleEvalStudyPlans(ctx);
      expect(res.statusCode).toBe(200);
      const { data } = await bodyOf(res);
      expect(data.unlocked).toBe(true);

      // Must use removeStudyPlanAttributes (not just updateField) for unlock
      expect(mockRemoveStudyPlanAttributes).toHaveBeenCalledOnce();
      const removeArgs = mockRemoveStudyPlanAttributes.mock.calls[0];
      expect(removeArgs[0]).toBe('student-123');
      expect(removeArgs[1]).toBe('2026-08-03');
      expect(removeArgs[2]).toContain('lockedBy');
      expect(removeArgs[2]).toContain('changeRequested');

      // Student notified
      expect(mockCreateNotification).toHaveBeenCalledOnce();
      const notif = mockCreateNotification.mock.calls[0][0];
      expect(notif.userId).toBe('student-123');
      expect(notif.type).toBe('STUDY_PLAN_UNLOCKED');
    });
  });

  it('returns null for unrecognized routes', async () => {
    const ctx = makeEvalCtx({ method: 'GET', path: '/evaluator/students/x/something-else' });
    const res = await handleEvalStudyPlans(ctx);
    expect(res).toBeNull();
  });
});
