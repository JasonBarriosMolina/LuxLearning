// Shared context, clients, cache, and helpers for lux-evaluator domain modules.
import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { S3Client } from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient, AdminGetUserCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import webpush from 'web-push';

// Configure VAPID for student push notifications
export const VAPID_PUBLIC_EV = process.env.VAPID_PUBLIC_KEY ?? '';
export const VAPID_PRIVATE_EV = process.env.VAPID_PRIVATE_KEY ?? '';
if (VAPID_PUBLIC_EV && VAPID_PRIVATE_EV) {
  webpush.setVapidDetails(process.env.VAPID_EMAIL ?? 'mailto:admin@luxlearning.com', VAPID_PUBLIC_EV, VAPID_PRIVATE_EV);
}
export { webpush };

export const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
export const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const s3Ev = new S3Client({ region: 'us-east-1' });
export const SUBMISSIONS_BUCKET_EV = process.env.SUBMISSIONS_BUCKET ?? 'lux-learning-submissions';
export const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
export const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.academy';

// Cache userId -> email/name — bounded LRU with 5-minute TTL to prevent unbounded growth
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

export async function getCognitoUser(userId: string): Promise<{ email: string; name: string } | null> {
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

export async function resolveStudentName(userId: string, storedEmail?: string): Promise<string> {
  // Always prefer the real name from Cognito — fall back to email only if unavailable
  const cachedName = cacheGet(nameCache, userId);
  if (cachedName !== undefined) return cachedName;
  const user = await getCognitoUser(userId);
  return user?.name ?? storedEmail ?? userId;
}

// Returns { email, name } for a student — email for sending, name for display
export async function resolveStudentContact(userId: string, reflection: any): Promise<{ email: string; name: string }> {
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

export async function sendEmail(to: string, subject: string, html: string) {
  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  }));
}

// Email HTML builders (legacy — kept for backward compat; new code uses sendTemplatedEmail)
export function approvedEmailHtml(studentName: string, moduleTitle: string, feedback: string): string {
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

export function rejectedEmailHtml(studentName: string, moduleTitle: string, feedback: string, reason: string): string {
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

export function approvedWithCertEmailHtml(studentName: string, moduleTitle: string, feedback: string, courseTitle: string, certId: string): string {
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

export function reconsideredEmailHtml(studentName: string, moduleTitle: string, reason: string, certId: string | null): string {
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

// ── Calendar event notification emails ───────────────────────────────────────
export async function sendCalendarEventEmails(
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
  const subject = action === 'created' ? `📅 Nuevo evento: ${title}` : `📅 Evento actualizado: ${title}`;
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

export type AuthContext = { userId: string; email: string; role: string };
export type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;
export type EvalCtx = {
  event: Event;
  method: string;
  path: string;
  prisma: any;
  body: any;
  userId: string;
  role: string;
  isAdminRole: boolean;
};
