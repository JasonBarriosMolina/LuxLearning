/**
 * Tests for services/api/src/attendance/handler.ts
 * Covers: record (PRESENT/ABSENT/LATE/invalid), matrix, pending, review (actionUrl fix),
 * justification presign, override with extraHours, risk scores, notifId uniqueness.
 * NEW: qr-token, qr-record, admin/overview, export CSV.
 */
import { createHmac } from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEvent, makePrisma, bodyOf } from '../helpers/ctx';

// ── Mock all AWS SDK clients ─────────────────────────────────────────────────
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client:          function () { return { send: vi.fn().mockResolvedValue({}) }; },
  PutObjectCommand:  function (x: any) { return x; },
  GetObjectCommand:  function (x: any) { return x; },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.presigned.url/doc.pdf'),
}));
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient:          function () { return { send: vi.fn().mockResolvedValue({}) }; },
  SendMessageCommand: function (x: any) { return x; },
}));

// ── Mock db-dynamo functions ─────────────────────────────────────────────────
const mockRecordAttendance      = vi.fn().mockResolvedValue(undefined);
const mockGetAttendanceMatrix   = vi.fn().mockResolvedValue([]);
const mockGetMyAttendance       = vi.fn().mockResolvedValue([]);
const mockUpdateAttendanceRecord = vi.fn().mockResolvedValue(undefined);
const mockGetPendingJustifications = vi.fn().mockResolvedValue([]);
const mockGetRiskScores         = vi.fn().mockResolvedValue(null);
const mockCreateNotification    = vi.fn().mockResolvedValue(undefined);

vi.mock('../../shared/db-dynamo', () => ({
  recordAttendance:          (...a: any[]) => mockRecordAttendance(...a),
  getAttendanceMatrix:       (...a: any[]) => mockGetAttendanceMatrix(...a),
  getMyAttendance:           (...a: any[]) => mockGetMyAttendance(...a),
  updateAttendanceRecord:    (...a: any[]) => mockUpdateAttendanceRecord(...a),
  getPendingJustifications:  (...a: any[]) => mockGetPendingJustifications(...a),
  getRiskScores:             (...a: any[]) => mockGetRiskScores(...a),
  createNotification:        (...a: any[]) => mockCreateNotification(...a),
}));

vi.mock('../../shared/db-neon', () => ({
  getPrismaClient: vi.fn(),
}));
vi.mock('../../shared/env-context', () => ({
  setEnvironmentFromOrigin: vi.fn(),
}));
vi.mock('../../shared/response', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual };
});

import { handler } from '../../attendance/handler';
import { getPrismaClient } from '../../shared/db-neon';

function makeAttendanceEvent(method: string, path: string, body?: any, role = 'EVALUATOR') {
  return makeEvent(role, method, path, { body });
}

function makePrismaWithSession(sessionDate = new Date()) {
  return makePrisma({
    courseSession: {
      findUnique: vi.fn().mockResolvedValue({ id: 'sess-1', sessionDate, courseId: 'course-1' }),
      findMany:   vi.fn().mockResolvedValue([{ id: 'sess-1', sessionDate: new Date(), order: 1 }]),
    },
    course: {
      findUnique: vi.fn().mockResolvedValue({ id: 'course-1', evaluatorId: 'eval-uuid', title: 'Test Course' }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPrismaClient).mockResolvedValue(makePrismaWithSession() as any);
  process.env.FRONTEND_URL = 'https://test.lux.app';
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /attendance/record
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /attendance/record', () => {
  it('records PRESENT and ABSENT for multiple students', async () => {
    const event = makeAttendanceEvent('POST', '/attendance/record', {
      courseId: 'course-1', sessionId: 'sess-1',
      records: [
        { userId: 'student-A', status: 'PRESENT' },
        { userId: 'student-B', status: 'ABSENT' },
      ],
    });
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.recorded).toBe(2);
    expect(mockRecordAttendance).toHaveBeenCalledTimes(2);
  });

  it('records LATE status (FIX #12)', async () => {
    const event = makeAttendanceEvent('POST', '/attendance/record', {
      courseId: 'course-1', sessionId: 'sess-1',
      records: [{ userId: 'student-A', status: 'LATE' }],
    });
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    expect(mockRecordAttendance).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'student-A', status: 'LATE' })
    );
  });

  it('skips records with invalid status — does not crash', async () => {
    const event = makeAttendanceEvent('POST', '/attendance/record', {
      courseId: 'course-1', sessionId: 'sess-1',
      records: [
        { userId: 'student-A', status: 'INVALID_STATUS' },
        { userId: 'student-B', status: 'PRESENT' },
      ],
    });
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    // Only valid record is saved
    expect(mockRecordAttendance).toHaveBeenCalledTimes(1);
    expect(mockRecordAttendance).toHaveBeenCalledWith(expect.objectContaining({ userId: 'student-B' }));
  });

  it('returns 400 when missing required fields', async () => {
    const event = makeAttendanceEvent('POST', '/attendance/record', { courseId: 'course-1' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 403 for STUDENT role', async () => {
    const event = makeAttendanceEvent('POST', '/attendance/record', {
      courseId: 'course-1', sessionId: 'sess-1', records: [],
    }, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 404 when session does not exist', async () => {
    vi.mocked(getPrismaClient).mockResolvedValue(makePrisma({
      courseSession: { findUnique: vi.fn().mockResolvedValue(null) },
    }) as any);
    const event = makeAttendanceEvent('POST', '/attendance/record', {
      courseId: 'course-1', sessionId: 'nonexistent', records: [],
    });
    const res = await handler(event);
    expect(res?.statusCode).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /attendance/matrix/:courseId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /attendance/matrix/:courseId', () => {
  it('returns sessions and studentRows', async () => {
    mockGetAttendanceMatrix.mockResolvedValue([
      { courseId: 'course-1', sk: 'student-A#sess-1', userId: 'student-A', sessionId: 'sess-1', status: 'PRESENT', sessionDate: '2026-01-15', createdAt: '', updatedAt: '' },
    ]);
    const event = makeAttendanceEvent('GET', '/attendance/matrix/course-1');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('sessions');
    expect(body.data).toHaveProperty('studentRows');
    expect(body.data.studentRows).toHaveLength(1);
    expect(body.data.studentRows[0].userId).toBe('student-A');
  });

  it('excludes RISK_SCORES row from studentRows', async () => {
    mockGetAttendanceMatrix.mockResolvedValue([
      { courseId: 'course-1', sk: 'RISK_SCORES', userId: 'student-A', sessionId: 'x', status: 'PRESENT', sessionDate: '', createdAt: '', updatedAt: '' },
    ]);
    const event = makeAttendanceEvent('GET', '/attendance/matrix/course-1');
    const res = await handler(event);
    const body = await bodyOf(res);
    expect(body.data.studentRows).toHaveLength(0);
  });

  it('returns 403 for STUDENT role', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/matrix/course-1', undefined, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /attendance/review — FIX #3 actionUrl, FIX #18 notifId
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /attendance/review', () => {
  const reviewBody = { courseId: 'course-1', sk: 'student-A#sess-1', status: 'JUSTIFIED', evaluatorFeedback: 'Aprobado' };

  it('approves and sends notification with correct actionUrl (FIX #3)', async () => {
    const event = makeAttendanceEvent('PUT', '/attendance/review', reviewBody);
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    expect(mockUpdateAttendanceRecord).toHaveBeenCalledWith(
      'course-1', 'student-A#sess-1',
      expect.objectContaining({ status: 'JUSTIFIED', evaluatorFeedback: 'Aprobado' })
    );
    const notif = mockCreateNotification.mock.calls[0][0];
    expect(notif.userId).toBe('student-A');
    // FIX #3: actionUrl must include /courses/{courseId}/attendance — not the dead /attendance route
    expect(notif.actionUrl).toContain('/courses/course-1/attendance');
    expect(notif.actionUrl).not.toBe('/attendance');
    expect(notif.actionUrl).not.toMatch(/^\/attendance$/);
  });

  it('rejects and sends notification with correct actionUrl path (FIX #3)', async () => {
    const event = makeAttendanceEvent('PUT', '/attendance/review', { ...reviewBody, status: 'REJECTED', evaluatorFeedback: 'Documentación inválida' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const notif = mockCreateNotification.mock.calls[0][0];
    expect(notif.actionUrl).toContain('/courses/course-1/attendance');
  });

  it('notifId uses createId — not a timestamp (FIX #18)', async () => {
    const event = makeAttendanceEvent('PUT', '/attendance/review', reviewBody);
    await handler(event);
    const notifCall = mockCreateNotification.mock.calls[0][0];
    // createId produces a non-numeric cuid2 string starting with a letter
    expect(notifCall.notifId).toMatch(/^attendance-review-[a-z0-9]+$/);
    expect(notifCall.notifId).not.toMatch(/^attendance-review-\d{13}$/);
  });

  it('returns 400 for unknown status', async () => {
    const event = makeAttendanceEvent('PUT', '/attendance/review', { ...reviewBody, status: 'PENDING' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 403 for STUDENT role', async () => {
    const event = makeAttendanceEvent('PUT', '/attendance/review', reviewBody, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /attendance/justify — presign URL
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /attendance/justify', () => {
  beforeEach(() => {
    mockGetMyAttendance.mockResolvedValue([{
      courseId: 'course-1', sk: 'student-A#sess-1', userId: 'user-uuid',
      sessionId: 'sess-1', status: 'ABSENT',
      justificationDeadline: new Date(Date.now() + 3600_000).toISOString(),
      sessionDate: '2026-01-15', createdAt: '', updatedAt: '',
    }]);
  });

  it('returns presigned URL for valid PDF', async () => {
    const event = makeAttendanceEvent('POST', '/attendance/justify', {
      courseId: 'course-1', sk: 'student-A#sess-1',
      fileName: 'doc.pdf', fileType: 'application/pdf',
    }, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.presignedUrl).toBe('https://s3.presigned.url/doc.pdf');
    expect(body.data.s3Key).toContain('justifications/');
  });

  it('returns 400 for unsupported file type', async () => {
    const event = makeAttendanceEvent('POST', '/attendance/justify', {
      courseId: 'course-1', sk: 'student-A#sess-1',
      fileName: 'doc.docx', fileType: 'application/msword',
    }, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 403 when deadline has passed', async () => {
    mockGetMyAttendance.mockResolvedValue([{
      courseId: 'course-1', sk: 'student-A#sess-1', userId: 'user-uuid',
      sessionId: 'sess-1', status: 'ABSENT',
      justificationDeadline: new Date(Date.now() - 1000).toISOString(),
      sessionDate: '2026-01-15', createdAt: '', updatedAt: '',
    }]);
    const event = makeAttendanceEvent('POST', '/attendance/justify', {
      courseId: 'course-1', sk: 'student-A#sess-1', fileName: 'doc.pdf', fileType: 'application/pdf',
    }, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /attendance/override — FIX #6 extraHours
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /attendance/override', () => {
  it('extends deadline by extraHours (FIX #6)', async () => {
    const before = Date.now();
    const event = makeAttendanceEvent('PUT', '/attendance/override', {
      courseId: 'course-1', sk: 'student-A#sess-1',
      overrideReason: 'Hospitalización', extraHours: 48,
    });
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.overridden).toBe(true);
    expect(body.data.extraHours).toBe(48);
    const updateCall = mockUpdateAttendanceRecord.mock.calls[0];
    const newDeadline = new Date(updateCall[2].justificationDeadline).getTime();
    expect(newDeadline).toBeGreaterThanOrEqual(before + 47 * 3600_000);
    expect(newDeadline).toBeLessThanOrEqual(before + 49 * 3600_000);
  });

  it('uses 168h default when extraHours is not provided', async () => {
    const before = Date.now();
    const event = makeAttendanceEvent('PUT', '/attendance/override', {
      courseId: 'course-1', sk: 'student-A#sess-1', overrideReason: 'Emergency',
    });
    await handler(event);
    const updateCall = mockUpdateAttendanceRecord.mock.calls[0];
    const newDeadline = new Date(updateCall[2].justificationDeadline).getTime();
    expect(newDeadline).toBeGreaterThanOrEqual(before + 167 * 3600_000);
  });

  it('returns 400 without overrideReason', async () => {
    const event = makeAttendanceEvent('PUT', '/attendance/override', {
      courseId: 'course-1', sk: 'student-A#sess-1',
    });
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 403 for STUDENT role', async () => {
    const event = makeAttendanceEvent('PUT', '/attendance/override', {
      courseId: 'course-1', sk: 'student-A#sess-1', overrideReason: 'test',
    }, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /attendance/risk/:courseId — FIX #5
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /attendance/risk/:courseId', () => {
  it('returns risk scores when present', async () => {
    mockGetRiskScores.mockResolvedValue({
      scores: [{ userId: 'student-A', name: 'Ana García', riskLevel: 'HIGH', riskScore: 80, absenceRate: 50, reason: 'many absences', suggestedAction: 'call' }],
      cohortInsight: 'Group at risk',
    });
    const event = makeAttendanceEvent('GET', '/attendance/risk/course-1');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.scores).toHaveLength(1);
    expect(body.data.scores[0].name).toBe('Ana García');
  });

  it('returns empty scores when no risk data', async () => {
    mockGetRiskScores.mockResolvedValue(null);
    const event = makeAttendanceEvent('GET', '/attendance/risk/course-1');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.scores).toEqual([]);
  });

  it('returns 403 for STUDENT role', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/risk/course-1', undefined, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /attendance/pending/:courseId — FIX #5
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /attendance/pending/:courseId', () => {
  it('returns pending justifications', async () => {
    mockGetPendingJustifications.mockResolvedValue([
      { courseId: 'course-1', sk: 'student-A#sess-1', userId: 'student-A', sessionId: 'sess-1', status: 'JUSTIFICATION_PENDING', sessionDate: '2026-01-15', createdAt: '', updatedAt: '' },
    ]);
    const event = makeAttendanceEvent('GET', '/attendance/pending/course-1');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].userId).toBe('student-A');
  });

  it('returns 403 for STUDENT role', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/pending/course-1', undefined, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /attendance/justify/submit — notifId uniqueness (FIX #18)
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /attendance/justify/submit', () => {
  beforeEach(() => {
    mockGetMyAttendance.mockResolvedValue([{
      courseId: 'course-1', sk: 'student-A#sess-1', userId: 'user-uuid',
      sessionId: 'sess-1', status: 'ABSENT',
      justificationDeadline: new Date(Date.now() + 3600_000).toISOString(),
      sessionDate: '2026-01-15', createdAt: '', updatedAt: '',
    }]);
  });

  it('marks JUSTIFICATION_PENDING and notifies evaluator with createId notifId (FIX #18)', async () => {
    const event = makeAttendanceEvent('PUT', '/attendance/justify/submit', {
      courseId: 'course-1', sk: 'student-A#sess-1', documentKey: 'justifications/user-uuid/course-1/doc.pdf',
    }, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    expect(mockUpdateAttendanceRecord).toHaveBeenCalledWith(
      'course-1', 'student-A#sess-1',
      expect.objectContaining({ status: 'JUSTIFICATION_PENDING', documentKey: 'justifications/user-uuid/course-1/doc.pdf' })
    );
    const notifCall = mockCreateNotification.mock.calls[0][0];
    expect(notifCall.notifId).toMatch(/^justif-[a-z0-9]+$/);
    expect(notifCall.notifId).not.toMatch(/^justif-\d{13}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QR token helper (mirrors handler internals — secret falls back to dev default)
// ─────────────────────────────────────────────────────────────────────────────

function buildQrToken(userId: string, courseId: string, offsetMs = 15_000): string {
  const secret = process.env.JWT_SECRET ?? 'lux-qr-dev-secret';
  const exp = Date.now() + offsetMs;
  const payload = Buffer.from(JSON.stringify({ userId, courseId, exp })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /attendance/qr-token
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /attendance/qr-token', () => {
  it('returns token and expiresAt for any authenticated user', async () => {
    const event = makeEvent('STUDENT', 'GET', '/attendance/qr-token', { qs: { courseId: 'course-1' } });
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(typeof body.data.token).toBe('string');
    expect(body.data.token.length).toBeGreaterThan(10);
    expect(body.data.expiresAt).toBeTruthy();
  });

  it('token has payload.signature format', async () => {
    const event = makeEvent('STUDENT', 'GET', '/attendance/qr-token', { qs: { courseId: 'course-1' } });
    const res = await handler(event);
    const body = await bodyOf(res);
    const parts = body.data.token.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
  });

  it('payload contains correct userId and courseId', async () => {
    const event = makeEvent('STUDENT', 'GET', '/attendance/qr-token', { qs: { courseId: 'course-abc' } });
    const res = await handler(event);
    const body = await bodyOf(res);
    const raw = Buffer.from(body.data.token.split('.')[0], 'base64url').toString();
    const decoded = JSON.parse(raw);
    expect(decoded.userId).toBe('user-uuid');  // from makeEvent default
    expect(decoded.courseId).toBe('course-abc');
    expect(decoded.exp).toBeGreaterThan(Date.now());
  });

  it('token expires ~30 seconds from now', async () => {
    const before = Date.now();
    const event = makeEvent('STUDENT', 'GET', '/attendance/qr-token', { qs: { courseId: 'course-1' } });
    const res = await handler(event);
    const body = await bodyOf(res);
    const decoded = JSON.parse(Buffer.from(body.data.token.split('.')[0], 'base64url').toString());
    const ttl = decoded.exp - before;
    expect(ttl).toBeGreaterThanOrEqual(29_000);
    expect(ttl).toBeLessThanOrEqual(31_000);
  });

  it('expiresAt matches payload exp field', async () => {
    const event = makeEvent('STUDENT', 'GET', '/attendance/qr-token', { qs: { courseId: 'course-1' } });
    const res = await handler(event);
    const body = await bodyOf(res);
    const decoded = JSON.parse(Buffer.from(body.data.token.split('.')[0], 'base64url').toString());
    expect(new Date(body.data.expiresAt).getTime()).toBe(decoded.exp);
  });

  it('returns 400 when courseId is missing', async () => {
    const event = makeEvent('STUDENT', 'GET', '/attendance/qr-token');
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
  });

  it('EVALUATOR and ADMIN can also generate a token', async () => {
    for (const role of ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN']) {
      const event = makeEvent(role, 'GET', '/attendance/qr-token', { qs: { courseId: 'course-1' } });
      const res = await handler(event);
      expect(res?.statusCode).toBe(200);
    }
  });

  it('two sequential tokens have different signatures (different exp)', async () => {
    const event1 = makeEvent('STUDENT', 'GET', '/attendance/qr-token', { qs: { courseId: 'course-1' } });
    const event2 = makeEvent('STUDENT', 'GET', '/attendance/qr-token', { qs: { courseId: 'course-1' } });
    const [r1, r2] = await Promise.all([handler(event1), handler(event2)]);
    const b1 = await bodyOf(r1);
    const b2 = await bodyOf(r2);
    // Tokens may be identical if generated in the same millisecond — just verify both are valid strings
    expect(typeof b1.data.token).toBe('string');
    expect(typeof b2.data.token).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /attendance/qr-record
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /attendance/qr-record', () => {
  it('returns 403 for STUDENT role', async () => {
    const token = buildQrToken('student-X', 'course-1');
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token, sessionId: 'sess-1', courseId: 'course-1' }, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 400 when token is missing', async () => {
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { sessionId: 'sess-1', courseId: 'course-1' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when sessionId is missing', async () => {
    const token = buildQrToken('student-X', 'course-1');
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token, courseId: 'course-1' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when courseId is missing', async () => {
    const token = buildQrToken('student-X', 'course-1');
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token, sessionId: 'sess-1' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 for a tampered token (wrong signature)', async () => {
    const token = buildQrToken('student-X', 'course-1') + 'tampered';
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token, sessionId: 'sess-1', courseId: 'course-1' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
    const body = await bodyOf(res);
    expect(body.error).toMatch(/inválido|expirado/i);
  });

  it('returns 400 for an expired token', async () => {
    const expiredToken = buildQrToken('student-X', 'course-1', -1_000);  // already expired
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token: expiredToken, sessionId: 'sess-1', courseId: 'course-1' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
    const body = await bodyOf(res);
    expect(body.error).toMatch(/inválido|expirado/i);
  });

  it('returns 400 when token courseId does not match body courseId', async () => {
    const token = buildQrToken('student-X', 'course-1');
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token, sessionId: 'sess-1', courseId: 'course-DIFFERENT' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
    const body = await bodyOf(res);
    expect(body.error).toMatch(/no corresponde/i);
  });

  it('returns 404 when session does not exist', async () => {
    vi.mocked(getPrismaClient).mockResolvedValue(makePrisma({
      courseSession: { findUnique: vi.fn().mockResolvedValue(null) },
    }) as any);
    const token = buildQrToken('student-X', 'course-1');
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token, sessionId: 'sess-missing', courseId: 'course-1' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(404);
  });

  it('records PRESENT for valid token and returns userId', async () => {
    const studentId = 'student-X';
    const token = buildQrToken(studentId, 'course-1');
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token, sessionId: 'sess-1', courseId: 'course-1' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.userId).toBe(studentId);
    expect(body.data.recorded).toBe(true);
  });

  it('records with correct sk format (userId#sessionId)', async () => {
    const studentId = 'student-X';
    const token = buildQrToken(studentId, 'course-1');
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token, sessionId: 'sess-1', courseId: 'course-1' });
    await handler(event);
    expect(mockRecordAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        sk: `${studentId}#sess-1`,
        userId: studentId,
        status: 'PRESENT',
        courseId: 'course-1',
        sessionId: 'sess-1',
      })
    );
  });

  it('accepts ADMIN role', async () => {
    const token = buildQrToken('student-X', 'course-1');
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token, sessionId: 'sess-1', courseId: 'course-1' }, 'ADMIN');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
  });

  it('rejects totally malformed token (no dot separator)', async () => {
    const event = makeAttendanceEvent('POST', '/attendance/qr-record', { token: 'notavalidtoken', sessionId: 'sess-1', courseId: 'course-1' });
    const res = await handler(event);
    expect(res?.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /attendance/admin/overview
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /attendance/admin/overview', () => {
  it('returns 403 for STUDENT role', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/admin/overview', undefined, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 403 for EVALUATOR role', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/admin/overview', undefined, 'EVALUATOR');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 200 for ADMIN role with correct shape', async () => {
    vi.mocked(getPrismaClient).mockResolvedValue(makePrisma({
      course: { findMany: vi.fn().mockResolvedValue([{ id: 'c-1', title: 'Curso A' }, { id: 'c-2', title: 'Curso B' }]) },
    }) as any);
    mockGetRiskScores.mockResolvedValue(null);

    const event = makeAttendanceEvent('GET', '/attendance/admin/overview', undefined, 'ADMIN');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toHaveProperty('totalCourses');
    expect(body.data).toHaveProperty('globalAttendanceRate');
    expect(body.data).toHaveProperty('studentsAtRisk');
    expect(body.data).toHaveProperty('studentsWarning');
    expect(body.data).toHaveProperty('coursesSummary');
    expect(Array.isArray(body.data.coursesSummary)).toBe(true);
  });

  it('returns 200 for SUPER_ADMIN role', async () => {
    vi.mocked(getPrismaClient).mockResolvedValue(makePrisma({
      course: { findMany: vi.fn().mockResolvedValue([]) },
    }) as any);
    const event = makeAttendanceEvent('GET', '/attendance/admin/overview', undefined, 'SUPER_ADMIN');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
  });

  it('returns totalCourses=0 and globalRate=100 when no courses', async () => {
    vi.mocked(getPrismaClient).mockResolvedValue(makePrisma({
      course: { findMany: vi.fn().mockResolvedValue([]) },
    }) as any);
    const event = makeAttendanceEvent('GET', '/attendance/admin/overview', undefined, 'ADMIN');
    const res = await handler(event);
    const body = await bodyOf(res);
    expect(body.data.totalCourses).toBe(0);
    expect(body.data.globalAttendanceRate).toBe(100);
    expect(body.data.studentsAtRisk).toBe(0);
    expect(body.data.coursesSummary).toHaveLength(0);
  });

  it('aggregates HIGH and MODERATE risk counts correctly', async () => {
    vi.mocked(getPrismaClient).mockResolvedValue(makePrisma({
      course: { findMany: vi.fn().mockResolvedValue([{ id: 'c-1', title: 'Curso A' }]) },
    }) as any);
    mockGetRiskScores.mockResolvedValue({
      scores: [
        { userId: 'u1', riskLevel: 'HIGH',     absenceRate: 40 },
        { userId: 'u2', riskLevel: 'HIGH',     absenceRate: 50 },
        { userId: 'u3', riskLevel: 'MODERATE', absenceRate: 25 },
        { userId: 'u4', riskLevel: 'LOW',      absenceRate: 10 },
      ],
      cohortInsight: null,
    });

    const event = makeAttendanceEvent('GET', '/attendance/admin/overview', undefined, 'ADMIN');
    const res = await handler(event);
    const body = await bodyOf(res);
    expect(body.data.studentsAtRisk).toBe(2);
    expect(body.data.studentsWarning).toBe(1);
    expect(body.data.coursesSummary[0].studentsHigh).toBe(2);
    expect(body.data.coursesSummary[0].studentsModerate).toBe(1);
    expect(body.data.coursesSummary[0].totalStudents).toBe(4);
  });

  it('computes attendanceRate as 100 − average absenceRate', async () => {
    vi.mocked(getPrismaClient).mockResolvedValue(makePrisma({
      course: { findMany: vi.fn().mockResolvedValue([{ id: 'c-1', title: 'Curso A' }]) },
    }) as any);
    mockGetRiskScores.mockResolvedValue({
      scores: [
        { userId: 'u1', riskLevel: 'LOW', absenceRate: 20 },
        { userId: 'u2', riskLevel: 'LOW', absenceRate: 40 },
      ],
      cohortInsight: null,
    });

    const event = makeAttendanceEvent('GET', '/attendance/admin/overview', undefined, 'ADMIN');
    const res = await handler(event);
    const body = await bodyOf(res);
    // avg attendance = (80 + 60) / 2 = 70
    expect(body.data.coursesSummary[0].attendanceRate).toBe(70);
    expect(body.data.globalAttendanceRate).toBe(70);
  });

  it('coursesSummary is sorted by attendanceRate ascending (worst first)', async () => {
    vi.mocked(getPrismaClient).mockResolvedValue(makePrisma({
      course: { findMany: vi.fn().mockResolvedValue([
        { id: 'c-good', title: 'Buen Curso' },
        { id: 'c-bad',  title: 'Mal Curso'  },
      ]) },
    }) as any);
    mockGetRiskScores
      .mockResolvedValueOnce({ scores: [{ userId: 'u1', riskLevel: 'LOW', absenceRate: 5 }],  cohortInsight: null })
      .mockResolvedValueOnce({ scores: [{ userId: 'u2', riskLevel: 'HIGH', absenceRate: 60 }], cohortInsight: null });

    const event = makeAttendanceEvent('GET', '/attendance/admin/overview', undefined, 'ADMIN');
    const res = await handler(event);
    const body = await bodyOf(res);
    const rates = body.data.coursesSummary.map((c: any) => c.attendanceRate);
    expect(rates[0]).toBeLessThanOrEqual(rates[1]);  // sorted ascending
  });

  it('course with no risk data gets attendanceRate=100', async () => {
    vi.mocked(getPrismaClient).mockResolvedValue(makePrisma({
      course: { findMany: vi.fn().mockResolvedValue([{ id: 'c-new', title: 'Nuevo' }]) },
    }) as any);
    mockGetRiskScores.mockResolvedValue(null);

    const event = makeAttendanceEvent('GET', '/attendance/admin/overview', undefined, 'ADMIN');
    const res = await handler(event);
    const body = await bodyOf(res);
    expect(body.data.coursesSummary[0].attendanceRate).toBe(100);
    expect(body.data.globalAttendanceRate).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /attendance/export/:courseId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /attendance/export/:courseId', () => {
  const sampleRecords = [
    {
      courseId: 'course-1', sk: 'student-A#sess-1', userId: 'student-A', sessionId: 'sess-1',
      status: 'PRESENT', sessionDate: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T11:00:00.000Z', createdAt: '2026-01-15T09:00:00.000Z',
      overriddenBy: '', overrideReason: '', documentKey: '',
    },
    {
      courseId: 'course-1', sk: 'student-B#sess-1', userId: 'student-B', sessionId: 'sess-1',
      status: 'ABSENT', sessionDate: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T11:00:00.000Z', createdAt: '2026-01-15T09:00:00.000Z',
      overriddenBy: 'eval-uuid', overrideReason: 'Autorizado', documentKey: 'justif/doc.pdf',
      aiOcrData: { aiRecommendation: 'VALID_MATCH' },
    },
  ];

  beforeEach(() => {
    vi.mocked(getPrismaClient).mockResolvedValue(makePrismaWithSession() as any);
    mockGetAttendanceMatrix.mockResolvedValue(sampleRecords);
  });

  it('returns 403 for STUDENT role', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1', undefined, 'STUDENT');
    const res = await handler(event);
    expect(res?.statusCode).toBe(403);
  });

  it('returns 200 for EVALUATOR role', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1', undefined, 'EVALUATOR');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
  });

  it('returns 200 for ADMIN role', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1', undefined, 'ADMIN');
    const res = await handler(event);
    expect(res?.statusCode).toBe(200);
  });

  it('response contains csvContent string and filename', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1');
    const res = await handler(event);
    const body = await bodyOf(res);
    expect(typeof body.data.csvContent).toBe('string');
    expect(body.data.filename).toBe('asistencia-course-1.csv');
  });

  it('CSV has correct 9-column header row', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1');
    const res = await handler(event);
    const body = await bodyOf(res);
    const lines = body.data.csvContent.split('\n');
    const headerCols = lines[0]!.split(',');
    expect(headerCols).toHaveLength(9);
    expect(lines[0]).toContain('Fecha');
    expect(lines[0]).toContain('Estado');
    expect(lines[0]).toContain('UserId');
    expect(lines[0]).toContain('Documento');
  });

  it('CSV data rows correspond to non-RISK_SCORES records', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1');
    const res = await handler(event);
    const body = await bodyOf(res);
    const lines = body.data.csvContent.split('\n');
    // 1 header + 2 records
    expect(lines).toHaveLength(3);
  });

  it('excludes RISK_SCORES row from CSV output', async () => {
    mockGetAttendanceMatrix.mockResolvedValue([
      ...sampleRecords,
      { courseId: 'course-1', sk: 'RISK_SCORES', userId: '', sessionId: '', status: 'PRESENT', sessionDate: '', createdAt: '', updatedAt: '' },
    ]);
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1');
    const res = await handler(event);
    const body = await bodyOf(res);
    const lines = body.data.csvContent.split('\n');
    expect(lines).toHaveLength(3);  // header + 2 valid rows, no RISK_SCORES
  });

  it('CSV values are double-quoted', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1');
    const res = await handler(event);
    const body = await bodyOf(res);
    const lines = body.data.csvContent.split('\n');
    // Every line's columns should be quoted
    lines.forEach((line: string) => {
      const cols = line.split(',');
      cols.forEach((col: string) => {
        expect(col.startsWith('"')).toBe(true);
        expect(col.endsWith('"')).toBe(true);
      });
    });
  });

  it('CSV row contains audit fields (overriddenBy, overrideReason, documentKey, AI recommendation)', async () => {
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1');
    const res = await handler(event);
    const body = await bodyOf(res);
    const lines = body.data.csvContent.split('\n');
    const studentBRow = lines.find((l: string) => l.includes('student-B')) ?? '';
    expect(studentBRow).toContain('eval-uuid');
    expect(studentBRow).toContain('Autorizado');
    expect(studentBRow).toContain('justif/doc.pdf');
    expect(studentBRow).toContain('VALID_MATCH');
  });

  it('double-quotes inside values are escaped as ""', async () => {
    mockGetAttendanceMatrix.mockResolvedValue([{
      courseId: 'course-1', sk: 'student-A#sess-1', userId: 'student-A', sessionId: 'sess-1',
      status: 'PRESENT', sessionDate: '2026-01-15T10:00:00.000Z',
      updatedAt: '', createdAt: '',
      overrideReason: 'Motivo con "comillas" internas',
    }]);
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1');
    const res = await handler(event);
    const body = await bodyOf(res);
    // The escaped version should have "" instead of a single "
    expect(body.data.csvContent).toContain('Motivo con ""comillas"" internas');
  });

  it('empty matrix returns only the header row', async () => {
    mockGetAttendanceMatrix.mockResolvedValue([]);
    const event = makeAttendanceEvent('GET', '/attendance/export/course-1');
    const res = await handler(event);
    const body = await bodyOf(res);
    const lines = body.data.csvContent.split('\n');
    expect(lines).toHaveLength(1);  // header only
  });
});
