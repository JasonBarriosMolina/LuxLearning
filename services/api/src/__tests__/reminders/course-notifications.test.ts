/**
 * Tests for reminders/course-notifications.ts.
 * Focus: course-start (day-of) + weekly-topic notifications, 3-channel fan-out
 * (email + push + in-app), Trello DmPpbrff item 2 (2026-08-30 20:16).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makePrisma } from '../helpers/ctx';

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return {}; },
  AdminGetUserCommand: function (x: any) { return x; },
}));

const sendEmailMock = vi.fn().mockResolvedValue({});
const createNotificationMock = vi.fn().mockResolvedValue(undefined);
const getPushSubsMock = vi.fn().mockResolvedValue([{ endpoint: 'https://push.example/1' }]);
const sendNotificationMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../shared/db-dynamo', () => ({
  createNotification: (...args: any[]) => createNotificationMock(...args),
  getPushSubscriptionsByUserId: (...args: any[]) => getPushSubsMock(...args),
}));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...args: any[]) => sendNotificationMock(...args) },
}));

let prismaMock = makePrisma();
vi.mock('../../shared/db-neon', () => ({ getPrismaClient: vi.fn(async () => prismaMock) }));

import { sendCourseStartNotifications, sendWeeklyCourseTopicNotifications } from '../../reminders/course-notifications';

function fakeCognitoRes(email: string, name: string) {
  return { UserAttributes: [{ Name: 'email', Value: email }, { Name: 'name', Value: name }] };
}

describe('course-notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock = makePrisma();
  });

  const baseDeps = (overrides: Partial<Parameters<typeof sendCourseStartNotifications>[0]> = {}) => ({
    ses: { send: (...args: any[]) => sendEmailMock(...args) } as any,
    cognito: { send: vi.fn().mockResolvedValue(fakeCognitoRes('ana@test.com', 'Ana')) } as any,
    fromEmail: 'noreply@luxlearning.academy',
    frontendUrl: 'https://staging.luxlearning.academy',
    allEnrollments: [{ userId: 'ana', courseId: 'course-1' }],
    ...overrides,
  });

  describe('sendCourseStartNotifications', () => {
    it('notifies on all 3 channels when a course starts today', async () => {
      prismaMock.course.findMany = vi.fn().mockResolvedValue([{ id: 'course-1', title: 'Music 101' }]);
      const sent = await sendCourseStartNotifications(baseDeps());
      expect(sent).toBe(1);
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      expect(sendNotificationMock).toHaveBeenCalledTimes(1);
      expect(createNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'ana', type: 'COURSE_STARTED', actionUrl: '/courses/course-1' }),
      );
    });

    it('sends nothing when no course starts today', async () => {
      prismaMock.course.findMany = vi.fn().mockResolvedValue([]);
      const sent = await sendCourseStartNotifications(baseDeps());
      expect(sent).toBe(0);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it('still notifies push + in-app when the student has no email', async () => {
      prismaMock.course.findMany = vi.fn().mockResolvedValue([{ id: 'course-1', title: 'Music 101' }]);
      const deps = baseDeps({ cognito: { send: vi.fn().mockResolvedValue({ UserAttributes: [] }) } as any });
      const sent = await sendCourseStartNotifications(deps);
      expect(sent).toBe(1);
      expect(sendEmailMock).not.toHaveBeenCalled();
      expect(sendNotificationMock).toHaveBeenCalledTimes(1);
      expect(createNotificationMock).toHaveBeenCalledTimes(1);
    });

    it('does not throw when Prisma lookup fails', async () => {
      prismaMock.course.findMany = vi.fn().mockRejectedValue(new Error('db down'));
      const sent = await sendCourseStartNotifications(baseDeps());
      expect(sent).toBe(0);
    });
  });

  describe('sendWeeklyCourseTopicNotifications', () => {
    it('notifies when a week (>1) starts today, listing its topics', async () => {
      const today = new Date();
      const weekNum = 3;
      const start = new Date(today);
      start.setDate(start.getDate() - (weekNum - 1) * 7); // course.startDate so week 3 begins today
      prismaMock.course.findMany = vi.fn().mockResolvedValue([{
        id: 'course-1', title: 'Music 101', startDate: start,
        planWeeklyPlan: [
          { weekNum: 1, topics: ['Intro'] },
          { weekNum: 3, topics: ['Mixing', 'Mastering'] },
        ],
      }]);
      const sent = await sendWeeklyCourseTopicNotifications(baseDeps());
      expect(sent).toBe(1);
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      expect(createNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'ana', type: 'COURSE_WEEK_STARTED' }),
      );
    });

    it('skips week 1 (already covered by the course-start notification)', async () => {
      const today = new Date();
      prismaMock.course.findMany = vi.fn().mockResolvedValue([{
        id: 'course-1', title: 'Music 101', startDate: today,
        planWeeklyPlan: [{ weekNum: 1, topics: ['Intro'] }],
      }]);
      const sent = await sendWeeklyCourseTopicNotifications(baseDeps());
      expect(sent).toBe(0);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it('skips weeks that do not start today', async () => {
      const today = new Date();
      const farStart = new Date(today);
      farStart.setDate(farStart.getDate() - 5); // week 2 would start in 2 more days, not today
      prismaMock.course.findMany = vi.fn().mockResolvedValue([{
        id: 'course-1', title: 'Music 101', startDate: farStart,
        planWeeklyPlan: [{ weekNum: 2, topics: ['Recording'] }],
      }]);
      const sent = await sendWeeklyCourseTopicNotifications(baseDeps());
      expect(sent).toBe(0);
    });

    it('skips courses with no weekly plan', async () => {
      prismaMock.course.findMany = vi.fn().mockResolvedValue([{
        id: 'course-1', title: 'Music 101', startDate: new Date(), planWeeklyPlan: [],
      }]);
      const sent = await sendWeeklyCourseTopicNotifications(baseDeps());
      expect(sent).toBe(0);
    });
  });
});
