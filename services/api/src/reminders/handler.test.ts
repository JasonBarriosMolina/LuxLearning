import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks — must be set up before importing handler ────────────────────────

const mockSesSend     = vi.hoisted(() => vi.fn());
const mockCognitoSend = vi.hoisted(() => vi.fn());

vi.mock('../shared/db-dynamo', () => ({
  getAllLessonProgress:  vi.fn(),
  getAllEnrollments:     vi.fn(),
  getAllReflections:     vi.fn(),
  getLastSeenAll:        vi.fn(),
  getAllPendingTasks:    vi.fn(),
  updateTask:           vi.fn(),
  getInactivityReminder: vi.fn(),
  setInactivityReminder: vi.fn(),
}));

vi.mock('../shared/db-neon', () => ({
  getPrismaClient: vi.fn().mockResolvedValue({
    course: { findMany: vi.fn().mockResolvedValue([]) },
  }),
}));

vi.mock('../shared/email', () => ({
  sendTemplatedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  // Must use regular functions — arrow functions cannot be used as constructors with `new`
  SESClient:        function() { return { send: mockSesSend }; },
  SendEmailCommand: function(inp: any) { return inp; },
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function() { return { send: mockCognitoSend }; },
  AdminGetUserCommand:           function(inp: any) { return inp; },
}));

import { handler } from './handler';
import {
  getAllLessonProgress, getAllEnrollments, getAllReflections,
  getLastSeenAll, getAllPendingTasks,
  getInactivityReminder, setInactivityReminder,
} from '../shared/db-dynamo';

// ── Helpers ────────────────────────────────────────────────────────────────

const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();
const daysAgo  = (n: number) => hoursAgo(n * 24);

const ENROLLED  = [{ userId: 'user-1', courseId: 'course-1' }] as any[];
const COG_USER  = { UserAttributes: [{ Name: 'email', Value: 'student@test.com' }, { Name: 'name', Value: 'Estudiante' }] };

beforeEach(() => {
  vi.clearAllMocks();

  // Defaults: one enrolled user, no heartbeat, no prior reminders
  vi.mocked(getAllEnrollments).mockResolvedValue(ENROLLED);
  vi.mocked(getAllLessonProgress).mockResolvedValue([]);
  vi.mocked(getAllReflections).mockResolvedValue([]);
  vi.mocked(getLastSeenAll).mockResolvedValue([]);
  vi.mocked(getAllPendingTasks).mockResolvedValue([]);
  vi.mocked(getInactivityReminder).mockResolvedValue({ count: 0, lastSent: null });
  vi.mocked(setInactivityReminder).mockResolvedValue(undefined as any);
  mockSesSend.mockResolvedValue({});
  mockCognitoSend.mockResolvedValue(COG_USER);
});

// ── Inactivity threshold ───────────────────────────────────────────────────

describe('inactivity threshold', () => {
  it('skips user who was active less than 72h ago', async () => {
    vi.mocked(getLastSeenAll).mockResolvedValue([{ userId: 'user-1', lastSeen: hoursAgo(48) }]);
    await handler();
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(vi.mocked(setInactivityReminder)).not.toHaveBeenCalled();
  });

  it('targets user who was active exactly 72h ago', async () => {
    vi.mocked(getLastSeenAll).mockResolvedValue([{ userId: 'user-1', lastSeen: hoursAgo(72) }]);
    await handler();
    expect(mockSesSend).toHaveBeenCalledTimes(1);
  });

  it('uses lesson activity as fallback when no heartbeat exists', async () => {
    // 10h ago lesson activity → should be considered active, no email
    vi.mocked(getAllLessonProgress).mockResolvedValue([
      { userId: 'user-1', completedAt: hoursAgo(10) } as any,
    ]);
    vi.mocked(getLastSeenAll).mockResolvedValue([]); // No heartbeat
    await handler();
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('uses reflection activity as fallback when no heartbeat or lesson progress', async () => {
    // 10h ago reflection → should be considered active
    vi.mocked(getAllReflections).mockResolvedValue([
      { userId: 'user-1', submittedAt: hoursAgo(10) } as any,
    ]);
    vi.mocked(getLastSeenAll).mockResolvedValue([]);
    await handler();
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('treats user with no heartbeat and no activity as inactive', async () => {
    // No heartbeat, no progress, no reflections → sends first email
    await handler();
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setInactivityReminder)).toHaveBeenCalledWith('user-1', 1, expect.any(String));
  });
});

// ── 5-email sequence ──────────────────────────────────────────────────────

describe('reminder email sequence (5-email max)', () => {
  const inactive = () =>
    vi.mocked(getLastSeenAll).mockResolvedValue([{ userId: 'user-1', lastSeen: hoursAgo(500) }]);

  it('email #1: sent when count=0 and inactive ≥ 72h', async () => {
    inactive();
    vi.mocked(getInactivityReminder).mockResolvedValue({ count: 0, lastSent: null });
    await handler();
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setInactivityReminder)).toHaveBeenCalledWith('user-1', 1, expect.any(String));
  });

  it('email #2: NOT sent when count=1 but < 72h since last', async () => {
    inactive();
    vi.mocked(getInactivityReminder).mockResolvedValue({ count: 1, lastSent: hoursAgo(48) });
    await handler();
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(vi.mocked(setInactivityReminder)).not.toHaveBeenCalled();
  });

  it('email #2: sent when count=1 and ≥ 72h since first email', async () => {
    inactive();
    vi.mocked(getInactivityReminder).mockResolvedValue({ count: 1, lastSent: hoursAgo(73) });
    await handler();
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setInactivityReminder)).toHaveBeenCalledWith('user-1', 2, expect.any(String));
  });

  it('email #3 (weekly): NOT sent when count=2 but < 7 days since last', async () => {
    inactive();
    vi.mocked(getInactivityReminder).mockResolvedValue({ count: 2, lastSent: daysAgo(6) });
    await handler();
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('email #3 (weekly): sent when count=2 and ≥ 7 days since second email', async () => {
    inactive();
    vi.mocked(getInactivityReminder).mockResolvedValue({ count: 2, lastSent: daysAgo(8) });
    await handler();
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setInactivityReminder)).toHaveBeenCalledWith('user-1', 3, expect.any(String));
  });

  it('email #4 (weekly): sent when count=3 and ≥ 7 days since third email', async () => {
    inactive();
    vi.mocked(getInactivityReminder).mockResolvedValue({ count: 3, lastSent: daysAgo(8) });
    await handler();
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setInactivityReminder)).toHaveBeenCalledWith('user-1', 4, expect.any(String));
  });

  it('email #5 (final "te extrañamos"): sent when count=4 and ≥ 7 days since fourth email', async () => {
    inactive();
    vi.mocked(getInactivityReminder).mockResolvedValue({ count: 4, lastSent: daysAgo(8) });
    await handler();
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const sent = mockSesSend.mock.calls[0]![0] as any;
    expect(sent.Message.Subject.Data).toContain('extrañamos');
    expect(vi.mocked(setInactivityReminder)).toHaveBeenCalledWith('user-1', 5, expect.any(String));
  });

  it('stops at count=5 — no more emails ever sent', async () => {
    inactive();
    vi.mocked(getInactivityReminder).mockResolvedValue({ count: 5, lastSent: daysAgo(30) });
    await handler();
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(vi.mocked(setInactivityReminder)).not.toHaveBeenCalled();
  });
});

// ── NaN guard ─────────────────────────────────────────────────────────────

describe('NaN guard — progress items without completedAt', () => {
  it('skips items without completedAt when building lastActivity map', async () => {
    // A row without completedAt (e.g. INACTIVITY_REMINDER item returned by scan)
    vi.mocked(getAllLessonProgress).mockResolvedValue([
      { userId: 'user-1' } as any,
    ]);
    vi.mocked(getLastSeenAll).mockResolvedValue([]);
    await handler();
    // User has no valid activity → treated as never active → first email goes out
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setInactivityReminder)).toHaveBeenCalledWith('user-1', 1, expect.any(String));
  });

  it('does NOT corrupt lastActivity when invalid row comes before valid one', async () => {
    // Without the guard: invalid item sets lastActivity = NaN, valid item cannot overwrite
    // because `NaN > validTimestamp` is false → user appears inactive even though active 10h ago
    vi.mocked(getAllLessonProgress).mockResolvedValue([
      { userId: 'user-1' } as any,                              // no completedAt (comes first)
      { userId: 'user-1', completedAt: hoursAgo(10) } as any,  // valid, 10h ago
    ]);
    vi.mocked(getLastSeenAll).mockResolvedValue([]); // no heartbeat — relies on lastActivity
    await handler();
    // lastActivity should be 10h ago → hoursInactive = 10 < 72 → no email
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('skips items with NaN completedAt (invalid date strings)', async () => {
    vi.mocked(getAllLessonProgress).mockResolvedValue([
      { userId: 'user-1', completedAt: 'not-a-date' } as any,
    ]);
    vi.mocked(getLastSeenAll).mockResolvedValue([]);
    // NaN date — should be skipped — user treated as never active
    await handler();
    expect(mockSesSend).toHaveBeenCalledTimes(1);
  });
});

// ── Email content ─────────────────────────────────────────────────────────

describe('email content', () => {
  it('includes user name in the email subject', async () => {
    vi.mocked(getLastSeenAll).mockResolvedValue([{ userId: 'user-1', lastSeen: hoursAgo(100) }]);
    await handler();
    const sent = mockSesSend.mock.calls[0]![0] as any;
    expect(sent.Message.Subject.Data).toContain('Estudiante');
  });

  it('sends to the correct email address from Cognito', async () => {
    vi.mocked(getLastSeenAll).mockResolvedValue([{ userId: 'user-1', lastSeen: hoursAgo(100) }]);
    await handler();
    const sent = mockSesSend.mock.calls[0]![0] as any;
    expect(sent.Destination.ToAddresses).toContain('student@test.com');
  });

  it('skips user if Cognito returns no email attribute', async () => {
    vi.mocked(getLastSeenAll).mockResolvedValue([{ userId: 'user-1', lastSeen: hoursAgo(100) }]);
    mockCognitoSend.mockResolvedValue({ UserAttributes: [{ Name: 'name', Value: 'Sin Email' }] });
    await handler();
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('skips user if Cognito lookup throws', async () => {
    vi.mocked(getLastSeenAll).mockResolvedValue([{ userId: 'user-1', lastSeen: hoursAgo(100) }]);
    mockCognitoSend.mockRejectedValue(new Error('UserNotFoundException'));
    await handler();
    expect(mockSesSend).not.toHaveBeenCalled();
  });
});

// ── Multiple users ────────────────────────────────────────────────────────

describe('multiple enrolled users', () => {
  it('processes each user independently', async () => {
    vi.mocked(getAllEnrollments).mockResolvedValue([
      { userId: 'user-active',   courseId: 'c1' },
      { userId: 'user-inactive', courseId: 'c1' },
    ] as any[]);
    vi.mocked(getLastSeenAll).mockResolvedValue([
      { userId: 'user-active',   lastSeen: hoursAgo(10) },  // active
      { userId: 'user-inactive', lastSeen: hoursAgo(200) }, // inactive
    ]);
    vi.mocked(getInactivityReminder).mockResolvedValue({ count: 0, lastSent: null });
    mockCognitoSend.mockResolvedValue(COG_USER);

    await handler();
    // Only the inactive user should receive an email
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setInactivityReminder)).toHaveBeenCalledWith('user-inactive', 1, expect.any(String));
    expect(vi.mocked(setInactivityReminder)).not.toHaveBeenCalledWith('user-active', expect.any(Number), expect.anything());
  });
});
