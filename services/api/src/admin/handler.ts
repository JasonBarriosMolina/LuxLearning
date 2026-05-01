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
} from '@aws-sdk/client-cognito-identity-provider';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { getPrismaClient } from '../shared/db-neon';
import { createEnrollment, getEnrollments, deleteEnrollment } from '../shared/db-dynamo';
import { ok, created, badRequest, forbidden, notFound, serverError, cors } from '../shared/response';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
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
      const { title, slug, description, imageUrl, isActive, isPilot } = body;
      if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
      const course = await prisma.course.create({
        data: { title, slug, description, imageUrl: imageUrl || null, isActive: isActive ?? false, isPilot: isPilot ?? false },
      });
      return created(course);
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
        const { title, slug, description, imageUrl, isActive, isPilot } = body;
        if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
        const course = await prisma.course.update({
          where: { id: courseId },
          data: { title, slug, description, imageUrl: imageUrl || null, isActive, isPilot },
        });
        return ok(course);
      }

      if (method === 'DELETE') {
        await prisma.course.delete({ where: { id: courseId } });
        return ok({ deleted: true });
      }
    }

    // ── POST /admin/courses/:courseId/modules ───────────────────────────────
    const courseModulesMatch = path.match(/^\/admin\/courses\/([^/]+)\/modules$/);
    if (courseModulesMatch && method === 'POST') {
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
        await prisma.module.delete({ where: { id: moduleId } });
        return ok({ deleted: true });
      }
    }

    // ── POST /admin/modules/:moduleId/lessons ───────────────────────────────
    const moduleLessonsMatch = path.match(/^\/admin\/modules\/([^/]+)\/lessons$/);
    if (moduleLessonsMatch && method === 'POST') {
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
        await prisma.lesson.delete({ where: { id: lessonId } });
        return ok({ deleted: true });
      }
    }

    // ── POST /admin/modules/:moduleId/questions ─────────────────────────────
    const moduleQuestionsMatch = path.match(/^\/admin\/modules\/([^/]+)\/questions$/);
    if (moduleQuestionsMatch && method === 'POST') {
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
        await prisma.question.delete({ where: { id: questionId } });
        return ok({ deleted: true });
      }
    }

    // ── GET /admin/users ────────────────────────────────────────────────────
    if (path === '/admin/users' && method === 'GET') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

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
        return {
          username,
          email: attr(u, 'email'),
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
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const username = decodeURIComponent(userEnrollmentsMatch[1]!);

      if (method === 'GET') {
        const courseIds = await getEnrollments(username);
        return ok({ courseIds });
      }

      if (method === 'POST') {
        const { courseId } = body;
        if (!courseId) return badRequest('courseId es requerido');
        await createEnrollment(username, courseId);
        return ok({ enrolled: true });
      }

      if (method === 'DELETE') {
        const { courseId } = body;
        if (!courseId) return badRequest('courseId es requerido');
        await deleteEnrollment(username, courseId);
        return ok({ removed: true });
      }
    }

    return notFound('Ruta no encontrada');
  } catch (err) {
    return serverError(err);
  }
};
