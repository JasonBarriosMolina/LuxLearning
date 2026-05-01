import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getPrismaClient } from '../shared/db-neon';
import { getPendingReflections, getAllReflections, getAllLessonProgress, getAllQuizAttempts, getReflection, updateReflectionStatus, createNotification, getAllEnrollments, getCertificateByUserAndCourse, saveCertificate } from '../shared/db-dynamo';
import { ok, badRequest, forbidden, notFound, serverError, cors } from '../shared/response';
import { createId } from '@paralleldrive/cuid2';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.com';

// Cache userId -> email to avoid repeated Cognito calls within a Lambda invocation
const emailCache = new Map<string, string>();

async function resolveStudentName(userId: string, storedEmail?: string): Promise<string> {
  if (storedEmail) return storedEmail;
  if (emailCache.has(userId)) return emailCache.get(userId)!;
  // userId looks like a UUID (Cognito sub) — look up via AdminGetUser
  if (/^[0-9a-f-]{36}$/i.test(userId)) {
    try {
      const res = await cognito.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      }));
      const email = res.UserAttributes?.find((a) => a.Name === 'email')?.Value ?? userId;
      emailCache.set(userId, email);
      return email;
    } catch {
      return userId;
    }
  }
  return userId;
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
    // GET /evaluator/reflections — list PENDING_EVAL
    if (method === 'GET' && path === '/evaluator/reflections') {
      const reflections = await getPendingReflections();

      // Enrich with module and course titles
      const enriched = await Promise.all(
        reflections.map(async (r) => {
          const module = await prisma.module.findUnique({
            where: { id: r.moduleId },
            include: { course: { select: { title: true } } },
          });
          const studentName = await resolveStudentName(r.userId, (r as any).studentEmail);
          return {
            ...r,
            moduleTitle: module?.title ?? 'Unknown',
            courseTitle: module?.course.title ?? 'Unknown',
            studentName,
          };
        })
      );

      return ok(enriched);
    }

    // POST /evaluator/reflections/review
    if (method === 'POST' && path === '/evaluator/reflections/review') {
      const body = JSON.parse(event.body ?? '{}');
      const { userId: studentId, moduleId, action, feedback } = body as {
        userId: string;
        moduleId: string;
        action: 'APPROVE' | 'REJECT';
        feedback: string;
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
      const [allProgress, allReflections, allAttempts, allEnrollments, courses] = await Promise.all([
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
      ]);

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

        return { userId: s.userId, studentName, courses: courseStats };
      }));

      // Sort: most progress first
      students.sort((a, b) => {
        const pA = a.courses.reduce((sum, c) => sum + c.progressPct, 0);
        const pB = b.courses.reduce((sum, c) => sum + c.progressPct, 0);
        return pB - pA;
      });

      return ok({ students, courses: courses.map((c) => ({ id: c.id, title: c.title })) });
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
