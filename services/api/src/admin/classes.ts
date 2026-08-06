// ─── admin/classes.ts ─────────────────────────────────────────────────────────
// Admin/evaluator routes for Lux Mentor Class definitions (EvaluationEvent type='CLASS').
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ok, created, badRequest, forbidden, notFound } from '../shared/response';
import { listClassSessionsForModule } from '../shared/db-classes';
import { getAllEnrollments } from '../shared/db-dynamo';
import { AdminCtx, isAdmin, isAuthorized, invokeBedrockForJson, cognito, USER_POOL_ID } from './ctx';

const s3 = new S3Client({ region: 'us-east-1' });
const IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET ?? 'lux-learning-images';

export async function handleClasses(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body } = ctx;

  if (!isAuthorized(event)) return forbidden('Se requiere rol de evaluador o administrador');

  // ── POST /admin/classes/generate — AI-generate vapiPrompt + objectives ────────
  if (path === '/admin/classes/generate' && method === 'POST') {
    const { title, topic, courseTitle, moduleTitle, language = 'ES' } = body as {
      title?: string; topic?: string; courseTitle?: string; moduleTitle?: string; language?: string;
    };
    if (!title && !topic) return badRequest('title o topic es requerido');

    const isES = language !== 'EN';
    const context = [
      courseTitle && `Curso: "${courseTitle}"`,
      moduleTitle && `Módulo: "${moduleTitle}"`,
      title && `Clase: "${title}"`,
      topic && `Tema: "${topic}"`,
    ].filter(Boolean).join('\n');

    const prompt = isES
      ? `Eres un diseñador de clases interactivas para un LMS. Genera la configuración de una clase con Lux Mentor (IA de voz).

${context}

La clase tiene dos fases:
1. FASE CONTENIDO: el estudiante escucha/ve el material de la lección.
2. FASE CONVERSACIÓN: Lux Mentor conversa con el estudiante para verificar comprensión.

Devuelve SOLO un objeto JSON con esta estructura exacta:
{
  "vapiPrompt": "Instrucciones para Lux Mentor en la fase de conversación (2-4 párrafos). Incluir: rol de Mentor, tema de la clase, tono cálido y académico, instrucciones de duración (~5 min), 3 objetivos de verificación de comprensión.",
  "vapiObjectives": ["Objetivo de verificación 1", "Objetivo de verificación 2", "Objetivo de verificación 3"],
  "lessonScript": "Guión de la lección para texto-a-voz (3-5 párrafos, tono educativo, máx 500 palabras). Este texto se leerá en voz alta al estudiante antes de la conversación."
}

Reglas:
- Todo en español, tono profesional y cálido
- lessonScript: explicación clara del tema, ejemplos concretos
- vapiObjectives: verificar comprensión en niveles cognitivos distintos
- SOLO el JSON, sin markdown ni explicaciones`
      : `You are an interactive class designer for an LMS. Generate the configuration for a class with Lux Mentor (voice AI).

${context}

The class has two phases:
1. CONTENT PHASE: student listens to / watches the lesson material.
2. CONVERSATION PHASE: Lux Mentor converses with the student to verify understanding.

Return ONLY a JSON object with this exact structure:
{
  "vapiPrompt": "Instructions for Lux Mentor in the conversation phase (2-4 paragraphs). Include: Mentor role, class topic, warm academic tone, duration instructions (~5 min), 3 comprehension-check objectives.",
  "vapiObjectives": ["Comprehension objective 1", "Comprehension objective 2", "Comprehension objective 3"],
  "lessonScript": "Lesson script for text-to-speech (3-5 paragraphs, educational tone, max 500 words). This text will be read aloud to the student before the conversation."
}

Rules:
- Everything in English, professional and warm tone
- lessonScript: clear explanation of topic with concrete examples
- vapiObjectives: verify comprehension at distinct cognitive levels
- ONLY the JSON, no markdown or explanations`;

    const result = await invokeBedrockForJson(prompt, 1500);
    if (!result?.vapiPrompt) return badRequest('La IA no pudo generar la configuración');
    return ok({
      vapiPrompt: String(result.vapiPrompt),
      vapiObjectives: Array.isArray(result.vapiObjectives) ? result.vapiObjectives : [],
      lessonScript: String(result.lessonScript ?? ''),
    });
  }

  // ── POST /admin/classes/presign-video — S3 presign for video upload ───────────
  if (path === '/admin/classes/presign-video' && method === 'POST') {
    const { fileName, fileType } = body as { fileName?: string; fileType?: string };
    if (!fileName || !fileType) return badRequest('fileName y fileType requeridos');
    if (!fileType.startsWith('video/') && !fileType.startsWith('audio/')) {
      return badRequest('Solo se permiten archivos de video o audio');
    }
    const ext = fileName.includes('.') ? fileName.split('.').pop() : 'mp4';
    const key = `classes/videos/${randomUUID()}.${ext}`;
    const cmd = new PutObjectCommand({ Bucket: IMAGES_BUCKET, Key: key, ContentType: fileType });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
    const publicUrl = `https://${IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
    return ok({ uploadUrl, publicUrl, key });
  }

  // ── GET /admin/classes/courses — course+module selector ──────────────────────
  if (path === '/admin/classes/courses' && method === 'GET') {
    const courses = await prisma.course.findMany({
      where: { isDraft: false, isArchived: false },
      select: {
        id: true, title: true, isActive: true,
        modules: { select: { id: true, title: true, order: true }, orderBy: { order: 'asc' } },
      },
      orderBy: { title: 'asc' },
    });
    return ok(courses);
  }

  // ── GET /admin/classes/submissions?courseId=X — DDB sessions by course ────────
  if (path === '/admin/classes/submissions' && method === 'GET') {
    const courseId = event.queryStringParameters?.courseId;
    if (!courseId) return badRequest('courseId es requerido');

    const events = await prisma.evaluationEvent.findMany({
      where: { courseId, type: 'CLASS' },
      select: { id: true, name: true, moduleId: true },
    });

    const allSessions = await Promise.all(
      events
        .filter((ev: any) => ev.moduleId)
        .map(async (ev: any) => {
          const sessions = await listClassSessionsForModule(ev.moduleId!);
          return sessions.map((s) => ({ ...s, className: ev.name, evaluationEventId: ev.id }));
        }),
    );

    const flat = allSessions.flat().filter((s) => !s.voided);

    // Dedup by sessionId
    const dedupMap = new Map<string, typeof flat[0]>();
    for (const s of flat) {
      if (!dedupMap.has(s.sessionId)) dedupMap.set(s.sessionId, s);
    }
    const deduped = Array.from(dedupMap.values());

    const status = event.queryStringParameters?.status;
    const filtered = status ? deduped.filter((s) => s.status === status) : deduped;
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Resolve display names from Cognito
    const uniqueUserIds = [...new Set(filtered.map((s) => s.userId))];
    const nameMap: Record<string, string> = {};
    await Promise.all(uniqueUserIds.map(async (uid) => {
      try {
        const cogUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: uid }));
        const attrs = cogUser.UserAttributes ?? [];
        const getAttr = (n: string) => attrs.find((a: any) => a.Name === n)?.Value ?? '';
        nameMap[uid] = getAttr('name') || getAttr('email') || uid;
      } catch {
        nameMap[uid] = uid;
      }
    }));

    return ok(filtered.map((s) => ({ ...s, displayName: nameMap[s.userId] ?? s.userId })));
  }

  // ── GET /admin/classes?courseId=X — list class definitions ───────────────────
  if (path === '/admin/classes' && method === 'GET') {
    const courseId = event.queryStringParameters?.courseId;
    if (!courseId) return badRequest('courseId es requerido');

    const includeArchived = event.queryStringParameters?.includeArchived === 'true';
    const events = await prisma.evaluationEvent.findMany({
      where: {
        courseId, type: 'CLASS',
        ...(includeArchived ? {} : { isArchived: false }),
      },
      orderBy: { order: 'asc' },
    });

    const includeSubmissions = event.queryStringParameters?.includeSubmissions === 'true';
    if (!includeSubmissions) return ok(events);

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { modules: { select: { id: true, title: true }, orderBy: { order: 'asc' } } },
    });
    const moduleMap = Object.fromEntries((course?.modules ?? []).map((m: any) => [m.id, m.title]));

    const enriched = await Promise.all(events.map(async (ev: any) => {
      const moduleTitle = ev.moduleId ? (moduleMap[ev.moduleId] ?? ev.moduleId) : null;
      if (!ev.moduleId) return { ...ev, moduleTitle, submissionCount: 0, pendingCount: 0 };
      const sessions = await listClassSessionsForModule(ev.moduleId);
      const completed = sessions.filter((s) => s.status === 'completed' && !s.voided);
      const pending = completed.filter((s) => s.grade == null);
      return { ...ev, moduleTitle, submissionCount: completed.length, pendingCount: pending.length };
    }));

    return ok(enriched);
  }

  // ── POST /admin/classes — create class definition ─────────────────────────────
  if (path === '/admin/classes' && method === 'POST') {
    const {
      courseId, moduleId, name, dueDate, weight = 0,
      instructions, vapiPrompt, vapiObjectives, lessonVideoUrl, lessonScript,
      targetStudentIds = [],
    } = body as {
      courseId?: string; moduleId?: string; name?: string; dueDate?: string;
      weight?: number; instructions?: string; vapiPrompt?: string; vapiObjectives?: string;
      lessonVideoUrl?: string; lessonScript?: string; targetStudentIds?: string[];
    };

    if (!courseId) return badRequest('courseId es requerido');
    if (!name?.trim()) return badRequest('name es requerido');

    const courseExists = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!courseExists) return notFound('Curso no encontrado');

    if (moduleId) {
      const modExists = await prisma.module.findUnique({ where: { id: moduleId }, select: { id: true } });
      if (!modExists) return notFound('Módulo no encontrado');
    }

    const last = await prisma.evaluationEvent.findFirst({
      where: { courseId, type: 'CLASS' },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const created_ = await prisma.evaluationEvent.create({
      data: {
        courseId,
        moduleId: moduleId ?? null,
        type: 'CLASS',
        name: name.trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        weight: parseFloat(String(weight)) || 0,
        instructions: instructions ?? null,
        vapiPrompt: vapiPrompt ?? null,
        vapiObjectives: vapiObjectives ?? null,
        lessonVideoUrl: lessonVideoUrl ?? null,
        lessonScript: lessonScript ?? null,
        targetStudentIds: Array.isArray(targetStudentIds) ? targetStudentIds : [],
        order: (last?.order ?? 0) + 1,
      },
    });

    return created(created_);
  }

  // ── PUT /admin/classes/:id — update class definition ─────────────────────────
  const idMatch = path.match(/^\/admin\/classes\/([^/]+)$/);
  if (idMatch && method === 'PUT') {
    const id = idMatch[1]!;
    const {
      name, courseId, moduleId, dueDate, weight,
      instructions, vapiPrompt, vapiObjectives, lessonVideoUrl, lessonScript,
      targetStudentIds, isDraft, isArchived,
    } = body as any;

    const existing = await prisma.evaluationEvent.findUnique({ where: { id } });
    if (!existing) return notFound('Clase no encontrada');
    if (existing.type !== 'CLASS') return badRequest('Este evento no es de tipo CLASS');

    const updated = await prisma.evaluationEvent.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(courseId !== undefined && { courseId }),
        ...(moduleId !== undefined && { moduleId: moduleId || null }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(weight !== undefined && { weight: parseFloat(String(weight)) || 0 }),
        ...(instructions !== undefined && { instructions: instructions || null }),
        ...(vapiPrompt !== undefined && { vapiPrompt: vapiPrompt || null }),
        ...(vapiObjectives !== undefined && { vapiObjectives: vapiObjectives || null }),
        ...(lessonVideoUrl !== undefined && { lessonVideoUrl: lessonVideoUrl || null }),
        ...(lessonScript !== undefined && { lessonScript: lessonScript || null }),
        ...(targetStudentIds !== undefined && { targetStudentIds: Array.isArray(targetStudentIds) ? targetStudentIds : [] }),
        ...(isDraft !== undefined && { isDraft: Boolean(isDraft) }),
        ...(isArchived !== undefined && { isArchived: Boolean(isArchived) }),
      },
    });
    return ok(updated);
  }

  // ── GET /admin/classes/students?courseId=X ────────────────────────────────────
  if (path === '/admin/classes/students' && method === 'GET') {
    const courseId = event.queryStringParameters?.courseId;
    if (!courseId) return badRequest('courseId es requerido');

    const allEnrollments = await getAllEnrollments().catch(() => [] as { userId: string; courseId: string }[]);
    const studentIds = [...new Set(
      allEnrollments.filter((e) => e.courseId === courseId).map((e) => e.userId)
    )];

    const students = await Promise.all(studentIds.map(async (uid) => {
      const cogUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: uid })).catch(() => null);
      const attrs = cogUser?.UserAttributes ?? [];
      const getAttr = (n: string) => attrs.find((a: any) => a.Name === n)?.Value ?? '';
      return { userId: uid, name: getAttr('name') || getAttr('email') || uid, email: getAttr('email') };
    }));

    return ok(students);
  }

  // ── DELETE /admin/classes/:id ─────────────────────────────────────────────────
  const delMatch = path.match(/^\/admin\/classes\/([^/]+)$/);
  if (delMatch && method === 'DELETE') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador para eliminar');
    const id = delMatch[1]!;
    const existing = await prisma.evaluationEvent.findUnique({ where: { id }, select: { id: true, type: true } });
    if (!existing) return notFound('Clase no encontrada');
    if (existing.type !== 'CLASS') return badRequest('Este evento no es de tipo CLASS');
    await prisma.evaluationEvent.delete({ where: { id } });
    return ok({ deleted: true });
  }

  return null;
}
