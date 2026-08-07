// ─── study-plans/cron.ts ─────────────────────────────────────────────────────
// EventBridge Monday cron — auto-generates study plans for all active students.
import { createId } from '@paralleldrive/cuid2';
import { CognitoIdentityProviderClient, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
  getStudyPlan, saveStudyPlan,
  getNextMonday, type StudyPlan, type DayPlan,
} from '../shared/db-study-plans';
import { getEnrollments, getLessonProgress, getAllQuizAttemptsForUser } from '../shared/db-dynamo';
import { isModuleUnlocked } from '../shared/db-progress';
import { getPrismaClient } from '../shared/db-neon';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

async function getAllStudentUserIds(): Promise<string[]> {
  const ids: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await cognito.send(new ListUsersInGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: 'STUDENT',
      Limit: 60,
      ...(nextToken ? { NextToken: nextToken } : {}),
    }));
    for (const u of res.Users ?? []) {
      const sub = u.Attributes?.find((a) => a.Name === 'sub')?.Value;
      if (sub) ids.push(sub);
    }
    nextToken = res.NextToken;
  } while (nextToken);
  return ids;
}

function buildEmptyDays(weekOf: string): DayPlan[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekOf + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return { dayIndex: i, date: d.toISOString().slice(0, 10), items: [] };
  });
}

async function generatePlanForStudent(userId: string, weekOf: string): Promise<void> {
  // Idempotency: skip if plan already exists for this week
  const existing = await getStudyPlan(userId, weekOf);
  if (existing) return;

  const prisma = await getPrismaClient();
  const days = buildEmptyDays(weekOf);

  const [courseIds, quizAttempts] = await Promise.all([
    getEnrollments(userId),
    getAllQuizAttemptsForUser(userId),
  ]);
  if (courseIds.length === 0) return; // no courses → skip

  const courses = await prisma.course.findMany({
    where: { id: { in: courseIds } },
    include: {
      modules: {
        orderBy: { order: 'asc' },
        include: { lessons: { select: { id: true, title: true }, orderBy: { order: 'asc' } } },
      },
    },
  });

  const progressResults = await Promise.all(courseIds.map((cid: string) => getLessonProgress(userId, cid)));
  const completedLessonIds = new Set(progressResults.flat().map((p: any) => p.lessonId));
  const passedModuleIds = new Set(quizAttempts.filter((a: any) => a.passed).map((a: any) => a.moduleId));

  let dayIndex = 0;
  for (const course of courses) {
    const moduleRefs = (course as any).modules.map((m: any) => ({ id: m.id, order: m.order }));
    for (const mod of (course as any).modules) {
      // Only include accessible (unlocked) modules — sequential lock check
      const unlocked = await isModuleUnlocked(userId, mod.order, moduleRefs);
      if (!unlocked) break;

      if (passedModuleIds.has(mod.id)) continue;
      const pendingLessons = mod.lessons.filter((l: any) => !completedLessonIds.has(l.id));
      const needsQuiz = pendingLessons.length === 0 && !passedModuleIds.has(mod.id);

      for (const lesson of pendingLessons.slice(0, 5)) {
        const targetDay = Math.min(dayIndex % 5, 4);
        days[targetDay].items.push({
          id: createId(),
          type: 'lesson',
          title: lesson.title,
          description: `Módulo: ${mod.title} — ${course.title}`,
          courseId: course.id,
          moduleId: mod.id,
          lessonId: lesson.id,
          pinned: false, completed: false,
          estimatedMinutes: 30,
          source: 'auto',
        });
        dayIndex++;
      }

      if (needsQuiz) {
        const targetDay = Math.min(dayIndex % 5, 4);
        days[targetDay].items.push({
          id: createId(),
          type: 'quiz',
          title: `Quiz — ${mod.title}`,
          description: `Todas las lecciones completadas. Quiz pendiente en ${course.title}`,
          courseId: course.id,
          moduleId: mod.id,
          pinned: false, completed: false,
          estimatedMinutes: 20,
          source: 'auto',
        });
        dayIndex++;
      }
    }
  }

  const plan: StudyPlan = {
    userId, weekOf,
    planId: createId(),
    days,
    generatedBy: 'auto',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveStudyPlan(plan);
}

// EventBridge rule must fire Sunday midnight UTC so getNextMonday() targets the upcoming week.
export async function runCronGeneration(): Promise<void> {
  const weekOf = getNextMonday();
  console.log(`[StudyPlan Cron] Generating plans for week ${weekOf}`);

  const userIds = await getAllStudentUserIds();
  console.log(`[StudyPlan Cron] Found ${userIds.length} students`);

  // Process in batches of 5 to avoid overwhelming Prisma connection pool
  const BATCH = 5;
  let success = 0, skip = 0, fail = 0;
  for (let i = 0; i < userIds.length; i += BATCH) {
    const batch = userIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((uid) => generatePlanForStudent(uid, weekOf)));
    for (const r of results) {
      if (r.status === 'fulfilled') success++;
      else { fail++; console.error('[StudyPlan Cron] Error:', r.reason); }
    }
  }
  console.log(`[StudyPlan Cron] Done — success=${success} skip=${skip} fail=${fail}`);
}
