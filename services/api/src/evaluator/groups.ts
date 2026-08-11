// Student groups domain handler for lux-evaluator.
import { AdminGetUserCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { EvalCtx, cognito, USER_POOL_ID } from './ctx';
import {
  getAllEnrollments, createEnrollment, getEnrollments, createTask, getPushSubscriptionsByUserId,
} from '../shared/db-dynamo';
import { sendTemplatedEmail } from '../shared/email';
import { upsertChat, upsertMembership } from '../shared/db-messages';
import { ok, badRequest, forbidden, notFound } from '../shared/response';

export async function handleGroups(ctx: EvalCtx): Promise<any | null> {
  const { event, method, path, prisma, userId, isAdminRole } = ctx;

  // ── GET /evaluator/groups ────────────────────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/groups') {
    const [assigned, own] = await Promise.all([
      prisma.studentGroupEvaluator.findMany({
        where: { evaluatorId: userId },
        include: { group: { include: { _count: { select: { members: true } } } } },
        orderBy: { assignedAt: 'asc' },
      }),
      prisma.studentGroup.findMany({
        where: { createdByEvaluatorId: userId },
        include: { _count: { select: { members: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const assignedIds = new Set(assigned.map((a: any) => a.groupId));
    const assignedGroups = assigned.map((a: any) => ({ ...a.group, memberCount: a.group._count.members, source: 'admin' }));
    const ownGroups = (own as any[]).filter((g: any) => !assignedIds.has(g.id)).map((g: any) => ({ ...g, memberCount: g._count.members, source: 'own' }));
    return ok([...assignedGroups, ...ownGroups]);
  }

  // ── POST /evaluator/groups — crear grupo propio ──────────────────────────────
  if (method === 'POST' && path === '/evaluator/groups') {
    const { name, description, color } = ctx.body as { name?: string; description?: string; color?: string };
    if (!name?.trim()) return badRequest('name es requerido');
    const group = await prisma.studentGroup.create({
      data: { name: name.trim(), description: description?.trim(), color: color ?? '#17527E', createdByEvaluatorId: userId },
    });
    return ok(group);
  }

  // ── GET /evaluator/students/pool ─────────────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/students/pool') {
    // All evaluators can see all enrolled students — grupos base are organizational tools
    const enrollments = await getAllEnrollments().catch(() => [] as any[]);
    const studentIds = [...new Set(enrollments.map((e: any) => e.userId as string))] as string[];
    const enriched = await Promise.all(studentIds.map(async (uid) => {
      const cogUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: uid })).catch(() => null);
      const attrs = cogUser?.UserAttributes ?? [];
      const getAttr = (n: string) => attrs.find((a: any) => a.Name === n)?.Value ?? '';
      return { userId: uid, name: getAttr('name') || getAttr('email'), email: getAttr('email') };
    }));
    return ok(enriched);
  }

  // ── GET /evaluator/evaluators ────────────────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/evaluators') {
    const listGroup = async (groupName: string): Promise<{ userId: string; name: string; email: string }[]> => {
      const users: { userId: string; name: string; email: string }[] = [];
      let nextToken: string | undefined;
      do {
        const res = await cognito.send(new ListUsersInGroupCommand({
          UserPoolId: USER_POOL_ID, GroupName: groupName, Limit: 60,
          ...(nextToken ? { NextToken: nextToken } : {}),
        }));
        for (const u of res.Users ?? []) {
          const getAttr = (n: string) => u.Attributes?.find((a) => a.Name === n)?.Value ?? '';
          users.push({ userId: u.Username!, name: getAttr('name') || getAttr('email'), email: getAttr('email') });
        }
        nextToken = res.NextToken;
      } while (nextToken);
      return users;
    };
    const evaluators = await listGroup('EVALUATOR').catch(() => [] as { userId: string; name: string; email: string }[]);
    return ok(evaluators.filter((e) => e.userId !== userId));
  }

  // ── GET /evaluator/groups/:id/members ────────────────────────────────────────
  const evalGroupMembersMatch = path.match(/^\/evaluator\/groups\/([^/]+)\/members$/);
  if (evalGroupMembersMatch && method === 'GET') {
    const groupId = evalGroupMembersMatch[1]!;
    const [access, groupOwner] = await Promise.all([
      prisma.studentGroupEvaluator.findUnique({
        where: { groupId_evaluatorId: { groupId, evaluatorId: userId } },
      }),
      prisma.studentGroup.findUnique({ where: { id: groupId }, select: { createdByEvaluatorId: true } }),
    ]);
    if (!groupOwner) return notFound('Grupo no encontrado');
    console.log('[groups/members GET] groupId=%s userId=%s createdByEvaluatorId=%s access=%s isAdminRole=%s', groupId, userId, groupOwner.createdByEvaluatorId, !!access, isAdminRole);
    if (!access && groupOwner.createdByEvaluatorId !== userId && !isAdminRole) return forbidden('No tienes acceso a este grupo');
    const members = await prisma.studentGroupMember.findMany({ where: { groupId }, orderBy: { addedAt: 'asc' } });
    const enriched = await Promise.all(members.map(async (m: any) => {
      const cogUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: m.userId })).catch(() => null);
      const attrs = cogUser?.UserAttributes ?? [];
      const getAttr = (n: string) => attrs.find((a: any) => a.Name === n)?.Value ?? '';
      const enrolledCourseIds = await getEnrollments(m.userId).catch(() => [] as string[]);
      return { ...m, email: getAttr('email'), name: getAttr('name') || getAttr('email'), enrolledCourseIds };
    }));
    return ok(enriched);
  }

  // ── POST /evaluator/groups/:id/enroll — inscribir estudiantes del grupo ──────
  const evalGroupEnrollMatch = path.match(/^\/evaluator\/groups\/([^/]+)\/enroll$/);
  if (evalGroupEnrollMatch && method === 'POST') {
    const groupId = evalGroupEnrollMatch[1]!;
    const [access, enrollGroupOwner] = await Promise.all([
      prisma.studentGroupEvaluator.findUnique({
        where: { groupId_evaluatorId: { groupId, evaluatorId: userId } },
      }),
      prisma.studentGroup.findUnique({ where: { id: groupId }, select: { createdByEvaluatorId: true } }),
    ]);
    if (!enrollGroupOwner) return notFound('Grupo no encontrado');
    if (!access && enrollGroupOwner.createdByEvaluatorId !== userId && !isAdminRole) return forbidden('No tienes acceso a este grupo');
    const { userIds, courseId } = ctx.body as { userIds?: string[]; courseId?: string };
    if (!userIds?.length || !courseId) return badRequest('userIds y courseId son requeridos');

    const course = await prisma.course.findUnique({ where: { id: courseId }, include: { modules: { include: { lessons: true } } } });
    if (!course) return notFound('Curso no encontrado');

    await Promise.allSettled(userIds.map(async (uid) => {
      const existingEnrollments = await getEnrollments(uid).catch(() => [] as string[]);
      const alreadyEnrolled = existingEnrollments.includes(courseId);
      await createEnrollment(uid, courseId);

      if (!alreadyEnrolled) {
        try {
          const cogUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: uid }));
          const attrs = cogUser.UserAttributes ?? [];
          const studentEmail = attrs.find((a: any) => a.Name === 'email')?.Value;
          const studentName  = attrs.find((a: any) => a.Name === 'name')?.Value ?? studentEmail ?? uid;
          if (studentEmail) {
            await sendTemplatedEmail(studentEmail, 'ENROLLMENT', { studentName, courseTitle: course.title });
          }
        } catch { /* non-fatal */ }

        try {
          const enrollDate = new Date();
          await Promise.all(course.modules.map((mod: any) => {
            const due = new Date(enrollDate);
            due.setDate(due.getDate() + 7 * mod.order);
            return createTask({
              userId: uid,
              taskId: `${uid}-${mod.id}-complete`,
              title: `Completar módulo: ${mod.title}`,
              description: `Completa las lecciones, quiz y reflexión del módulo "${mod.title}" del curso "${course.title}".`,
              dueDate: due.toISOString().slice(0, 10),
              type: 'complete_module',
              courseId,
              moduleId: mod.id,
              courseTitle: course.title,
              moduleTitle: mod.title,
              assignedBy: 'system',
              status: 'PENDING',
              createdAt: new Date().toISOString(),
            });
          }));
        } catch { /* non-fatal */ }
      }

      try {
        const chatId = `group_${courseId}`;
        await upsertChat(chatId, { type: 'GROUP', name: `Curso: ${course.title}`, participants: [uid] });
        await upsertMembership(uid, chatId, { chatName: `Curso: ${course.title}`, chatType: 'GROUP' });
      } catch { /* non-fatal */ }

      const member = await prisma.studentGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId: uid } },
      }).catch(() => null);
      if (member && !(member as any).enrolledCourseIds.includes(courseId)) {
        await prisma.studentGroupMember.update({
          where: { groupId_userId: { groupId, userId: uid } },
          data: { enrolledCourseIds: { push: courseId } },
        }).catch(() => {});
      }
    }));

    return ok({ enrolled: userIds.length, courseId });
  }

  // ── PUT /evaluator/groups/:id — editar grupo propio ──────────────────────────
  const evalGroupBaseMatch = path.match(/^\/evaluator\/groups\/([^/]+)$/);
  if (evalGroupBaseMatch && method === 'PUT') {
    const groupId = evalGroupBaseMatch[1]!;
    const group = await prisma.studentGroup.findUnique({ where: { id: groupId } });
    if (!group) return notFound('Grupo no encontrado');
    if ((group as any).createdByEvaluatorId !== userId && !isAdminRole) return forbidden('Solo puedes editar tus propios grupos');
    const { name, description, color } = ctx.body as { name?: string; description?: string; color?: string };
    if (!name?.trim()) return badRequest('name es requerido');
    const updated = await prisma.studentGroup.update({
      where: { id: groupId },
      data: { name: name.trim(), description: description?.trim() ?? null, ...(color ? { color } : {}) },
    });
    return ok(updated);
  }

  // ── DELETE /evaluator/groups/:id — eliminar grupo propio ─────────────────────
  if (evalGroupBaseMatch && method === 'DELETE') {
    const groupId = evalGroupBaseMatch[1]!;
    const group = await prisma.studentGroup.findUnique({ where: { id: groupId } });
    if (!group) return notFound('Grupo no encontrado');
    if ((group as any).createdByEvaluatorId !== userId && !isAdminRole) return forbidden('Solo puedes eliminar tus propios grupos');
    await prisma.studentGroup.delete({ where: { id: groupId } });
    return ok({ deleted: true });
  }

  // ── POST /evaluator/groups/:id/members — agregar miembros al grupo propio ────
  if (evalGroupMembersMatch && method === 'POST') {
    const groupId = evalGroupMembersMatch[1]!;
    const group = await prisma.studentGroup.findUnique({ where: { id: groupId } });
    if (!group) return notFound('Grupo no encontrado');
    console.log('[groups/members POST] groupId=%s userId=%s createdByEvaluatorId=%s isAdminRole=%s', groupId, userId, (group as any).createdByEvaluatorId, isAdminRole);
    if ((group as any).createdByEvaluatorId !== userId && !isAdminRole) return forbidden('Solo puedes modificar tus propios grupos');
    const { userIds } = ctx.body as { userIds?: string[] };
    if (!userIds?.length) return badRequest('userIds es requerido');
    await prisma.studentGroupMember.createMany({
      data: userIds.map((uid) => ({ groupId, userId: uid })),
      skipDuplicates: true,
    });
    return ok({ added: userIds.length });
  }

  // ── DELETE /evaluator/groups/:id/members/:userId ─────────────────────────────
  const evalGroupMemberDeleteMatch = path.match(/^\/evaluator\/groups\/([^/]+)\/members\/([^/]+)$/);
  if (evalGroupMemberDeleteMatch && method === 'DELETE') {
    const [, groupId, memberId] = evalGroupMemberDeleteMatch;
    const group = await prisma.studentGroup.findUnique({ where: { id: groupId! } });
    if (!group) return notFound('Grupo no encontrado');
    if ((group as any).createdByEvaluatorId !== userId && !isAdminRole) return forbidden('Solo puedes modificar tus propios grupos');
    await prisma.studentGroupMember.delete({ where: { groupId_userId: { groupId: groupId!, userId: memberId! } } });
    return ok({ removed: true });
  }

  return null; // not handled by this domain
}
