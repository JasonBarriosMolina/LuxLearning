// Users and enrollments domain handler for lux-admin.
import { randomInt } from 'crypto';
import {
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
import { SendEmailCommand } from '@aws-sdk/client-ses';
import { createEnrollment, getEnrollments, deleteEnrollment, createTask, createNotification } from '../shared/db-dynamo';
import { sendTemplatedEmail } from '../shared/email';
import { upsertChat, upsertMembership } from '../shared/db-messages';
import { ok, created, badRequest, forbidden, notFound, conflict } from '../shared/response';
import {
  AdminCtx, isAuthorized, isAdmin, ses, cognito, USER_POOL_ID, FROM_EMAIL, FRONTEND_URL, invitationEmailHtml,
} from './ctx';

export async function handleUsers(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body } = ctx;

  // ── GET /admin/users ────────────────────────────────────────────────────────
  if (path === '/admin/users' && method === 'GET') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');

    // Paginated fetch helpers
    const listAllUsers = async () => {
      const all: NonNullable<Awaited<ReturnType<typeof cognito.send>>['Users']>[number][] = [];
      let token: string | undefined;
      do {
        const res = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60, PaginationToken: token }));
        all.push(...(res.Users ?? []));
        token = res.PaginationToken;
      } while (token);
      return all;
    };
    const listAllInGroup = async (GroupName: string) => {
      const all: NonNullable<Awaited<ReturnType<typeof cognito.send>>['Users']>[number][] = [];
      let token: string | undefined;
      do {
        const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName, Limit: 60, NextToken: token }));
        all.push(...(res.Users ?? []));
        token = res.NextToken;
      } while (token);
      return all;
    };

    // Fetch all users + group memberships in parallel
    const [allUsers, evaluators, admins] = await Promise.all([
      listAllUsers(),
      listAllInGroup('EVALUATOR'),
      listAllInGroup('ADMIN'),
    ]);

    const evaluatorUsernames = new Set(evaluators.map((u) => u.Username));
    const adminUsernames = new Set(admins.map((u) => u.Username));

    const attr = (user: { Attributes?: { Name?: string; Value?: string }[] }, name: string) =>
      user.Attributes?.find((a) => a.Name === name)?.Value ?? '';

    const users = allUsers.map((u) => {
      const username = u.Username ?? '';
      const role = adminUsernames.has(username) ? 'ADMIN'
        : evaluatorUsernames.has(username) ? 'EVALUATOR'
        : 'STUDENT';
      const email = attr(u, 'email') || username; // fallback to username (which is email for admin-created users)
      return {
        username,
        sub: attr(u, 'sub'),   // Cognito UUID — matches userId stored in tasks/enrollments
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

  // ── POST /admin/users/bulk-import — CSV batch create students ───────────────
  if (path === '/admin/users/bulk-import' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { csv, courseIds = [], role: importRole = 'STUDENT' } = body as { csv: string; courseIds?: string[]; role?: string };
    if (!csv || typeof csv !== 'string') return badRequest('csv es requerido');
    if (!['STUDENT', 'EVALUATOR'].includes(importRole)) return badRequest('rol inválido');

    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows = lines[0]?.toLowerCase().startsWith('email') ? lines.slice(1) : lines;
    if (rows.length === 0) return badRequest('CSV sin filas de datos');
    if (rows.length > 100) return badRequest('Máximo 100 usuarios por importación');

    let importCourseNames: string[] = [];
    if (Array.isArray(courseIds) && courseIds.length > 0) {
      try {
        const cs = await prisma.course.findMany({ where: { id: { in: courseIds } }, select: { title: true } });
        importCourseNames = cs.map((c: any) => c.title);
      } catch { /* non-fatal */ }
    }

    const results: { email: string; status: 'created' | 'skipped' | 'error'; reason?: string }[] = [];

    for (const row of rows) {
      const [rawEmail, rawName] = row.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
      const userEmail = rawEmail?.toLowerCase() ?? '';
      const userName = rawName ?? '';
      if (!userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
        results.push({ email: userEmail || row, status: 'error', reason: 'Email inválido' });
        continue;
      }

      const chars = 'abcdefghijklmnopqrstuvwxyz';
      const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const digits = '0123456789';
      const cryptoItem = (s: string) => s[randomInt(s.length)]!;
      const pwChars = [cryptoItem(uppers), cryptoItem(uppers), cryptoItem(chars), cryptoItem(chars), cryptoItem(chars), cryptoItem(chars), cryptoItem(digits), cryptoItem(digits)];
      for (let i = pwChars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pwChars[i], pwChars[j]] = [pwChars[j]!, pwChars[i]!]; }
      const temporaryPassword = pwChars.join('');

      try {
        const createRes = await cognito.send(new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID, Username: userEmail,
          TemporaryPassword: temporaryPassword, MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: userEmail }, { Name: 'email_verified', Value: 'true' },
            ...(userName ? [{ Name: 'name', Value: userName }] : []),
          ],
        }));
        const username = createRes.User?.Username ?? userEmail;
        await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: importRole })).catch((e: any) => console.warn('[BulkImport] AddToGroup failed:', e));
        if (courseIds.length > 0) {
          await Promise.allSettled(courseIds.map((cid) => createEnrollment(username, cid)));
        }
        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL, Destination: { ToAddresses: [userEmail] },
          Message: { Subject: { Data: '¡Bienvenido a Lux Learning! — Tu cuenta está lista', Charset: 'UTF-8' }, Body: { Html: { Data: invitationEmailHtml(userName, userEmail, temporaryPassword, importCourseNames), Charset: 'UTF-8' } } },
        })).catch((e: any) => console.warn('[BulkImport] Email failed for', userEmail, e));
        results.push({ email: userEmail, status: 'created' });
      } catch (err: any) {
        const errName: string = err?.name ?? err?.__type ?? '';
        if (errName === 'UsernameExistsException') {
          results.push({ email: userEmail, status: 'skipped', reason: 'Ya existe' });
        } else {
          results.push({ email: userEmail, status: 'error', reason: err?.message ?? 'Error desconocido' });
        }
      }
    }

    const createdCount = results.filter((r) => r.status === 'created').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const errors = results.filter((r) => r.status === 'error');
    console.log(`[BulkImport] created=${createdCount} skipped=${skipped} errors=${errors.length}`);
    return ok({ created: createdCount, skipped, errors, total: rows.length });
  }

  // ── POST /admin/users — invite/create user ──────────────────────────────────
  if (path === '/admin/users' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

    const { email, role = 'STUDENT', name, courseIds } = body as { email: string; role?: string; name?: string; courseIds?: string[] };
    if (!email) return badRequest('email es requerido');
    if (!['STUDENT', 'EVALUATOR', 'ADMIN'].includes(role)) return badRequest('rol inválido');

    // Generate a cryptographically secure temporary password (Cognito policy: 8+ chars,
    // uppercase, lowercase, digits). Use crypto.randomInt (Node 18+) + Fisher-Yates shuffle.
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const cryptoItem = (s: string) => s[randomInt(s.length)]!;
    const pwChars = [
      cryptoItem(uppers), cryptoItem(uppers),
      cryptoItem(chars), cryptoItem(chars), cryptoItem(chars), cryptoItem(chars),
      cryptoItem(digits), cryptoItem(digits),
    ];
    // Unbiased Fisher-Yates shuffle
    for (let i = pwChars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [pwChars[i], pwChars[j]] = [pwChars[j]!, pwChars[i]!];
    }
    const temporaryPassword = pwChars.join('');

    // Create user with SUPPRESS — admin shares password through their own channel
    let createRes: any;
    try {
      createRes = await cognito.send(new AdminCreateUserCommand({
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
    } catch (cognitoErr: any) {
      const errName: string = cognitoErr?.name ?? cognitoErr?.__type ?? '';
      console.warn('[Admin] AdminCreateUser error:', errName, cognitoErr?.message);
      if (errName === 'UsernameExistsException') {
        return conflict('Este correo ya tiene una cuenta registrada en la plataforma');
      }
      if (errName === 'InvalidPasswordException') {
        return badRequest('Error al generar la contraseña temporal. Contacta soporte.');
      }
      if (errName === 'InvalidParameterException') {
        return badRequest('Email inválido o parámetros incorrectos');
      }
      throw cognitoErr;
    }

    const username = createRes.User?.Username ?? email;

    // Add to role group
    try {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: role === 'EVALUATOR' || role === 'ADMIN' ? role : 'STUDENT',
      }));
    } catch (groupErr: any) {
      console.error('[Admin] AddUserToGroup failed (non-fatal for response):', groupErr);
    }

    // Enroll in courses if provided
    let courseNames: string[] = [];
    if (Array.isArray(courseIds) && courseIds.length > 0) {
      await Promise.all(courseIds.map((cid) => createEnrollment(username, cid)));
      // Fetch course names for the email
      try {
        const courses = await prisma.course.findMany({ where: { id: { in: courseIds } }, select: { title: true } });
        courseNames = courses.map((c: any) => c.title);
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

  // ── PUT /admin/users/:username/role ─────────────────────────────────────────
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

  // ── PUT /admin/users/:username/status ───────────────────────────────────────
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

  // ── DELETE /admin/users/:username ───────────────────────────────────────────
  const userDeleteMatch = path.match(/^\/admin\/users\/([^/]+)$/);
  if (userDeleteMatch && method === 'DELETE') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

    const username = decodeURIComponent(userDeleteMatch[1]!);
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    return ok({ deleted: true });
  }

  // ── /admin/users/:username/enrollments ──────────────────────────────────────
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

      // Send enrollment notification email + add to group chat
      try {
        const [userRes, course] = await Promise.all([
          cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username })),
          prisma.course.findUnique({ where: { id: courseId }, select: { title: true, evaluatorId: true } }),
        ]);
        const emailAttr = userRes.UserAttributes?.find((a: any) => a.Name === 'email')?.Value;
        const nameAttr = userRes.UserAttributes?.find((a: any) => a.Name === 'name')?.Value;
        if (emailAttr && course) {
          await sendTemplatedEmail(emailAttr, 'ENROLLMENT', {
            studentName: nameAttr || emailAttr.split('@')[0],
            courseTitle: course.title,
          });
        }
        // Notify evaluator when a student is enrolled in their course
        if (course?.evaluatorId) {
          createNotification({
            userId: course.evaluatorId,
            notifId: `enroll-${username}-${courseId}-${Date.now()}`,
            type: 'GENERAL',
            message: `Nuevo estudiante inscrito en "${course.title}": ${nameAttr || username}`,
            read: false,
            createdAt: new Date().toISOString(),
            actionUrl: '/evaluator/my-courses',
          }).catch(() => { /* non-fatal */ });
        }
        // Add student to group chat for this course (ensure META + membership both exist)
        if (course) {
          await upsertChat(`group_${courseId}`, {
            type: 'GROUP',
            name: `Curso: ${course.title}`,
            participants: [username],
          });
          await upsertMembership(username, `group_${courseId}`, {
            chatName: `Curso: ${course.title}`,
            chatType: 'GROUP',
          });
        }
      } catch (e) { console.warn('Enrollment email/chat failed:', e); }

      // M-7: Auto-create tasks for each module (one per module, due in 7×order days)
      try {
        const courseModules = await prisma.module.findMany({
          where: { courseId },
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true },
        });
        const courseForTasks = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true } });
        const enrollDate = new Date();
        await Promise.all(courseModules.map((mod: any) => {
          const due = new Date(enrollDate);
          due.setDate(due.getDate() + 7 * mod.order);
          const dueDate = due.toISOString().slice(0, 10);
          return createTask({
            userId: username,
            taskId: `auto-${courseId}-${mod.id}`,
            title: `Completar módulo: ${mod.title}`,
            description: `Completa todas las lecciones y el quiz del módulo ${mod.order}.`,
            type: 'complete_module',
            dueDate,
            courseId,
            moduleId: mod.id,
            courseTitle: courseForTasks?.title ?? '',
            moduleTitle: mod.title,
            assignedBy: 'system',
            status: 'PENDING',
            createdAt: new Date().toISOString(),
          });
        }));
      } catch (e) { console.warn('Auto-task creation failed:', e); }

      return ok({ enrolled: true });
    }

    if (method === 'DELETE') {
      const { courseId } = body;
      if (!courseId) return badRequest('courseId es requerido');
      await deleteEnrollment(username, courseId);
      return ok({ removed: true });
    }
  }

  return null; // not handled by this domain
}
