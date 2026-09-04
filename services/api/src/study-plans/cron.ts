// ─── study-plans/cron.ts ─────────────────────────────────────────────────────
// EventBridge Monday cron — auto-generates study plans for all active students.
import { createId } from '@paralleldrive/cuid2';
import { CognitoIdentityProviderClient, ListUsersInGroupCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  getStudyPlan, saveStudyPlan, getStudyPlansBatch,
  getNextMonday, getMonday, type StudyPlan, type DayPlan,
} from '../shared/db-study-plans';
import { getAllEnrollments, getEnrollments, getLessonProgress, getAllQuizAttemptsForUser, createNotification } from '../shared/db-dynamo';
import { isModuleUnlocked } from '../shared/db-progress';
import { getPrismaClient } from '../shared/db-neon';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.academy';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://luxlearning.academy';

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

/** ISO date of the previous Monday (weekOf - 7 days) */
function getPrevMonday(weekOf: string): string {
  const d = new Date(weekOf + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

async function checkNoProgressNotification(userId: string, weekOf: string): Promise<void> {
  const prevWeek = getPrevMonday(weekOf);
  const prevPlan = await getStudyPlan(userId, prevWeek);
  if (!prevPlan) return;

  const allItems = prevPlan.days.flatMap((d) => d.items);
  if (allItems.length === 0) return;

  const completed = allItems.filter((i) => i.completed).length;
  if (completed === 0) {
    // Student completed nothing last week — send motivational nudge
    await createNotification({
      userId,
      notifId: `splan-noprog-${createId()}`,
      type: 'STUDY_PLAN_NO_PROGRESS',
      message: '¡Tu Mentor preparó un nuevo plan para esta semana! La semana pasada no completaste actividades. Dedica solo 1 hora hoy para empezar — ¡pequeños pasos hacen grandes diferencias!',
      actionUrl: '/plan',
      read: false,
      createdAt: new Date().toISOString(),
    }).catch(() => {});
  } else if (completed < allItems.length) {
    // Partial progress — encourage to keep going
    const pct = Math.round((completed / allItems.length) * 100);
    await createNotification({
      userId,
      notifId: `splan-prog-${createId()}`,
      type: 'STUDY_PLAN_NEW_WEEK',
      message: `¡Nuevo plan de la semana listo! La semana pasada completaste el ${pct}% de tus actividades. ¡Sigue así y esta semana llega al 100%!`,
      actionUrl: '/plan',
      read: false,
      createdAt: new Date().toISOString(),
    }).catch(() => {});
  }
}

async function generatePlanForStudent(userId: string, weekOf: string): Promise<void> {
  // Respect evaluator-locked plans — never overwrite them automatically
  const existing = await getStudyPlan(userId, weekOf);
  if (existing?.lockedBy) return;

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
      evaluationEvents: { select: { type: true, moduleId: true } },
    },
  });

  const progressResults = await Promise.all(courseIds.map((cid: string) => getLessonProgress(userId, cid)));
  const completedLessonIds = new Set(progressResults.flat().map((p: any) => p.lessonId));
  const passedModuleIds = new Set(quizAttempts.filter((a: any) => a.passed).map((a: any) => a.moduleId));

  let dayIndex = 0;
  for (const course of courses) {
    const moduleRefs = (course as any).modules.map((m: any) => ({ id: m.id, order: m.order, lessonIds: m.lessons.map((l: any) => l.id) }));
    const reflectionPlannedModuleIds = new Set(
      ((course as any).evaluationEvents ?? [])
        .filter((e: any) => e.type === 'REFLECTION' && e.moduleId)
        .map((e: any) => e.moduleId as string),
    );
    const quizPlannedModuleIds = new Set(
      ((course as any).evaluationEvents ?? [])
        .filter((e: any) => e.type === 'QUIZ' && e.moduleId)
        .map((e: any) => e.moduleId as string),
    );
    for (const mod of (course as any).modules) {
      // Only include accessible (unlocked) modules — sequential lock check
      const unlocked = await isModuleUnlocked(userId, mod.order, moduleRefs, {
        weeklyPacingEnabled: (course as any).weeklyPacingEnabled,
        courseStartDate: (course as any).startDate,
        reflectionPlannedModuleIds,
        completedLessonIds,
        quizPlannedModuleIds,
        quizPassedModuleIds: passedModuleIds, // already computed above — avoids a duplicate hasPassedQuiz DB call
      });
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
          courseTitle: course.title,
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
          courseTitle: course.title,
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
    const results = await Promise.allSettled(
      batch.map((uid) =>
        generatePlanForStudent(uid, weekOf)
          .then(() => checkNoProgressNotification(uid, weekOf).catch(() => {}))
      )
    );
    for (const r of results) {
      if (r.status === 'fulfilled') success++;
      else { fail++; console.error('[StudyPlan Cron] Error:', r.reason); }
    }
  }
  console.log(`[StudyPlan Cron] Done — success=${success} skip=${skip} fail=${fail}`);
}

// ── Compliance cron (Tue + Fri, 5 AM UTC) ────────────────────────────────────
// Finds students with < 50% plan completion and notifies their evaluator.

async function getUserAttr(userId: string, attr: string): Promise<string> {
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    return res.UserAttributes?.find((a) => a.Name === attr)?.Value ?? '';
  } catch { return ''; }
}

function complianceEmailHtml(evaluatorName: string, students: { name: string; pct: number }[], weekOf: string): string {
  const rows = students.map((s) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;">${s.name}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#ef4444;font-weight:700;">${s.pct}%</td></tr>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Resumen de cumplimiento — semana del ${weekOf}</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">Hola ${evaluatorName},</h2>
      <p style="color:#555;line-height:1.6;">Los siguientes estudiantes completaron <strong>menos del 50%</strong> de su plan de estudio esta semana:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <thead><tr style="background:#f3f4f6;"><th style="padding:8px 12px;text-align:left;font-size:13px;">Estudiante</th><th style="padding:8px 12px;text-align:left;font-size:13px;">Avance</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <a href="${FRONTEND_URL}/evaluator/students" style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;">Ver estudiantes</a>
    </div>
  </div>
</body></html>`;
}

export async function runComplianceCron(): Promise<void> {
  const weekOf = getMonday();
  console.log(`[Compliance Cron] Checking compliance for week ${weekOf}`);

  const prisma = await getPrismaClient();

  // Get all courses with evaluatorId
  const courses = await prisma.course.findMany({
    where: { evaluatorId: { not: null } },
    select: { id: true, evaluatorId: true },
  });

  // Group courseIds by evaluatorId
  const evalCourses: Record<string, string[]> = {};
  for (const c of courses) {
    if (!c.evaluatorId) continue;
    if (!evalCourses[c.evaluatorId]) evalCourses[c.evaluatorId] = [];
    evalCourses[c.evaluatorId].push(c.id);
  }
  if (Object.keys(evalCourses).length === 0) return;

  // Get all enrollments and current week plans once
  const allEnrollments = await getAllEnrollments().catch(() => [] as any[]);
  const allStudentIds = [...new Set(allEnrollments.map((e: any) => e.userId as string))];
  const allPlans = await getStudyPlansBatch(allStudentIds, weekOf);
  const planByUser = new Map(allPlans.map((p) => [p.userId, p]));

  const THRESHOLD = 0.5;

  for (const [evaluatorId, courseIds] of Object.entries(evalCourses)) {
    const courseSet = new Set(courseIds);
    const evalStudentIds = [...new Set(
      allEnrollments
        .filter((e: any) => courseSet.has(e.courseId))
        .map((e: any) => e.userId as string)
    )];

    const noncompliant: { userId: string; name: string; pct: number }[] = [];
    for (const sid of evalStudentIds) {
      const plan = planByUser.get(sid);
      if (!plan) continue;
      const total = plan.days.reduce((s, d) => s + d.items.length, 0);
      if (total === 0) continue;
      const done = plan.days.reduce((s, d) => s + d.items.filter((i) => i.completed).length, 0);
      if (done / total < THRESHOLD) {
        const name = await getUserAttr(sid, 'name').catch(() => sid);
        noncompliant.push({ userId: sid, name: name || sid, pct: Math.round((done / total) * 100) });
      }
    }

    if (noncompliant.length === 0) continue;

    // In-app notification to evaluator
    const evalName = await getUserAttr(evaluatorId, 'name').catch(() => 'Evaluador');
    const evalEmail = await getUserAttr(evaluatorId, 'email').catch(() => '');

    await createNotification({
      userId: evaluatorId,
      notifId: `compliance-${weekOf}-${createId()}`,
      type: 'STUDY_PLAN_COMPLIANCE',
      message: `${noncompliant.length} estudiante${noncompliant.length !== 1 ? 's' : ''} con menos del 50% de avance esta semana (${weekOf}).`,
      actionUrl: '/evaluator/students',
      read: false,
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    // Email to evaluator
    if (evalEmail) {
      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [evalEmail] },
        Message: {
          Subject: { Data: `[Lux Learning] Reporte de cumplimiento — ${noncompliant.length} estudiante(s) con bajo avance`, Charset: 'UTF-8' },
          Body: { Html: { Data: complianceEmailHtml(evalName || 'Evaluador', noncompliant, weekOf), Charset: 'UTF-8' } },
        },
      })).catch((e) => console.error('[Compliance Cron] Email error:', e));
    }

    console.log(`[Compliance Cron] Evaluator ${evaluatorId}: ${noncompliant.length} non-compliant students`);
  }

  console.log('[Compliance Cron] Done');
}
