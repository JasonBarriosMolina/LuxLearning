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
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getPrismaClient } from '../shared/db-neon';
import { createEnrollment, getEnrollments, deleteEnrollment, getAllReflections, getAllLessonProgress, getAllEnrollments } from '../shared/db-dynamo';
import { ok, created, badRequest, forbidden, notFound, serverError, cors } from '../shared/response';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
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
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const { title, slug, description, imageUrl, isActive, isPilot, tags } = body;
      if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
      const course = await prisma.course.create({
        data: { title, slug, description, imageUrl: imageUrl || null, isActive: isActive ?? false, isPilot: isPilot ?? false, tags: Array.isArray(tags) ? tags : [] },
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
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        const { title, slug, description, imageUrl, isActive, isPilot, tags } = body;
        if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
        const course = await prisma.course.update({
          where: { id: courseId },
          data: { title, slug, description, imageUrl: imageUrl || null, isActive, isPilot, tags: Array.isArray(tags) ? tags : [] },
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
      const { method: genMethod, input } = body as { method?: string; input?: string };
      if (!input) return badRequest('input es requerido');

      let context = input;

      // For URL method: fetch and strip HTML
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
        } catch {
          return badRequest('No se pudo obtener contenido de la URL');
        }
      }

      const prompt = `Eres un experto en diseño instruccional. Genera un curso completo en español con 7-10 módulos sobre el siguiente tema o contenido:

"""
${context.slice(0, 4000)}
"""

Responde ÚNICAMENTE con JSON válido (sin markdown, sin comentarios):
{
  "title": "Título del curso",
  "description": "Descripción del curso en 2-3 oraciones",
  "modules": [
    {
      "title": "Título del módulo",
      "description": "Descripción del módulo",
      "order": 1,
      "lessons": [
        { "title": "Introducción — [tema del módulo]", "order": 1, "type": "video", "content": "" },
        { "title": "Título lección de texto", "order": 2, "type": "text", "content": "Escribe aquí 3-5 párrafos educativos y detallados sobre este subtema específico del módulo. El contenido debe ser informativo, claro y útil para el estudiante." },
        { "title": "Título lección de texto", "order": 3, "type": "text", "content": "3-5 párrafos sobre otro subtema..." },
        { "title": "Título lección de texto", "order": 4, "type": "text", "content": "3-5 párrafos..." },
        { "title": "Título lección de texto", "order": 5, "type": "text", "content": "3-5 párrafos..." },
        { "title": "Título lección de texto", "order": 6, "type": "text", "content": "3-5 párrafos..." },
        { "title": "Título lección de texto", "order": 7, "type": "text", "content": "3-5 párrafos..." },
        { "title": "Título lección de texto", "order": 8, "type": "text", "content": "3-5 párrafos..." },
        { "title": "Título lección de texto", "order": 9, "type": "text", "content": "3-5 párrafos..." },
        { "title": "Resumen y cierre — [tema del módulo]", "order": 10, "type": "video", "content": "" }
      ],
      "questions": [
        { "text": "¿Pregunta de opción múltiple sobre el módulo?", "options": ["Opción A", "Opción B", "Opción C", "Opción D"], "correctIndex": 0, "order": 1 },
        { "text": "¿Pregunta 2?", "options": ["A", "B", "C", "D"], "correctIndex": 1, "order": 2 },
        { "text": "¿Pregunta 3?", "options": ["A", "B", "C", "D"], "correctIndex": 2, "order": 3 },
        { "text": "¿Pregunta 4?", "options": ["A", "B", "C", "D"], "correctIndex": 0, "order": 4 },
        { "text": "¿Pregunta 5?", "options": ["A", "B", "C", "D"], "correctIndex": 3, "order": 5 },
        { "text": "¿Pregunta 6?", "options": ["A", "B", "C", "D"], "correctIndex": 1, "order": 6 },
        { "text": "¿Pregunta 7?", "options": ["A", "B", "C", "D"], "correctIndex": 0, "order": 7 },
        { "text": "¿Pregunta 8?", "options": ["A", "B", "C", "D"], "correctIndex": 2, "order": 8 },
        { "text": "¿Pregunta 9?", "options": ["A", "B", "C", "D"], "correctIndex": 1, "order": 9 },
        { "text": "¿Pregunta 10?", "options": ["A", "B", "C", "D"], "correctIndex": 3, "order": 10 }
      ]
    }
  ]
}

REGLAS ESTRICTAS QUE DEBES CUMPLIR:
1. Cada módulo tiene EXACTAMENTE 10 lecciones: orden 1 y 10 son type "video" con content vacío "", órdenes 2 al 9 son type "text" con content de 3-5 párrafos educativos reales sobre el subtema
2. Cada módulo tiene EXACTAMENTE 10 questions con 4 opciones (A, B, C, D) cada una, basadas en el contenido del módulo
3. Las preguntas deben ser específicas al tema del módulo, no genéricas
4. El contenido de las lecciones de texto debe ser educativo, específico y en español
5. No incluyas markdown ni comentarios en el JSON`;

      const bedrockRes = await bedrock.send(
        new InvokeModelCommand({
          modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 8000,
            messages: [{ role: 'user', content: prompt }],
          }),
        })
      );
      const parsed = JSON.parse(new TextDecoder().decode(bedrockRes.body));
      const raw = parsed.content?.[0]?.text ?? '{}';
      const clean = raw.replace(/```json|```/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return serverError('AI response format error — no JSON found');
      const structure = JSON.parse(jsonMatch[0]);
      return ok(structure);
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

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();

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
                  duration: '5 min',
                  type: l.type ?? 'video',
                  youtubeId: '',
                  content: l.content ?? null,
                  points: [],
                  tip: '',
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
