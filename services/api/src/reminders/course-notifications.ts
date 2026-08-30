// ─── course-notifications.ts ─────────────────────────────────────────────────
// Domain: course-start + weekly-topic notifications for enrolled students.
// Extracted out of reminders/handler.ts to keep it from growing further
// (already over the file-size guideline) — Trello DmPpbrff item 2, 2026-08-30
// 20:16: "cuando este curso llega a esa fecha de inicio debe notificársele a
// los estudiantes... también el inicio de cada semana, cuáles son los temas."
//
// Both notifications go out on all 3 channels: email (SES), push (web-push),
// and in-app (Notifications DDB table) — matches the requested "por correo,
// por notificación push y notificación dentro de la plataforma."
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import webpush from 'web-push';
import { createId } from '@paralleldrive/cuid2';
import { createNotification, getPushSubscriptionsByUserId } from '../shared/db-dynamo';
import { getPrismaClient } from '../shared/db-neon';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(process.env.VAPID_EMAIL ?? 'mailto:admin@luxlearning.com', VAPID_PUBLIC, VAPID_PRIVATE);
}

async function sendPush(userId: string, title: string, body: string) {
  try {
    const subs = await getPushSubscriptionsByUserId(userId);
    await Promise.allSettled(
      subs.map((sub: any) => webpush.sendNotification(sub, JSON.stringify({ title, body }))),
    );
  } catch { /* non-fatal — VAPID not configured or subs stale */ }
}

function courseStartEmailHtml(name: string, courseTitle: string, frontendUrl: string): string {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Claridad que transforma.</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Tu curso ya está disponible! 🚀</h2>
      <p style="color:#555;line-height:1.6;">Hola ${name},</p>
      <p style="color:#555;line-height:1.6;">Hoy inicia oficialmente el curso en el que estás inscrito:</p>
      <div style="background:#F0F7FF;border-left:4px solid #7B2FBE;padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0;color:#2C2C2C;font-size:18px;font-weight:700;">📚 ${courseTitle}</p>
      </div>
      <a href="${frontendUrl}/courses" style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:8px;">Ver mis cursos</a>
      <p style="color:#aaa;font-size:12px;margin-top:32px;">Recibes este email porque estás inscrito en Lux Learning.</p>
    </div>
  </div>
</body></html>`;
}

function weeklyTopicsEmailHtml(name: string, courseTitle: string, weekNum: number, topics: string[], frontendUrl: string): string {
  const topicsList = topics.map((t) => `<li style="margin:4px 0;color:#555;">${t}</li>`).join('');
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Claridad que transforma.</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">📅 Nueva semana en ${courseTitle}</h2>
      <p style="color:#555;line-height:1.6;">Hola ${name}, esta semana (semana ${weekNum}) verás:</p>
      <ul style="padding-left:20px;">${topicsList}</ul>
      <a href="${frontendUrl}/courses" style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:8px;">Ir al curso</a>
      <p style="color:#aaa;font-size:12px;margin-top:32px;">Recibes este email porque estás inscrito en Lux Learning.</p>
    </div>
  </div>
</body></html>`;
}

interface Deps {
  ses: SESClient;
  cognito: CognitoIdentityProviderClient;
  fromEmail: string;
  frontendUrl: string;
  allEnrollments: { userId: string; courseId: string }[];
}

// Notifies enrolled students the day a course's startDate lands on today —
// was email-only before (Trello DmPpbrff item 2); now also push + in-app.
export async function sendCourseStartNotifications(deps: Deps): Promise<number> {
  const { ses, cognito, fromEmail, frontendUrl, allEnrollments } = deps;
  let sent = 0;
  try {
    const prisma = await getPrismaClient();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const coursesStartingToday = await prisma.course.findMany({
      where: { startDate: { gte: todayStart, lte: todayEnd }, isActive: true },
      select: { id: true, title: true },
    });

    for (const course of coursesStartingToday) {
      const enrolled = allEnrollments.filter((e) => e.courseId === course.id);
      for (const enrollment of enrolled) {
        try {
          const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: process.env.COGNITO_USER_POOL_ID!, Username: enrollment.userId }));
          const attr = (n: string) => res.UserAttributes?.find((a) => a.Name === n)?.Value ?? '';
          const email = attr('email');
          const name = attr('name') || email.split('@')[0] || '';
          if (email) {
            await ses.send(new SendEmailCommand({
              Source: fromEmail,
              Destination: { ToAddresses: [email] },
              Message: {
                Subject: { Data: `¡Tu curso "${course.title}" ya está disponible! 🚀`, Charset: 'UTF-8' },
                Body: { Html: { Data: courseStartEmailHtml(name, course.title, frontendUrl), Charset: 'UTF-8' } },
              },
            }));
          }
          await sendPush(enrollment.userId, '🚀 Tu curso ya inició', `"${course.title}" está disponible — ¡comienza a aprender!`);
          await createNotification({
            userId: enrollment.userId,
            notifId: createId(),
            type: 'COURSE_STARTED',
            message: `Tu curso "${course.title}" ya inició — ¡comienza a aprender!`,
            read: false,
            createdAt: new Date().toISOString(),
            actionUrl: `/courses/${course.id}`,
          }).catch(() => {});
          sent++;
        } catch (e) { console.warn('[Reminders] Course-start notification failed:', e); }
      }
    }
  } catch (e) {
    console.warn('[Reminders] Course-start check failed:', e);
  }
  return sent;
}

// NEW (Trello DmPpbrff item 2): notify enrolled students when a new week of the
// course's weekly plan begins, listing that week's topics. Week N's start date
// is course.startDate + (N-1)*7 days; planWeeklyPlan is the JSON array saved by
// Lux Planner ({weekNum, topics, module, ...}).
export async function sendWeeklyCourseTopicNotifications(deps: Deps): Promise<number> {
  const { ses, cognito, fromEmail, frontendUrl, allEnrollments } = deps;
  let sent = 0;
  try {
    const prisma = await getPrismaClient();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const activeCourses = await prisma.course.findMany({
      where: { isActive: true, startDate: { not: null }, planWeeklyPlan: { not: (null as any) } },
      select: { id: true, title: true, startDate: true, planWeeklyPlan: true },
    });

    for (const course of activeCourses) {
      const weeklyPlan: any[] = Array.isArray(course.planWeeklyPlan) ? (course.planWeeklyPlan as any[]) : [];
      if (weeklyPlan.length === 0 || !course.startDate) continue;

      for (const week of weeklyPlan) {
        const weekNum = week?.weekNum;
        const topics: string[] = Array.isArray(week?.topics) ? week.topics : [];
        if (!weekNum || weekNum <= 1 || topics.length === 0) continue; // week 1 is covered by course-start
        const weekStart = new Date(course.startDate);
        weekStart.setDate(weekStart.getDate() + (weekNum - 1) * 7);
        if (weekStart < todayStart || weekStart > todayEnd) continue;

        const enrolled = allEnrollments.filter((e) => e.courseId === course.id);
        for (const enrollment of enrolled) {
          try {
            const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: process.env.COGNITO_USER_POOL_ID!, Username: enrollment.userId }));
            const attr = (n: string) => res.UserAttributes?.find((a) => a.Name === n)?.Value ?? '';
            const email = attr('email');
            const name = attr('name') || email.split('@')[0] || '';
            if (email) {
              await ses.send(new SendEmailCommand({
                Source: fromEmail,
                Destination: { ToAddresses: [email] },
                Message: {
                  Subject: { Data: `📅 Semana ${weekNum} de "${course.title}" — Lux Learning`, Charset: 'UTF-8' },
                  Body: { Html: { Data: weeklyTopicsEmailHtml(name, course.title, weekNum, topics, frontendUrl), Charset: 'UTF-8' } },
                },
              }));
            }
            await sendPush(enrollment.userId, `📅 Semana ${weekNum} — ${course.title}`, topics.slice(0, 3).join(', '));
            await createNotification({
              userId: enrollment.userId,
              notifId: createId(),
              type: 'COURSE_WEEK_STARTED',
              message: `Semana ${weekNum} de "${course.title}": ${topics.slice(0, 3).join(', ')}`,
              read: false,
              createdAt: new Date().toISOString(),
              actionUrl: `/courses/${course.id}`,
            }).catch(() => {});
            sent++;
          } catch (e) { console.warn('[Reminders] Weekly topic notification failed:', e); }
        }
      }
    }
  } catch (e) {
    console.warn('[Reminders] Weekly topic check failed:', e);
  }
  return sent;
}
