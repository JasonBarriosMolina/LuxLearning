import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCertificate = vi.fn();
const mockGetCertificatesByUser = vi.fn();
const mockGetCertificateByUserAndCourse = vi.fn();
const mockGetCertTemplate = vi.fn();
const mockSaveCertTemplate = vi.fn();

vi.mock('../../shared/db-dynamo', () => ({
  getCertificate: (...a: any[]) => mockGetCertificate(...a),
  getCertificatesByUser: (...a: any[]) => mockGetCertificatesByUser(...a),
  getCertificateByUserAndCourse: (...a: any[]) => mockGetCertificateByUserAndCourse(...a),
  getCertTemplate: (...a: any[]) => mockGetCertTemplate(...a),
  saveCertTemplate: (...a: any[]) => mockSaveCertTemplate(...a),
}));

const mockGetPrismaClient = vi.fn().mockResolvedValue({});
vi.mock('../../shared/db-neon', () => ({ getPrismaClient: (...a: any[]) => mockGetPrismaClient(...a) }));

const mockCheckAndCompleteCourse = vi.fn();
vi.mock('../../shared/db-course-completion', () => ({ checkAndCompleteCourse: (...a: any[]) => mockCheckAndCompleteCourse(...a) }));

import { handler } from '../../certificates/handler';

function makeEvent(body: any, auth: any = { userId: '11111111-1111-1111-1111-111111111111', email: 's@test.com', role: 'STUDENT' }) {
  return {
    headers: {},
    requestContext: { http: { method: 'POST' }, authorizer: { lambda: auth } },
    rawPath: '/my-certificates/generate',
    body: JSON.stringify(body),
  } as any;
}

async function bodyOf(res: any) { return JSON.parse(res.body); }

// Trello DmPpbrff, 2026-09-06 (Mack): the endpoint used to check reflectionStatus
// directly — now delegates entirely to the shared, full completion check so a
// certificate can appear from ANY gating action, not just this endpoint.
describe('POST /my-certificates/generate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when courseId is missing', async () => {
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(400);
  });

  it('returns the existing certificate immediately without calling checkAndCompleteCourse', async () => {
    mockGetCertificateByUserAndCourse.mockResolvedValue({ certId: 'existing-cert' });
    const res = await handler(makeEvent({ courseId: 'c1' }));
    expect(res.statusCode).toBe(200);
    expect((await bodyOf(res)).data).toEqual({ certId: 'existing-cert' });
    expect(mockCheckAndCompleteCourse).not.toHaveBeenCalled();
  });

  it('returns 400 "aún no está completado" when checkAndCompleteCourse finds it incomplete', async () => {
    mockGetCertificateByUserAndCourse.mockResolvedValue(null);
    mockCheckAndCompleteCourse.mockResolvedValue(null);
    const res = await handler(makeEvent({ courseId: 'c1' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns the newly-generated certificate when checkAndCompleteCourse completes the course', async () => {
    mockGetCertificateByUserAndCourse.mockResolvedValue(null);
    mockCheckAndCompleteCourse.mockResolvedValue({ certId: 'new-cert' });
    mockGetCertificate.mockResolvedValue({ certId: 'new-cert', courseTitle: 'Curso de Prueba' });
    const res = await handler(makeEvent({ courseId: 'c1' }));
    expect(res.statusCode).toBe(200);
    expect((await bodyOf(res)).data).toEqual({ certId: 'new-cert', courseTitle: 'Curso de Prueba' });
    expect(mockCheckAndCompleteCourse).toHaveBeenCalledWith(expect.anything(), '11111111-1111-1111-1111-111111111111', 'c1', 's@test.com');
  });

  it('returns 404 when not authenticated', async () => {
    const res = await handler(makeEvent({ courseId: 'c1' }, null));
    expect(res.statusCode).toBe(404);
  });
});
