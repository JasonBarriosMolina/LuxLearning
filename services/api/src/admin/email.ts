// Email module domain handler for lux-admin.
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrock } from './ctx';

async function generateEmailDraft(prompt: string): Promise<string> {
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Eres el asistente de comunicaciones de Lux Learning, una plataforma educativa. Redacta un email profesional, cordial y conciso en español basado en la siguiente instrucción:\n\n"${prompt}"\n\nDevuelve SOLO el cuerpo del email en HTML (párrafos <p>, listas <ul><li>). Sin saludos genéricos. Sin explicaciones adicionales.`,
      }],
    }),
  }));
  const parsed = JSON.parse(new TextDecoder().decode(res.body));
  return parsed.content?.[0]?.text?.trim() ?? '';
}

function brandedEmailHtml(bodyHtml: string, subject: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#17527E 0%,#0F3F62 100%);padding:28px 40px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="background:rgba(255,255,255,0.15);border-radius:10px;padding:8px 12px">
                        <span style="color:#E2BA50;font-size:18px;font-weight:900;letter-spacing:-0.5px">LUX</span>
                        <span style="color:#ffffff;font-size:18px;font-weight:400;letter-spacing:-0.5px"> LEARNING</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Gold accent bar -->
        <tr><td style="background:#E2BA50;height:4px;padding:0"></td></tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 28px;color:#2d3748;font-size:15px;line-height:1.7">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e8ecf0;padding:20px 40px;text-align:center">
            <p style="margin:0 0 4px;font-size:12px;color:#718096">Este correo fue enviado por Lux Learning.</p>
            <p style="margin:0;font-size:11px;color:#a0aec0">© ${new Date().getFullYear()} Lux Learning · luxlearning.academy</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

import { SendEmailCommand } from '@aws-sdk/client-ses';
import { ListUsersInGroupCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { AdminCtx, ses, FROM_EMAIL, cognito, USER_POOL_ID, isAdmin } from './ctx';
import { saveEmail, listSentEmails } from '../shared/db-email';
import { ok, badRequest, forbidden } from '../shared/response';
import { createId } from '@paralleldrive/cuid2';

async function resolveEmailAddress(userId: string): Promise<string | null> {
  if (userId.includes('@')) return userId;
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    return res.UserAttributes?.find((a) => a.Name === 'email')?.Value ?? null;
  } catch { return null; }
}

async function resolveDisplayName(userId: string): Promise<string> {
  if (userId.includes('@')) return userId.split('@')[0];
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const attrs = res.UserAttributes ?? [];
    return attrs.find((a) => a.Name === 'name')?.Value
      ?? attrs.find((a) => a.Name === 'email')?.Value
      ?? userId;
  } catch { return userId; }
}

export async function handleEmail(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, userId, body } = ctx;

  // ── GET /admin/email/sent ───────────────────────────────────────────────────
  if (method === 'GET' && path === '/admin/email/sent') {
    const sent = await listSentEmails(userId!);
    return ok(sent);
  }

  // ── GET /admin/email/recipients — students by course or all ────────────────
  if (method === 'GET' && path === '/admin/email/recipients') {
    const courseId = event.queryStringParameters?.courseId;
    let userIds: string[] = [];
    if (courseId) {
      const enrollments = await prisma.enrollment?.findMany?.({ where: { courseId }, select: { userId: true } }).catch(() => null)
        ?? await prisma.$queryRaw`SELECT "userId" FROM "Enrollment" WHERE "courseId" = ${courseId}`.catch(() => []) as any[];
      userIds = enrollments.map((e: any) => e.userId);
    } else {
      // All students from Cognito STUDENT group
      const users: any[] = [];
      let token: string | undefined;
      do {
        const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: 'STUDENT', Limit: 60, NextToken: token }));
        users.push(...(res.Users ?? []));
        token = res.NextToken;
      } while (token);
      userIds = users.map((u) => u.Username!).filter(Boolean);
    }
    const recipients = await Promise.all(userIds.slice(0, 200).map(async (uid) => ({
      userId: uid,
      name: await resolveDisplayName(uid),
      email: await resolveEmailAddress(uid),
    })));
    return ok(recipients.filter((r) => r.email));
  }

  // ── GET /admin/email/courses — list courses for recipient picker ────────────
  if (method === 'GET' && path === '/admin/email/courses') {
    const courses = await prisma.course.findMany({ select: { id: true, title: true }, orderBy: { createdAt: 'desc' } });
    return ok(courses);
  }

  // ── POST /admin/email/send ──────────────────────────────────────────────────
  if (method === 'POST' && path === '/admin/email/send') {
    const { to, cc, subject, bodyHtml, bodyText, courseId } = body as {
      to?: string[];
      cc?: string[];
      subject?: string;
      bodyHtml?: string;
      bodyText?: string;
      courseId?: string;
    };
    if (!to || to.length === 0) return badRequest('to (array) required');
    if (!subject?.trim()) return badRequest('subject required');
    if (!bodyHtml?.trim()) return badRequest('bodyHtml required');
    if (to.length + (cc?.length ?? 0) > 100) return badRequest('max 100 recipients per send');
    if ((cc?.length ?? 0) > 20) return badRequest('max 20 cc recipients per send');

    // Resolve email addresses for userIds that aren't already emails
    const resolveAddresses = async (list: string[]) => {
      const resolved = await Promise.all(
        list.map(async (recipient) => (recipient.includes('@') ? recipient : resolveEmailAddress(recipient))),
      );
      return resolved.filter((e): e is string => !!e);
    };
    const validAddresses = await resolveAddresses(to);
    if (validAddresses.length === 0) return badRequest('no valid email addresses found');
    // CC goes out once, visible to everyone, on the first SES call; skip addresses already in `to`.
    const ccAddresses = (await resolveAddresses(cc ?? [])).filter((a) => !validAddresses.includes(a));

    const emailId = createId();
    let status: 'sent' | 'failed' = 'sent';

    // SES has 50-recipient limit per send (to + cc + bcc) — batch if needed
    const BATCH = 50;
    let first = true;
    for (let i = 0; i < validAddresses.length;) {
      const size = first ? BATCH - ccAddresses.length : BATCH;
      const batch = validAddresses.slice(i, i + size);
      const batchCc = first && ccAddresses.length ? { CcAddresses: ccAddresses } : {};
      first = false;
      i += size;
      try {
        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { BccAddresses: batch, ...batchCc },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: brandedEmailHtml(bodyHtml, subject), Charset: 'UTF-8' },
              ...(bodyText ? { Text: { Data: bodyText, Charset: 'UTF-8' } } : {}),
            },
          },
        }));
      } catch (err) {
        status = 'failed';
        console.error('[email/send] SES error:', err);
      }
    }

    await saveEmail({
      sentBy: userId!,
      emailId,
      to: validAddresses,
      ...(ccAddresses.length ? { cc: ccAddresses } : {}),
      subject,
      bodyHtml,
      bodyText,
      courseId,
      sentAt: new Date().toISOString(),
      status,
      recipientCount: validAddresses.length + ccAddresses.length,
    });

    return ok({ emailId, sent: status === 'sent', recipientCount: validAddresses.length + ccAddresses.length });
  }

  // ── POST /admin/email/ai-draft ─────────────────────────────────────────────
  if (method === 'POST' && path === '/admin/email/ai-draft') {
    const { prompt } = body as { prompt?: string };
    if (!prompt?.trim()) return badRequest('prompt required');
    const html = await generateEmailDraft(prompt.trim());
    return ok({ html });
  }

  return null;
}
