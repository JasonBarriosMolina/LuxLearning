// Interview definitions domain handler for lux-admin.
// Manages EvaluationEvent records with type='INTERVIEW' — creation, editing, AI generation.
// Actual interview sessions (transcripts, grades) live in DDB LuxInterviews.
import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ok, created, badRequest, forbidden, notFound } from '../shared/response';
import { listInterviewsForModule } from '../shared/db-submissions';
import { getAllEnrollments } from '../shared/db-dynamo';
import { AdminCtx, isAdmin, isAuthorized, invokeBedrockForJson, cognito, USER_POOL_ID } from './ctx';

export async function handleInterviews(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body } = ctx;

  if (!isAuthorized(event)) return forbidden('Se requiere rol de evaluador o administrador');

  // ── POST /admin/interviews/generate — AI-assisted vapiPrompt + objectives ────
  if (path === '/admin/interviews/generate' && method === 'POST') {
    const { title, topic, courseTitle, moduleTitle, language = 'ES' } = body as {
      title?: string; topic?: string; courseTitle?: string; moduleTitle?: string; language?: string;
    };
    if (!title && !topic) return badRequest('title o topic es requerido');

    const isES = language !== 'EN';
    const context = [
      courseTitle && `Curso: "${courseTitle}"`,
      moduleTitle && `Módulo: "${moduleTitle}"`,
      title && `Entrevista: "${title}"`,
      topic && `Tema: "${topic}"`,
    ].filter(Boolean).join('\n');

    const prompt = isES
      ? `Eres un diseñador de evaluaciones orales para un LMS educativo. Genera la configuración de una entrevista oral conducida por Mentor, un evaluador IA cálido y profesional.

${context}

Devuelve SOLO un objeto JSON con esta estructura exacta:
{
  "vapiPrompt": "Instrucciones detalladas para Mentor. DEBE incluir: (1) instrucción de saludar al estudiante por nombre con calidez y gentileza, (2) instrucción de introducir brevemente el tema del módulo en 2-3 oraciones que den contexto y relevancia, (3) instrucción de desarrollar las ideas principales del tema de forma accesible antes de las preguntas, (4) instrucción de hacer la transición a las preguntas diciendo algo como 'Ahora me gustaría hacerte algunas preguntas...', (5) reglas de evaluación interna. Tono cálido, alentador y académico. Duración total ~8 minutos.",
  "vapiObjectives": ["Objetivo de pregunta 1 (nivel conceptual)", "Objetivo de pregunta 2 (nivel aplicación)", "Objetivo de pregunta 3 (nivel análisis/reflexión)"]
}

Reglas:
- vapiPrompt en español, tono cálido, gentil y académico
- El vapiPrompt debe enfatizar que las preguntas van AL FINAL, después de la introducción y el desarrollo del tema
- Exactamente 3 objetivos de preguntas, cada uno evaluando un nivel cognitivo diferente
- No incluir las preguntas literales, solo los objetivos
- SOLO el JSON, sin markdown ni explicaciones`
      : `You are an oral evaluation designer for an educational LMS. Generate the configuration for an AI oral interview conducted by Mentor, a warm and professional AI evaluator.

${context}

Return ONLY a JSON object with this exact structure:
{
  "vapiPrompt": "Detailed instructions for Mentor. MUST include: (1) instruction to greet the student warmly by name, (2) instruction to briefly introduce the module topic in 2-3 sentences providing context and relevance, (3) instruction to develop the main ideas of the topic in an accessible way before the questions, (4) instruction to transition to questions saying something like 'Now I'd like to ask you a few questions...', (5) internal evaluation rules. Warm, encouraging, and academic tone. Total duration ~8 minutes.",
  "vapiObjectives": ["Question objective 1 (conceptual level)", "Question objective 2 (application level)", "Question objective 3 (analysis/reflection level)"]
}

Rules:
- vapiPrompt in English, warm, gentle, and academic tone
- The vapiPrompt must emphasize that questions come AT THE END, after the intro and topic development
- Exactly 3 question objectives, each evaluating a different cognitive level
- Do not include literal questions, only objectives
- ONLY the JSON, no markdown or explanations`;

    const result = await invokeBedrockForJson(prompt, 1000);
    if (!result?.vapiPrompt) return badRequest('La IA no pudo generar la configuración');
    return ok({ vapiPrompt: String(result.vapiPrompt), vapiObjectives: Array.isArray(result.vapiObjectives) ? result.vapiObjectives : [] });
  }

  // ── GET /admin/interviews/courses — list courses + modules for selectors ──────
  if (path === '/admin/interviews/courses' && method === 'GET') {
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

  // ── GET /admin/interviews/coverage — total weight of all eval events for course ─
  if (path === '/admin/interviews/coverage' && method === 'GET') {
    const courseId = event.queryStringParameters?.courseId;
    if (!courseId) return badRequest('courseId es requerido');

    const allEvents = await prisma.evaluationEvent.findMany({
      where: { courseId, isArchived: false },
      select: { type: true, weight: true, isDraft: true },
    });

    const totalWeight = allEvents.reduce((s: number, e: any) => s + (e.weight || 0), 0);
    const interviewEvents = allEvents.filter((e: any) => e.type === 'INTERVIEW' && !e.isDraft);
    const interviewWeight = interviewEvents.reduce((s: number, e: any) => s + (e.weight || 0), 0);
    const interviewCount = interviewEvents.length;

    return ok({ totalWeight, interviewWeight, interviewCount, isFull: totalWeight >= 99.9 });
  }

  // ── GET /admin/interviews — list interview definitions ────────────────────────
  if (path === '/admin/interviews' && method === 'GET') {
    const courseId = event.queryStringParameters?.courseId;
    if (!courseId) return badRequest('courseId es requerido');

    const includeArchived = event.queryStringParameters?.includeArchived === 'true';
    const events = await prisma.evaluationEvent.findMany({
      where: {
        courseId, type: 'INTERVIEW',
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
      const submissions = await listInterviewsForModule(ev.moduleId);
      const completed = submissions.filter((s) => s.status === 'completed');
      const pending = completed.filter((s) => s.grade == null);
      return { ...ev, moduleTitle, submissionCount: completed.length, pendingCount: pending.length };
    }));

    return ok(enriched);
  }

  // ── GET /admin/interviews/submissions — DDB interviews by course ─────────────
  if (path === '/admin/interviews/submissions' && method === 'GET') {
    const courseId = event.queryStringParameters?.courseId;
    if (!courseId) return badRequest('courseId es requerido');

    const events = await prisma.evaluationEvent.findMany({
      where: { courseId, type: 'INTERVIEW' },
      select: { id: true, name: true, moduleId: true },
    });

    const allSubmissions = await Promise.all(
      events
        .filter((ev: any) => ev.moduleId)
        .map(async (ev: any) => {
          const subs = await listInterviewsForModule(ev.moduleId!);
          return subs.map((s) => ({ ...s, interviewName: ev.name, evaluationEventId: ev.id }));
        }),
    );

    const flat = allSubmissions.flat();

    // Deduplicate by interviewId — a DDB interview record is unique per session.
    // Keying by userId|evaluationEventId caused the same record to appear N times
    // when N EvaluationEvents share the same moduleId (each ev query returns the
    // same DDB rows, each tagged with a different evaluationEventId).
    const dedupMap = new Map<string, typeof flat[0]>();
    for (const sub of flat) {
      if (!dedupMap.has(sub.interviewId)) {
        dedupMap.set(sub.interviewId, sub);
      }
    }
    const deduped = Array.from(dedupMap.values());

    const status = event.queryStringParameters?.status;
    const filtered = status ? deduped.filter((s) => s.status === status) : deduped;
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Resolve display names from Cognito for unique userIds
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

    const enriched = filtered.map((s) => ({ ...s, displayName: nameMap[s.userId] ?? s.userId }));
    return ok(enriched);
  }

  // ── POST /admin/interviews — create interview definition ──────────────────────
  if (path === '/admin/interviews' && method === 'POST') {
    const {
      courseId, moduleId, name, dueDate, weight = 0,
      instructions, vapiPrompt, vapiObjectives, targetStudentIds = [],
    } = body as {
      courseId?: string; moduleId?: string; name?: string; dueDate?: string;
      weight?: number; instructions?: string; vapiPrompt?: string;
      vapiObjectives?: string; targetStudentIds?: string[];
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
      where: { courseId, type: 'INTERVIEW' },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const event_ = await prisma.evaluationEvent.create({
      data: {
        courseId,
        moduleId: moduleId ?? null,
        type: 'INTERVIEW',
        name: name.trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        weight: parseFloat(String(weight)) || 0,
        instructions: instructions ?? null,
        vapiPrompt: vapiPrompt ?? null,
        vapiObjectives: vapiObjectives ?? null,
        targetStudentIds: Array.isArray(targetStudentIds) ? targetStudentIds : [],
        order: (last?.order ?? 0) + 1,
      },
    });

    return created(event_);
  }

  // ── PUT /admin/interviews/:id — update interview definition ──────────────────
  const idMatch = path.match(/^\/admin\/interviews\/([^/]+)$/);
  if (idMatch && method === 'PUT') {
    const id = idMatch[1]!;
    const {
      name, courseId, moduleId, dueDate, weight,
      instructions, vapiPrompt, vapiObjectives, targetStudentIds,
      isDraft, isArchived,
    } = body as any;

    const existing = await prisma.evaluationEvent.findUnique({ where: { id } });
    if (!existing) return notFound('Entrevista no encontrada');
    if (existing.type !== 'INTERVIEW') return badRequest('Este evento no es de tipo INTERVIEW');

    if (courseId && courseId !== existing.courseId) {
      const courseExists = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
      if (!courseExists) return notFound('Curso no encontrado');
    }

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
        ...(targetStudentIds !== undefined && { targetStudentIds: Array.isArray(targetStudentIds) ? targetStudentIds : [] }),
        ...(isDraft !== undefined && { isDraft: Boolean(isDraft) }),
        ...(isArchived !== undefined && { isArchived: Boolean(isArchived) }),
      },
    });
    return ok(updated);
  }

  // ── GET /admin/interviews/students — enrolled students for a course ───────────
  if (path === '/admin/interviews/students' && method === 'GET') {
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

  // ── DELETE /admin/interviews/:id — delete interview definition ───────────────
  const delMatch = path.match(/^\/admin\/interviews\/([^/]+)$/);
  if (delMatch && method === 'DELETE') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador para eliminar');
    const id = delMatch[1]!;

    const existing = await prisma.evaluationEvent.findUnique({ where: { id }, select: { id: true, type: true } });
    if (!existing) return notFound('Entrevista no encontrada');
    if (existing.type !== 'INTERVIEW') return badRequest('Este evento no es de tipo INTERVIEW');

    await prisma.evaluationEvent.delete({ where: { id } });
    return ok({ deleted: true });
  }

  return null;
}
