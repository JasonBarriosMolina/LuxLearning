// ─── reminders/digest.ts ─────────────────────────────────────────────────────
// Weekly digest emails: evaluator summary (Mon) + student plan digest (Tue/Fri)
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CognitoIdentityProviderClient, AdminGetUserCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getAllEnrollments } from '../shared/db-dynamo';
import { getStudyPlansBatch, getMonday } from '../shared/db-study-plans';
import { getPrismaClient } from '../shared/db-neon';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://luxlearning.academy';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

// ── Evaluator weekly summary ──────────────────────────────────────────────────

function weeklyEvaluatorHtml(name: string, summary: string, pending: number, courseNames: string[]): string {
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
      ${pending > 0 ? `<div style="background:#FFF7ED;border-left:4px solid #F59E0B;padding:16px 20px;border-radius:4px;margin:0 0 24px;"><p style="margin:0;color:#92400E;font-weight:600;">📋 ${pending} reflexión${pending !== 1 ? 'es' : ''} pendiente${pending !== 1 ? 's' : ''} de evaluación</p></div>` : ''}
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

export async function sendWeeklyEvaluatorSummaries(
  ses: SESClient,
  bedrock: BedrockRuntimeClient,
  cognito: CognitoIdentityProviderClient,
  fromEmail: string,
  allReflections: any[],
  allEnrollments: any[],
  allLastSeen: any[],
): Promise<number> {
  const prisma = await getPrismaClient();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const lastSeenMap = new Map(allLastSeen.map((ls) => [ls.userId, new Date(ls.lastSeen)]));

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
      const inactive = studentIds.filter((uid) => {
        const ls = lastSeenMap.get(uid);
        return ls === undefined || ls < fiveDaysAgo;
      });

      const statsText = `Semana del ${oneWeekAgo.toLocaleDateString('es-ES')} al ${now.toLocaleDateString('es-ES')}
Cursos: ${courseNames.join(', ')}
Total estudiantes: ${studentIds.length}
Reflexiones nuevas: ${weekNew.length}, pendientes: ${pending.length}
Aprobadas: ${weekNew.filter((r) => r.status === 'APPROVED').length}, Rechazadas: ${weekNew.filter((r) => r.status === 'REJECTED').length}
Estudiantes inactivos (>5 días): ${inactive.length}`;

      let summary = statsText;
      try {
        const res = await bedrock.send(new InvokeModelCommand({
          modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json', accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31', max_tokens: 300,
            messages: [{ role: 'user', content: `Eres el asistente de evaluación de Lux Learning. Genera un resumen semanal ejecutivo para el evaluador "${name}".\n\nDATOS:\n${statsText}\n\nRedacta un párrafo de máximo 120 palabras en español. Tono profesional y motivador. Destaca lo más importante: carga de trabajo pendiente, tendencias y estudiantes en riesgo.` }],
          }),
        }));
        const parsed = JSON.parse(new TextDecoder().decode(res.body));
        const text = parsed.content?.[0]?.text?.trim();
        if (text) summary = text;
      } catch { /* use raw stats */ }

      await ses.send(new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: `📊 Resumen semanal Lux Learning — ${pending.length} reflexión${pending.length !== 1 ? 'es' : ''} pendiente${pending.length !== 1 ? 's' : ''}`, Charset: 'UTF-8' },
          Body: { Html: { Data: weeklyEvaluatorHtml(name, summary, pending.length, courseNames), Charset: 'UTF-8' } },
        },
      }));
      sent++;
      console.log(`[Digest] Evaluator summary → ${email} (${pending.length} pending)`);
    } catch (err) {
      console.warn(`[Digest] Evaluator summary failed for ${email}:`, err);
    }
  }
  return sent;
}

// ── Student weekly digest (Tue + Fri) ─────────────────────────────────────────

function weeklyStudentHtml(name: string, done: number, total: number, pendingItems: string[], weekOf: string): string {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const color = pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444';
  const motivations = [
    '¡Cada lección es un paso más hacia tus metas!',
    'La constancia supera a la intensidad. ¡Un módulo a la vez!',
    'Tu esfuerzo de hoy es tu ventaja de mañana.',
    '¡Sigue adelante — ya llevas un gran avance!',
  ];
  const motivation = motivations[Math.floor(Math.random() * motivations.length)];
  const items = pendingItems.slice(0, 5).map((t) => `<li style="color:#555;margin:6px 0;">${t}</li>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Tu progreso semanal · Semana del ${weekOf}</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Hola ${name}! 👋</h2>
      <div style="text-align:center;padding:24px;background:#F8F8FF;border-radius:12px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:48px;font-weight:700;color:${color};">${pct}%</p>
        <p style="margin:0;color:#555;font-size:14px;">${done} de ${total} actividades completadas esta semana</p>
        <div style="background:#E5E7EB;border-radius:999px;height:8px;margin:16px 0 0;overflow:hidden;">
          <div style="background:${color};height:100%;width:${pct}%;border-radius:999px;"></div>
        </div>
      </div>
      ${pendingItems.length > 0 ? `
      <p style="color:#374151;font-weight:600;margin-bottom:8px;">📋 Actividades pendientes:</p>
      <ul style="padding-left:20px;margin:0 0 24px;">${items}</ul>
      ${pendingItems.length > 5 ? `<p style="color:#888;font-size:12px;">...y ${pendingItems.length - 5} más en tu plan</p>` : ''}
      ` : `<div style="background:#ECFDF5;border-left:4px solid #10B981;padding:16px 20px;border-radius:4px;margin-bottom:24px;"><p style="margin:0;color:#065F46;font-weight:600;">🎉 ¡Completaste todas las actividades de la semana!</p></div>`}
      <div style="background:#F0F7FF;border-left:4px solid #7B2FBE;padding:16px 20px;border-radius:4px;margin-bottom:24px;">
        <p style="margin:0;color:#5B21B6;font-style:italic;">"${motivation}"</p>
      </div>
      <a href="${FRONTEND_URL}/plan" style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;">
        Ver mi plan →
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:32px;">Recibes este email porque estás inscrito en Lux Learning.</p>
    </div>
  </div>
</body></html>`;
}

export async function sendWeeklyStudentDigests(
  ses: SESClient,
  cognito: CognitoIdentityProviderClient,
  fromEmail: string,
): Promise<number> {
  const weekOf = getMonday();

  // Get all enrolled students
  const allEnrollments = await getAllEnrollments().catch(() => [] as any[]);
  const studentIds = [...new Set(allEnrollments.map((e: any) => e.userId as string))];
  if (studentIds.length === 0) return 0;

  // Batch-get study plans for current week
  const plans = await getStudyPlansBatch(studentIds, weekOf);
  const planByUser = new Map(plans.map((p) => [p.userId, p]));

  let sent = 0;
  for (const uid of studentIds) {
    const plan = planByUser.get(uid);
    // Skip students without a plan or with an empty plan
    if (!plan) continue;
    const allItems = plan.days.flatMap((d) => d.items);
    if (allItems.length === 0) continue;

    const done = allItems.filter((i) => i.completed).length;
    const total = allItems.length;
    const pendingItems = allItems.filter((i) => !i.completed).map((i) => i.title);

    try {
      const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: uid }));
      const attr = (n: string) => res.UserAttributes?.find((a) => a.Name === n)?.Value ?? '';
      const email = attr('email');
      const name = attr('name') || email.split('@')[0] || '';
      if (!email) continue;

      await ses.send(new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: `📚 Tu plan de estudio — ${done}/${total} completadas · Lux Learning`, Charset: 'UTF-8' },
          Body: { Html: { Data: weeklyStudentHtml(name, done, total, pendingItems, weekOf), Charset: 'UTF-8' } },
        },
      }));
      sent++;
      console.log(`[Digest] Student digest → ${email} (${done}/${total})`);
    } catch (err) {
      console.warn(`[Digest] Student digest failed for ${uid}:`, err);
    }
  }
  return sent;
}
