import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetLessonProgress = vi.fn();
const mockHasPassedQuiz = vi.fn();
const mockGetReflection = vi.fn();
const mockListMyClassSessionsForCourse = vi.fn();
const mockListMyInterviews = vi.fn();
const mockGetCertificateByUserAndCourse = vi.fn();
const mockSaveCertificate = vi.fn();
const mockCreateNotification = vi.fn();

vi.mock('../../shared/db-dynamo', () => ({
  getLessonProgress: (...a: any[]) => mockGetLessonProgress(...a),
  hasPassedQuiz: (...a: any[]) => mockHasPassedQuiz(...a),
  getReflection: (...a: any[]) => mockGetReflection(...a),
  listMyClassSessionsForCourse: (...a: any[]) => mockListMyClassSessionsForCourse(...a),
  listMyInterviews: (...a: any[]) => mockListMyInterviews(...a),
  getCertificateByUserAndCourse: (...a: any[]) => mockGetCertificateByUserAndCourse(...a),
  saveCertificate: (...a: any[]) => mockSaveCertificate(...a),
  createNotification: (...a: any[]) => mockCreateNotification(...a),
}));

const mockCognitoSend = vi.fn();
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return { send: (...a: any[]) => mockCognitoSend(...a) }; },
  ListUsersInGroupCommand: function (x: any) { return { __cmd: 'ListUsersInGroup', ...x }; },
  AdminGetUserCommand: function (x: any) { return { __cmd: 'AdminGetUser', ...x }; },
}));

import { isModuleFullyCompletePure, isCourseFullyComplete, checkAndCompleteCourse } from '../../shared/db-course-completion';

const fullyDone = {
  allLessonsDone: true,
  hasClassPlanned: false, classCompleted: false,
  hasQuizPlanned: false, quizPassed: false,
  hasReflectionPlanned: false, reflectionApproved: false,
  hasInterviewPlanned: false, interviewCompleted: false,
};

// Trello DmPpbrff, 2026-09-06 (Mack): the old check only looked at reflectionStatus —
// a module with no reflection planned (quiz-only, class-only) could never satisfy it.
describe('isModuleFullyCompletePure', () => {
  it('is complete when lessons are done and nothing else is planned', () => {
    expect(isModuleFullyCompletePure(fullyDone)).toBe(true);
  });

  it('is NOT complete when lessons are not done, regardless of anything else', () => {
    expect(isModuleFullyCompletePure({ ...fullyDone, allLessonsDone: false })).toBe(false);
  });

  it.each([
    ['hasClassPlanned', 'classCompleted'],
    ['hasQuizPlanned', 'quizPassed'],
    ['hasReflectionPlanned', 'reflectionApproved'],
    ['hasInterviewPlanned', 'interviewCompleted'],
  ] as const)('requires %s to actually be satisfied when planned', (plannedKey, doneKey) => {
    expect(isModuleFullyCompletePure({ ...fullyDone, [plannedKey]: true, [doneKey]: false })).toBe(false);
    expect(isModuleFullyCompletePure({ ...fullyDone, [plannedKey]: true, [doneKey]: true })).toBe(true);
  });

  it('a quiz-only module (no reflection planned at all) can be fully complete — the old bug', () => {
    expect(isModuleFullyCompletePure({ ...fullyDone, hasQuizPlanned: true, quizPassed: true })).toBe(true);
  });
});

function makePrisma(course: any) {
  return { course: { findUnique: vi.fn().mockResolvedValue(course) } };
}

describe('isCourseFullyComplete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is false for a course with no modules', async () => {
    const prisma = makePrisma({ modules: [], evaluationEvents: [] });
    expect(await isCourseFullyComplete(prisma as any, 'u1', 'c1')).toBe(false);
  });

  it('is true for a quiz-only module once the quiz is passed — the exact bug reported', async () => {
    const prisma = makePrisma({
      modules: [{ id: 'm1', lessons: [{ id: 'l1' }] }],
      evaluationEvents: [{ moduleId: 'm1', type: 'QUIZ' }],
    });
    mockGetLessonProgress.mockResolvedValue([{ lessonId: 'l1' }]);
    mockListMyClassSessionsForCourse.mockResolvedValue([]);
    mockHasPassedQuiz.mockResolvedValue(true);
    expect(await isCourseFullyComplete(prisma as any, 'u1', 'c1')).toBe(true);
  });

  it('is false when an interview is planned but not completed, even with reflection approved', async () => {
    const prisma = makePrisma({
      modules: [{ id: 'm1', lessons: [] }],
      evaluationEvents: [{ moduleId: 'm1', type: 'REFLECTION' }, { moduleId: 'm1', type: 'INTERVIEW' }],
    });
    mockGetLessonProgress.mockResolvedValue([]);
    mockListMyClassSessionsForCourse.mockResolvedValue([]);
    mockGetReflection.mockResolvedValue({ status: 'APPROVED' });
    mockListMyInterviews.mockResolvedValue([{ status: 'pending' }]);
    expect(await isCourseFullyComplete(prisma as any, 'u1', 'c1')).toBe(false);
  });

  it('is true once every module clears its own planned requirements', async () => {
    const prisma = makePrisma({
      modules: [{ id: 'm1', lessons: [] }, { id: 'm2', lessons: [] }],
      evaluationEvents: [{ moduleId: 'm1', type: 'QUIZ' }, { moduleId: 'm2', type: 'REFLECTION' }],
    });
    mockGetLessonProgress.mockResolvedValue([]);
    mockListMyClassSessionsForCourse.mockResolvedValue([]);
    mockHasPassedQuiz.mockResolvedValue(true);
    mockGetReflection.mockResolvedValue({ status: 'APPROVED' });
    expect(await isCourseFullyComplete(prisma as any, 'u1', 'c1')).toBe(true);
  });
});

describe('checkAndCompleteCourse', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null and does nothing when a certificate already exists (idempotent)', async () => {
    mockGetCertificateByUserAndCourse.mockResolvedValue({ certId: 'existing' });
    const prisma = makePrisma({ modules: [], evaluationEvents: [] });
    const result = await checkAndCompleteCourse(prisma as any, 'u1', 'c1');
    expect(result).toBeNull();
    expect(mockSaveCertificate).not.toHaveBeenCalled();
  });

  it('returns null and saves nothing when the course is not yet complete', async () => {
    mockGetCertificateByUserAndCourse.mockResolvedValue(null);
    const prisma = makePrisma({
      modules: [{ id: 'm1', lessons: [{ id: 'l1' }] }],
      evaluationEvents: [],
    });
    mockGetLessonProgress.mockResolvedValue([]); // lesson not completed
    mockListMyClassSessionsForCourse.mockResolvedValue([]);
    const result = await checkAndCompleteCourse(prisma as any, 'u1', 'c1');
    expect(result).toBeNull();
    expect(mockSaveCertificate).not.toHaveBeenCalled();
  });

  it('generates a certificate and notifies the student + evaluator + every admin when newly complete', async () => {
    mockGetCertificateByUserAndCourse.mockResolvedValue(null);
    const prisma = {
      course: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ modules: [{ id: 'm1', lessons: [] }], evaluationEvents: [] }) // isCourseFullyComplete's own fetch
          .mockResolvedValueOnce({ title: 'Curso de Prueba', evaluatorId: 'eval-1' }), // course title/evaluator fetch
      },
    };
    mockGetLessonProgress.mockResolvedValue([]);
    mockListMyClassSessionsForCourse.mockResolvedValue([]);
    mockCognitoSend.mockImplementation((cmd: any) => {
      if (cmd.__cmd === 'AdminGetUser') return Promise.resolve({ UserAttributes: [{ Name: 'name', Value: 'Estudiante Prueba' }] });
      if (cmd.__cmd === 'ListUsersInGroup') return Promise.resolve({ Users: [{ Attributes: [{ Name: 'sub', Value: 'admin-1' }] }] });
      return Promise.resolve({});
    });

    const result = await checkAndCompleteCourse(prisma as any, '11111111-1111-1111-1111-111111111111', 'c1');

    expect(result).toEqual({ certId: expect.any(String) });
    expect(mockSaveCertificate).toHaveBeenCalledWith(expect.objectContaining({
      userId: '11111111-1111-1111-1111-111111111111', courseId: 'c1', courseTitle: 'Curso de Prueba', studentName: 'Estudiante Prueba',
    }));
    const notifiedUserIds = mockCreateNotification.mock.calls.map((c) => c[0].userId);
    expect(notifiedUserIds).toContain('11111111-1111-1111-1111-111111111111'); // student
    expect(notifiedUserIds).toContain('eval-1'); // evaluator
    expect(notifiedUserIds).toContain('admin-1'); // admin
  });

  it('never throws — a downstream failure returns null instead of breaking the caller', async () => {
    mockGetCertificateByUserAndCourse.mockRejectedValue(new Error('DynamoDB down'));
    const prisma = makePrisma({ modules: [], evaluationEvents: [] });
    await expect(checkAndCompleteCourse(prisma as any, 'u1', 'c1')).resolves.toBeNull();
  });
});
