// Email module domain handler for lux-admin.
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
    const { to, subject, bodyHtml, bodyText, courseId } = body as {
      to?: string[];
      subject?: string;
      bodyHtml?: string;
      bodyText?: string;
      courseId?: string;
    };
    if (!to || to.length === 0) return badRequest('to (array) required');
    if (!subject?.trim()) return badRequest('subject required');
    if (!bodyHtml?.trim()) return badRequest('bodyHtml required');
    if (to.length > 100) return badRequest('max 100 recipients per send');

    // Resolve email addresses for userIds that aren't already emails
    const resolvedAddresses = await Promise.all(
      to.map(async (recipient) => {
        if (recipient.includes('@')) return recipient;
        return resolveEmailAddress(recipient);
      })
    );
    const validAddresses = resolvedAddresses.filter((e): e is string => !!e);
    if (validAddresses.length === 0) return badRequest('no valid email addresses found');

    const emailId = createId();
    let status: 'sent' | 'failed' = 'sent';

    // SES has 50-recipient limit per send — batch if needed
    const BATCH = 50;
    for (let i = 0; i < validAddresses.length; i += BATCH) {
      const batch = validAddresses.slice(i, i + BATCH);
      try {
        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { BccAddresses: batch },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: bodyHtml, Charset: 'UTF-8' },
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
      subject,
      bodyHtml,
      bodyText,
      courseId,
      sentAt: new Date().toISOString(),
      status,
      recipientCount: validAddresses.length,
    });

    return ok({ emailId, sent: status === 'sent', recipientCount: validAddresses.length });
  }

  return null;
}
