import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import webpush from 'web-push';

// Configure VAPID for student push notifications
const VAPID_PUBLIC_EV = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE_EV = process.env.VAPID_PRIVATE_KEY ?? '';
if (VAPID_PUBLIC_EV && VAPID_PRIVATE_EV) {
  webpush.setVapidDetails(process.env.VAPID_EMAIL ?? 'mailto:admin@luxlearning.com', VAPID_PUBLIC_EV, VAPID_PRIVATE_EV);
}
import { getPrismaClient } from '../shared/db-neon';
import { getAllReflections, getAllLessonProgress, getAllQuizAttempts, getReflection, updateReflectionStatus, setReflectionPriority, createNotification, getAllEnrollments, getCertificateByUserAndCourse, saveCertificate, getQuizAttempts, getPushSubscriptionsByUserId, createTask, getTasksForUser, getTasksByCourse, updateTask, deleteTask, getLastSeenAll, getSignature, saveSignature, TABLES, ddb } from '../shared/db-dynamo';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { detectAI } from '../reflection/detect-ai';
import { ok, badRequest, forbidden, notFound, serverError, cors } from '../shared/response';
import { createId } from '@paralleldrive/cuid2';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.com';

// Cache userId -> email to avoid repeated Cognito calls within a Lambda invocation
const emailCache = new Map<string, string>();
const roleCache = new Map<string, string>();

async function getCognitoUser(userId: string): Promise<{ email: string; role: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  if (emailCache.has(userId)) return { email: emailCache.get(userId)!, role: roleCache.get(userId) ?? '' };
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const email = res.UserAttributes?.find((a) => a.Name === 'email')?.Value ?? userId;
    const role = res.UserAttributes?.find((a) => a.Name === 'custom:role')?.Value ?? '';
    emailCache.set(userId, email);
    roleCache.set(userId, role);
    return { email, role };
  } catch {
    return null;
  }
}

async function resolveStudentName(userId: string, storedEmail?: string): Promise<string> {
  if (storedEmail) return storedEmail;
  if (emailCache.has(userId)) return emailCache.get(userId)!;
  const user = await getCognitoUser(userId);
  return user?.email ?? userId;
}

async function isStudentRole(userId: string): Promise<boolean> {
  if (roleCache.has(userId)) return roleCache.get(userId) === 'STUDENT';
  const user = await getCognitoUser(userId);
  return user?.role === 'STUDENT';
}

// Returns { email, name } for a student — email for sending, name for display
async function resolveStudentContact(userId: string, reflection: any): Promise<{ email: string; name: string }> {
  // New reflections store studentEmail directly
  const storedEmail: string | undefined = reflection.studentEmail;
  if (storedEmail && storedEmail.includes('@')) {
    // Try to get display name from Cognito
    try {
      const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
      const name = res.UserAttributes?.find((a: any) => a.Name === 'name')?.Value
        ?? res.UserAttributes?.find((a: any) => a.Name === 'email')?.Value
        ?? storedEmail;
      return { email: storedEmail, name };
    } catch {
      return { email: storedEmail, name: storedEmail.split('@')[0] };
    }
  }
  // UUID userId — look up email + name from Cognito
  if (/^[0-9a-f-]{36}$/i.test(userId)) {
    try {
      const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
      const email = res.UserAttributes?.find((a: any) => a.Name === 'email')?.Value ?? '';
      const name = res.UserAttributes?.find((a: any) => a.Name === 'name')?.Value ?? email.split('@')[0] ?? userId;
      if (email) return { email, name };
    } catch { /* fall through */ }
  }
  // userId might already be the email
  if (userId.includes('@')) return { email: userId, name: userId.split('@')[0] };
  return { email: '', name: userId };
}

async function sendEmail(to: string, subject: string, html: string) {
  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  }));
}

function approvedEmailHtml(studentName: string, moduleTitle: string, feedback: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Roboto', Arial, sans-serif; background: #F8F8F8; padding: 40px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 16px rgba(0,0,0,.08);">
    <div style="background: linear-gradient(135deg, #00B4D8, #7B2FBE); padding: 32px 40px;">
      <h1 style="color: #fff; margin: 0; font-family: Montserrat, sans-serif; font-size: 24px;">Lux Learning</h1>
      <p style="color: rgba(255,255,255,.85); margin: 8px 0 0; font-size: 14px;">Claridad que transforma.</p>
    </div>
    <div style="padding: 40px;">
      <h2 style="color: #2C2C2C; font-family: Montserrat, sans-serif; margin-top: 0;">¡Reflexión aprobada!</h2>
      <p style="color: #555; line-height: 1.6;">Hola ${studentName},</p>
      <p style="color: #555; line-height: 1.6;">Tu reflexión del módulo <strong>${moduleTitle}</strong> ha sido <strong style="color: #00B4D8;">aprobada</strong>. El siguiente módulo ya está desbloqueado.</p>
      <div style="background: #F8F8F8; border-left: 4px solid #00B4D8; padding: 16px 20px; border-radius: 4px; margin: 24px 0;">
        <p style="margin: 0; color: #555; font-style: italic;">"${feedback}"</p>
        <p style="margin: 8px 0 0; color: #888; font-size: 13px;">— Tu evaluador</p>
      </div>
      <a href="${process.env.FRONTEND_URL ?? 'https://luxlearning.com'}/dashboard"
         style="display: inline-block; background: linear-gradient(135deg, #00B4D8, #7B2FBE); color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-family: Montserrat, sans-serif; font-weight: 600; margin-top: 8px;">
        Continuar aprendiendo
      </a>
    </div>
  </div>
</body>
</html>`;
}

function rejectedEmailHtml(studentName: string, moduleTitle: string, feedback: string, reason: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Roboto', Arial, sans-serif; background: #F8F8F8; padding: 40px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 16px rgba(0,0,0,.08);">
    <div style="background: linear-gradient(135deg, #00B4D8, #7B2FBE); padding: 32px 40px;">
      <h1 style="color: #fff; margin: 0; font-family: Montserrat, sans-serif; font-size: 24px;">Lux Learning</h1>
    </div>
    <div style="padding: 40px;">
      <h2 style="color: #2C2C2C; font-family: Montserrat, sans-serif; margin-top: 0;">Reflexión requiere revisión</h2>
      <p style="color: #555; line-height: 1.6;">Hola ${studentName},</p>
      <p style="color: #555; line-height: 1.6;">Tu reflexión del módulo <strong>${moduleTitle}</strong> necesita ser reescrita.</p>
      <p style="color: #555; line-height: 1.6;"><strong>Motivo:</strong> ${reason}</p>
      <div style="background: #F8F8F8; border-left: 4px solid #7B2FBE; padding: 16px 20px; border-radius: 4px; margin: 24px 0;">
        <p style="margin: 0; color: #555; font-style: italic;">"${feedback}"</p>
        <p style="margin: 8px 0 0; color: #888; font-size: 13px;">— Tu evaluador</p>
      </div>
      <a href="${process.env.FRONTEND_URL ?? 'https://luxlearning.com'}/dashboard"
         style="display: inline-block; background: linear-gradient(135deg, #00B4D8, #7B2FBE); color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-family: Montserrat, sans-serif; font-weight: 600; margin-top: 8px;">
        Reescribir reflexión
      </a>
    </div>
  </div>
</body>
</html>`;
}

function approvedWithCertEmailHtml(studentName: string, moduleTitle: string, feedback: string, courseTitle: string, certId: string): string {
  const certUrl = `${process.env.FRONTEND_URL ?? 'https://luxlearning.com'}/certificado/${certId}`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Roboto', Arial, sans-serif; background: #F8F8F8; padding: 40px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 16px rgba(0,0,0,.08);">
    <div style="background: linear-gradient(135deg, #00B4D8, #7B2FBE); padding: 32px 40px;">
      <h1 style="color: #fff; margin: 0; font-family: Montserrat, sans-serif; font-size: 24px;">Lux Learning</h1>
      <p style="color: rgba(255,255,255,.85); margin: 8px 0 0; font-size: 14px;">Claridad que transforma.</p>
    </div>
    <div style="padding: 40px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="font-size: 48px; margin-bottom: 8px;">🎓</div>
        <h2 style="color: #2C2C2C; font-family: Montserrat, sans-serif; margin: 0;">¡Curso completado!</h2>
        <p style="color: #888; margin: 8px 0 0; font-size: 14px;">${courseTitle}</p>
      </div>
      <p style="color: #555; line-height: 1.6;">Hola ${studentName},</p>
      <p style="color: #555; line-height: 1.6;">Tu última reflexión del módulo <strong>${moduleTitle}</strong> ha sido <strong style="color: #00B4D8;">aprobada</strong> y has completado el curso.</p>
      <div style="background: #F8F8F8; border-left: 4px solid #00B4D8; padding: 16px 20px; border-radius: 4px; margin: 24px 0;">
        <p style="margin: 0; color: #555; font-style: italic;">"${feedback}"</p>
        <p style="margin: 8px 0 0; color: #888; font-size: 13px;">— Tu evaluador</p>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${certUrl}"
           style="display: inline-block; background: linear-gradient(135deg, #00B4D8, #7B2FBE); color: #fff; text-decoration: none; padding: 16px 36px; border-radius: 8px; font-family: Montserrat, sans-serif; font-weight: 700; font-size: 16px;">
          🏆 Ver y descargar certificado
        </a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const auth = event.requestContext.authorizer?.lambda;
  if (auth?.role !== 'EVALUATOR' && auth?.role !== 'ADMIN') return forbidden('Evaluator role required');

  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const prisma = getPrismaClient();

  try {
    // GET /evaluator/reflections — list ALL reflections (frontend filters by status)
    if (method === 'GET' && path === '/evaluator/reflections') {
      const reflections = await getAllReflections();

      // Enrich with module and course titles — batch to avoid N+1
      const uniqueModuleIds = [...new Set(reflections.map((r) => r.moduleId))];
      const modules = await prisma.module.findMany({
        where: { id: { in: uniqueModuleIds } },
        include: { course: { select: { title: true } } },
      });
      const moduleMap = new Map(modules.map((m) => [m.id, m]));

      const enriched = await Promise.all(
        reflections.map(async (r) => {
          const mod = moduleMap.get(r.moduleId);
          const studentName = await resolveStudentName(r.userId, (r as any).studentEmail);
          return {
            ...r,
            moduleTitle: mod?.title ?? 'Unknown',
            courseTitle: mod?.course.title ?? 'Unknown',
            studentName,
          };
        })
      );

      return ok(enriched);
    }

    // POST /evaluator/reflections/review
    if (method === 'POST' && path === '/evaluator/reflections/review') {
      const body = JSON.parse(event.body ?? '{}');
      const { userId: studentId, moduleId, action, feedback, qualityScore } = body as {
        userId: string;
        moduleId: string;
        action: 'APPROVE' | 'REJECT';
        feedback: string;
        qualityScore?: number;
      };

      if (!studentId || !moduleId || !action || !feedback) {
        return badRequest('userId, moduleId, action and feedback are required');
      }

      if (feedback.trim().length < 20) {
        return badRequest('Feedback must be at least 20 characters');
      }

      const reflection = await getReflection(studentId, moduleId);
      if (!reflection) return notFound('Reflection not found');

      if (reflection.status !== 'PENDING_EVAL') {
        return badRequest(`Cannot review reflection with status: ${reflection.status}`);
      }

      const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const reviewedAt = new Date().toISOString();

      await updateReflectionStatus(studentId, moduleId, {
        status: newStatus,
        evaluatorFeedback: feedback,
        reviewedAt,
        ...(action === 'APPROVE' && qualityScore != null ? { qualityScore: Math.min(10, Math.max(1, Math.round(qualityScore))) } : {}),
      });

      // Get module info for emails
      const module = await prisma.module.findUnique({
        where: { id: moduleId },
        include: { course: true },
      });

      // Create in-app notification
      await createNotification({
        userId: studentId,
        notifId: createId(),
        type: action === 'APPROVE' ? 'REFLECTION_APPROVED' : 'REFLECTION_REJECTED',
        message: action === 'APPROVE'
          ? `Tu reflexión de "${module?.title}" fue aprobada. ¡Módulo siguiente desbloqueado!`
          : `Tu reflexión de "${module?.title}" necesita revisión.`,
        read: false,
        createdAt: reviewedAt,
      });

      // ── Fire-and-forget push notification to the student ─────────────────────
      void (async () => {
        try {
          if (!VAPID_PUBLIC_EV || !VAPID_PRIVATE_EV) return;
          const studentSubs = await getPushSubscriptionsByUserId(studentId);
          if (!studentSubs.length) return;
          const pushPayload = JSON.stringify({
            title: action === 'APPROVE' ? '✅ Reflexión aprobada' : '✍️ Reflexión necesita revisión',
            body: action === 'APPROVE'
              ? `Tu reflexión de "${module?.title}" fue aprobada. ¡Siguiente módulo desbloqueado!`
              : `Tu reflexión de "${module?.title}" necesita ser reescrita.`,
            url: '/dashboard',
          });
          await Promise.allSettled(
            studentSubs.map((sub) => webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, pushPayload))
          );
        } catch { /* non-fatal */ }
      })();

      // ── Check if all modules approved → generate certificate ─────────────────
      let certId: string | null = null;
      if (action === 'APPROVE' && module?.course) {
        try {
          const allModules = await prisma.module.findMany({
            where: { courseId: module.courseId },
            select: { id: true },
          });
          const allReflections = await Promise.all(
            allModules.map((m) => getReflection(studentId, m.id))
          );
          const allApproved = allReflections.every((r) => r?.status === 'APPROVED');

          if (allApproved) {
            // Check if cert already exists
            const existing = await getCertificateByUserAndCourse(studentId, module.courseId);
            if (!existing) {
              certId = createId();
              const { name: studentName } = await resolveStudentContact(studentId, reflection);
              await saveCertificate({
                certId,
                userId: studentId,
                courseId: module.courseId,
                studentName,
                courseTitle: module.course.title,
                issuedAt: reviewedAt,
              });
              // In-app notification for course completion
              await createNotification({
                userId: studentId,
                notifId: createId(),
                type: 'GENERAL',
                message: `🎓 ¡Felicitaciones! Completaste "${module.course.title}". Tu certificado está disponible.`,
                read: false,
                createdAt: reviewedAt,
              });
              console.log(`[Evaluator] Certificate generated: ${certId} for student ${studentId}`);
            } else {
              certId = existing.certId;
            }
          }
        } catch (certErr) {
          console.warn('[Evaluator] Certificate generation failed (non-fatal):', certErr);
        }
      }

      // ── Send SES email ────────────────────────────────────────────────────────
      try {
        const moduleTitle = module?.title ?? 'módulo';
        const { email: studentEmail, name: studentName } = await resolveStudentContact(studentId, reflection);
        if (studentEmail) {
          if (action === 'APPROVE') {
            const emailHtml = certId
              ? approvedWithCertEmailHtml(studentName, moduleTitle, feedback, module?.course?.title ?? '', certId)
              : approvedEmailHtml(studentName, moduleTitle, feedback);
            await sendEmail(
              studentEmail,
              certId
                ? `🎓 ¡Curso completado! Certificado disponible — ${module?.course?.title ?? moduleTitle}`
                : `¡Reflexión aprobada! — ${moduleTitle}`,
              emailHtml
            );
          } else {
            await sendEmail(
              studentEmail,
              `Reflexión requiere revisión — ${moduleTitle}`,
              rejectedEmailHtml(studentName, moduleTitle, feedback, 'El evaluador ha dejado comentarios.')
            );
          }
        } else {
          console.warn(`[Evaluator] No email found for student ${studentId} — skipping email`);
        }
      } catch (emailErr) {
        console.warn('[Evaluator] Email send failed (non-fatal):', emailErr);
      }

      return ok({ status: newStatus, reviewedAt, certId });
    }

    // GET /evaluator/students — full progress per student
    if (method === 'GET' && path === '/evaluator/students') {
      const [allProgress, allReflections, allAttempts, allEnrollments, courses, allLastSeen] = await Promise.all([
        getAllLessonProgress(),
        getAllReflections(),
        getAllQuizAttempts(),
        getAllEnrollments(),
        prisma.course.findMany({
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          include: {
            modules: {
              orderBy: { order: 'asc' },
              include: { lessons: { select: { id: true } } },
            },
          },
        }),
        getLastSeenAll(),
      ]);

      // Build lastSeen map
      const lastSeenMap = new Map(allLastSeen.map((ls) => [ls.userId, ls.lastSeen]));
      const now = Date.now();
      const getPresenceStatus = (userId: string): 'online' | 'active' | 'inactive' => {
        const ls = lastSeenMap.get(userId);
        if (!ls) return 'inactive';
        const diffMs = now - new Date(ls).getTime();
        if (diffMs < 5 * 60 * 1000) return 'online';       // < 5 min = online
        if (diffMs < 72 * 60 * 60 * 1000) return 'active'; // < 72h = active
        return 'inactive';
      };

      // Build per-student maps
      type StudentAccum = {
        userId: string;
        completedLessons: Record<string, Set<string>>; // courseId -> Set<lessonId>
        quizPassed: Set<string>;                        // moduleId
        reflections: Record<string, string>;            // moduleId -> status
      };

      const byStudent = new Map<string, StudentAccum>();

      const getOrCreate = (uid: string): StudentAccum => {
        if (!byStudent.has(uid)) {
          byStudent.set(uid, { userId: uid, completedLessons: {}, quizPassed: new Set(), reflections: {} });
        }
        return byStudent.get(uid)!;
      };

      // Seed all enrolled students so they appear even with 0 activity
      allEnrollments.forEach((e) => getOrCreate(e.userId));

      allProgress.forEach((p) => {
        const s = getOrCreate(p.userId);
        if (!s.completedLessons[p.courseId]) s.completedLessons[p.courseId] = new Set();
        s.completedLessons[p.courseId]!.add(p.lessonId);
      });

      allAttempts.forEach((a) => {
        if (a.passed) getOrCreate(a.userId).quizPassed.add(a.moduleId);
      });

      allReflections.forEach((r) => {
        getOrCreate(r.userId).reflections[r.moduleId] = r.status;
      });

      // Build enrollment map: userId -> Set<courseId>
      const enrollmentMap = new Map<string, Set<string>>();
      allEnrollments.forEach((e) => {
        if (!enrollmentMap.has(e.userId)) enrollmentMap.set(e.userId, new Set());
        enrollmentMap.get(e.userId)!.add(e.courseId);
      });

      const students = await Promise.all(Array.from(byStudent.values()).map(async (s) => {
        const studentName = await resolveStudentName(s.userId);
        const enrolledCourseIds = enrollmentMap.get(s.userId) ?? new Set<string>();
        const visibleCourses = enrolledCourseIds.size > 0
          ? courses.filter((c) => enrolledCourseIds.has(c.id))
          : courses;

        const courseStats = visibleCourses.map((course) => {
          const allLessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
          const completedSet = s.completedLessons[course.id] ?? new Set<string>();
          const completedCount = allLessonIds.filter((id) => completedSet.has(id)).length;

          const moduleStats = course.modules.map((mod) => ({
            moduleId: mod.id,
            title: mod.title,
            order: mod.order,
            totalLessons: mod.lessons.length,
            completedLessons: mod.lessons.filter((l) => completedSet.has(l.id)).length,
            quizPassed: s.quizPassed.has(mod.id),
            reflectionStatus: s.reflections[mod.id] ?? null,
          }));

          return {
            courseId: course.id,
            title: course.title,
            totalLessons: allLessonIds.length,
            completedLessons: completedCount,
            progressPct: allLessonIds.length > 0 ? Math.round((completedCount / allLessonIds.length) * 100) : 0,
            modulesApproved: moduleStats.filter((m) => m.reflectionStatus === 'APPROVED').length,
            modules: moduleStats,
          };
        });

        const lastSeen = lastSeenMap.get(s.userId) ?? null;
        const presenceStatus = getPresenceStatus(s.userId);
        return { userId: s.userId, studentName, courses: courseStats, lastSeen, presenceStatus };
      }));

      // Filter out non-STUDENT users (evaluators, admins who may have enrollments/heartbeats)
      const studentRoleChecks = await Promise.all(students.map((s) => isStudentRole(s.userId)));
      const studentsOnly = students.filter((_, i) => studentRoleChecks[i]);

      // Sort: online first, then active, then inactive, then by progress
      const statusOrder = { online: 0, active: 1, inactive: 2 };
      studentsOnly.sort((a, b) => {
        const sA = statusOrder[a.presenceStatus as keyof typeof statusOrder] ?? 2;
        const sB = statusOrder[b.presenceStatus as keyof typeof statusOrder] ?? 2;
        if (sA !== sB) return sA - sB;
        const pA = a.courses.reduce((sum, c) => sum + c.progressPct, 0);
        const pB = b.courses.reduce((sum, c) => sum + c.progressPct, 0);
        return pB - pA;
      });

      return ok({ students: studentsOnly, courses: courses.map((c) => ({ id: c.id, title: c.title })) });
    }

    // POST /evaluator/reminder — send inactivity reminder email to a student
    if (method === 'POST' && path === '/evaluator/reminder') {
      const body = JSON.parse(event.body ?? '{}');
      const { userId, studentEmail, studentName, hoursInactive, courseTitle } = body as {
        userId: string; studentEmail: string; studentName?: string;
        hoursInactive?: number; courseTitle?: string;
      };
      if (!userId || !studentEmail) return badRequest('userId y studentEmail son requeridos');

      const name = studentName || studentEmail.split('@')[0];
      const hours = Math.round(hoursInactive ?? 72);
      const timeLabel = hours >= 48 ? `${Math.round(hours / 24)} días` : `${hours} horas`;

      const reminderHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Claridad que transforma.</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Hola, ${name}!</h2>
      <p style="color:#555;line-height:1.6;">Hemos notado que llevas <strong>${timeLabel}</strong> sin conectarte a la plataforma.</p>
      ${courseTitle ? `<p style="color:#555;line-height:1.6;">Recuerda que tienes el curso <strong>"${courseTitle}"</strong> activo con fechas límite próximas.</p>` : ''}
      <p style="color:#555;line-height:1.6;">Tu progreso importa. ¡Todavía estás a tiempo de completar tus módulos y reflexiones!</p>
      <a href="${process.env.FRONTEND_URL ?? 'https://lux-learning-mentor.vercel.app'}/dashboard"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:16px;">
        Continuar aprendiendo
      </a>
    </div>
  </div>
</body>
</html>`;

      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [studentEmail] },
        Message: {
          Subject: { Data: '¡Te echamos de menos en Lux Learning!', Charset: 'UTF-8' },
          Body: { Html: { Data: reminderHtml, Charset: 'UTF-8' } },
        },
      }));

      return ok({ sent: true });
    }

    // POST /evaluator/reflections/priority — toggle priority flag
    if (method === 'POST' && path === '/evaluator/reflections/priority') {
      const body2 = JSON.parse(event.body ?? '{}');
      const { userId: studentId, moduleId, priority } = body2 as { userId: string; moduleId: string; priority: boolean };
      if (!studentId || !moduleId || priority == null) return badRequest('userId, moduleId, priority required');
      await setReflectionPriority(studentId, moduleId, priority);
      return ok({ priority });
    }

    // POST /evaluator/ai-feedback — generate 5 feedback suggestions via Bedrock
    if (method === 'POST' && path === '/evaluator/ai-feedback') {
      const body = JSON.parse(event.body ?? '{}');
      const { text, moduleTitle } = body as { text: string; moduleTitle?: string };
      if (!text) return badRequest('text is required');

      const prompt = `Eres un evaluador experto en desarrollo personal y aprendizaje. Se te ha presentado la siguiente reflexión de un estudiante del módulo "${moduleTitle ?? 'del curso'}".

REFLEXIÓN:
"""
${text.slice(0, 3000)}
"""

Genera exactamente 5 comentarios de feedback constructivo y específico para esta reflexión. Cada comentario debe:
- Ser concreto y referirse al contenido real de la reflexión
- Ser entre 1-2 oraciones
- Alternar entre aspectos positivos y áreas de mejora
- Estar en español

Responde ÚNICAMENTE con un objeto JSON con esta estructura exacta:
{
  "suggestions": [
    "Comentario 1",
    "Comentario 2",
    "Comentario 3",
    "Comentario 4",
    "Comentario 5"
  ]
}`;

      try {
        const response = await bedrock.send(new InvokeModelCommand({
          modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          }),
        }));

        const raw = JSON.parse(new TextDecoder().decode(response.body));
        const content = raw.content?.[0]?.text ?? '';
        const clean = content.replace(/```json|```/g, '').trim();
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return serverError('AI response format error');
        const parsed = JSON.parse(jsonMatch[0]);
        return ok({ suggestions: parsed.suggestions ?? [] });
      } catch (aiErr) {
        console.error('[Evaluator] Bedrock AI feedback error:', aiErr);
        return serverError('AI feedback generation failed');
      }
    }

    // GET /evaluator/quiz-audit?userId=X&moduleId=Y — quiz answers for a student
    if (method === 'GET' && path === '/evaluator/quiz-audit') {
      const qs = event.queryStringParameters ?? {};
      const { userId: studentId, moduleId } = qs as { userId?: string; moduleId?: string };
      if (!studentId || !moduleId) return badRequest('userId and moduleId are required');

      const [attempts, module] = await Promise.all([
        getQuizAttempts(studentId, moduleId),
        getPrismaClient().module.findUnique({
          where: { id: moduleId },
          include: { questions: { orderBy: { order: 'asc' } } },
        }),
      ]);

      if (!module) return notFound('Module not found');

      // Enrich each attempt with question details
      const enrichedAttempts = attempts.map((attempt) => ({
        ...attempt,
        results: module.questions.map((q, i) => ({
          questionText: q.text,
          options: q.options,
          selectedIndex: attempt.answers?.[i] ?? -1,
          correctIndex: q.correctIndex,
          isCorrect: attempt.answers?.[i] === q.correctIndex,
        })),
      }));

      return ok({
        attempts: enrichedAttempts,
        passingScore: module.passingScore,
        moduleTitle: module.title,
        totalQuestions: module.questions.length,
      });
    }

    // POST /evaluator/ai-check — run AI detection synchronously on a reflection
    if (method === 'POST' && path === '/evaluator/ai-check') {
      const body = JSON.parse(event.body ?? '{}');
      const { userId: studentId, moduleId } = body as { userId?: string; moduleId?: string };
      if (!studentId || !moduleId) return badRequest('userId and moduleId are required');

      const reflection = await getReflection(studentId, moduleId);
      if (!reflection) return notFound('Reflection not found');

      try {
        const aiResult = await detectAI(reflection.text ?? '');
        // Persist result back to DynamoDB
        await updateReflectionStatus(studentId, moduleId, { aiResult, analyzedAt: new Date().toISOString() });
        return ok({ aiResult });
      } catch (aiErr) {
        console.error('[Evaluator] AI check error:', aiErr);
        return serverError('AI detection failed');
      }
    }

    // ── Tasks ─────────────────────────────────────────────────────────────────

    // POST /evaluator/tasks — create task(s) for individual or all students in a course
    if (path === '/evaluator/tasks' && method === 'POST') {
      const body = JSON.parse(event.body ?? '{}');
      const { title, description, type = 'custom', dueDate, courseId, moduleId, courseTitle, moduleTitle, assignTo, userId: targetUserId, targetCourseId } = body as any;
      if (!title || !dueDate) return badRequest('title y dueDate son requeridos');

      const assignerUserId = event.requestContext.authorizer?.lambda?.userId!;
      let assignees: string[] = [];

      if (assignTo === 'course' && targetCourseId) {
        // Fetch all enrolled students in a course
        const all = await ddb.send(new QueryCommand({
          TableName: TABLES.ENROLLMENTS,
          IndexName: 'courseId-users-index',
          KeyConditionExpression: 'courseId = :cid',
          ExpressionAttributeValues: { ':cid': targetCourseId },
        })).catch(async () => {
          // Fallback: scan enrollments for this course
          const scan = await ddb.send(new ScanCommand({
            TableName: TABLES.ENROLLMENTS,
            FilterExpression: 'courseId = :cid',
            ExpressionAttributeValues: { ':cid': targetCourseId },
          }));
          return { Items: scan.Items ?? [] };
        });
        assignees = [...new Set((all.Items ?? []).map((item: any) => item.userId as string).filter(Boolean))];
      } else if (targetUserId) {
        assignees = [targetUserId];
      }

      if (!assignees.length) return badRequest('No se encontraron destinatarios');

      // Server-side dedup: if same title+dueDate+assignedBy exists in last 30s, return existing
      const cutoff = new Date(Date.now() - 30_000).toISOString();
      const recentScan = await ddb.send(new ScanCommand({
        TableName: TABLES.TASKS,
        FilterExpression: '#t = :title AND dueDate = :dd AND assignedBy = :aid AND createdAt >= :cutoff',
        ExpressionAttributeNames: { '#t': 'title' },
        ExpressionAttributeValues: { ':title': title, ':dd': dueDate, ':aid': assignerUserId, ':cutoff': cutoff },
      })).catch(() => ({ Items: [] }));
      if ((recentScan.Items ?? []).length > 0) {
        return ok({ created: (recentScan.Items ?? []).length, deduplicated: true });
      }

      const tasks = await Promise.all(
        assignees.map((uid) =>
          createTask({
            userId: uid,
            taskId: createId(),
            title,
            description,
            courseId,
            moduleId,
            courseTitle,
            moduleTitle,
            type,
            dueDate,
            status: 'PENDING',
            assignedBy: assignerUserId,
            createdAt: new Date().toISOString(),
          })
        )
      );

      // Push notifications (non-fatal)
      Promise.allSettled(
        assignees.map(async (uid) => {
          const subs = await getPushSubscriptionsByUserId(uid);
          await Promise.allSettled(
            subs.map((sub: any) =>
              webpush.sendNotification(sub, JSON.stringify({
                title: '📋 Nueva tarea asignada',
                body: `${title} — Vence: ${dueDate}`,
              }))
            )
          );
        })
      ).catch(() => {});

      return ok({ created: tasks.length });
    }

    // GET /evaluator/tasks — list all tasks assigned by this evaluator
    if (path === '/evaluator/tasks' && method === 'GET') {
      const assignerUserId = event.requestContext.authorizer?.lambda?.userId!;
      const scan = await ddb.send(new ScanCommand({
        TableName: TABLES.TASKS,
        FilterExpression: 'assignedBy = :aid',
        ExpressionAttributeValues: { ':aid': assignerUserId },
      }));
      const tasks = (scan.Items ?? []).sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate));
      return ok(tasks);
    }

    // PUT /evaluator/tasks/:taskId — update a task
    const taskEditMatch = path.match(/^\/evaluator\/tasks\/([^/]+)$/);
    if (taskEditMatch && method === 'PUT') {
      const body = JSON.parse(event.body ?? '{}');
      const taskId = taskEditMatch[1]!;
      const { userId: targetUserId, title, description, dueDate } = body as any;
      if (!targetUserId) return badRequest('userId es requerido');
      const tasks = await getTasksForUser(targetUserId);
      const task = tasks.find((t: any) => t.taskId === taskId);
      if (!task) return badRequest('Tarea no encontrada');
      await updateTask(targetUserId, task.sk, { title, description, dueDate });
      return ok({ updated: true });
    }

    // DELETE /evaluator/tasks/:taskId — delete a task
    if (taskEditMatch && method === 'DELETE') {
      const body = JSON.parse(event.body ?? '{}');
      const taskId = taskEditMatch[1]!;
      const { userId: targetUserId } = body as any;
      if (!targetUserId) return badRequest('userId es requerido');
      const tasks = await getTasksForUser(targetUserId);
      const task = tasks.find((t: any) => t.taskId === taskId);
      if (!task) return badRequest('Tarea no encontrada');
      await deleteTask(targetUserId, task.sk);
      return ok({ deleted: true });
    }

    // GET /evaluator/signature — obtener firma digital del evaluador
    if (method === 'GET' && path === '/evaluator/signature') {
      const signature = await getSignature(userId);
      return ok({ signature });
    }

    // PUT /evaluator/signature — guardar firma digital del evaluador
    if (method === 'PUT' && path === '/evaluator/signature') {
      const { signature } = body as { signature?: string };
      if (!signature) return badRequest('signature es requerido');
      await saveSignature(userId, signature);
      return ok({ ok: true });
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
