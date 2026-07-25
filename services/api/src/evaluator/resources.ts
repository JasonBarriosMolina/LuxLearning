// Resources, signature, and certificates domain handler for lux-evaluator.
import { EvalCtx } from './ctx';
import {
  getResourcesByEvaluator, saveResource, updateResource, getResourcesByCourse,
  getSignature, saveSignature, getCertificatesByUser,
} from '../shared/db-dynamo';
import { ok, badRequest } from '../shared/response';

export async function handleResources(ctx: EvalCtx): Promise<any | null> {
  const { event, method, path, userId } = ctx;

  // ── GET /evaluator/signature ─────────────────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/signature') {
    const uid = event.requestContext.authorizer?.lambda?.userId!;
    const signature = await getSignature(uid);
    return ok({ signature });
  }

  // ── PUT /evaluator/signature ─────────────────────────────────────────────────
  if (method === 'PUT' && path === '/evaluator/signature') {
    const uid = event.requestContext.authorizer?.lambda?.userId!;
    const { signature } = ctx.body as { signature?: string };
    if (!signature) return badRequest('signature es requerido');
    await saveSignature(uid, signature);
    return ok({ ok: true });
  }

  // ── GET /evaluator/students/:userId/certificates ─────────────────────────────
  const studentCertsMatch = path.match(/^\/evaluator\/students\/([^/]+)\/certificates$/);
  if (studentCertsMatch && method === 'GET') {
    const targetUserId = studentCertsMatch[1]!;
    const certs = await getCertificatesByUser(targetUserId);
    return ok(certs);
  }

  // ── GET /evaluator/resources ─────────────────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/resources') {
    const resources = await getResourcesByEvaluator(userId);
    return ok(resources);
  }

  // ── POST /evaluator/resources ────────────────────────────────────────────────
  if (method === 'POST' && path === '/evaluator/resources') {
    const { title, description, fileUrl, fileName, fileType, fileSize, folder, courseIds } = ctx.body as any;
    if (!title || !fileUrl || !fileName) return badRequest('title, fileUrl y fileName son requeridos');
    const now = new Date().toISOString();
    const resource = {
      evaluatorId: userId,
      resourceId: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: String(title).slice(0, 200),
      description: description ? String(description).slice(0, 500) : undefined,
      fileUrl: String(fileUrl),
      fileName: String(fileName),
      fileType: String(fileType ?? 'application/octet-stream'),
      fileSize: fileSize ? Number(fileSize) : undefined,
      folder: folder ? String(folder).slice(0, 100) : undefined,
      courseIds: Array.isArray(courseIds) ? courseIds : [],
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await saveResource(resource);
    return ok(resource);
  }

  // ── PUT /evaluator/resources/:resourceId ────────────────────────────────────
  const resourceUpdateMatch = path.match(/^\/evaluator\/resources\/([^/]+)$/);
  if (resourceUpdateMatch && method === 'PUT') {
    const resourceId = resourceUpdateMatch[1]!;
    const { title, description, folder, courseIds } = ctx.body as any;
    await updateResource(userId, resourceId, {
      ...(title !== undefined ? { title: String(title).slice(0, 200) } : {}),
      ...(description !== undefined ? { description: String(description).slice(0, 500) } : {}),
      ...(folder !== undefined ? { folder: folder ? String(folder).slice(0, 100) : undefined } : {}),
      ...(courseIds !== undefined ? { courseIds: Array.isArray(courseIds) ? courseIds : [] } : {}),
      updatedAt: new Date().toISOString(),
    });
    return ok({ updated: true });
  }

  // ── DELETE /evaluator/resources/:resourceId — soft delete (60-day TTL) ──────
  if (resourceUpdateMatch && method === 'DELETE') {
    const resourceId = resourceUpdateMatch[1]!;
    const ttl = Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60; // 60 days
    await updateResource(userId, resourceId, { archived: true, ttl, updatedAt: new Date().toISOString() });
    return ok({ archived: true });
  }

  // ── POST /evaluator/resources/:resourceId/restore ────────────────────────────
  const resourceRestoreMatch = path.match(/^\/evaluator\/resources\/([^/]+)\/restore$/);
  if (resourceRestoreMatch && method === 'POST') {
    const resourceId = resourceRestoreMatch[1]!;
    await updateResource(userId, resourceId, { archived: false, ttl: undefined, updatedAt: new Date().toISOString() });
    return ok({ restored: true });
  }

  // ── GET /evaluator/courses/:courseId/resources ────────────────────────────────
  const courseResourcesEvalMatch = path.match(/^\/evaluator\/courses\/([^/]+)\/resources$/);
  if (courseResourcesEvalMatch && method === 'GET') {
    const courseId = courseResourcesEvalMatch[1]!;
    const resources = await getResourcesByCourse(courseId);
    return ok(resources);
  }

  return null; // not handled by this domain
}
