// ─── db-course-completion.ts ────────────────────────────────────────────────────
// Course-wide completion check + certificate + admin/evaluator notification.
//
// Trello DmPpbrff, 2026-09-06 (Mack): the old check (POST /my-certificates/generate
// in certificates/handler.ts) only looked at reflectionStatus === 'APPROVED' per
// module — a module with no reflection planned at all (quiz-only, or class-only)
// could NEVER satisfy it, permanently blocking the certificate. It also never
// checked class/quiz/interview completion, so a module could read "complete" for
// certificate purposes while an interview was still pending (same root cause as
// the "Continuar" button bug fixed the same day — see moduleStatus.ts on the
// frontend, which this mirrors server-side).
//
// Mack's spec (2026-09-06): "El certificado se obtiene al completar todo el
// módulo y todos los entregables y evaluaciones de un curso. Ahí debería avisar
// al admin + evaluador" — as soon as the LAST gate anywhere clears, generate the
// certificate immediately and notify both, rather than waiting for the student to
// happen to reload the course page (the old, only, trigger).
import { CognitoIdentityProviderClient, ListUsersInGroupCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { createId } from '@paralleldrive/cuid2';
import {
  getLessonProgress, hasPassedQuiz, getReflection, listMyClassSessionsForCourse,
  listMyInterviews, getCertificateByUserAndCourse, saveCertificate, createNotification,
} from './db-dynamo';

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://luxlearning.academy';

/** Minimal shape every caller's Prisma client satisfies — avoids importing the full
 *  AdminCtx/EvalCtx type into lambdas (lux-quiz, lux-courses) that don't otherwise
 *  need it. */
type PrismaLike = { course: { findUnique: (args: any) => Promise<any> } };

export interface ModuleCompletionInput {
  allLessonsDone: boolean;
  hasClassPlanned: boolean; classCompleted: boolean;
  hasQuizPlanned: boolean; quizPassed: boolean;
  hasReflectionPlanned: boolean; reflectionApproved: boolean;
  hasInterviewPlanned: boolean; interviewCompleted: boolean;
}

/** Pure — same gate order as the frontend's computeModuleStatus (lessons → class →
 *  quiz → reflection → interview), but answering "is this module fully done" rather
 *  than "what's the single blocking reason". An unplanned step is never required. */
export function isModuleFullyCompletePure(m: ModuleCompletionInput): boolean {
  if (!m.allLessonsDone) return false;
  if (m.hasClassPlanned && !m.classCompleted) return false;
  if (m.hasQuizPlanned && !m.quizPassed) return false;
  if (m.hasReflectionPlanned && !m.reflectionApproved) return false;
  if (m.hasInterviewPlanned && !m.interviewCompleted) return false;
  return true;
}

export async function isCourseFullyComplete(prisma: PrismaLike, userId: string, courseId: string): Promise<boolean> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      modules: { include: { lessons: { select: { id: true } } } },
      evaluationEvents: { select: { moduleId: true, type: true } },
    },
  });
  if (!course || course.modules.length === 0) return false;

  const [lessonProgress, classSessions] = await Promise.all([
    getLessonProgress(userId, courseId),
    listMyClassSessionsForCourse(userId, courseId),
  ]);
  const completedLessonIds = new Set(lessonProgress.map((p: any) => p.lessonId));
  const classCompletedModuleIds = new Set(
    classSessions.filter((s: any) => s.status === 'completed' || s.hasCompletedQA).map((s: any) => s.moduleId)
  );

  for (const mod of course.modules as any[]) {
    const evEvents = (course.evaluationEvents as any[]).filter((e) => e.moduleId === mod.id);
    const hasClassPlanned = evEvents.some((e) => e.type === 'CLASS');
    const hasQuizPlanned = evEvents.some((e) => e.type === 'QUIZ');
    const hasReflectionPlanned = evEvents.some((e) => e.type === 'REFLECTION');
    const hasInterviewPlanned = evEvents.some((e) => e.type === 'INTERVIEW');
    const allLessonsDone = mod.lessons.length === 0 || mod.lessons.every((l: any) => completedLessonIds.has(l.id));

    const [quizPassed, reflection, interviews] = await Promise.all([
      hasQuizPlanned ? hasPassedQuiz(userId, mod.id) : Promise.resolve(true),
      hasReflectionPlanned ? getReflection(userId, mod.id) : Promise.resolve(null),
      hasInterviewPlanned ? listMyInterviews(userId, mod.id) : Promise.resolve([]),
    ]);

    const complete = isModuleFullyCompletePure({
      allLessonsDone,
      hasClassPlanned, classCompleted: classCompletedModuleIds.has(mod.id),
      hasQuizPlanned, quizPassed,
      hasReflectionPlanned, reflectionApproved: (reflection as any)?.status === 'APPROVED',
      hasInterviewPlanned, interviewCompleted: (interviews as any[]).some((i) => i.status === 'completed'),
    });
    if (!complete) return false;
  }
  return true;
}

async function resolveStudentName(cognito: CognitoIdentityProviderClient, userId: string, fallbackEmail?: string): Promise<string> {
  try {
    if (/^[0-9a-f-]{36}$/i.test(userId)) {
      const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
      return res.UserAttributes?.find((a) => a.Name === 'name')?.Value
        ?? res.UserAttributes?.find((a) => a.Name === 'email')?.Value
        ?? fallbackEmail ?? userId;
    }
  } catch { /* fall through */ }
  return fallbackEmail || userId;
}

async function listGroupMemberSubs(cognito: CognitoIdentityProviderClient, groupName: string): Promise<string[]> {
  const subs: string[] = [];
  let nextToken: string | undefined;
  try {
    do {
      const res = await cognito.send(new ListUsersInGroupCommand({
        UserPoolId: USER_POOL_ID, GroupName: groupName, Limit: 60,
        ...(nextToken ? { NextToken: nextToken } : {}),
      }));
      for (const u of res.Users ?? []) {
        const sub = u.Attributes?.find((a) => a.Name === 'sub')?.Value;
        if (sub) subs.push(sub);
      }
      nextToken = res.NextToken;
    } while (nextToken);
  } catch (e: any) { console.error(`[course-completion] listGroup(${groupName}) error:`, e?.message); }
  return subs;
}

/** Idempotent: safe to call from every gating action (reflection approval, quiz
 *  pass, interview completion) without checking "is this the last one" — the
 *  existing-certificate check makes repeat calls no-ops. Returns the certificate
 *  only when THIS call is the one that completed the course (i.e. actually worth
 *  telling the caller about); returns null on every other call. Never throws —
 *  a failure here must not break the actual gating action that triggered it. */
export async function checkAndCompleteCourse(
  prisma: PrismaLike, userId: string, courseId: string, studentEmail?: string, studentLang?: 'es' | 'en',
): Promise<{ certId: string } | null> {
  try {
    const existing = await getCertificateByUserAndCourse(userId, courseId);
    if (existing) return null;

    const complete = await isCourseFullyComplete(prisma, userId, courseId);
    if (!complete) return null;

    const course = await (prisma as any).course.findUnique({ where: { id: courseId }, select: { title: true, evaluatorId: true } });
    if (!course) return null;

    const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
    const studentName = await resolveStudentName(cognito, userId, studentEmail);
    const cert = { certId: createId(), userId, courseId, studentName, courseTitle: course.title, issuedAt: new Date().toISOString() };
    await saveCertificate(cert);

    // Notify the student (existing behavior, pre-2026-09-06) + the course's
    // evaluator + every ADMIN (new — Mack: "ahí debería avisar al admin +
    // evaluador"). Non-fatal: a notification failure must never undo the
    // certificate that was just (successfully) saved above.
    try {
      const now = new Date().toISOString();
      await createNotification({
        userId,
        notifId: `course-completed-student-${courseId}-${userId}`,
        type: 'GENERAL',
        message: studentLang === 'en'
          ? `🎓 Congratulations! You completed "${course.title}". Your certificate is available.`
          : `🎓 ¡Felicitaciones! Completaste "${course.title}". Tu certificado está disponible.`,
        read: false,
        createdAt: now,
        actionUrl: `/certificado/${cert.certId}`,
      });

      const recipientIds = new Set<string>();
      if (course.evaluatorId) recipientIds.add(course.evaluatorId);
      for (const sub of await listGroupMemberSubs(cognito, 'ADMIN')) recipientIds.add(sub);

      const message = `🎓 ${studentName} completó el curso "${course.title}"`;
      await Promise.allSettled([...recipientIds].map((uid) => createNotification({
        userId: uid,
        notifId: `course-completed-${courseId}-${userId}`,
        type: 'GENERAL',
        message,
        read: false,
        createdAt: now,
        actionUrl: `${FRONTEND_URL}/admin/courses/${courseId}`,
      })));
    } catch (e: any) { console.error('[course-completion] notify error:', e?.message); }

    return { certId: cert.certId };
  } catch (e: any) {
    console.error('[course-completion] checkAndCompleteCourse error:', e?.message);
    return null;
  }
}
