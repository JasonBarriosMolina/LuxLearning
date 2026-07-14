import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient, AdminGetUserCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
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
import { getAllReflections, getAllLessonProgress, getAllQuizAttempts, getReflection, updateReflectionStatus, setReflectionPriority, createNotification, getAllEnrollments, getCertificateByUserAndCourse, getCertificatesByUser, saveCertificate, getQuizAttempts, getPushSubscriptionsByUserId, createTask, getTasksForUser, getTasksByCourse, updateTask, deleteTask, autoCompleteTasks, getLastSeenAll, getSignature, saveSignature, getResourcesByEvaluator, saveResource, updateResource, getResourcesByCourse, getUserLang, TABLES, ddb, createCalendarEvent, getAllVisibleCalendarEvents, updateCalendarEvent, deleteCalendarEvent, getCalendarEventById } from '../shared/db-dynamo';
import { createId } from '@paralleldrive/cuid2';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { detectAI } from '../reflection/detect-ai';
import { ok, badRequest, forbidden, notFound, serverError, cors, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';
import { jsonrepair } from 'jsonrepair';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });

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

async function getCognitoUser(userId: string): Promise<{ email: string; name: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const cachedEmail = cacheGet(emailCache, userId);
  if (cachedEmail !== undefined) return { email: cachedEmail, name: cacheGet(nameCache, userId) ?? cachedEmail };
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const attrs = res.UserAttributes ?? [];
    const email = attrs.find((a) => a.Name === 'email')?.Value ?? userId;
    const name = attrs.find((a) => a.Name === 'name')?.Value
      ?? attrs.find((a) => a.Name === 'given_name')?.Value
      ?? email;
    cacheSet(emailCache, userId, email);
    cacheSet(nameCache, userId, name);
    return { email, name };
  } catch {
    return null;
  }
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

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const auth = event.requestContext.authorizer?.lambda;
  if (auth?.role !== 'EVALUATOR' && auth?.role !== 'ADMIN' && auth?.role !== 'SUPER_ADMIN') return forbidden('Evaluator role required');

  const userId = auth?.userId ?? '';
  const isAdminRole = auth?.role === 'ADMIN' || auth?.role === 'SUPER_ADMIN';
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const prisma = await getPrismaClient();

  try {
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
        const studentName = cognitoUser?.name ?? s.userId;
        const studentEmail = cognitoUser?.email ?? null;
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
        return { userId: s.userId, studentName, studentEmail, courses: courseStats, lastSeen, presenceStatus };
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

      return ok({
        students: studentsOnly.map((s) => ({ ...s, taskCounts: tasksByCourse[s.userId] ?? null })),
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
        // SES sandbox: unverified destination — log but don't fail (chat message still sent by frontend)
        console.warn('[Reminder] SES send failed (non-fatal):', sesErr?.message ?? sesErr);
        return ok({ sent: false, reason: sesErr?.message ?? 'SES error' });
      }

      return ok({ sent: true });
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
      const events = await getAllVisibleCalendarEvents(userId, role);
      return ok(events);
    }

    // POST /evaluator/calendar/events
    if (method === 'POST' && path === '/evaluator/calendar/events') {
      const { title, description, type, startDate, endDate, allDay, visibility, color, location, targetCourseId } = body as {
        title?: string; description?: string;
        type?: 'class' | 'meeting' | 'event' | 'deadline' | 'reminder' | 'other';
        startDate?: string; endDate?: string; allDay?: boolean;
        visibility?: 'private' | 'evaluators' | 'students' | 'community';
        color?: string; location?: string; targetCourseId?: string;
      };
      if (!title || !startDate || !endDate) return badRequest('title, startDate y endDate son requeridos');
      const eventId = createId();
      const event = {
        creatorId: userId,
        eventId,
        title: title.trim(),
        description: description?.trim(),
        type: type ?? 'event',
        startDate,
        endDate,
        allDay: allDay ?? false,
        visibility: visibility ?? 'private',
        color,
        location: location?.trim(),
        targetCourseId,
        creatorRole: role,
        createdAt: new Date().toISOString(),
      };
      await createCalendarEvent(event);
      return ok(event);
    }

    // PUT /evaluator/calendar/events/:eventId
    const calEditMatch = path.match(/^\/evaluator\/calendar\/events\/([^/]+)$/);
    if (method === 'PUT' && calEditMatch) {
      const eventId = calEditMatch[1]!;
      const existing = await getCalendarEventById(userId, eventId);
      // Admins can update any event; evaluators only their own
      const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
      if (!existing) {
        // Try to find by scanning if admin (event may belong to another creator)
        if (!isAdmin) return notFound('Evento no encontrado');
        // For admin, get creatorId from body
        const { creatorId: bodyCreatorId } = body as { creatorId?: string };
        if (!bodyCreatorId) return badRequest('creatorId requerido para admin');
        const adminExisting = await getCalendarEventById(bodyCreatorId, eventId);
        if (!adminExisting) return notFound('Evento no encontrado');
        const { creatorId: _c, eventId: _e, createdAt: _t, ...rest } = body as any;
        await updateCalendarEvent(bodyCreatorId, eventId, rest);
        return ok({ updated: true });
      }
      const { creatorId: _c, eventId: _e, createdAt: _t, ...updates } = body as any;
      await updateCalendarEvent(userId, eventId, updates);
      return ok({ updated: true });
    }

    // DELETE /evaluator/calendar/events/:eventId
    const calDeleteMatch = path.match(/^\/evaluator\/calendar\/events\/([^/]+)$/);
    if (method === 'DELETE' && calDeleteMatch) {
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

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
