import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { getPrismaClient } from '../shared/db-neon.js';
import { getPendingReflections, getReflection, updateReflectionStatus, createNotification } from '../shared/db-dynamo.js';
import { ok, badRequest, forbidden, notFound, serverError, cors } from '../shared/response.js';
import { createId } from '@paralleldrive/cuid2';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.com';

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

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const auth = event.requestContext.authorizer?.lambda;
  if (auth?.role !== 'EVALUATOR') return forbidden('Evaluator role required');

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
          return {
            ...r,
            moduleTitle: module?.title ?? 'Unknown',
            courseTitle: module?.course.title ?? 'Unknown',
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

      // Send SES email
      try {
        const studentEmail = reflection.userId; // userId IS the email in Cognito
        // Note: In practice you'd look up the Cognito user email — here we assume userId=email
        // or use a Cognito AdminGetUser call. For now we skip if it looks like a UUID.
        if (studentEmail.includes('@')) {
          const moduleTitle = module?.title ?? 'módulo';
          if (action === 'APPROVE') {
            await sendEmail(
              studentEmail,
              `¡Reflexión aprobada! — ${moduleTitle}`,
              approvedEmailHtml('Estudiante', moduleTitle, feedback)
            );
          } else {
            await sendEmail(
              studentEmail,
              `Reflexión requiere revisión — ${moduleTitle}`,
              rejectedEmailHtml('Estudiante', moduleTitle, feedback, 'El evaluador ha dejado comentarios.')
            );
          }
        }
      } catch (emailErr) {
        console.warn('[Evaluator] Email send failed (non-fatal):', emailErr);
      }

      return ok({ status: newStatus, reviewedAt });
    }

    // GET /evaluator/students
    if (method === 'GET' && path === '/evaluator/students') {
      // Return aggregate stats — for MVP we return raw reflection data
      const reflections = await getPendingReflections();
      return ok(reflections);
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
