/**
 * Reminders Lambda — triggered by EventBridge daily at 9:00 AM UTC
 * 1. Sends re-engagement emails to students inactive > 72h
 * 2. Sends "course starts tomorrow" emails to enrolled students
 */
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CognitoIdentityProviderClient, AdminGetUserCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getAllLessonProgress, getAllEnrollments, getAllReflections, getLastSeenAll, getAllPendingTasks, updateTask, getInactivityReminder, setInactivityReminder, createNotification } from '../shared/db-dynamo';
import { getPrismaClient } from '../shared/db-neon';
import { sendTemplatedEmail } from '../shared/email';
import { createId } from '@paralleldrive/cuid2';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.academy';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://luxlearning.academy';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

// Inactivity reminder sequence: 3 days → first, 5 days total → second, then every 5 days
const INACTIVITY_HOURS = 72;           // trigger first reminder at 3 days inactivity
const SECOND_EMAIL_HOURS = 48;         // 2 more days → 5 days total inactivity for 2nd reminder
const WEEKLY_EMAIL_HOURS = 120;        // 5 days between subsequent reminders
const MAX_REMINDER_COUNT = 5;          // stop after 5 reminders

function reminderEmailHtml(name: string, daysInactive: number, emailNum: number): string {
  const isFinal = emailNum >= 5;
  const header = isFinal
    ? `Te extrañamos en Lux Learning`
    : `¡Te echamos de menos!`;
  const body = isFinal
    ? `Llevas ya varias semanas sin actividad. Te extrañamos y nos encantaría que continuaras con nosotros. Si has decidido pausar tu formación o deseas darte de baja, no dudes en escribirnos — estaremos encantados de ayudarte.`
    : `Llevas <strong>${daysInactive} día${daysInactive !== 1 ? 's' : ''}</strong> sin actividad en Lux Learning. Tu aprendizaje está esperando — unos minutos cada día marcan la diferencia.`;
  const cta = isFinal
    ? `<a href="mailto:${FROM_EMAIL}" style="display:inline-block;background:#7B2FBE;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:8px;">Contáctanos</a>&nbsp;&nbsp;<a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:8px;">Volver a aprender</a>`
    : `<a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:8px;">Continuar aprendiendo</a>`;
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
        ${name ? `¡Hola ${name}! — ${header}` : header}
      </h2>
      <p style="color:#555;line-height:1.6;">${body}</p>
      ${!isFinal ? `<div style="background:#F0FBFF;border-left:4px solid #00B4D8;padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0;color:#0077A8;font-style:italic;">"La consistencia supera a la intensidad. Un módulo a la vez."</p>
      </div>` : ''}
      ${cta}
      <p style="color:#aaa;font-size:12px;margin-top:32px;">
        Recibes este email porque estás inscrito en Lux Learning.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function courseStartEmailHtml(name: string, courseTitle: string): string {
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
        ¡Tu curso comienza mañana! 🚀
      </h2>
      <p style="color:#555;line-height:1.6;">Hola ${name},</p>
      <p style="color:#555;line-height:1.6;">
        Mañana comienza oficialmente el curso en el que estás inscrito:
      </p>
      <div style="background:#F0F7FF;border-left:4px solid #7B2FBE;padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0;color:#2C2C2C;font-size:18px;font-weight:700;">📚 ${courseTitle}</p>
      </div>
      <p style="color:#555;line-height:1.6;">
        Asegúrate de estar listo. Prepara un espacio tranquilo y tus ganas de aprender.
      </p>
      <a href="${FRONTEND_URL}/courses"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:8px;">
        Ver mis cursos
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:32px;">
        Recibes este email porque estás inscrito en Lux Learning.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function taskReminderEmailHtml(name: string, taskTitle: string, daysLeft: number, courseTitle?: string): string {
  const urgency = daysLeft <= 3 ? '⏰ ¡Faltan pocos días!' : '📌 Recordatorio de tarea';
  const urgencyColor = daysLeft <= 3 ? '#F59E0B' : '#00B4D8';
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
        ${name ? `¡Hola ${name}!` : '¡Hola!'}
      </h2>
      <p style="color:#555;line-height:1.6;">
        Tienes una tarea que vence en <strong style="color:${urgencyColor}">${daysLeft} día${daysLeft !== 1 ? 's' : ''}</strong>.
      </p>
      <div style="background:#FFFBEB;border-left:4px solid ${urgencyColor};padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0 0 4px;color:#92400E;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">${urgency}</p>
        <p style="margin:0;color:#2C2C2C;font-size:18px;font-weight:700;">📋 ${taskTitle}</p>
        ${courseTitle ? `<p style="margin:4px 0 0;color:#555;font-size:13px;">Curso: ${courseTitle}</p>` : ''}
      </div>
      <p style="color:#555;line-height:1.6;">
        ¡Puedes hacerlo! Revisa los materiales del curso, organiza tus ideas y entrega tu mejor trabajo.
      </p>
      <a href="${FRONTEND_URL}/tasks"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:8px;">
        Ver mis tareas
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:32px;">
        Recibes este email porque estás inscrito en Lux Learning.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function weeklyEmailHtml(name: string, summary: string, pending: number, courseNames: string[]): string {
  const courses = courseNames.slice(0, 5).map((c) => `<li style="color:#555;margin:4px 0;">${c}</li>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Resumen semanal — ${new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Hola ${name}! 👋</h2>
      ${pending > 0 ? `<div style="background:#FFF7ED;border-left:4px solid #F59E0B;padding:16px 20px;border-radius:4px;margin:0 0 24px;">
        <p style="margin:0;color:#92400E;font-weight:600;">📋 ${pending} reflexión${pending !== 1 ? 'es' : ''} pendiente${pending !== 1 ? 's' : ''} de evaluación</p>
      </div>` : ''}
      <div style="background:#F8F8FF;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
        <p style="color:#555;line-height:1.7;margin:0;">${summary.replace(/\n/g, '<br>')}</p>
      </div>
      ${courseNames.length > 0 ? `<p style="color:#888;font-size:13px;margin-bottom:8px;">Cursos a cargo:</p><ul style="padding-left:20px;margin:0 0 24px;">${courses}</ul>` : ''}
      <a href="${FRONTEND_URL}/evaluator/reflections" style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;">
        Ver reflexiones pendientes →
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:32px;">Recibes este email como evaluador en Lux Learning.</p>
    </div>
  </div>
</body></html>`;
}

async function sendWeeklyEvaluatorSummaries(
  allReflections: any[], allEnrollments: any[], allLastSeen: any[]
): Promise<number> {
  const prisma = await getPrismaClient();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const lastSeenMap = new Map(allLastSeen.map((ls) => [ls.userId, new Date(ls.lastSeen)]));

  // Collect evaluators + admins from Cognito
  const listGroup = async (groupName: string) => {
    const users: any[] = [];
    let nextToken: string | undefined;
    do {
      const res = await cognito.send(new ListUsersInGroupCommand({
        UserPoolId: USER_POOL_ID, GroupName: groupName, Limit: 60,
        ...(nextToken ? { NextToken: nextToken } : {}),
      }));
      users.push(...(res.Users ?? []));
      nextToken = res.NextToken;
    } while (nextToken);
    return users;
  };
  const [evUsers, adminUsers] = await Promise.allSettled([listGroup('EVALUATOR'), listGroup('ADMIN')]);
  const evaluators = [
    ...((evUsers.status === 'fulfilled' ? evUsers.value : []) ?? []),
    ...((adminUsers.status === 'fulfilled' ? adminUsers.value : []) ?? []),
  ];

  // Batch-load all courses in one query to avoid N+1 per evaluator
  const evaluatorIds = evaluators
    .map((ev) => ev.Attributes?.find((a: any) => a.Name === 'sub')?.Value ?? '')
    .filter(Boolean);
  const allCourses = evaluatorIds.length > 0
    ? await prisma.course.findMany({
        where: { evaluatorId: { in: evaluatorIds } },
        select: { id: true, title: true, evaluatorId: true, modules: { select: { id: true } } },
      })
    : [];
  const coursesByEvaluator = new Map<string, typeof allCourses>();
  for (const c of allCourses) {
    const list = coursesByEvaluator.get(c.evaluatorId) ?? [];
    list.push(c);
    coursesByEvaluator.set(c.evaluatorId, list);
  }

  let sent = 0;
  for (const ev of evaluators) {
    const attr = (n: string) => ev.Attributes?.find((a: any) => a.Name === n)?.Value ?? '';
    const email = attr('email');
    const name = attr('name') || email.split('@')[0] || '';
    const evaluatorId = attr('sub');
    if (!email || !evaluatorId) continue;

    try {
      const courses = coursesByEvaluator.get(evaluatorId) ?? [];
      if (courses.length === 0) continue;

      const courseIds = courses.map((c: any) => c.id);
      const moduleIds = courses.flatMap((c: any) => c.modules.map((m: any) => m.id));
      const courseNames = courses.map((c: any) => c.title);

      const studentIds = [...new Set(allEnrollments.filter((e) => courseIds.includes(e.courseId)).map((e) => e.userId))];
      const myReflections = allReflections.filter((r) => moduleIds.includes(r.moduleId));
      const pending = myReflections.filter((r) => r.status === 'PENDING_EVAL');
      const weekNew = myReflections.filter((r) => new Date(r.submittedAt) >= oneWeekAgo);
      const weekApproved = weekNew.filter((r) => r.status === 'APPROVED');
      const weekRejected = weekNew.filter((r) => r.status === 'REJECTED');
      const inactive = studentIds.filter((uid) => {
        const ls = lastSeenMap.get(uid);
        return ls !== undefined && ls < fiveDaysAgo;
      });

      const statsText = `Semana del ${oneWeekAgo.toLocaleDateString('es-ES')} al ${now.toLocaleDateString('es-ES')}
Cursos: ${courseNames.join(', ')}
Total estudiantes: ${studentIds.length}
Reflexiones nuevas esta semana: ${weekNew.length}
Reflexiones pendientes de evaluación: ${pending.length}
Aprobadas esta semana: ${weekApproved.length}
Rechazadas esta semana: ${weekRejected.length}
Estudiantes inactivos (>5 días): ${inactive.length}`;

      const prompt = `Eres el asistente de evaluación de Lux Learning. Genera un resumen semanal ejecutivo para el evaluador "${name}".

DATOS:
${statsText}

Redacta un párrafo de máximo 120 palabras en español. Tono profesional y motivador. Destaca lo más importante: carga de trabajo pendiente, tendencias de la semana y si hay estudiantes en riesgo. Sé concreto con los números.`;

      let summary = statsText;
      try {
        const bedrockRes = await bedrock.send(new InvokeModelCommand({
          modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 300,
            messages: [{ role: 'user', content: prompt }],
          }),
        }));
        const parsed = JSON.parse(new TextDecoder().decode(bedrockRes.body));
        const text = parsed.content?.[0]?.text?.trim();
        if (text) summary = text;
      } catch (bedrockErr) {
        console.warn('[Reminders] Bedrock weekly summary failed — using raw stats:', bedrockErr);
      }

      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: `📊 Resumen semanal Lux Learning — ${pending.length} reflexión${pending.length !== 1 ? 'es' : ''} pendiente${pending.length !== 1 ? 's' : ''}`, Charset: 'UTF-8' },
          Body: { Html: { Data: weeklyEmailHtml(name, summary, pending.length, courseNames), Charset: 'UTF-8' } },
        },
      }));
      sent++;
      console.log(`[Reminders] Weekly summary sent to ${email} (${pending.length} pending)`);
    } catch (err) {
      console.warn(`[Reminders] Weekly summary failed for ${email}:`, err);
    }
  }
  return sent;
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
    // Guard: PROGRESS table contains non-lesson items (HEARTBEAT, INACTIVITY_REMINDER, etc.) — skip those
    const lastActivity = new Map<string, number>();
    allProgress.forEach((p) => {
      if (!p.completedAt) return;
      const t = new Date(p.completedAt).getTime();
      if (isNaN(t)) return;
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

      // Check reminder sequence tracking
      let reminder;
      try {
        reminder = await getInactivityReminder(userId);
      } catch {
        reminder = { count: 0, lastSent: null };
      }

      if (reminder.count >= MAX_REMINDER_COUNT) {
        skipped++;
        continue;
      }

      // Determine if enough time has passed since last reminder
      if (reminder.lastSent) {
        const hoursSinceLast = Math.floor((now - new Date(reminder.lastSent).getTime()) / 3600000);
        const requiredHours = reminder.count <= 1 ? SECOND_EMAIL_HOURS : WEEKLY_EMAIL_HOURS;
        if (hoursSinceLast < requiredHours) {
          skipped++;
          continue;
        }
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
        const daysInactive = Math.floor(hoursInactive / 24) || 1;
        const nextCount = reminder.count + 1;
        const isFinal = nextCount >= MAX_REMINDER_COUNT;
        const subject = isFinal
          ? `Te extrañamos en Lux Learning ❤️`
          : `${name ? name + ', t' : 'T'}e echamos de menos en Lux Learning 🌟`;

        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Html: { Data: reminderEmailHtml(name, daysInactive, nextCount), Charset: 'UTF-8' } },
          },
        }));

        sent++;
        console.log(`[Reminders] Sent #${nextCount} to ${email} (${hoursInactive}h inactive)`);

        // Also send in-app notification so the student sees it on the platform
        createNotification({
          userId,
          notifId: createId(),
          type: 'INACTIVITY_REMINDER',
          message: isFinal
            ? 'Te extrañamos en Lux Learning — ¡continuemos tu formación!'
            : `Llevas ${Math.floor(hoursInactive / 24)} días sin actividad — ¡te echamos de menos!`,
          read: false,
          createdAt: new Date().toISOString(),
          actionUrl: '/dashboard',
        }).catch((err) => {
          console.warn(`[Reminders] In-app notification failed for ${userId}:`, err);
        });

        try {
          await setInactivityReminder(userId, nextCount, new Date().toISOString());
        } catch (ddbErr) {
          console.warn(`[Reminders] Counter update failed for ${userId} — email was sent, counter not advanced:`, ddbErr);
        }
      } catch (err) {
        console.warn(`[Reminders] Failed for userId ${userId}:`, err);
        skipped++;
      }
    }

    console.log(`[Reminders] Done — sent: ${sent}, skipped: ${skipped}`);

    // ── Course-start notifications (1 day before startDate) ──────────────────
    let startSent = 0;
    try {
      const prisma = await getPrismaClient();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStart = new Date(tomorrow); tomorrowStart.setHours(0, 0, 0, 0);
      const tomorrowEnd   = new Date(tomorrow); tomorrowEnd.setHours(23, 59, 59, 999);

      const coursesStartingTomorrow = await prisma.course.findMany({
        where: { startDate: { gte: tomorrowStart, lte: tomorrowEnd }, isActive: true },
        select: { id: true, title: true },
      });

      for (const course of coursesStartingTomorrow) {
        // Get all enrolled students for this course
        const enrolled = allEnrollments.filter((e) => e.courseId === course.id);
        for (const enrollment of enrolled) {
          try {
            const res = await cognito.send(new AdminGetUserCommand({
              UserPoolId: USER_POOL_ID,
              Username: enrollment.userId,
            }));
            const attr = (n: string) => res.UserAttributes?.find((a) => a.Name === n)?.Value ?? '';
            const email = attr('email');
            const name  = attr('name') || email.split('@')[0] || '';
            if (!email) continue;

            await ses.send(new SendEmailCommand({
              Source: FROM_EMAIL,
              Destination: { ToAddresses: [email] },
              Message: {
                Subject: { Data: `¡Tu curso "${course.title}" comienza mañana! 🚀`, Charset: 'UTF-8' },
                Body: { Html: { Data: courseStartEmailHtml(name, course.title), Charset: 'UTF-8' } },
              },
            }));
            startSent++;
            console.log(`[Reminders] Course-start sent to ${email} for "${course.title}"`);
          } catch (e) { console.warn('[Reminders] Course-start email failed:', e); }
        }
      }
      console.log(`[Reminders] Course-start notifications sent: ${startSent}`);
    } catch (e) {
      console.warn('[Reminders] Course-start check failed:', e);
    }

    // ── Task due-date reminders (5 and 3 days before) ──────────────────────────
    let taskReminderSent = 0;
    try {
      const pendingTasks = await getAllPendingTasks();
      const todayStr = new Date().toISOString().split('T')[0];

      for (const task of pendingTasks) {
        const dueMs = new Date(task.dueDate + 'T00:00:00Z').getTime();
        const daysLeft = Math.round((dueMs - now) / 86400000);

        const needsR5 = daysLeft === 5 && !task.r5;
        const needsR3 = daysLeft === 3 && !task.r3;
        if (!needsR5 && !needsR3) continue;

        try {
          const res = await cognito.send(new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: task.userId,
          }));
          const attr = (n: string) => res.UserAttributes?.find((a) => a.Name === n)?.Value ?? '';
          const email = attr('email');
          const name  = attr('name') || email.split('@')[0] || '';
          if (!email) continue;

          await sendTemplatedEmail(email, 'TASK_DUE_SOON', {
            studentName: name,
            taskTitle: task.title,
            courseTitle: task.courseTitle ?? '',
            daysLeft: String(daysLeft),
          });

          // Mark reminder as sent
          const reminderUpdate = needsR5 ? { r5: new Date().toISOString() } : { r3: new Date().toISOString() };
          await updateTask(task.userId, task.sk, reminderUpdate);
          taskReminderSent++;
          console.log(`[Reminders] Task reminder (${daysLeft}d) sent to ${email} for "${task.title}"`);
        } catch (e) { console.warn('[Reminders] Task reminder failed:', e); }
      }
      console.log(`[Reminders] Task reminders sent: ${taskReminderSent}`);
    } catch (e) {
      console.warn('[Reminders] Task reminder check failed:', e);
    }

    // ── Weekly AI summary for evaluators (Mondays only) ─────────────────────
    let weeklySent = 0;
    if (new Date().getDay() === 1) {
      try {
        weeklySent = await sendWeeklyEvaluatorSummaries(allReflections, allEnrollments, allLastSeen);
        console.log(`[Reminders] Weekly summaries sent: ${weeklySent}`);
      } catch (e) {
        console.warn('[Reminders] Weekly summary block failed:', e);
      }
    }

    return { sent, skipped, startSent, taskReminderSent, weeklySent };
  } catch (err) {
    console.error('[Reminders] Fatal error:', err);
    throw err;
  }
};
