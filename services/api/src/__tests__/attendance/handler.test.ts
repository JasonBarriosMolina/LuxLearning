/**
 * Tests for services/api/src/attendance/handler.ts
 * Covers: record (PRESENT/ABSENT/LATE/invalid), matrix, pending, review (actionUrl fix),
 * justification presign, override with extraHours, risk scores, notifId uniqueness.
 */
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
