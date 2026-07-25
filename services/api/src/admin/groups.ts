// Student groups admin domain handler for lux-admin.
import { AdminGetUserCommand, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { AdminCtx, cognito, USER_POOL_ID, isAdmin, isAuthorized } from './ctx';
import { deleteEnrollment } from '../shared/db-dynamo';
import { ok, badRequest, forbidden } from '../shared/response';

export async function handleGroups(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma } = ctx;

  // ── GET /admin/groups ────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/admin/groups') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const groups = await prisma.studentGroup.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true, evaluators: true } } },
    });
    return ok(groups);
  }

  // ── POST /admin/groups ───────────────────────────────────────────────────────
  if (method === 'POST' && path === '/admin/groups') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { name, description, color } = ctx.body as { name?: string; description?: string; color?: string };
    if (!name?.trim()) return badRequest('name es requerido');
    const group = await prisma.studentGroup.create({ data: { name: name.trim(), description: description?.trim(), color: color ?? '#17527E' } });
    return ok(group);
  }

  const groupBaseMatch = path.match(/^\/admin\/groups\/([^/]+)$/);

  // ── PUT /admin/groups/:id ────────────────────────────────────────────────────
  if (groupBaseMatch && method === 'PUT') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const groupId = groupBaseMatch[1]!;
    const { name, description, color } = ctx.body as { name?: string; description?: string; color?: string };
    if (!name?.trim()) return badRequest('name es requerido');
    const group = await prisma.studentGroup.update({ where: { id: groupId }, data: { name: name.trim(), description: description?.trim() ?? null, ...(color ? { color } : {}) } });
    return ok(group);
  }

  // ── DELETE /admin/groups/:id ─────────────────────────────────────────────────
  if (groupBaseMatch && method === 'DELETE') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const groupId = groupBaseMatch[1]!;
    await prisma.studentGroup.delete({ where: { id: groupId } });
    return ok({ deleted: true });
  }

  const groupMembersMatch = path.match(/^\/admin\/groups\/([^/]+)\/members$/);

  // ── GET /admin/groups/:id/members ────────────────────────────────────────────
  if (groupMembersMatch && method === 'GET') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const groupId = groupMembersMatch[1]!;
    const group = await prisma.studentGroup.findUnique({ where: { id: groupId } });
    const members = await prisma.studentGroupMember.findMany({ where: { groupId }, orderBy: { addedAt: 'asc' } });
    const enriched = await Promise.all(members.map(async (m: any) => {
      const cog = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: m.userId })).catch(() => null);
      const attrs = cog?.UserAttributes ?? [];
      const getAttr = (n: string) => attrs.find((a: any) => a.Name === n)?.Value ?? '';
      return { ...m, email: getAttr('email'), name: getAttr('name') || getAttr('email') || m.userId };
    }));
    return ok({ groupName: (group as any)?.name ?? '', members: enriched });
  }

  // ── POST /admin/groups/:id/members ───────────────────────────────────────────
  if (groupMembersMatch && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const groupId = groupMembersMatch[1]!;
    const { userIds } = ctx.body as { userIds?: string[] };
    if (!userIds?.length) return badRequest('userIds es requerido');
    await prisma.studentGroupMember.createMany({
      data: userIds.map((uid) => ({ groupId, userId: uid })),
      skipDuplicates: true,
    });
    return ok({ added: userIds.length });
  }

  const groupMemberIdMatch = path.match(/^\/admin\/groups\/([^/]+)\/members\/([^/]+)$/);

  // ── DELETE /admin/groups/:id/members/:userId ─────────────────────────────────
  if (groupMemberIdMatch && method === 'DELETE') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const [, groupId, memberId] = groupMemberIdMatch;
    const { unenrollCourseIds = [] } = ctx.body as { unenrollCourseIds?: string[] };
    if (unenrollCourseIds.length > 0) {
      await Promise.allSettled(unenrollCourseIds.map((cid) => deleteEnrollment(memberId!, cid)));
    }
    await prisma.studentGroupMember.delete({ where: { groupId_userId: { groupId: groupId!, userId: memberId! } } });
    return ok({ removed: true, unenrolled: unenrollCourseIds.length });
  }

  const groupEvaluatorsMatch = path.match(/^\/admin\/groups\/([^/]+)\/evaluators$/);

  // ── GET /admin/groups/:id/evaluators ─────────────────────────────────────────
  if (groupEvaluatorsMatch && method === 'GET') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const groupId = groupEvaluatorsMatch[1]!;
    const evaluators = await prisma.studentGroupEvaluator.findMany({ where: { groupId }, orderBy: { assignedAt: 'asc' } });
    const enrichedEvals = await Promise.all(evaluators.map(async (ev: any) => {
      const isUuid = /^[0-9a-f-]{36}$/i.test(ev.evaluatorId);
      let attrs: { Name?: string; Value?: string }[] = [];
      if (isUuid) {
        const res = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${ev.evaluatorId}"`, Limit: 1 })).catch(() => null);
        attrs = res?.Users?.[0]?.Attributes ?? [];
      } else {
        const cog = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: ev.evaluatorId })).catch(() => null);
        attrs = cog?.UserAttributes ?? [];
      }
      const getAttr = (n: string) => attrs.find((a: any) => a.Name === n)?.Value ?? '';
      return { ...ev, name: getAttr('name') || getAttr('email') || ev.evaluatorId, email: getAttr('email') };
    }));
    return ok(enrichedEvals);
  }

  // ── POST /admin/groups/:id/evaluators ────────────────────────────────────────
  if (groupEvaluatorsMatch && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const groupId = groupEvaluatorsMatch[1]!;
    const { evaluatorId } = ctx.body as { evaluatorId?: string };
    if (!evaluatorId) return badRequest('evaluatorId es requerido');
    await prisma.studentGroupEvaluator.upsert({
      where: { groupId_evaluatorId: { groupId, evaluatorId } },
      create: { groupId, evaluatorId },
      update: {},
    });
    return ok({ assigned: true });
  }

  const groupEvaluatorIdMatch = path.match(/^\/admin\/groups\/([^/]+)\/evaluators\/([^/]+)$/);

  // ── DELETE /admin/groups/:id/evaluators/:evaluatorId ─────────────────────────
  if (groupEvaluatorIdMatch && method === 'DELETE') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const [, groupId, evaluatorId] = groupEvaluatorIdMatch;
    await prisma.studentGroupEvaluator.delete({ where: { groupId_evaluatorId: { groupId: groupId!, evaluatorId: evaluatorId! } } });
    return ok({ removed: true });
  }

  // ── GET /admin/periods ───────────────────────────────────────────────────────
  if (path === '/admin/periods' && method === 'GET') {
    if (!isAuthorized(event)) return forbidden('Se requiere autenticación');
    const periods = await prisma.academicPeriod.findMany({ orderBy: { createdAt: 'desc' } });
    return ok(periods);
  }

  // ── POST /admin/periods ──────────────────────────────────────────────────────
  if (path === '/admin/periods' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { name } = ctx.body as { name?: string };
    if (!name?.trim()) return badRequest('name requerido');
    const period = await prisma.academicPeriod.upsert({
      where: { name: name.trim() },
      update: { active: true },
      create: { name: name.trim() },
    });
    return ok(period);
  }

  return null; // not handled by this domain
}
