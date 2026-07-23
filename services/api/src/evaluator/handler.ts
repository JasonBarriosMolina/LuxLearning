import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CognitoIdentityProviderClient, AdminGetUserCommand, ListUsersCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import webpush from 'web-push';

// Configure VAPID for student push notifications
const VAPID_PUBLIC_EV = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE_EV = process.env.VAPID_PRIVATE_KEY ?? '';
if (VAPID_PUBLIC_EV && VAPID_PRIVATE_EV) {
  webpush.setVapidDetails(process.env.VAPID_EMAIL ?? 'mailto:admin@luxlearning.com', VAPID_PUBLIC_EV, VAPID_PRIVATE_EV);
}
import { getPrismaClient } from '../shared/db-neon';
import { batchTranslate } from '../shared/translate';
import { sendTemplatedEmail } from '../shared/email';
import { getAllReflections, getAllLessonProgress, getAllQuizAttempts, getReflection, updateReflectionStatus, setReflectionPriority, createNotification, getAllEnrollments, createEnrollment, getEnrollments, getCertificateByUserAndCourse, getCertificatesByUser, saveCertificate, getQuizAttempts, getPushSubscriptionsByUserId, createTask, getTasksForUser, getTasksByCourse, updateTask, deleteTask, autoCompleteTasks, getLastSeenAll, getSignature, saveSignature, getResourcesByEvaluator, saveResource, updateResource, getResourcesByCourse, getUserLang, TABLES, ddb, createCalendarEvent, batchCreateCalendarEvents, getAllVisibleCalendarEvents, updateCalendarEvent, deleteCalendarEvent, getCalendarEventById, setManualReminder, getLastManualReminder, getManualReminderHistory, getInactivityReminder, listSubmissionsForModule, updateSubmissionGrade, listInterviewsForModule, updateInterviewGrade } from '../shared/db-dynamo';
import { createId } from '@paralleldrive/cuid2';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { detectAI } from '../reflection/detect-ai';
import { ok, badRequest, forbidden, notFound, serverError, cors, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';
import { jsonrepair } from 'jsonrepair';
import { upsertChat, upsertMembership } from '../shared/db-messages';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const s3Ev = new S3Client({ region: 'us-east-1' });
const SUBMISSIONS_BUCKET_EV = 'lux-learning-submissions';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.academy';

// Cache userId -> email/role — bounded LRU with 5-minute TTL to prevent unbounded growth
// on long-running warm Lambda instances.
const MAX_CACHE = 500;
const CACHE_TTL_MS = 5 * 60 * 1000;
interface CacheEntry { value: string; expiresAt: number }
const emailCache = new Map<string, CacheEntry>();
const nameCache = new Map<string, CacheEntry>();
const enabledCache = new Map<string, CacheEntry>(); // 'true' | 'false'

function cacheGet(map: Map<string, CacheEntry>, key: string): string | undefined {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { map.delete(key); return undefined; }
  return entry.value;
}
function cacheSet(map: Map<string, CacheEntry>, key: string, value: string): void {
  if (map.size >= MAX_CACHE) map.delete(map.keys().next().value!); // evict oldest entry
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function getCognitoUser(userId: string): Promise<{ email: string; name: string; enabled: boolean } | null> {
  if (!userId) return null;
  const cachedEmail = cacheGet(emailCache, userId);
  if (cachedEmail !== undefined) {
    const cachedEnabled = cacheGet(enabledCache, userId);
    return { email: cachedEmail, name: cacheGet(nameCache, userId) ?? cachedEmail, enabled: cachedEnabled !== 'false' };
  }

  const extractAttrs = (attrs: { Name?: string; Value?: string }[], enabled: boolean) => {
    const email = attrs.find((a) => a.Name === 'email')?.Value ?? '';
    const name = attrs.find((a) => a.Name === 'name')?.Value
      ?? attrs.find((a) => a.Name === 'given_name')?.Value
      ?? email;
    if (email) {
      cacheSet(emailCache, userId, email);
      cacheSet(nameCache, userId, name);
      cacheSet(enabledCache, userId, enabled ? 'true' : 'false');
    }
    return { email, name, enabled };
  };

  // Try by username first (fastest path — works when userId === Cognito username)
  if (/^[0-9a-f-]{36}$/i.test(userId) || !userId.includes('@')) {
    try {
      const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
      return extractAttrs(res.UserAttributes ?? [], res.Enabled ?? true);
    } catch { /* fall through to sub lookup */ }
  }

  // Fallback: look up by sub attribute (handles UUID subs stored in enrollments)
  if (/^[0-9a-f-]{36}$/i.test(userId)) {
    try {
      const res = await cognito.send(new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: `sub = "${userId}"`,
        Limit: 1,
      }));
      const u = res.Users?.[0];
      if (u) return extractAttrs(u.Attributes ?? [], u.Enabled ?? true);
    } catch { /* user not found */ }
  }

  return null;
}

async function resolveStudentName(userId: string, storedEmail?: string): Promise<string> {
  // Always prefer the real name from Cognito — fall back to email only if unavailable
  const cachedName = cacheGet(nameCache, userId);
  if (cachedName !== undefined) return cachedName;
  const user = await getCognitoUser(userId);
  return user?.name ?? storedEmail ?? userId;
}

// Returns { email, name } for a student — email for sending, name for display
async function resolveStudentContact(userId: string, reflection: any): Promise<{ email: string; name: string }> {
  const storedEmail: string | undefined = reflection.studentEmail;
  // Always try Cognito first to get the real name (uses cache from getCognitoUser)
  const cognitoUser = await getCognitoUser(userId);
  if (cognitoUser) {
    return { email: cognitoUser.email, name: cognitoUser.name };
  }
  // Fallback: no Cognito record (e.g. non-UUID userId)
  if (storedEmail && storedEmail.includes('@')) return { email: storedEmail, name: storedEmail.split('@')[0] };
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
      <a href="${process.env.FRONTEND_URL ?? 'https://luxlearning.academy'}/dashboard"
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
      <a href="${process.env.FRONTEND_URL ?? 'https://luxlearning.academy'}/dashboard"
         style="display: inline-block; background: linear-gradient(135deg, #00B4D8, #7B2FBE); color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-family: Montserrat, sans-serif; font-weight: 600; margin-top: 8px;">
        Reescribir reflexión
      </a>
    </div>
  </div>
</body>
</html>`;
}

function approvedWithCertEmailHtml(studentName: string, moduleTitle: string, feedback: string, courseTitle: string, certId: string): string {
  const certUrl = `${process.env.FRONTEND_URL ?? 'https://luxlearning.academy'}/certificado/${certId}`;
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

function reconsideredEmailHtml(studentName: string, moduleTitle: string, reason: string, certId: string | null): string {
  const frontendUrl = process.env.FRONTEND_URL ?? 'https://luxlearning.academy';
  const certLink = certId ? `<p style="margin-top:16px;"><a href="${frontendUrl}/certificado/${certId}" style="background:#059669;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Ver Certificado</a></p>` : '';
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#059669;">✅ Tu reflexión fue reconsiderada y aprobada</h2>
  <p>Hola <strong>${studentName}</strong>,</p>
  <p>Tu reflexión del módulo <strong>${moduleTitle}</strong> fue rechazada inicialmente por el sistema de detección de IA, pero un evaluador la revisó manualmente y decidió aprobarla.</p>
  <p><strong>Razón de la reconsideración:</strong></p>
  <blockquote style="border-left:4px solid #059669;padding-left:12px;color:#555;">${reason}</blockquote>
  ${certLink}
  <p style="margin-top:24px;color:#888;font-size:12px;">— Lux Learning Team | <a href="${frontendUrl}">Lux Learning</a></p>
</body></html>`;
}

// ─── Calendar email helper ────────────────────────────────────────────────────
async function sendCalendarEventEmails(
  calEv: { title: string; type: string; startDate: string; endDate: string; location?: string; description?: string; visibility: string },
  action: 'created' | 'updated',
  cognitoClient: typeof cognito,
  sesClient: typeof ses,
  userPoolId: string,
  fromEmail: string,
): Promise<void> {
  const { title, type, startDate, endDate, location, description, visibility } = calEv;
  const frontendUrl = process.env.FRONTEND_URL ?? 'https://luxlearning.academy';

  const typeLabels: Record<string, string> = {
    class: 'Clase', meeting: 'Reunión', event: 'Evento',
    deadline: 'Fecha límite', reminder: 'Recordatorio', other: 'Otro',
  };
  const typeLabel = typeLabels[type] ?? type;
  const startFmt = new Date(startDate).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const endFmt = new Date(endDate).toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const subject = action === 'created'
    ? `📅 Nuevo evento: ${title}`
    : `📅 Evento actualizado: ${title}`;
  const actionText = action === 'created' ? 'Se ha creado un nuevo evento' : 'Se ha actualizado un evento';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Claridad que transforma.</p>
    </div>
    <div style="padding:40px;">
      <p style="color:#555;margin-top:0;">${actionText} en tu calendario:</p>
      <div style="background:#F0F7FF;border-left:4px solid #7B2FBE;padding:16px 20px;border-radius:4px;margin:16px 0;">
        <p style="margin:0 0 8px;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">${typeLabel}</p>
        <p style="margin:0;color:#2C2C2C;font-size:20px;font-weight:700;">${title}</p>
        <p style="margin:8px 0 0;color:#555;">🕐 ${startFmt} — ${endFmt}</p>
        ${location ? `<p style="margin:6px 0 0;color:#555;">📍 ${location}</p>` : ''}
        ${description ? `<p style="margin:8px 0 0;color:#666;font-size:14px;">${description}</p>` : ''}
      </div>
      <a href="${frontendUrl}/evaluator/calendar" style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:8px;">
        Ver calendario →
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:32px;">Recibes este email como parte de la comunidad Lux Learning.</p>
    </div>
  </div>
</body></html>`;

  // Collect recipient emails based on visibility
  const listGroup = async (groupName: string) => {
    const users: string[] = [];
    let nextToken: string | undefined;
    do {
      const res = await cognitoClient.send(new ListUsersInGroupCommand({
        UserPoolId: userPoolId, GroupName: groupName, Limit: 60,
        ...(nextToken ? { NextToken: nextToken } : {}),
      }));
      for (const u of res.Users ?? []) {
        const email = u.Attributes?.find((a) => a.Name === 'email')?.Value;
        if (email) users.push(email);
      }
      nextToken = res.NextToken;
    } while (nextToken);
    return users;
  };

  const emails: string[] = [];
  if (visibility === 'evaluators' || visibility === 'community') {
    const evEmails = await listGroup('EVALUATOR').catch(() => [] as string[]);
    emails.push(...evEmails);
  }
  if (visibility === 'students' || visibility === 'community' || visibility === 'course_all') {
    const stEmails = await listGroup('STUDENT').catch(() => [] as string[]);
    emails.push(...stEmails);
  }
  if (visibility === 'course_mine') {
    // Only students of the creator's courses — handled by reminders lambda for now
    // Here we send to evaluators as a fallback notification
    const evEmails = await listGroup('EVALUATOR').catch(() => [] as string[]);
    emails.push(...evEmails);
  }

  const unique = [...new Set(emails)];
  for (const email of unique) {
    await sesClient.send(new SendEmailCommand({
      Source: fromEmail,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    })).catch(() => {});
  }
}

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const auth = event.requestContext.authorizer?.lambda;
  if (auth?.role !== 'EVALUATOR' && auth?.role !== 'ADMIN' && auth?.role !== 'SUPER_ADMIN') return forbidden('Evaluator role required');

  const userId = auth?.userId ?? '';
  const role = auth?.role ?? '';
  const isAdminRole = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    const prisma = await getPrismaClient();
    // GET /evaluator/reflections — list reflections assigned to this evaluator
    if (method === 'GET' && path === '/evaluator/reflections') {
      const all = await getAllReflections();
      const reflections = isAdminRole ? all : all.filter((r) => (r as any).evaluatorId === userId);

      // Enrich with module and course titles — batch to avoid N+1
      const uniqueModuleIds = [...new Set(reflections.map((r) => r.moduleId))];
      const modules = await prisma.module.findMany({
        where: { id: { in: uniqueModuleIds } },
        include: { course: { select: { id: true, title: true } } },
      });
      const moduleMap = new Map(modules.map((m) => [m.id, m]));

      const enriched = await Promise.all(
        reflections.map(async (r) => {
          const mod = moduleMap.get(r.moduleId);
          const studentName = await resolveStudentName(r.userId, (r as any).studentEmail);
          return {
            ...r,
            moduleTitle: mod?.title ?? 'Unknown',
            courseId: mod?.course.id ?? null,
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

      // Get module info and student lang in parallel
      const [module, studentLang] = await Promise.all([
        prisma.module.findUnique({ where: { id: moduleId }, include: { course: true } }),
        getUserLang(studentId),
      ]);

      const frontendUrl = process.env.FRONTEND_URL ?? '';
      const reflActionUrl = module?.course
        ? `${frontendUrl}/courses/${module.courseId}/modules/${moduleId}/reflection`
        : `${frontendUrl}/dashboard`;

      const notifStrings = studentLang === 'en'
        ? {
            approve: `Your reflection for "${module?.title}" was approved. Next module unlocked!`,
            reject: `Your reflection for "${module?.title}" needs revision.`,
          }
        : {
            approve: `Tu reflexión de "${module?.title}" fue aprobada. ¡Módulo siguiente desbloqueado!`,
            reject: `Tu reflexión de "${module?.title}" necesita revisión.`,
          };

      // Create in-app notification
      await createNotification({
        userId: studentId,
        notifId: createId(),
        type: action === 'APPROVE' ? 'REFLECTION_APPROVED' : 'REFLECTION_REJECTED',
        message: action === 'APPROVE' ? notifStrings.approve : notifStrings.reject,
        read: false,
        createdAt: reviewedAt,
        actionUrl: reflActionUrl,
      });

      // Auto-complete matching tasks on APPROVE (non-fatal)
      if (action === 'APPROVE') {
        autoCompleteTasks(studentId, 'submit_reflection', moduleId).catch(() => {});
      }

      // ── Fire-and-forget push notification to the student ─────────────────────
      void (async () => {
        try {
          if (!VAPID_PUBLIC_EV || !VAPID_PRIVATE_EV) return;
          const studentSubs = await getPushSubscriptionsByUserId(studentId);
          if (!studentSubs.length) return;
          const pushStrings = studentLang === 'en'
            ? {
                title: action === 'APPROVE' ? '✅ Reflection approved' : '✍️ Reflection needs revision',
                body: action === 'APPROVE'
                  ? `Your reflection for "${module?.title}" was approved. Next module unlocked!`
                  : `Your reflection for "${module?.title}" needs to be rewritten.`,
              }
            : {
                title: action === 'APPROVE' ? '✅ Reflexión aprobada' : '✍️ Reflexión necesita revisión',
                body: action === 'APPROVE'
                  ? `Tu reflexión de "${module?.title}" fue aprobada. ¡Siguiente módulo desbloqueado!`
                  : `Tu reflexión de "${module?.title}" necesita ser reescrita.`,
              };
          const pushPayload = JSON.stringify({ ...pushStrings, url: '/dashboard' });
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
                message: studentLang === 'en'
                  ? `🎓 Congratulations! You completed "${module.course.title}". Your certificate is available.`
                  : `🎓 ¡Felicitaciones! Completaste "${module.course.title}". Tu certificado está disponible.`,
                read: false,
                createdAt: reviewedAt,
                actionUrl: `/certificado/${certId}`,
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

      // ── Send SES email via shared template system ────────────────────────────
      try {
        const moduleTitle = module?.title ?? 'módulo';
        const { email: studentEmail, name: studentName } = await resolveStudentContact(studentId, reflection);
        if (studentEmail) {
          if (action === 'APPROVE') {
            await sendTemplatedEmail(studentEmail, 'REFLECTION_APPROVED', {
              studentName,
              moduleTitle,
              feedback,
              courseTitle: module?.course?.title ?? '',
              certId: certId ?? '',
              certUrl: certId ? `${process.env.FRONTEND_URL ?? ''}/certificado/${certId}` : '',
            }, studentLang);
          } else {
            await sendTemplatedEmail(studentEmail, 'REFLECTION_REJECTED', {
              studentName,
              moduleTitle,
              feedback,
            }, studentLang);
          }
        } else {
          console.warn(`[Evaluator] No email found for student ${studentId} — skipping email`);
        }
      } catch (emailErr) {
        console.warn('[Evaluator] Email send failed (non-fatal):', emailErr);
      }

      return ok({ status: newStatus, reviewedAt, certId });
    }

    // GET /evaluator/my-courses — courses owned by this evaluator
    if (method === 'GET' && path === '/evaluator/my-courses') {
      const rawLang = event.queryStringParameters?.lang ?? 'es';
      const lang = ['en', 'es'].includes(rawLang) ? rawLang : 'es';

      const courses = await prisma.course.findMany({
        where: { evaluatorId: userId },
        include: { modules: { select: { id: true, title: true, order: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const allEnrollments = await getAllEnrollments();
      const allReflections = await getAllReflections();

      let enriched: any[] = courses.map((course) => {
        const enrollmentCount = allEnrollments.filter((e) => e.courseId === course.id).length;
        const pendingReflections = allReflections.filter(
          (r) => r.status === 'PENDING_EVAL' && course.modules.some((m) => m.id === r.moduleId)
        ).length;
        return {
          ...course,
          enrollmentCount,
          pendingReflections,
          groupChatId: `group_${course.id}`,
        };
      });

      if (lang !== 'es' && enriched.length > 0) {
        const translations = await batchTranslate(
          enriched.map((c) => ({ type: 'course' as const, id: c.id, fields: { title: c.title, description: c.description } })),
          lang
        );
        enriched = enriched.map((c) => {
          const t = translations.get(`course#${c.id}`);
          return t ? { ...c, title: (t.title as string) ?? c.title, description: (t.description as string) ?? c.description } : c;
        });
      }

      return ok(enriched);
    }

    // GET /evaluator/students — full progress per student (filtered to this evaluator's courses)
    if (method === 'GET' && path === '/evaluator/students') {
      const courseIdFilter = event.queryStringParameters?.courseId ?? null;
      const [allProgress, allReflections, allAttempts, allEnrollments, courses, allLastSeen] = await Promise.all([
        getAllLessonProgress(),
        getAllReflections(),
        getAllQuizAttempts(),
        getAllEnrollments(),
        prisma.course.findMany({
          where: { ...(isAdminRole ? {} : { evaluatorId: userId }) },
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

      // Build lastSeen map — merge lesson completedAt + reflection submittedAt (fully paginated)
      // then override with heartbeat if more recent (heartbeat = actual browser activity)
      const lastSeenMap = new Map<string, string>();
      for (const p of allProgress) {
        if (!p.userId || !p.completedAt) continue;
        const prev = lastSeenMap.get(p.userId);
        if (!prev || p.completedAt > prev) lastSeenMap.set(p.userId, p.completedAt);
      }
      for (const r of allReflections) {
        if (!r.userId || !r.submittedAt) continue;
        const prev = lastSeenMap.get(r.userId);
        if (!prev || r.submittedAt > prev) lastSeenMap.set(r.userId, r.submittedAt);
      }
      for (const ls of allLastSeen) {
        if (!ls.userId || !ls.lastSeen) continue;
        const prev = lastSeenMap.get(ls.userId);
        if (!prev || ls.lastSeen > prev) lastSeenMap.set(ls.userId, ls.lastSeen);
      }
      const now = Date.now();
      const getPresenceStatus = (uid: string): 'online' | 'active' | 'inactive' | 'never_active' => {
        const ls = lastSeenMap.get(uid);
        if (!ls) return 'never_active'; // enrolled but zero recorded activity
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

      // Only consider enrollments in this evaluator's courses
      const myCourseIds = new Set(courses.map((c) => c.id));
      const myEnrollments = allEnrollments.filter((e) => myCourseIds.has(e.courseId));

      // Seed all enrolled students so they appear even with 0 activity
      myEnrollments.forEach((e) => getOrCreate(e.userId));

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

      // Build enrollment map: userId -> Set<courseId> (only this evaluator's courses)
      const enrollmentMap = new Map<string, Set<string>>();
      myEnrollments.forEach((e) => {
        if (!enrollmentMap.has(e.userId)) enrollmentMap.set(e.userId, new Set());
        enrollmentMap.get(e.userId)!.add(e.courseId);
      });

      const students = await Promise.all(Array.from(byStudent.values()).map(async (s) => {
        const cognitoUser = await getCognitoUser(s.userId);
        const studentName = cognitoUser?.name || 'Sin nombre';
        const studentEmail = cognitoUser?.email ?? null;
        const enabled = cognitoUser?.enabled ?? true;
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
        const presenceStatus = enabled === false ? 'disabled' : getPresenceStatus(s.userId);
        return { userId: s.userId, studentName, studentEmail, courses: courseStats, lastSeen, presenceStatus, enabled };
      }));

      // Filter out non-STUDENT users (evaluators, admins who may have enrollments/heartbeats) —
      // role lives in Cognito Groups, not a custom attribute, so list group members directly.
      const listAllInGroup = async (GroupName: string) => {
        const all: NonNullable<Awaited<ReturnType<typeof cognito.send>>['Users']>[number][] = [];
        let token: string | undefined;
        do {
          const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName, Limit: 60, NextToken: token }));
          all.push(...(res.Users ?? []));
          token = res.NextToken;
        } while (token);
        return all;
      };
      const [evaluatorUsers, adminUsers] = await Promise.all([
        listAllInGroup('EVALUATOR'),
        listAllInGroup('ADMIN'),
      ]);
      const nonStudentUsernames = new Set([...evaluatorUsers, ...adminUsers].map((u) => u.Username));
      const studentsOnly = students.filter((s) => !nonStudentUsernames.has(s.userId));

      // Sort: online → active → inactive → never_active → disabled
      const statusOrder = { online: 0, active: 1, inactive: 2, never_active: 3, disabled: 4 };
      studentsOnly.sort((a, b) => {
        const sA = statusOrder[a.presenceStatus as keyof typeof statusOrder] ?? 2;
        const sB = statusOrder[b.presenceStatus as keyof typeof statusOrder] ?? 2;
        if (sA !== sB) return sA - sB;
        const pA = a.courses.reduce((sum, c) => sum + c.progressPct, 0);
        const pB = b.courses.reduce((sum, c) => sum + c.progressPct, 0);
        return pB - pA;
      });

      let tasksByCourse: Record<string, { pending: number; overdue: number; completed: number }> = {};
      if (courseIdFilter) {
        const tasks = await getTasksByCourse(courseIdFilter);
        for (const task of tasks) {
          if (!tasksByCourse[task.userId]) tasksByCourse[task.userId] = { pending: 0, overdue: 0, completed: 0 };
          if (task.status === 'PENDING' || task.status === 'SUBMITTED') tasksByCourse[task.userId]!.pending++;
          else if (task.status === 'OVERDUE') tasksByCourse[task.userId]!.overdue++;
          else if (task.status === 'COMPLETED') tasksByCourse[task.userId]!.completed++;
        }
      }

      // Fetch last reminder info for all students in parallel
      const reminderData = await Promise.all(
        studentsOnly.map((s) => Promise.all([
          getLastManualReminder(s.userId).catch(() => null),
          getInactivityReminder(s.userId).catch(() => ({ count: 0, lastSent: null })),
        ]))
      );

      return ok({
        students: studentsOnly.map((s, i) => ({
          ...s,
          taskCounts: tasksByCourse[s.userId] ?? null,
          lastManualReminder: reminderData[i]![0],
          lastAutoReminder: reminderData[i]![1]?.lastSent ? reminderData[i]![1] : null,
        })),
        courses: courses.map((c) => ({ id: c.id, title: c.title })),
      });
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
      <a href="${process.env.FRONTEND_URL ?? 'https://luxlearning.academy'}/dashboard"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:16px;">
        Continuar aprendiendo
      </a>
    </div>
  </div>
</body>
</html>`;

      let emailSent = true;
      try {
        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [studentEmail] },
          Message: {
            Subject: { Data: '¡Te echamos de menos en Lux Learning!', Charset: 'UTF-8' },
            Body: { Html: { Data: reminderHtml, Charset: 'UTF-8' } },
          },
        }));
      } catch (sesErr: any) {
        // SES sandbox: unverified destination — non-fatal, still persist the reminder
        console.warn('[Reminder] SES send failed (non-fatal):', sesErr?.message ?? sesErr);
        emailSent = false;
      }

      // Always persist — the reminder was sent regardless of SES sandbox limitations
      await setManualReminder(userId, auth?.email ?? userId, courseTitle).catch((err: any) => {
        console.error('[Reminder] setManualReminder failed:', err?.message ?? err);
      });

      return ok({ sent: emailSent });
    }

    // GET /evaluator/students/:userId/reminders — full reminder history (manual + auto)
    const remindersMatch = path.match(/^\/evaluator\/students\/([^/]+)\/reminders$/);
    if (method === 'GET' && remindersMatch) {
      const targetUserId = decodeURIComponent(remindersMatch[1]);
      const [manualEntries, autoReminder] = await Promise.all([
        getManualReminderHistory(targetUserId),
        getInactivityReminder(targetUserId),
      ]);
      const combined = [
        ...manualEntries,
        ...(autoReminder.lastSent ? [{ sentAt: autoReminder.lastSent, sentBy: 'SISTEMA', type: 'auto' as const, count: autoReminder.count }] : []),
      ].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
      return ok(combined);
    }

    // POST /evaluator/reflections/reconsider — override AI rejection, approve with reason
    if (method === 'POST' && path === '/evaluator/reflections/reconsider') {
      const body = JSON.parse(event.body ?? '{}');
      const { userId: studentId, moduleId, reason } = body as { userId: string; moduleId: string; reason: string };
      if (!studentId || !moduleId || !reason) return badRequest('userId, moduleId, reason required');
      if (reason.length < 20) return badRequest('La razón debe tener al menos 20 caracteres');

      const reflection = await getReflection(studentId, moduleId);
      if (!reflection) return notFound('Reflexión no encontrada');
      if (reflection.status !== 'REJECTED') return badRequest('Solo se pueden reconsiderar reflexiones rechazadas');

      const reviewedAt = new Date().toISOString();
      await updateReflectionStatus(studentId, moduleId, {
        status: 'APPROVED',
        reviewedAt,
        reconsideredBy: userId,
        reconsiderationReason: reason,
      });

      const reconsiderStudentLang = await getUserLang(studentId);

      // Notify student
      await createNotification({
        userId: studentId,
        notifId: createId(),
        type: 'REFLECTION_RECONSIDERED',
        message: reconsiderStudentLang === 'en'
          ? 'Your reflection was reconsidered and approved by an evaluator.'
          : 'Tu reflexión fue reconsiderada y aprobada por un evaluador.',
        read: false,
        createdAt: reviewedAt,
        actionUrl: '/student/reflections',
      });

      // Check if all modules approved → generate certificate
      let certId: string | null = null;
      try {
        const module = await prisma.module.findUnique({ where: { id: moduleId }, include: { course: true } });
        if (module?.course) {
          const allModules = await prisma.module.findMany({ where: { courseId: module.courseId }, select: { id: true } });
          const allReflections = await Promise.all(allModules.map((m) => getReflection(studentId, m.id)));
          const allApproved = allReflections.every((r) => r?.status === 'APPROVED');
          if (allApproved) {
            const existing = await getCertificateByUserAndCourse(studentId, module.courseId);
            if (!existing) {
              certId = createId();
              const { name: studentName } = await resolveStudentContact(studentId, reflection);
              await saveCertificate({ certId, userId: studentId, courseId: module.courseId, studentName, courseTitle: module.course.title, issuedAt: reviewedAt });
              await createNotification({
                userId: studentId, notifId: createId(), type: 'GENERAL',
                message: reconsiderStudentLang === 'en'
                  ? `🎓 Congratulations! You completed "${module.course.title}". Your certificate is available.`
                  : `🎓 ¡Felicitaciones! Completaste "${module.course.title}". Tu certificado está disponible.`,
                read: false, createdAt: reviewedAt, actionUrl: `/certificado/${certId}`,
              });
            } else {
              certId = existing.certId;
            }
          }
          // Send email
          try {
            const { email: studentEmail, name: studentName } = await resolveStudentContact(studentId, reflection);
            if (studentEmail) {
              await sendTemplatedEmail(studentEmail, 'REFLECTION_RECONSIDERED', {
                studentName,
                moduleTitle: module.title,
                reason,
                certId: certId ?? '',
                certUrl: certId ? `${process.env.FRONTEND_URL ?? ''}/certificado/${certId}` : '',
              }, reconsiderStudentLang);
            }
          } catch { /* non-fatal */ }
        }
      } catch (e) {
        console.warn('[Evaluator] Reconsider post-processing failed (non-fatal):', e);
      }

      return ok({ status: 'APPROVED', reviewedAt, certId });
    }

    // POST /evaluator/reflections/priority — toggle priority flag
    if (method === 'POST' && path === '/evaluator/reflections/priority') {
      const body2 = JSON.parse(event.body ?? '{}');
      const { userId: studentId, moduleId, priority } = body2 as { userId: string; moduleId: string; priority: boolean };
      if (!studentId || !moduleId || priority == null) return badRequest('userId, moduleId, priority required');
      await setReflectionPriority(studentId, moduleId, priority);
      return ok({ priority });
    }

    // POST /evaluator/ai-feedback — generate full feedback paragraph via Bedrock
    if (method === 'POST' && path === '/evaluator/ai-feedback') {
      const body = JSON.parse(event.body ?? '{}');
      const { text, moduleTitle } = body as { text: string; moduleTitle?: string };
      if (!text) return badRequest('text is required');

      const prompt = `Eres un evaluador pedagógico experto en desarrollo personal y aprendizaje significativo. Has revisado la reflexión de un estudiante del módulo "${moduleTitle ?? 'del curso'}".

REFLEXIÓN DEL ESTUDIANTE:
"""
${text.slice(0, 4000)}
"""

Genera un feedback evaluativo COMPLETO, listo para enviar directamente al estudiante sin edición adicional. El feedback debe:

ESTRUCTURA (4 párrafos, mínimo 300 palabras en total):
1. **Reconocimiento**: Abre con el nombre implícito del contexto. Señala 2-3 fortalezas específicas que observas en el texto, citando frases o ideas concretas de la reflexión.
2. **Análisis profundo**: Evalúa la profundidad del aprendizaje — ¿el estudiante conectó el contenido con su experiencia real? ¿demostró pensamiento crítico? ¿identificó implicaciones prácticas? Sé específico con el contenido de la reflexión.
3. **Áreas de crecimiento**: Con tono constructivo (nunca crítico ni condescendiente), señala 1-2 aspectos donde el estudiante puede profundizar. Sugiere preguntas concretas que el estudiante debería reflexionar para mejorar.
4. **Cierre motivador**: Concluye con un reconocimiento del esfuerzo y una orientación hacia los próximos pasos de aprendizaje. Conecta con el módulo o el curso en general.

TONO Y ESTILO:
- Profesional, cálido, personalizado — nunca genérico ni robótico
- Usa segunda persona ("tu reflexión muestra...", "has demostrado...")
- En español, sin tecnicismos innecesarios
- Mínimo 300 palabras, máximo 500 palabras

Responde ÚNICAMENTE con un objeto JSON (sin markdown, sin texto extra):
{"feedback": "Párrafo 1...\\n\\nPárrafo 2...\\n\\nPárrafo 3...\\n\\nPárrafo 4..."}`;

      try {
        const response = await bedrock.send(new InvokeModelCommand({
          modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1500,
            messages: [{ role: 'user', content: prompt }],
          }),
        }));

        const raw = JSON.parse(new TextDecoder().decode(response.body));
        const content = raw.content?.[0]?.text ?? '';
        const clean = content.replace(/```json\s*|```/g, '').trim();
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return serverError('AI response format error');
        let parsed: any;
        try { parsed = JSON.parse(jsonMatch[0]); }
        catch { try { parsed = JSON.parse(jsonrepair(jsonMatch[0])); } catch { return serverError('AI response format error'); } }
        return ok({ feedback: parsed.feedback ?? '' });
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
        getPrismaClient().then((p) => p.module.findUnique({
          where: { id: moduleId },
          include: { questions: { orderBy: { order: 'asc' } } },
        })),
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
      try {
        const body = JSON.parse(event.body ?? '{}');
        const { title, description, type = 'custom', dueDate, courseId, moduleId, courseTitle, moduleTitle, assignTo, userId: targetUserId, targetCourseId } = body as any;
        if (!title || !dueDate) return badRequest('title y dueDate son requeridos');

        const assignerUserId = event.requestContext.authorizer?.lambda?.userId ?? 'system';
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

        if (!assignees.length) return badRequest('No se encontraron destinatarios para asignar la tarea');

        // Each task gets a unique taskId from cuid2 — no Scan-based dedup needed
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

        // Push + email notifications (non-fatal)
        Promise.allSettled(
          assignees.map(async (uid) => {
            const [subs] = await Promise.all([getPushSubscriptionsByUserId(uid)]);
            await Promise.allSettled(
              subs.map((sub: any) =>
                webpush.sendNotification(sub, JSON.stringify({
                  title: '📋 Nueva tarea asignada',
                  body: `${title} — Vence: ${dueDate}`,
                }))
              )
            );
            try {
              const { email: studentEmail, name: studentName } = await resolveStudentContact(uid, {});
              if (studentEmail) {
                await sendTemplatedEmail(studentEmail, 'TASK_ASSIGNED', {
                  studentName,
                  taskTitle: title,
                  courseTitle: courseTitle ?? '',
                  dueDate,
                });
              }
            } catch { /* non-fatal */ }
          })
        ).catch(() => {});

        return ok({ created: tasks.length });
      } catch (e: any) {
        console.error('[tasks/create] Error:', e?.message, e?.code, e?.name);
        return serverError(e?.message ?? 'Error al crear tarea');
      }
    }

    // GET /evaluator/tasks — list all tasks assigned by this evaluator
    if (path === '/evaluator/tasks' && method === 'GET') {
      const assignerUserId = event.requestContext.authorizer?.lambda?.userId!;
      // Paginate through full Scan to avoid silent data loss after 1MB
      let lastKey: Record<string, any> | undefined;
      const allItems: any[] = [];
      do {
        const page = await ddb.send(new ScanCommand({
          TableName: TABLES.TASKS,
          FilterExpression: 'assignedBy = :aid',
          ExpressionAttributeValues: { ':aid': assignerUserId },
          ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(page.Items ?? []));
        lastKey = page.LastEvaluatedKey;
      } while (lastKey);
      const tasks = allItems.sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate));
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
      // dueDate is part of the DynamoDB SK — changing it requires delete + recreate
      if (dueDate && dueDate !== task.dueDate) {
        await deleteTask(targetUserId, task.sk);
        await createTask({
          userId: targetUserId,
          taskId: task.taskId,
          title: title ?? task.title,
          description: description ?? task.description,
          type: task.type,
          dueDate,
          courseId: task.courseId,
          moduleId: task.moduleId,
          courseTitle: task.courseTitle,
          moduleTitle: task.moduleTitle,
          assignedBy: task.assignedBy,
          status: task.status,
          createdAt: task.createdAt,
        });
      } else {
        const updates: any = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (Object.keys(updates).length) await updateTask(targetUserId, task.sk, updates);
      }
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
      const userId = event.requestContext.authorizer?.lambda?.userId!;
      const signature = await getSignature(userId);
      return ok({ signature });
    }

    // PUT /evaluator/signature — guardar firma digital del evaluador
    if (method === 'PUT' && path === '/evaluator/signature') {
      const userId = event.requestContext.authorizer?.lambda?.userId!;
      const body = JSON.parse(event.body ?? '{}');
      const { signature } = body as { signature?: string };
      if (!signature) return badRequest('signature es requerido');
      await saveSignature(userId, signature);
      return ok({ ok: true });
    }

    // GET /evaluator/students/:userId/certificates
    const studentCertsMatch = path.match(/^\/evaluator\/students\/([^/]+)\/certificates$/);
    if (studentCertsMatch && method === 'GET') {
      const targetUserId = studentCertsMatch[1]!;
      const certs = await getCertificatesByUser(targetUserId);
      return ok(certs);
    }

    // ── Resources (Mis Recursos) ─────────────────────────────────────────────
    // GET /evaluator/resources — list evaluator's own resources
    if (method === 'GET' && path === '/evaluator/resources') {
      const resources = await getResourcesByEvaluator(userId);
      return ok(resources);
    }

    // POST /evaluator/resources — create a new resource
    if (method === 'POST' && path === '/evaluator/resources') {
      const body = JSON.parse(event.body ?? '{}');
      const { title, description, fileUrl, fileName, fileType, fileSize, folder, courseIds } = body as any;
      if (!title || !fileUrl || !fileName) return badRequest('title, fileUrl y fileName son requeridos');
      const now = new Date().toISOString();
      const resource = {
        evaluatorId: userId,
        resourceId: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: String(title).slice(0, 200),
        description: description ? String(description).slice(0, 500) : undefined,
        fileUrl: String(fileUrl),
        fileName: String(fileName),
        fileType: String(fileType ?? 'application/octet-stream'),
        fileSize: fileSize ? Number(fileSize) : undefined,
        folder: folder ? String(folder).slice(0, 100) : undefined,
        courseIds: Array.isArray(courseIds) ? courseIds : [],
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      await saveResource(resource);
      return ok(resource);
    }

    // PUT /evaluator/resources/:resourceId — update resource (rename, folder, assign courses)
    const resourceUpdateMatch = path.match(/^\/evaluator\/resources\/([^/]+)$/);
    if (resourceUpdateMatch && method === 'PUT') {
      const resourceId = resourceUpdateMatch[1]!;
      const body = JSON.parse(event.body ?? '{}');
      const { title, description, folder, courseIds } = body as any;
      await updateResource(userId, resourceId, {
        ...(title !== undefined ? { title: String(title).slice(0, 200) } : {}),
        ...(description !== undefined ? { description: String(description).slice(0, 500) } : {}),
        ...(folder !== undefined ? { folder: folder ? String(folder).slice(0, 100) : undefined } : {}),
        ...(courseIds !== undefined ? { courseIds: Array.isArray(courseIds) ? courseIds : [] } : {}),
        updatedAt: new Date().toISOString(),
      });
      return ok({ updated: true });
    }

    // DELETE /evaluator/resources/:resourceId — soft delete (60-day TTL)
    if (resourceUpdateMatch && method === 'DELETE') {
      const resourceId = resourceUpdateMatch[1]!;
      const ttl = Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60; // 60 days
      await updateResource(userId, resourceId, { archived: true, ttl, updatedAt: new Date().toISOString() });
      return ok({ archived: true });
    }

    // POST /evaluator/resources/:resourceId/restore — restore from trash
    const resourceRestoreMatch = path.match(/^\/evaluator\/resources\/([^/]+)\/restore$/);
    if (resourceRestoreMatch && method === 'POST') {
      const resourceId = resourceRestoreMatch[1]!;
      await updateResource(userId, resourceId, { archived: false, ttl: undefined, updatedAt: new Date().toISOString() });
      return ok({ restored: true });
    }

    // GET /evaluator/courses/:courseId/resources — resources assigned to a course (evaluator view)
    const courseResourcesEvalMatch = path.match(/^\/evaluator\/courses\/([^/]+)\/resources$/);
    if (courseResourcesEvalMatch && method === 'GET') {
      const courseId = courseResourcesEvalMatch[1]!;
      const resources = await getResourcesByCourse(courseId);
      return ok(resources);
    }

    // POST /evaluator/translate — translate evaluator feedback text using Bedrock
    if (method === 'POST' && path === '/evaluator/translate') {
      const body = JSON.parse(event.body ?? '{}');
      const { text, targetLang } = body as { text?: string; targetLang?: string };
      if (!text?.trim()) return badRequest('text is required');
      const validLangs: Record<string, string> = {
        es: 'español',
        en: 'English',
        pt: 'português',
        fr: 'français',
      };
      const targetLabel = validLangs[targetLang ?? ''];
      if (!targetLabel) return badRequest('targetLang must be es, en, pt, or fr');

      const translatePrompt = `Translate the following educational feedback text to ${targetLabel}.
Preserve the tone, formality, and educational context.
Return ONLY the translated text, no explanations or extra content.

Text to translate:
${text.trim()}`;

      const translateResponse = await bedrock.send(new InvokeModelCommand({
        modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 2048,
          messages: [{ role: 'user', content: translatePrompt }],
        }),
      }));

      const translateRaw = JSON.parse(new TextDecoder().decode(translateResponse.body));
      const translatedText = translateRaw.content?.[0]?.text?.trim() ?? '';
      if (!translatedText) return serverError('Translation returned empty result');
      return ok({ translatedText });
    }

    // ─── Calendar Events ───────────────────────────────────────────────────────

    // GET /evaluator/calendar/events
    if (method === 'GET' && path === '/evaluator/calendar/events') {
      const calEvents = await getAllVisibleCalendarEvents(userId, role);
      return ok(calEvents);
    }

    // POST /evaluator/calendar/events
    if (method === 'POST' && path === '/evaluator/calendar/events') {
      const body = JSON.parse(event.body ?? '{}');
      const {
        title, description, type, startDate, endDate, allDay,
        visibility, color, location, targetCourseId, targetStudentIds, targetEvaluatorIds,
        recurrence, recurrenceDays, recurrenceEndDate,
      } = body as {
        title?: string; description?: string;
        type?: 'class' | 'meeting' | 'event' | 'deadline' | 'reminder' | 'other';
        startDate?: string; endDate?: string; allDay?: boolean;
        visibility?: 'private' | 'evaluators' | 'students' | 'community' | 'course_mine' | 'course_all';
        color?: string; location?: string; targetCourseId?: string; targetStudentIds?: string[]; targetEvaluatorIds?: string[];
        recurrence?: 'none' | 'weekly' | 'monthly' | 'weekdays' | 'custom_days';
        recurrenceDays?: number[];
        recurrenceEndDate?: string;
      };
      if (!title || !startDate || !endDate) return badRequest('title, startDate y endDate son requeridos');

      const effectiveRecurrence = recurrence ?? 'none';
      const baseId = createId();
      const recurrenceGroupId = effectiveRecurrence !== 'none' ? baseId : undefined;

      const buildCalEvent = (start: string, end: string, eid: string) => ({
        creatorId: userId,
        eventId: eid,
        title: title.trim(),
        ...(description ? { description: description.trim() } : {}),
        type: type ?? 'event',
        startDate: start,
        endDate: end,
        allDay: allDay ?? false,
        visibility: visibility ?? 'private',
        ...(color ? { color } : {}),
        ...(location ? { location: location.trim() } : {}),
        ...(targetCourseId ? { targetCourseId } : {}),
        ...(targetStudentIds && targetStudentIds.length > 0 ? { targetStudentIds } : {}),
        ...(targetEvaluatorIds && targetEvaluatorIds.length > 0 ? { targetEvaluatorIds } : {}),
        creatorRole: role,
        createdAt: new Date().toISOString(),
        ...(effectiveRecurrence !== 'none' ? { recurrence: effectiveRecurrence } : {}),
        ...(recurrenceDays ? { recurrenceDays } : {}),
        ...(recurrenceEndDate ? { recurrenceEndDate } : {}),
        ...(recurrenceGroupId ? { recurrenceGroupId } : {}),
      });

      // Generate occurrences for recurring events
      const calEvents: ReturnType<typeof buildCalEvent>[] = [];
      if (effectiveRecurrence === 'none') {
        calEvents.push(buildCalEvent(startDate, endDate, baseId));
      } else {
        const startMs = new Date(startDate).getTime();
        const durationMs = new Date(endDate).getTime() - startMs;
        // Add 23h59m so events on the recurrenceEndDate day are included
        const limitDate = recurrenceEndDate
          ? new Date(recurrenceEndDate).getTime() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000
          : startMs + 180 * 24 * 60 * 60 * 1000; // default 6 months
        const MAX_OCCURRENCES = 52;
        let cursor = new Date(startDate);
        let count = 0;

        if (effectiveRecurrence === 'weekly') {
          while (cursor.getTime() <= limitDate && count < MAX_OCCURRENCES) {
            const ocStart = cursor.toISOString();
            const ocEnd = new Date(cursor.getTime() + durationMs).toISOString();
            calEvents.push(buildCalEvent(ocStart, ocEnd, count === 0 ? baseId : createId()));
            count++;
            cursor.setDate(cursor.getDate() + 7);
          }
        } else if (effectiveRecurrence === 'monthly') {
          while (cursor.getTime() <= limitDate && count < MAX_OCCURRENCES) {
            const ocStart = cursor.toISOString();
            const ocEnd = new Date(cursor.getTime() + durationMs).toISOString();
            calEvents.push(buildCalEvent(ocStart, ocEnd, count === 0 ? baseId : createId()));
            count++;
            cursor.setMonth(cursor.getMonth() + 1);
          }
        } else {
          // weekdays or custom_days — advance daily, filter by day-of-week
          while (cursor.getTime() <= limitDate && count < MAX_OCCURRENCES) {
            const day = cursor.getDay();
            const include = effectiveRecurrence === 'weekdays'
              ? day >= 1 && day <= 5
              : (recurrenceDays ?? []).includes(day);
            if (include) {
              const ocStart = cursor.toISOString();
              const ocEnd = new Date(cursor.getTime() + durationMs).toISOString();
              calEvents.push(buildCalEvent(ocStart, ocEnd, count === 0 ? baseId : createId()));
              count++;
            }
            cursor.setDate(cursor.getDate() + 1);
          }
        }
      }

      if (calEvents.length === 1) {
        await createCalendarEvent(calEvents[0] as any);
      } else {
        await batchCreateCalendarEvents(calEvents as any);
      }

      // Send notification emails fire-and-forget (non-blocking)
      if (visibility && visibility !== 'private') {
        sendCalendarEventEmails(calEvents[0] as any, 'created', cognito, ses, USER_POOL_ID, FROM_EMAIL).catch(() => {});
      }

      return ok({ events: calEvents, count: calEvents.length });
    }

    // PUT /evaluator/calendar/events/:eventId
    const calEditMatch = path.match(/^\/evaluator\/calendar\/events\/([^/]+)$/);
    if (method === 'PUT' && calEditMatch) {
      const body = JSON.parse(event.body ?? '{}');
      const eventId = calEditMatch[1]!;
      const existing = await getCalendarEventById(userId, eventId);
      const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
      if (!existing) {
        if (!isAdmin) return notFound('Evento no encontrado');
        const { creatorId: bodyCreatorId } = body as { creatorId?: string };
        if (!bodyCreatorId) return badRequest('creatorId requerido para admin');
        const adminExisting = await getCalendarEventById(bodyCreatorId, eventId);
        if (!adminExisting) return notFound('Evento no encontrado');
        const { creatorId: _c, eventId: _e, createdAt: _t, ...rest } = body as any;
        await updateCalendarEvent(bodyCreatorId, eventId, rest);
        if (rest.visibility && rest.visibility !== 'private') {
          sendCalendarEventEmails({ ...adminExisting, ...rest }, 'updated', cognito, ses, USER_POOL_ID, FROM_EMAIL).catch(() => {});
        }
        return ok({ updated: true });
      }
      const { creatorId: _c, eventId: _e, createdAt: _t, ...updates } = body as any;
      await updateCalendarEvent(userId, eventId, updates);
      if (updates.visibility && updates.visibility !== 'private') {
        sendCalendarEventEmails({ ...existing, ...updates }, 'updated', cognito, ses, USER_POOL_ID, FROM_EMAIL).catch(() => {});
      }
      return ok({ updated: true });
    }

    // DELETE /evaluator/calendar/events/:eventId
    const calDeleteMatch = path.match(/^\/evaluator\/calendar\/events\/([^/]+)$/);
    if (method === 'DELETE' && calDeleteMatch) {
      const body = JSON.parse(event.body ?? '{}');
      const eventId = calDeleteMatch[1]!;
      const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
      const existing = await getCalendarEventById(userId, eventId);
      if (!existing) {
        if (!isAdmin) return notFound('Evento no encontrado');
        const { creatorId: bodyCreatorId } = body as { creatorId?: string };
        if (!bodyCreatorId) return badRequest('creatorId requerido para admin');
        await deleteCalendarEvent(bodyCreatorId, eventId);
        return ok({ deleted: true });
      }
      await deleteCalendarEvent(userId, eventId);
      return ok({ deleted: true });
    }

    // ── Student Groups (evaluator view) ────────────────────────────────────────
    // GET /evaluator/groups — grupos asignados + propios del evaluador
    if (method === 'GET' && path === '/evaluator/groups') {
      const [assigned, own] = await Promise.all([
        prisma.studentGroupEvaluator.findMany({
          where: { evaluatorId: userId },
          include: { group: { include: { _count: { select: { members: true } } } } },
          orderBy: { assignedAt: 'asc' },
        }),
        prisma.studentGroup.findMany({
          where: { createdByEvaluatorId: userId },
          include: { _count: { select: { members: true } } },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      const assignedIds = new Set(assigned.map((a) => a.groupId));
      const assignedGroups = assigned.map((a) => ({ ...a.group, memberCount: a.group._count.members, source: 'admin' }));
      const ownGroups = own.filter((g) => !assignedIds.has(g.id)).map((g) => ({ ...g, memberCount: g._count.members, source: 'own' }));
      return ok([...assignedGroups, ...ownGroups]);
    }

    // POST /evaluator/groups — crear grupo propio
    if (method === 'POST' && path === '/evaluator/groups') {
      const { name, description, color } = JSON.parse(event.body ?? '{}') as { name?: string; description?: string; color?: string };
      if (!name?.trim()) return badRequest('name es requerido');
      const group = await prisma.studentGroup.create({
        data: { name: name.trim(), description: description?.trim(), color: color ?? '#17527E', createdByEvaluatorId: userId },
      });
      return ok(group);
    }

    // GET /evaluator/students/pool — estudiantes de los cursos del evaluador (para agregar al grupo)
    if (method === 'GET' && path === '/evaluator/students/pool') {
      let studentIds: string[];
      if (isAdminRole) {
        // Admin: all enrolled students
        const enrollments = await getAllEnrollments().catch(() => [] as any[]);
        studentIds = [...new Set(enrollments.map((e: any) => e.userId as string))];
      } else {
        const myCourses = await prisma.course.findMany({ where: { evaluatorId: userId }, select: { id: true } });
        const courseIds = myCourses.map((c) => c.id);
        if (courseIds.length === 0) return ok([]);
        const enrollments = await getAllEnrollments().catch(() => [] as any[]);
        studentIds = [...new Set(
          enrollments.filter((e: any) => courseIds.includes(e.courseId)).map((e: any) => e.userId as string)
        )];
      }
      const enriched = await Promise.all(studentIds.map(async (uid) => {
        const cogUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: uid })).catch(() => null);
        const attrs = cogUser?.UserAttributes ?? [];
        const getAttr = (n: string) => attrs.find((a: any) => a.Name === n)?.Value ?? '';
        return { userId: uid, name: getAttr('name') || getAttr('email'), email: getAttr('email') };
      }));
      return ok(enriched);
    }

    // GET /evaluator/evaluators — lista de evaluadores (para selector de destinatarios en calendario)
    if (method === 'GET' && path === '/evaluator/evaluators') {
      const listGroup = async (groupName: string): Promise<{ userId: string; name: string; email: string }[]> => {
        const users: { userId: string; name: string; email: string }[] = [];
        let nextToken: string | undefined;
        do {
          const res = await cognito.send(new ListUsersInGroupCommand({
            UserPoolId: USER_POOL_ID, GroupName: groupName, Limit: 60,
            ...(nextToken ? { NextToken: nextToken } : {}),
          }));
          for (const u of res.Users ?? []) {
            const getAttr = (n: string) => u.Attributes?.find((a) => a.Name === n)?.Value ?? '';
            users.push({ userId: u.Username!, name: getAttr('name') || getAttr('email'), email: getAttr('email') });
          }
          nextToken = res.NextToken;
        } while (nextToken);
        return users;
      };
      const evaluators = await listGroup('EVALUATOR').catch(() => [] as { userId: string; name: string; email: string }[]);
      return ok(evaluators.filter((e) => e.userId !== userId));
    }

    // GET /evaluator/groups/:id/members — estudiantes de un grupo asignado
    const evalGroupMembersMatch = path.match(/^\/evaluator\/groups\/([^/]+)\/members$/);
    if (evalGroupMembersMatch && method === 'GET') {
      const groupId = evalGroupMembersMatch[1]!;
      // Verify evaluator has access to this group
      const access = await prisma.studentGroupEvaluator.findUnique({
        where: { groupId_evaluatorId: { groupId, evaluatorId: userId } },
      });
      if (!access && !isAdminRole) return forbidden('No tienes acceso a este grupo');
      const members = await prisma.studentGroupMember.findMany({ where: { groupId }, orderBy: { addedAt: 'asc' } });
      const enriched = await Promise.all(members.map(async (m) => {
        const cogUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: m.userId })).catch(() => null);
        const attrs = cogUser?.UserAttributes ?? [];
        const getAttr = (n: string) => attrs.find((a) => a.Name === n)?.Value ?? '';
        const enrolledCourseIds = await getEnrollments(m.userId).catch(() => [] as string[]);
        return { ...m, email: getAttr('email'), name: getAttr('name') || getAttr('email'), enrolledCourseIds };
      }));
      return ok(enriched);
    }

    // POST /evaluator/groups/:id/enroll — inscribir estudiantes del grupo a un curso
    const evalGroupEnrollMatch = path.match(/^\/evaluator\/groups\/([^/]+)\/enroll$/);
    if (evalGroupEnrollMatch && method === 'POST') {
      const groupId = evalGroupEnrollMatch[1]!;
      const access = await prisma.studentGroupEvaluator.findUnique({
        where: { groupId_evaluatorId: { groupId, evaluatorId: userId } },
      });
      if (!access && !isAdminRole) return forbidden('No tienes acceso a este grupo');
      const { userIds, courseId } = JSON.parse(event.body ?? '{}') as { userIds?: string[]; courseId?: string };
      if (!userIds?.length || !courseId) return badRequest('userIds y courseId son requeridos');

      const course = await prisma.course.findUnique({ where: { id: courseId }, include: { modules: { include: { lessons: true } } } });
      if (!course) return notFound('Curso no encontrado');

      await Promise.allSettled(userIds.map(async (uid) => {
        // 1. Create DynamoDB enrollment
        await createEnrollment(uid, courseId);

        // 2. Email welcome (best-effort)
        try {
          const cogUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: uid }));
          const attrs = cogUser.UserAttributes ?? [];
          const studentEmail = attrs.find((a) => a.Name === 'email')?.Value;
          const studentName  = attrs.find((a) => a.Name === 'name')?.Value ?? studentEmail ?? uid;
          if (studentEmail) {
            await sendTemplatedEmail(studentEmail, 'ENROLLMENT', { studentName, courseTitle: course.title });
          }
        } catch { /* non-fatal */ }

        // 3. Group chat membership
        try {
          const chatId = `group_${courseId}`;
          await upsertChat(chatId, { type: 'group', name: course.title, participants: [uid] });
          await upsertMembership(uid, chatId, { role: 'member', name: uid });
        } catch { /* non-fatal */ }

        // 4. Auto-tasks per module
        try {
          const enrollDate = new Date();
          await Promise.all(course.modules.map((mod) => {
            const due = new Date(enrollDate);
            due.setDate(due.getDate() + 7 * mod.order);
            return createTask({
              userId: uid,
              taskId: `${uid}-${mod.id}-complete`,
              title: `Completar módulo: ${mod.title}`,
              description: `Completa las lecciones, quiz y reflexión del módulo "${mod.title}" del curso "${course.title}".`,
              dueDate: due.toISOString(),
              type: 'complete_module',
              courseId,
              moduleId: mod.id,
              assignedBy: 'system',
              status: 'pending',
              createdAt: new Date().toISOString(),
            });
          }));
        } catch { /* non-fatal */ }

        // 5. Track enrollment in StudentGroupMember (deduplicate)
        const member = await prisma.studentGroupMember.findUnique({
          where: { groupId_userId: { groupId, userId: uid } },
        }).catch(() => null);
        if (member && !member.enrolledCourseIds.includes(courseId)) {
          await prisma.studentGroupMember.update({
            where: { groupId_userId: { groupId, userId: uid } },
            data: { enrolledCourseIds: { push: courseId } },
          }).catch(() => {});
        }
      }));

      return ok({ enrolled: userIds.length, courseId });
    }

    // PUT /evaluator/groups/:id — editar grupo propio
    const evalGroupBaseMatch = path.match(/^\/evaluator\/groups\/([^/]+)$/);
    if (evalGroupBaseMatch && method === 'PUT') {
      const groupId = evalGroupBaseMatch[1]!;
      const group = await prisma.studentGroup.findUnique({ where: { id: groupId } });
      if (!group) return notFound('Grupo no encontrado');
      if (group.createdByEvaluatorId !== userId && !isAdminRole) return forbidden('Solo puedes editar tus propios grupos');
      const { name, description, color } = JSON.parse(event.body ?? '{}') as { name?: string; description?: string; color?: string };
      if (!name?.trim()) return badRequest('name es requerido');
      const updated = await prisma.studentGroup.update({
        where: { id: groupId },
        data: { name: name.trim(), description: description?.trim() ?? null, ...(color ? { color } : {}) },
      });
      return ok(updated);
    }

    // DELETE /evaluator/groups/:id — eliminar grupo propio
    if (evalGroupBaseMatch && method === 'DELETE') {
      const groupId = evalGroupBaseMatch[1]!;
      const group = await prisma.studentGroup.findUnique({ where: { id: groupId } });
      if (!group) return notFound('Grupo no encontrado');
      if (group.createdByEvaluatorId !== userId && !isAdminRole) return forbidden('Solo puedes eliminar tus propios grupos');
      await prisma.studentGroup.delete({ where: { id: groupId } });
      return ok({ deleted: true });
    }

    // POST /evaluator/groups/:id/members — agregar miembros al grupo propio
    const evalGroupMembersWriteMatch = path.match(/^\/evaluator\/groups\/([^/]+)\/members$/);
    if (evalGroupMembersWriteMatch && method === 'POST') {
      const groupId = evalGroupMembersWriteMatch[1]!;
      const group = await prisma.studentGroup.findUnique({ where: { id: groupId } });
      if (!group) return notFound('Grupo no encontrado');
      if (group.createdByEvaluatorId !== userId && !isAdminRole) return forbidden('Solo puedes modificar tus propios grupos');
      const { userIds } = JSON.parse(event.body ?? '{}') as { userIds?: string[] };
      if (!userIds?.length) return badRequest('userIds es requerido');
      await prisma.studentGroupMember.createMany({
        data: userIds.map((uid) => ({ groupId, userId: uid })),
        skipDuplicates: true,
      });
      return ok({ added: userIds.length });
    }

    // DELETE /evaluator/groups/:id/members/:userId — quitar miembro del grupo propio
    const evalGroupMemberDeleteMatch = path.match(/^\/evaluator\/groups\/([^/]+)\/members\/([^/]+)$/);
    if (evalGroupMemberDeleteMatch && method === 'DELETE') {
      const [, groupId, memberId] = evalGroupMemberDeleteMatch;
      const group = await prisma.studentGroup.findUnique({ where: { id: groupId! } });
      if (!group) return notFound('Grupo no encontrado');
      if (group.createdByEvaluatorId !== userId && !isAdminRole) return forbidden('Solo puedes modificar tus propios grupos');
      await prisma.studentGroupMember.delete({ where: { groupId_userId: { groupId: groupId!, userId: memberId! } } });
      return ok({ removed: true });
    }

    // GET /evaluator/submissions?moduleId=X — list all student submissions for a module
    if (method === 'GET' && path === '/evaluator/submissions') {
      const moduleId = event.queryStringParameters?.moduleId;
      if (!moduleId) return badRequest('moduleId required');
      const subs = await listSubmissionsForModule(moduleId);
      return ok(subs);
    }

    // PUT /evaluator/submissions/:submissionId/grade — grade a submission
    const gradeMatch = path.match(/^\/evaluator\/submissions\/([^/]+)\/grade$/);
    if (gradeMatch && method === 'PUT') {
      const submissionId = gradeMatch[1]!;
      const body = JSON.parse(event.body ?? '{}');
      const { studentUserId, grade, feedback } = body;
      const gradeNum = Number(grade);
      if (!studentUserId || grade == null) return badRequest('studentUserId and grade required');
      if (isNaN(gradeNum) || gradeNum < 0 || gradeNum > 100) return badRequest('grade must be 0-100');
      await updateSubmissionGrade(studentUserId, submissionId, gradeNum, String(feedback ?? ''), userId!);
      return ok({ graded: true });
    }

    // GET /evaluator/submissions/:submissionId/download?s3Key=Y — presigned GET URL
    const downloadMatch = path.match(/^\/evaluator\/submissions\/([^/]+)\/download$/);
    if (downloadMatch && method === 'GET') {
      const s3Key = event.queryStringParameters?.s3Key;
      if (!s3Key) return badRequest('s3Key required');
      if (!s3Key.startsWith('submissions/')) return badRequest('Invalid s3Key');
      const cmd = new GetObjectCommand({ Bucket: SUBMISSIONS_BUCKET_EV, Key: s3Key });
      const url = await getSignedUrl(s3Ev, cmd, { expiresIn: 300 });
      return ok({ url });
    }

    // GET /evaluator/interviews?moduleId=X — list all student interviews for a module
    if (method === 'GET' && path === '/evaluator/interviews') {
      const moduleId = event.queryStringParameters?.moduleId;
      if (!moduleId) return badRequest('moduleId required');
      const interviews = await listInterviewsForModule(moduleId);
      return ok(interviews);
    }

    // PUT /evaluator/interviews/:interviewId/grade — grade an interview
    const interviewGradeMatch = path.match(/^\/evaluator\/interviews\/([^/]+)\/grade$/);
    if (interviewGradeMatch && method === 'PUT') {
      const interviewId = interviewGradeMatch[1]!;
      let body: any = {};
      try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }
      const { studentUserId, grade, feedback } = body as { studentUserId?: string; grade?: number; feedback?: string };
      if (!studentUserId || grade == null) return badRequest('studentUserId and grade required');
      const gradeNum = Number(grade);
      if (isNaN(gradeNum) || gradeNum < 0 || gradeNum > 100) return badRequest('grade must be 0-100');
      await updateInterviewGrade(studentUserId, interviewId, gradeNum, String(feedback ?? ''), userId!);

      // Push notification to student
      if (VAPID_PUBLIC_EV && VAPID_PRIVATE_EV) {
        void (async () => {
          try {
            const subs = await getPushSubscriptionsByUserId(studentUserId);
            const payload = JSON.stringify({ title: 'Entrevista calificada', body: `Tu entrevista oral fue calificada: ${gradeNum}%` });
            await Promise.allSettled(subs.map((sub: any) =>
              webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
            ));
          } catch {}
        })();
      }
      return ok({ graded: true });
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
