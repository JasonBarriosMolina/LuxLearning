import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { getPrismaClient } from '../shared/db-neon';
import { createEnrollment, getEnrollments, deleteEnrollment, getAllReflections, getAllLessonProgress, getAllEnrollments, saveAiJob, getAiJob } from '../shared/db-dynamo';
import { ok, created, badRequest, forbidden, notFound, serverError, cors } from '../shared/response';
import { jsonrepair } from 'jsonrepair';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.com';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://luxlearning.com';

function invitationEmailHtml(name: string, email: string, temporaryPassword: string, courseNames: string[]): string {
  const coursesBlock = courseNames.length > 0
    ? `<p style="color:#555;line-height:1.6;">Has sido inscrito en:</p>
       <ul style="color:#555;line-height:1.8;padding-left:20px;">${courseNames.map((c) => `<li><strong>${c}</strong></li>`).join('')}</ul>`
    : '';
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
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Bienvenido a Lux Learning!</h2>
      <p style="color:#555;line-height:1.6;">Hola ${name || email.split('@')[0]},</p>
      <p style="color:#555;line-height:1.6;">Tu cuenta ha sido creada. Aquí están tus credenciales de acceso:</p>
      <div style="background:#F8F8F8;border-left:4px solid #00B4D8;padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0 0 8px;color:#555;"><strong>Correo:</strong> ${email}</p>
        <p style="margin:0;color:#555;"><strong>Contraseña temporal:</strong> <span style="font-family:monospace;font-size:16px;color:#7B2FBE;">${temporaryPassword}</span></p>
      </div>
      <p style="color:#888;font-size:13px;">Se te pedirá cambiar tu contraseña al iniciar sesión por primera vez.</p>
      ${coursesBlock}
      <a href="${FRONTEND_URL}/auth/login"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:16px;">
        Iniciar sesión
      </a>
    </div>
  </div>
</body>
</html>`;
}

function enrollmentEmailHtml(name: string, courseName: string): string {
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
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Tienes un nuevo curso!</h2>
      <p style="color:#555;line-height:1.6;">Hola ${name},</p>
      <p style="color:#555;line-height:1.6;">Has sido inscrito en el siguiente curso:</p>
      <div style="background:#F0F7FF;border-left:4px solid #00B4D8;padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0;color:#2C2C2C;font-size:16px;font-weight:600;">📚 ${courseName}</p>
      </div>
      <p style="color:#555;line-height:1.6;">Ingresa a la plataforma para comenzar tu aprendizaje.</p>
      <a href="${FRONTEND_URL}/courses"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:16px;">
        Ver mis cursos
      </a>
    </div>
  </div>
</body>
</html>`;
}

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<
  APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }
>;

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

function isAuthorized(event: Event): boolean {
  const role = event.requestContext.authorizer?.lambda?.role;
  return role === 'ADMIN' || role === 'EVALUATOR';
}

function isAdmin(event: Event): boolean {
  return event.requestContext.authorizer?.lambda?.role === 'ADMIN';
}

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();
  if (!isAuthorized(event)) return forbidden('Se requiere rol de evaluador o administrador');

  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const prisma = getPrismaClient();

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // ── GET /admin/courses ──────────────────────────────────────────────────
    if (path === '/admin/courses' && method === 'GET') {
      const courses = await prisma.course.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          modules: {
            orderBy: { order: 'asc' },
            select: {
              id: true, order: true, title: true, duration: true, passingScore: true,
              _count: { select: { lessons: true, questions: true } },
            },
          },
        },
      });
      return ok(courses);
    }

    // ── POST /admin/courses ─────────────────────────────────────────────────
    if (path === '/admin/courses' && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const { title, slug, description, imageUrl, isActive, isPilot, tags, startDate, closeDate } = body;
      if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
      const course = await prisma.course.create({
        data: {
          title, slug, description,
          imageUrl: imageUrl || null,
          isActive: isActive ?? false,
          isPilot: isPilot ?? false,
          tags: Array.isArray(tags) ? tags : [],
          startDate: startDate ? new Date(startDate) : null,
          closeDate: closeDate ? new Date(closeDate) : null,
        },
      });
      return created(course);
    }

    // ── GET /admin/courses/ai-job — poll async job status ──────────────────────
    if (path === '/admin/courses/ai-job' && method === 'GET') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador');
      const jobId = event.queryStringParameters?.jobId;
      if (!jobId) return badRequest('jobId es requerido');
      const job = await getAiJob(jobId);
      if (!job) return notFound('Job no encontrado');
      return ok(job);
    }

    // ── /admin/courses/:courseId ────────────────────────────────────────────
    const courseMatch = path.match(/^\/admin\/courses\/([^/]+)$/);
    if (courseMatch) {
      const courseId = courseMatch[1]!;

      if (method === 'GET') {
        const course = await prisma.course.findUnique({
          where: { id: courseId },
          include: {
            modules: {
              orderBy: { order: 'asc' },
              include: {
                lessons: { orderBy: { order: 'asc' } },
                questions: { orderBy: { order: 'asc' } },
              },
            },
          },
        });
        if (!course) return notFound('Curso no encontrado');
        return ok(course);
      }

      if (method === 'PUT') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        const { title, slug, description, imageUrl, isActive, isPilot, tags, startDate, closeDate } = body;
        if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
        const course = await prisma.course.update({
          where: { id: courseId },
          data: {
            title, slug, description,
            imageUrl: imageUrl || null,
            isActive, isPilot,
            tags: Array.isArray(tags) ? tags : [],
            startDate: startDate ? new Date(startDate) : null,
            closeDate: closeDate ? new Date(closeDate) : null,
          },
        });
        return ok(course);
      }

      if (method === 'DELETE') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        await prisma.course.delete({ where: { id: courseId } });
        return ok({ deleted: true });
      }
    }

    // ── POST /admin/courses/:courseId/modules ───────────────────────────────
    const courseModulesMatch = path.match(/^\/admin\/courses\/([^/]+)\/modules$/);
    if (courseModulesMatch && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const courseId = courseModulesMatch[1]!;
      const { title, description, duration, passingScore, order } = body;
      if (!title || !description || !duration || passingScore == null) {
        return badRequest('title, description, duration y passingScore son requeridos');
      }
      let moduleOrder = order;
      if (moduleOrder == null) {
        const count = await prisma.module.count({ where: { courseId } });
        moduleOrder = count + 1;
      }
      const mod = await prisma.module.create({
        data: { courseId, title, description, duration, passingScore: Number(passingScore), order: moduleOrder },
      });
      return created(mod);
    }

    // ── /admin/modules/:moduleId ────────────────────────────────────────────
    const moduleMatch = path.match(/^\/admin\/modules\/([^/]+)$/);
    if (moduleMatch) {
      const moduleId = moduleMatch[1]!;

      if (method === 'PUT') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        const { title, description, duration, passingScore, order } = body;
        if (!title || !description || !duration || passingScore == null) {
          return badRequest('title, description, duration y passingScore son requeridos');
        }
        const mod = await prisma.module.update({
          where: { id: moduleId },
          data: { title, description, duration, passingScore: Number(passingScore), order: Number(order) },
        });
        return ok(mod);
      }

      if (method === 'DELETE') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        await prisma.module.delete({ where: { id: moduleId } });
        return ok({ deleted: true });
      }
    }

    // ── POST /admin/modules/:moduleId/lessons ───────────────────────────────
    const moduleLessonsMatch = path.match(/^\/admin\/modules\/([^/]+)\/lessons$/);
    if (moduleLessonsMatch && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const moduleId = moduleLessonsMatch[1]!;
      const { title, duration, youtubeId, imageUrl, points, tip, order } = body;
      if (!title || !duration || !youtubeId) {
        return badRequest('title, duration y youtubeId son requeridos');
      }
      let lessonOrder = order;
      if (lessonOrder == null) {
        const count = await prisma.lesson.count({ where: { moduleId } });
        lessonOrder = count + 1;
      }
      const lesson = await prisma.lesson.create({
        data: {
          moduleId, title, duration, youtubeId,
          imageUrl: imageUrl || null,
          points: Array.isArray(points) ? points : [],
          tip: tip ?? '',
          order: Number(lessonOrder),
        },
      });
      return created(lesson);
    }

    // ── /admin/lessons/:lessonId ────────────────────────────────────────────
    const lessonMatch = path.match(/^\/admin\/lessons\/([^/]+)$/);
    if (lessonMatch) {
      const lessonId = lessonMatch[1]!;

      if (method === 'PUT') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        const { title, duration, youtubeId, imageUrl, points, tip, order } = body;
        if (!title || !duration || !youtubeId) {
          return badRequest('title, duration y youtubeId son requeridos');
        }
        const lesson = await prisma.lesson.update({
          where: { id: lessonId },
          data: {
            title, duration, youtubeId,
            imageUrl: imageUrl || null,
            points: Array.isArray(points) ? points : [],
            tip: tip ?? '',
            order: Number(order),
          },
        });
        return ok(lesson);
      }

      if (method === 'DELETE') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        await prisma.lesson.delete({ where: { id: lessonId } });
        return ok({ deleted: true });
      }
    }

    // ── POST /admin/modules/:moduleId/questions ─────────────────────────────
    const moduleQuestionsMatch = path.match(/^\/admin\/modules\/([^/]+)\/questions$/);
    if (moduleQuestionsMatch && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const moduleId = moduleQuestionsMatch[1]!;
      const { text, options, correctIndex, order } = body;
      if (!text || !Array.isArray(options) || options.length < 2 || correctIndex == null) {
        return badRequest('text, options (mínimo 2) y correctIndex son requeridos');
      }
      let questionOrder = order;
      if (questionOrder == null) {
        const count = await prisma.question.count({ where: { moduleId } });
        questionOrder = count + 1;
      }
      const question = await prisma.question.create({
        data: { moduleId, text, options, correctIndex: Number(correctIndex), order: Number(questionOrder) },
      });
      return created(question);
    }

    // ── /admin/questions/:questionId ────────────────────────────────────────
    const questionMatch = path.match(/^\/admin\/questions\/([^/]+)$/);
    if (questionMatch) {
      const questionId = questionMatch[1]!;

      if (method === 'PUT') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        const { text, options, correctIndex, order } = body;
        if (!text || !Array.isArray(options) || options.length < 2 || correctIndex == null) {
          return badRequest('text, options (mínimo 2) y correctIndex son requeridos');
        }
        const question = await prisma.question.update({
          where: { id: questionId },
          data: { text, options, correctIndex: Number(correctIndex), order: Number(order) },
        });
        return ok(question);
      }

      if (method === 'DELETE') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        await prisma.question.delete({ where: { id: questionId } });
        return ok({ deleted: true });
      }
    }

    // ── GET /admin/users ────────────────────────────────────────────────────
    if (path === '/admin/users' && method === 'GET') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');

      // Fetch all users + group memberships in parallel
      const [usersRes, evaluatorsRes, adminsRes] = await Promise.all([
        cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 })),
        cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: 'EVALUATOR', Limit: 60 })),
        cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: 'ADMIN', Limit: 60 })),
      ]);

      const evaluatorUsernames = new Set((evaluatorsRes.Users ?? []).map((u) => u.Username));
      const adminUsernames = new Set((adminsRes.Users ?? []).map((u) => u.Username));

      const attr = (user: { Attributes?: { Name?: string; Value?: string }[] }, name: string) =>
        user.Attributes?.find((a) => a.Name === name)?.Value ?? '';

      const users = (usersRes.Users ?? []).map((u) => {
        const username = u.Username ?? '';
        const role = adminUsernames.has(username) ? 'ADMIN'
          : evaluatorUsernames.has(username) ? 'EVALUATOR'
          : 'STUDENT';
        const email = attr(u, 'email') || username; // fallback to username (which is email for admin-created users)
        return {
          username,
          email,
          name: attr(u, 'name'),
          role,
          enabled: u.Enabled ?? true,
          status: u.UserStatus ?? 'UNKNOWN',
          createdAt: u.UserCreateDate?.toISOString() ?? null,
        };
      });

      // Sort: ADMIN first, then EVALUATOR, then STUDENT, then by email
      const roleOrder = { ADMIN: 0, EVALUATOR: 1, STUDENT: 2 };
      users.sort((a, b) =>
        (roleOrder[a.role as keyof typeof roleOrder] ?? 2) - (roleOrder[b.role as keyof typeof roleOrder] ?? 2) ||
        a.email.localeCompare(b.email)
      );

      return ok(users);
    }

    // ── POST /admin/users — invite/create user ──────────────────────────────
    if (path === '/admin/users' && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

      const { email, role = 'STUDENT', name, courseIds } = body as { email: string; role?: string; name?: string; courseIds?: string[] };
      if (!email) return badRequest('email es requerido');
      if (!['STUDENT', 'EVALUATOR', 'ADMIN'].includes(role)) return badRequest('rol inválido');

      // Generate a secure temporary password that meets Cognito policy
      // (8+ chars, uppercase, lowercase, digits)
      const chars = 'abcdefghijklmnopqrstuvwxyz';
      const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const digits = '0123456789';
      const rand = (s: string) => s[Math.floor(Math.random() * s.length)];
      const temporaryPassword = [
        rand(uppers), rand(uppers),
        rand(chars), rand(chars), rand(chars), rand(chars),
        rand(digits), rand(digits),
      ].sort(() => Math.random() - 0.5).join('');

      // Create user with SUPPRESS — admin shares password through their own channel
      const createRes = await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        TemporaryPassword: temporaryPassword,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          ...(name ? [{ Name: 'name', Value: name }] : []),
        ],
      }));

      const username = createRes.User?.Username ?? email;

      // Add to role group
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: role === 'EVALUATOR' || role === 'ADMIN' ? role : 'STUDENT',
      }));

      // Enroll in courses if provided
      let courseNames: string[] = [];
      if (Array.isArray(courseIds) && courseIds.length > 0) {
        await Promise.all(courseIds.map((cid) => createEnrollment(username, cid)));
        // Fetch course names for the email
        try {
          const courses = await prisma.course.findMany({ where: { id: { in: courseIds } }, select: { title: true } });
          courseNames = courses.map((c) => c.title);
        } catch { /* non-fatal */ }
      }

      // Send welcome email via SES
      try {
        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Data: '¡Bienvenido a Lux Learning! — Tu cuenta está lista', Charset: 'UTF-8' },
            Body: { Html: { Data: invitationEmailHtml(name ?? '', email, temporaryPassword, courseNames), Charset: 'UTF-8' } },
          },
        }));
      } catch (emailErr) {
        console.warn('[Admin] Invitation email failed (non-fatal):', emailErr);
      }

      return created({ username, email, role, status: 'FORCE_CHANGE_PASSWORD', temporaryPassword, courseIds: courseIds ?? [] });
    }

    // ── PUT /admin/users/:username/role ─────────────────────────────────────
    const userRoleMatch = path.match(/^\/admin\/users\/([^/]+)\/role$/);
    if (userRoleMatch && method === 'PUT') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

      const username = decodeURIComponent(userRoleMatch[1]!);
      const { role } = body as { role: string };
      if (!['STUDENT', 'EVALUATOR', 'ADMIN'].includes(role)) return badRequest('rol inválido');

      // Remove from all groups first, then add to new one
      await Promise.allSettled([
        cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: 'STUDENT' })),
        cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: 'EVALUATOR' })),
        cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: 'ADMIN' })),
      ]);

      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: role,
      }));

      return ok({ username, role });
    }

    // ── PUT /admin/users/:username/status ───────────────────────────────────
    const userStatusMatch = path.match(/^\/admin\/users\/([^/]+)\/status$/);
    if (userStatusMatch && method === 'PUT') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

      const username = decodeURIComponent(userStatusMatch[1]!);
      const { enabled } = body as { enabled: boolean };

      if (enabled) {
        await cognito.send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
      } else {
        await cognito.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
      }

      return ok({ username, enabled });
    }

    // ── DELETE /admin/users/:username ───────────────────────────────────────
    const userDeleteMatch = path.match(/^\/admin\/users\/([^/]+)$/);
    if (userDeleteMatch && method === 'DELETE') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

      const username = decodeURIComponent(userDeleteMatch[1]!);
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
      return ok({ deleted: true });
    }

    // ── /admin/users/:username/enrollments ──────────────────────────────────
    const userEnrollmentsMatch = path.match(/^\/admin\/users\/([^/]+)\/enrollments$/);
    if (userEnrollmentsMatch) {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const username = decodeURIComponent(userEnrollmentsMatch[1]!);

      if (method === 'GET') {
        const courseIds = await getEnrollments(username);
        return ok({ courseIds });
      }

      if (method === 'POST') {
        const { courseId } = body;
        if (!courseId) return badRequest('courseId es requerido');
        await createEnrollment(username, courseId);

        // Send enrollment notification email
        try {
          const [userRes, course] = await Promise.all([
            cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username })),
            prisma.course.findUnique({ where: { id: courseId }, select: { title: true } }),
          ]);
          const emailAttr = userRes.UserAttributes?.find((a) => a.Name === 'email')?.Value;
          const nameAttr = userRes.UserAttributes?.find((a) => a.Name === 'name')?.Value;
          if (emailAttr && course) {
            await ses.send(new SendEmailCommand({
              Source: FROM_EMAIL,
              Destination: { ToAddresses: [emailAttr] },
              Message: {
                Subject: { Data: `¡Nuevo curso disponible: ${course.title}!`, Charset: 'UTF-8' },
                Body: { Html: { Data: enrollmentEmailHtml(nameAttr || emailAttr.split('@')[0], course.title), Charset: 'UTF-8' } },
              },
            }));
          }
        } catch (e) { console.warn('Enrollment email failed:', e); }

        return ok({ enrolled: true });
      }

      if (method === 'DELETE') {
        const { courseId } = body;
        if (!courseId) return badRequest('courseId es requerido');
        await deleteEnrollment(username, courseId);
        return ok({ removed: true });
      }
    }

    // ── GET /admin/reports ──────────────────────────────────────────────────
    if (path === '/admin/reports' && method === 'GET') {
      // Both EVALUATOR and ADMIN can view reports

      const [allReflections, allProgress, allEnrollments, courses] = await Promise.all([
        getAllReflections(),
        getAllLessonProgress(),
        getAllEnrollments(),
        prisma.course.findMany({
          include: {
            modules: {
              orderBy: { order: 'asc' },
              include: { lessons: { select: { id: true } } },
            },
          },
        }),
      ]);

      // ── Tasa de aprobación por módulo ──────────────────────────────────────
      const moduleMap = new Map<string, { title: string; courseTitle: string; total: number; approved: number; rejected: number; avgDaysToReview: number; totalReviewTime: number; reviewedCount: number }>();
      courses.forEach((c) =>
        c.modules.forEach((m) => moduleMap.set(m.id, { title: m.title, courseTitle: c.title, total: 0, approved: 0, rejected: 0, avgDaysToReview: 0, totalReviewTime: 0, reviewedCount: 0 }))
      );

      allReflections.forEach((r) => {
        const entry = moduleMap.get(r.moduleId);
        if (!entry) return;
        entry.total++;
        if (r.status === 'APPROVED') entry.approved++;
        if (r.status === 'REJECTED') entry.rejected++;
        if ((r.status === 'APPROVED' || r.status === 'REJECTED') && (r as any).reviewedAt && r.submittedAt) {
          const ms = new Date((r as any).reviewedAt).getTime() - new Date(r.submittedAt).getTime();
          if (ms > 0) {
            entry.totalReviewTime += ms;
            entry.reviewedCount++;
          }
        }
      });

      const moduleStats = Array.from(moduleMap.entries()).map(([moduleId, e]) => ({
        moduleId,
        title: e.title,
        courseTitle: e.courseTitle,
        total: e.total,
        approved: e.approved,
        rejected: e.rejected,
        approvalRate: e.total > 0 ? Math.round((e.approved / e.total) * 100) : null,
        avgHoursToReview: e.reviewedCount > 0 ? Math.round(e.totalReviewTime / e.reviewedCount / 3600000 * 10) / 10 : null,
      })).filter((m) => m.total > 0).sort((a, b) => (b.approvalRate ?? 0) - (a.approvalRate ?? 0));

      // ── Estudiantes en riesgo (inscrito, sin actividad en >7 días) ─────────
      const INACTIVITY_DAYS = 7;
      const now = Date.now();
      const lastActivityByStudent = new Map<string, number>();

      allProgress.forEach((p) => {
        const t = new Date(p.completedAt).getTime();
        if (!lastActivityByStudent.has(p.userId) || t > lastActivityByStudent.get(p.userId)!) {
          lastActivityByStudent.set(p.userId, t);
        }
      });
      allReflections.forEach((r) => {
        const t = new Date(r.submittedAt).getTime();
        if (!lastActivityByStudent.has(r.userId) || t > lastActivityByStudent.get(r.userId)!) {
          lastActivityByStudent.set(r.userId, t);
        }
      });

      const enrolledUserIds = [...new Set(allEnrollments.map((e) => e.userId))];
      const atRiskStudents = enrolledUserIds.filter((uid) => {
        const last = lastActivityByStudent.get(uid);
        if (!last) return true; // never active
        return (now - last) / 86400000 > INACTIVITY_DAYS;
      }).length;

      // ── Totals ─────────────────────────────────────────────────────────────
      const totalReflections = allReflections.length;
      const totalApproved = allReflections.filter((r) => r.status === 'APPROVED').length;
      const totalRejected = allReflections.filter((r) => r.status === 'REJECTED').length;
      const totalPending = allReflections.filter((r) => r.status === 'PENDING_EVAL').length;
      const overallApprovalRate = totalReflections > 0 ? Math.round((totalApproved / totalReflections) * 100) : 0;
      const totalEnrolled = enrolledUserIds.length;
      const activeStudents = enrolledUserIds.filter((uid) => {
        const last = lastActivityByStudent.get(uid);
        return last && (now - last) / 86400000 <= 7;
      }).length;

      // ── Avg quality score ──────────────────────────────────────────────────
      const scored = allReflections.filter((r) => (r as any).qualityScore != null);
      const avgQuality = scored.length > 0
        ? Math.round(scored.reduce((sum, r) => sum + ((r as any).qualityScore ?? 0), 0) / scored.length * 10) / 10
        : null;

      return ok({
        summary: { totalReflections, totalApproved, totalRejected, totalPending, overallApprovalRate, totalEnrolled, activeStudents, atRiskStudents, avgQuality },
        moduleStats,
      });
    }

    // ── POST /admin/courses/ai-generate ────────────────────────────────────────
    if (path === '/admin/courses/ai-generate' && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const { method: genMethod, input, _jobId, _context } = body as { method?: string; input?: string; _jobId?: string; _context?: string };

      // ── ASYNC WORKER: invoked by self with _jobId ─────────────────────────
      if (_jobId && _context) {
        // This branch runs as a fire-and-forget Lambda invocation — no API GW timeout
        const context = _context;

        // ── Bedrock helper ───────────────────────────────────────────────────
        // Escape control chars ONLY inside JSON string values (not structural whitespace)
        const fixJsonControlChars = (str: string): string => {
          let out = ''; let inStr = false; let esc = false;
          for (let i = 0; i < str.length; i++) {
            const c = str[i]!; const code = str.charCodeAt(i);
            if (esc) { out += c; esc = false; continue; }
            if (c === '\\' && inStr) { out += c; esc = true; continue; }
            if (c === '"') { inStr = !inStr; out += c; continue; }
            if (inStr && code < 0x20) {
              if (code === 0x0A) out += '\\n';
              else if (code === 0x0D) out += '\\r';
              else if (code === 0x09) out += '\\t';
              else out += `\\u${code.toString(16).padStart(4, '0')}`;
            } else { out += c; }
          }
          return out;
        };

        const bedrockJSON = async (prompt: string, maxTokens = 2000): Promise<any> => {
          const res = await bedrock.send(new InvokeModelCommand({
            modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: maxTokens,
              messages: [{ role: 'user', content: prompt }],
            }),
          }));
          const parsed = JSON.parse(new TextDecoder().decode(res.body));
          const raw = (parsed.content?.[0]?.text ?? '{}').replace(/```json\s*|```/g, '').trim();
          const match = raw.match(/[\[{][\s\S]*/);
          const jsonStr = fixJsonControlChars(match?.[0] ?? '{}');
          try { return JSON.parse(jsonStr); } catch {
            // Use jsonrepair to fix unescaped quotes, trailing commas, truncation, etc.
            try { return JSON.parse(jsonrepair(jsonStr)); } catch {
              return {};
            }
          }
        };

        try {
          // FASE 1: Estructura
          const structure = await bedrockJSON(`Eres un experto en diseño instruccional. Para un curso sobre:
"""
${context.slice(0, 3000)}
"""
Determina cuántos módulos necesita este curso según la complejidad del tema (mínimo 5, máximo 10). Genera la estructura en JSON. Responde ÚNICAMENTE con JSON válido:
{"title":"Título del curso","description":"Descripción 2-3 oraciones","modules":[{"order":1,"title":"Módulo 1","description":"Descripción breve"},{"order":2,"title":"Módulo 2","description":"Descripción breve"},{"order":3,"title":"Módulo 3","description":"Descripción breve"}]}`, 1200);

          if (!structure.title || !Array.isArray(structure.modules)) throw new Error('Estructura inválida');

          // FASE 2: Módulos en paralelo — cada uno genera lecciones y preguntas simultáneamente
          const generateModule = async (mod: { order: number; title: string; description: string }) => {
            const [lessons, questions] = await Promise.all([
              bedrockJSON(`Eres experto en diseño instruccional. Genera las 10 lecciones del módulo "${mod.title}" del curso "${structure.title}".
Responde ÚNICAMENTE con array JSON válido. Cada lección incluye: title, order, type, content, duration, points (array 3 frases cortas), tip (1 consejo práctico).
[
{"title":"Introducción — ${mod.title}","order":1,"type":"video","content":"<p>Escribe 1 párrafo introductorio sobre qué aprenderá el estudiante en ${mod.title} y por qué es importante.</p>","duration":"5 min","points":["Concepto clave 1 de ${mod.title}","Concepto clave 2","Para qué sirve este módulo"],"tip":"Toma notas de los conceptos que te resulten nuevos."},
{"title":"Subtema A","order":2,"type":"text","content":"<p>Párrafo 1 educativo real sobre subtema de ${mod.title}.</p><p>Párrafo 2 con más detalle y ejemplos.</p>","duration":"8 min","points":["Punto clave 1","Punto clave 2","Punto clave 3"],"tip":"Consejo práctico aplicable al subtema."},
{"title":"Subtema B","order":3,"type":"text","content":"<p>Párrafo 1.</p><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip práctico."},
{"title":"Subtema C","order":4,"type":"text","content":"<p>Párrafo 1.</p><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema D","order":5,"type":"text","content":"<p>Párrafo 1.</p><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema E","order":6,"type":"text","content":"<p>Párrafo 1.</p><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema F","order":7,"type":"text","content":"<p>Párrafo 1.</p><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema G","order":8,"type":"text","content":"<p>Párrafo 1.</p><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema H","order":9,"type":"text","content":"<p>Párrafo 1.</p><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Resumen y cierre — ${mod.title}","order":10,"type":"video","content":"<p>Escribe 1 párrafo que resuma los conceptos principales aprendidos en ${mod.title} y los próximos pasos del estudiante.</p>","duration":"5 min","points":["Resumen concepto 1","Resumen concepto 2","Próximos pasos"],"tip":"Completa el quiz para afianzar lo aprendido."}
]
REGLAS ESTRICTAS: 10 lecciones exactas. TODAS deben tener content real en español con etiquetas <p>. points y tip ESPECÍFICOS al tema real. Sin markdown, sin comillas dentro del content. Genera contenido educativo auténtico, no ejemplos genéricos.`, 4000),

              bedrockJSON(`Genera 10 preguntas de opción múltiple en español para el módulo "${mod.title}" del curso "${structure.title}".
Responde ÚNICAMENTE con array JSON válido:
[
{"text":"¿Pregunta real sobre ${mod.title}?","options":["Respuesta correcta","Distractor B","Distractor C","Distractor D"],"correctIndex":0,"order":1},
{"text":"¿Pregunta 2?","options":["Op A","Op B","Op C","Op D"],"correctIndex":1,"order":2},
{"text":"¿Pregunta 3?","options":["Op A","Op B","Op C","Op D"],"correctIndex":2,"order":3},
{"text":"¿Pregunta 4?","options":["Op A","Op B","Op C","Op D"],"correctIndex":0,"order":4},
{"text":"¿Pregunta 5?","options":["Op A","Op B","Op C","Op D"],"correctIndex":3,"order":5},
{"text":"¿Pregunta 6?","options":["Op A","Op B","Op C","Op D"],"correctIndex":1,"order":6},
{"text":"¿Pregunta 7?","options":["Op A","Op B","Op C","Op D"],"correctIndex":0,"order":7},
{"text":"¿Pregunta 8?","options":["Op A","Op B","Op C","Op D"],"correctIndex":2,"order":8},
{"text":"¿Pregunta 9?","options":["Op A","Op B","Op C","Op D"],"correctIndex":1,"order":9},
{"text":"¿Pregunta 10?","options":["Op A","Op B","Op C","Op D"],"correctIndex":3,"order":10}
]
REGLAS: 10 preguntas exactas, opciones reales (no "Op A"), específicas al tema "${mod.title}", correctIndex 0-3. Sin markdown.`, 1500),
            ]);

            // Garantizar que TODAS las lecciones tengan content
            const finalLessons = Array.isArray(lessons) ? await Promise.all(lessons.map(async (l: any) => {
              if (l.content && l.content.trim().length > 10) return l;
              // Si falta content, generarlo individualmente
              const fallback = await bedrockJSON(
                `Genera el contenido educativo en español para la lección "${l.title}" del módulo "${mod.title}" del curso "${structure.title}".
Responde ÚNICAMENTE con JSON válido: {"content":"<p>Párrafo 1 educativo real sobre el tema.</p><p>Párrafo 2 con más detalle.</p>","points":["Punto clave 1","Punto clave 2","Punto clave 3"],"tip":"Consejo práctico."}
Sin markdown. Contenido auténtico y específico.`, 800
              );
              return {
                ...l,
                content: fallback.content ?? `<p>Introducción a ${l.title} en el contexto de ${mod.title}.</p>`,
                points: fallback.points?.length ? fallback.points : (l.points?.length ? l.points : [`Concepto clave de ${l.title}`]),
                tip: fallback.tip ?? l.tip ?? 'Repasa los puntos clave antes de continuar.',
              };
            })) : [];

            return { order: mod.order, title: mod.title, description: mod.description,
              lessons: finalLessons,
              questions: Array.isArray(questions) ? questions : [] };
          };

          const modulesWithContent = await Promise.all(structure.modules.map((mod: any) => generateModule(mod)));
          const result = { title: structure.title, description: structure.description,
            modules: modulesWithContent.sort((a: any, b: any) => a.order - b.order) };

          await saveAiJob(_jobId, { status: 'done', result });
        } catch (err: any) {
          await saveAiJob(_jobId, { status: 'error', error: err.message ?? 'Error desconocido' });
        }
        return ok({ ok: true }); // async invocation ignores response
      }

      // ── DISPATCH: first call — save job and fire async ────────────────────
      if (!input) return badRequest('input es requerido');
      let context = input;
      if (genMethod === 'url') {
        try {
          const res = await fetch(input, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
          const html = await res.text();
          context = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 4000);
        } catch { return badRequest('No se pudo obtener contenido de la URL'); }
      }

      const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await saveAiJob(jobId, { status: 'processing' });

      // Fire-and-forget: invoke self async bypassing API GW timeout
      const asyncPayload = {
        requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
        rawPath: '/admin/courses/ai-generate',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ _jobId: jobId, _context: context }),
      };
      await lambdaClient.send(new LambdaInvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
        InvocationType: 'Event', // async — no wait for response
        Payload: Buffer.from(JSON.stringify(asyncPayload)),
      }));

      return ok({ jobId });
    }

    // ── POST /admin/courses/ai-publish ──────────────────────────────────────────
    if (path === '/admin/courses/ai-publish' && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const { title, description, modules } = body as {
        title?: string;
        description?: string;
        modules?: {
          title: string;
          description: string;
          order: number;
          lessons: { title: string; order: number; type?: string; content?: string }[];
          questions?: { text: string; options: string[]; correctIndex: number; order: number }[];
        }[];
      };
      if (!title || !modules || !Array.isArray(modules)) return badRequest('title y modules son requeridos');

      const slug = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        + '-' + Math.random().toString(36).slice(2, 8);

      const course = await prisma.course.create({
        data: {
          title,
          slug,
          description: description ?? '',
          isActive: false,
          isPilot: false,
          tags: ['ia-generado'],
          modules: {
            create: modules.map((m) => ({
              title: m.title,
              description: m.description ?? '',
              order: m.order,
              duration: `${(m.lessons?.length ?? 0) * 5} min`,
              passingScore: 70,
              lessons: {
                create: (m.lessons ?? []).map((l) => ({
                  title: l.title,
                  order: l.order,
                  duration: l.duration ?? (l.type === 'video' ? '5 min' : '8 min'),
                  type: l.type ?? 'video',
                  youtubeId: '',
                  content: l.content ?? null,
                  points: Array.isArray(l.points) ? l.points : [],
                  tip: l.tip ?? '',
                })),
              },
              questions: {
                create: (m.questions ?? []).map((q) => ({
                  text: q.text,
                  options: q.options,
                  correctIndex: Number(q.correctIndex),
                  order: q.order,
                })),
              },
            })),
          },
        },
        include: {
          modules: {
            orderBy: { order: 'asc' },
            include: {
              lessons: { orderBy: { order: 'asc' } },
              questions: { orderBy: { order: 'asc' } },
            },
          },
        },
      });
      return created(course);
    }

    return notFound('Ruta no encontrada');
  } catch (err) {
    return serverError(err);
  }
};
