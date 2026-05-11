/**
 * Reminders Lambda — triggered by EventBridge daily at 9:00 AM UTC
 * Scans enrolled students and sends re-engagement emails to those inactive > INACTIVITY_DAYS
 */
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getAllLessonProgress, getAllEnrollments, getAllReflections, getLastSeenAll } from '../shared/db-dynamo';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.com';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://lux-learning.vercel.app';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

// Hours of inactivity before sending a reminder
const INACTIVITY_HOURS = 72;
// Don't send a reminder if we sent one less than this many days ago
// (we store in a simple in-memory map; Lambda is stateless, so this is reset per invocation)
// For a stateless check we use DynamoDB lastActivity timestamp only.

function reminderEmailHtml(name: string, daysInactive: number): string {
  return `
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
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">
        ${name ? `¡Hola ${name}!` : '¡Te echamos de menos!'}
      </h2>
      <p style="color:#555;line-height:1.6;">
        Llevas <strong>${daysInactive} días</strong> sin actividad en Lux Learning.
        Tu aprendizaje está esperando — unos minutos cada día marcan la diferencia.
      </p>
      <div style="background:#F0FBFF;border-left:4px solid #00B4D8;padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0;color:#0077A8;font-style:italic;">
          "La consistencia supera a la intensidad. Un módulo a la vez."
        </p>
      </div>
      <a href="${FRONTEND_URL}/dashboard"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:8px;">
        Continuar aprendiendo
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:32px;">
        Recibes este email porque estás inscrito en Lux Learning.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export const handler = async () => {
  console.log('[Reminders] Starting daily reminder check...');

  try {
    const [allProgress, allReflections, allEnrollments, allLastSeen] = await Promise.all([
      getAllLessonProgress(),
      getAllReflections(),
      getAllEnrollments(),
      getLastSeenAll(),
    ]);

    const now = Date.now();

    // Build last seen map from heartbeat (most accurate) — fallback to activity
    const lastSeenMap = new Map(allLastSeen.map((ls) => [ls.userId, new Date(ls.lastSeen).getTime()]));

    // Build last activity timestamp per user (fallback)
    const lastActivity = new Map<string, number>();
    allProgress.forEach((p) => {
      const t = new Date(p.completedAt).getTime();
      if (!lastActivity.has(p.userId) || t > lastActivity.get(p.userId)!) lastActivity.set(p.userId, t);
    });
    allReflections.forEach((r) => {
      const t = new Date(r.submittedAt).getTime();
      if (!lastActivity.has(r.userId) || t > lastActivity.get(r.userId)!) lastActivity.set(r.userId, t);
    });

    // All enrolled unique users
    const enrolledUsers = [...new Set(allEnrollments.map((e) => e.userId))];

    let sent = 0;
    let skipped = 0;

    for (const userId of enrolledUsers) {
      // Use heartbeat lastSeen if available, else fall back to last activity
      const lastTs = lastSeenMap.get(userId) ?? lastActivity.get(userId);
      const hoursInactive = lastTs
        ? Math.floor((now - lastTs) / 3600000)
        : INACTIVITY_HOURS + 1; // never active → over threshold

      if (hoursInactive < INACTIVITY_HOURS) {
        skipped++;
        continue;
      }

      // Look up user email + name from Cognito
      try {
        const res = await cognito.send(new AdminGetUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: userId,
        }));

        const attr = (name: string) => res.UserAttributes?.find((a) => a.Name === name)?.Value ?? '';
        const email = attr('email') || (userId.includes('@') ? userId : '');
        if (!email) { skipped++; continue; }

        const name = attr('name') || email.split('@')[0] || '';

        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Data: `${name ? name + ', t' : 'T'}e echamos de menos en Lux Learning 🌟`, Charset: 'UTF-8' },
            Body: { Html: { Data: reminderEmailHtml(name, Math.floor(hoursInactive / 24) || 1), Charset: 'UTF-8' } },
          },
        }));

        sent++;
        console.log(`[Reminders] Sent to ${email} (${hoursInactive}h inactive)`);
      } catch (err) {
        console.warn(`[Reminders] Failed for userId ${userId}:`, err);
        skipped++;
      }
    }

    console.log(`[Reminders] Done — sent: ${sent}, skipped: ${skipped}`);
    return { sent, skipped };
  } catch (err) {
    console.error('[Reminders] Fatal error:', err);
    throw err;
  }
};
