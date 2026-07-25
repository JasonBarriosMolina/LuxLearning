// Courses, modules, lessons, questions domain handler for lux-admin.
import { InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { saveAiJob, getAiJob, createNotification } from '../shared/db-dynamo';
import { batchTranslate, invalidateTranslation } from '../shared/translate';
import { sendTemplatedEmail } from '../shared/email';
import { upsertChat } from '../shared/db-messages';
import { ok, created, badRequest, forbidden, notFound, serverError } from '../shared/response';
import { jsonrepair } from 'jsonrepair';
import {
  AdminCtx, isAuthorized, isAdmin, getCallerName, invokeBedrockForJson, shuffleQuestionOptions,
  s3KeyFromUrl, S3_IMAGES_BUCKET, USER_POOL_ID, lambdaClient, s3Client, bedrock, cognito,
  generateLessonAudio, generateLessonImage,
} from './ctx';

export async function handleCourses(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body, action } = ctx;

  // ── Async audio generation workers (self-invoked via Lambda Event) ──────────
  if (action === 'bulk-audio') {
    const { lessonIds, voiceId = 'Mia' } = body as any;
    const lessons = await prisma.lesson.findMany({ where: { id: { in: lessonIds } } });
    await Promise.allSettled(lessons.map(async (lesson: any) => {
      const text = [lesson.title, lesson.content ?? '', ...(lesson.points ?? []), lesson.tip ?? ''].join('. ');
      const audioUrl = await generateLessonAudio(lesson.id, text, voiceId);
      if (audioUrl) await prisma.lesson.update({ where: { id: lesson.id }, data: { audioUrl } });
    }));
    return ok({ generated: lessonIds.length });
  }

  if (action === 'single-audio') {
    const { lessonId, voiceId = 'Mia' } = body as any;
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (lesson) {
      const text = [lesson.title, lesson.content ?? '', ...(lesson.points ?? []), lesson.tip ?? ''].join('. ');
      const audioUrl = await generateLessonAudio(lesson.id, text, voiceId);
      if (audioUrl) await prisma.lesson.update({ where: { id: lesson.id }, data: { audioUrl } });
    }
    return ok({ generated: 1 });
  }

  // ── GET /admin/courses ──────────────────────────────────────────────────────
  if (path === '/admin/courses' && method === 'GET') {
    const statusFilter = event.queryStringParameters?.status;
    const rawLang = event.queryStringParameters?.lang ?? 'es';
    const lang = ['en', 'es'].includes(rawLang) ? rawLang : 'es';
    let whereClause: Record<string, any> = {};
    if (statusFilter === 'draft') {
      whereClause = { isDraft: true, isArchived: false };
    } else if (statusFilter === 'archived') {
      whereClause = { isArchived: true };
    } else if (statusFilter === 'active') {
      whereClause = { isDraft: false, isArchived: false };
    } else {
      // Default: all non-archived (show active + drafts together in admin)
      whereClause = { isArchived: false };
    }
    const courses = await prisma.course.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        modules: {
          orderBy: { order: 'asc' },
          select: {
            id: true, order: true, title: true, duration: true, passingScore: true,
            _count: { select: { lessons: true, questions: true } },
            lessons: { select: { type: true, content: true } },
          },
        },
      },
    });
    let coursesWithLegacy: any[] = courses.map((c: any) => {
      const isLegacy = c.modules.length > 0 &&
        c.modules.every((m: any) => (m.lessons as any[]).every((l: any) => l.type === 'video' && !l.content));
      return { ...c, isLegacy };
    });
    if (lang !== 'es' && coursesWithLegacy.length > 0) {
      const translations = await batchTranslate(
        coursesWithLegacy.map((c: any) => ({ type: 'course' as const, id: c.id, fields: { title: c.title, description: c.description } })),
        lang
      );
      coursesWithLegacy = coursesWithLegacy.map((c: any) => {
        const t = translations.get(`course#${c.id}`);
        return t ? { ...c, title: (t.title as string) ?? c.title, description: (t.description as string) ?? c.description } : c;
      });
    }
    return ok(coursesWithLegacy);
  }

  // ── POST /admin/courses ─────────────────────────────────────────────────────
  if (path === '/admin/courses' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { title, slug, description, imageUrl, isActive, isPilot, tags, startDate, closeDate } = body;
    if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
    const callerName = await getCallerName(event);
    const course = await prisma.course.create({
      data: {
        title, slug, description,
        imageUrl: imageUrl || null,
        isActive: isActive ?? false,
        isPilot: isPilot ?? false,
        isDraft: true, // new manual courses start as drafts
        tags: Array.isArray(tags) ? tags : [],
        startDate: startDate ? new Date(startDate) : null,
        closeDate: closeDate ? new Date(closeDate) : null,
        createdByName: callerName,
      },
    });
    // Auto-create group chat for the new course
    await upsertChat(`group_${course.id}`, {
      type: 'GROUP',
      name: `Curso: ${course.title}`,
      participants: [],
    }).catch(() => {});
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

  // ── GET /admin/courses/:courseId/validate-videos ────────────────────────────
  const validateVideosMatch = path.match(/^\/admin\/courses\/([^/]+)\/validate-videos$/);
  if (validateVideosMatch && method === 'GET') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
    const courseId = validateVideosMatch[1]!;
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: { modules: { include: { lessons: { select: { id: true, title: true, youtubeId: true, order: true, moduleId: true } } } } },
    });
    if (!course) return notFound('Curso no encontrado');

    const allLessons = course.modules.flatMap((m: any) =>
      m.lessons.filter((l: any) => l.youtubeId && l.youtubeId.trim())
    );

    const results = await Promise.allSettled(
      allLessons.map(async (l: any) => {
        try {
          const res = await fetch(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${l.youtubeId}&format=json`,
            { signal: AbortSignal.timeout(5000) }
          );
          return { lessonId: l.id, title: l.title, youtubeId: l.youtubeId, ok: res.ok, status: res.status };
        } catch {
          return { lessonId: l.id, title: l.title, youtubeId: l.youtubeId, ok: false, status: 0 };
        }
      })
    );

    const videos = results.map((r: any) => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
    return ok({ videos, broken: videos.filter((v: any) => !v!.ok).length, total: videos.length });
  }

  // ── PUT /admin/courses/:courseId/evaluator ──────────────────────────────────
  const courseEvaluatorMatch = path.match(/^\/admin\/courses\/([^/]+)\/evaluator$/);
  if (courseEvaluatorMatch && method === 'PUT') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador');
    const courseId = courseEvaluatorMatch[1]!;
    const { evaluatorId, evaluatorName } = body as { evaluatorId?: string; evaluatorName?: string };
    if (!evaluatorId) return badRequest('evaluatorId es requerido');
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { evaluatorId, evaluatorName: evaluatorName ?? null },
    });

    // Notify evaluator of assignment (non-fatal)
    try {
      const frontendUrl = process.env.FRONTEND_URL ?? '';
      await createNotification({
        userId: evaluatorId,
        notifId: `course-assigned-${Date.now()}`,
        type: 'GENERAL',
        message: `🎓 Se te asignó el curso "${updated.title}" como evaluador`,
        read: false,
        createdAt: new Date().toISOString(),
        actionUrl: `${frontendUrl}/evaluator/my-courses`,
      });
      // Get evaluator email from Cognito
      const cognitoUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: evaluatorId })).catch(() => null);
      const evEmail = cognitoUser?.UserAttributes?.find((a: any) => a.Name === 'email')?.Value;
      if (evEmail) {
        sendTemplatedEmail(evEmail, 'COURSE_ASSIGNED', {
          evaluatorName: evaluatorName ?? evaluatorId,
          courseTitle: updated.title,
        }).catch(() => {});
      }
    } catch { /* non-fatal */ }

    return ok(updated);
  }

  // ── PUT /admin/courses/:courseId/publish ────────────────────────────────────
  const coursePublishMatch = path.match(/^\/admin\/courses\/([^/]+)\/publish$/);
  if (coursePublishMatch && method === 'PUT') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const courseId = coursePublishMatch[1]!;
    const course = await prisma.course.update({
      where: { id: courseId },
      data: { isDraft: false },
    });
    return ok(course);
  }

  // ── PUT /admin/courses/:courseId/archive ────────────────────────────────────
  const courseArchiveMatch = path.match(/^\/admin\/courses\/([^/]+)\/archive$/);
  if (courseArchiveMatch && method === 'PUT') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const courseId = courseArchiveMatch[1]!;
    const course = await prisma.course.update({
      where: { id: courseId },
      data: { isArchived: true, isActive: false },
    });
    return ok(course);
  }

  // ── PUT /admin/courses/:courseId/restore ────────────────────────────────────
  const courseRestoreMatch = path.match(/^\/admin\/courses\/([^/]+)\/restore$/);
  if (courseRestoreMatch && method === 'PUT') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const courseId = courseRestoreMatch[1]!;
    const course = await prisma.course.update({
      where: { id: courseId },
      data: { isArchived: false },
    });
    return ok(course);
  }

  // ── /admin/courses/:courseId ────────────────────────────────────────────────
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
      const { title, slug, description, imageUrl, isActive, isPilot, tags, startDate, closeDate, isDraft, isArchived } = body;
      if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
      const course = await prisma.course.update({
        where: { id: courseId },
        data: {
          title, slug, description,
          imageUrl: imageUrl || null,
          isActive,
          isPilot,
          ...(isDraft !== undefined ? { isDraft } : {}),
          ...(isArchived !== undefined ? { isArchived } : {}),
          tags: Array.isArray(tags) ? tags : [],
          startDate: startDate ? new Date(startDate) : null,
          closeDate: closeDate ? new Date(closeDate) : null,
        },
      });
      await invalidateTranslation('course', courseId);
      return ok(course);
    }

    if (method === 'DELETE') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      await prisma.course.delete({ where: { id: courseId } });
      return ok({ deleted: true });
    }
  }

  // ── POST /admin/courses/:courseId/modules ───────────────────────────────────
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

  // ── /admin/modules/:moduleId ────────────────────────────────────────────────
  const moduleMatch = path.match(/^\/admin\/modules\/([^/]+)$/);
  if (moduleMatch) {
    const moduleId = moduleMatch[1]!;

    if (method === 'PUT') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const { title, description, duration, passingScore, order } = body;
      if (!title || !description || !duration || passingScore == null) {
        return badRequest('title, description, duration y passingScore son requeridos');
      }
      const mod = await prisma.module.update({
        where: { id: moduleId },
        data: { title, description, duration, passingScore: Number(passingScore), order: Number(order) },
      });
      await invalidateTranslation('module', moduleId);
      return ok(mod);
    }

    if (method === 'DELETE') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      await prisma.module.delete({ where: { id: moduleId } });
      return ok({ deleted: true });
    }
  }

  // ── POST /admin/modules/:moduleId/lessons ───────────────────────────────────
  const moduleLessonsMatch = path.match(/^\/admin\/modules\/([^/]+)\/lessons$/);
  if (moduleLessonsMatch && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const moduleId = moduleLessonsMatch[1]!;
    const { title, duration, youtubeId, imageUrl, points, tip, order, type, content } = body;
    if (!title || !duration) {
      return badRequest('title y duration son requeridos');
    }
    const lessonType = type ?? (youtubeId ? 'video' : 'text');
    let lessonOrder = order;
    if (lessonOrder == null) {
      const count = await prisma.lesson.count({ where: { moduleId } });
      lessonOrder = count + 1;
    }
    const lesson = await prisma.lesson.create({
      data: {
        moduleId, title, duration,
        youtubeId: youtubeId ?? '',
        type: lessonType,
        content: content ?? null,
        imageUrl: imageUrl || null,
        points: Array.isArray(points) ? points : [],
        tip: tip ?? '',
        order: Number(lessonOrder),
      },
    });

    // Auto-generate Polly audio asynchronously (fire-and-forget)
    lambdaClient.send(new LambdaInvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({
        requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
        rawPath: '/_internal/audio',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ _action: 'single-audio', lessonId: lesson.id, voiceId: 'Mia' }),
      })),
    })).catch(() => {});

    return created(lesson);
  }

  // ── POST /admin/courses/ai-generate-module (no-save preview for wizard) ─────
  if (path === '/admin/courses/ai-generate-module' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { topic, courseTitle } = body as { topic?: string; courseTitle?: string };
    if (!topic) return badRequest('topic es requerido');
    const ctx2 = courseTitle ? `Curso: ${courseTitle}\nTema del módulo: ${topic}` : topic;
    const mod = await invokeBedrockForJson(
      `Eres experto en diseño instruccional. Genera la estructura de UN módulo sobre "${ctx2}".
Responde ÚNICAMENTE con JSON válido:
{"title":"Título del módulo","description":"Descripción 1-2 oraciones","lessons":[{"title":"Lección 1","order":1,"type":"video"},{"title":"Lección 2","order":2,"type":"text"},{"title":"Lección 3","order":3,"type":"text"},{"title":"Lección 4","order":4,"type":"text"},{"title":"Lección 5","order":5,"type":"text"},{"title":"Lección 6","order":6,"type":"text"},{"title":"Lección 7","order":7,"type":"text"},{"title":"Lección 8","order":8,"type":"text"},{"title":"Lección 9","order":9,"type":"text"},{"title":"Lección 10","order":10,"type":"video"}],"questions":[{"text":"¿Pregunta 1?"},{"text":"¿Pregunta 2?"},{"text":"¿Pregunta 3?"},{"text":"¿Pregunta 4?"},{"text":"¿Pregunta 5?"}]}
Exactamente 10 lecciones y 5 preguntas de muestra. Títulos reales y específicos. Sin markdown.`, 1500);
    if (!mod.title) return badRequest('No se pudo generar la estructura del módulo');
    return ok(mod);
  }

  // ── POST /admin/courses/:courseId/modules/ai-generate ──────────────────────
  const courseModuleAiMatch = path.match(/^\/admin\/courses\/([^/]+)\/modules\/ai-generate$/);
  if (courseModuleAiMatch && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const courseId = courseModuleAiMatch[1]!;
    const { topic, _jobId: workerJobId, _courseTitle: workerCourseTitle } = body as any;

    // ── Async worker branch ─────────────────────────────────────────────────
    if (workerJobId) {
      try {
        const bedrockJSON2 = async (prompt: string, maxTokens = 2000): Promise<any> => {
          const res = await bedrock.send(new InvokeModelCommand({
            modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
            contentType: 'application/json', accept: 'application/json',
            body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
          }));
          const raw = (JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text ?? '{}').replace(/```json\s*|```/g, '').trim();
          const match = raw.match(/[\[{][\s\S]*/);
          try { return JSON.parse(match?.[0] ?? '{}'); } catch { try { return JSON.parse(jsonrepair(match?.[0] ?? '{}')); } catch { return {}; } }
        };

        const modMeta = await bedrockJSON2(
          `Eres experto en diseño instruccional. Genera título y descripción para un módulo sobre "${topic}" dentro del curso "${workerCourseTitle}".
Responde ÚNICAMENTE con JSON: {"title":"Título real del módulo","description":"Descripción de 1-2 oraciones."}`, 400);
        const modTitle = (modMeta.title as string) || topic;
        const modDesc = (modMeta.description as string) || `Módulo sobre ${topic}`;

        const [rawLessons, rawQuestions] = await Promise.all([
          bedrockJSON2(`Genera exactamente 10 lecciones para el módulo "${modTitle}" del curso "${workerCourseTitle}".
Array JSON (10 elementos):
[{"title":"Introducción — ${modTitle}","order":1,"type":"video","content":"<p>Párrafo introductorio.</p>","duration":"5 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Consejo."},
{"title":"Subtema A","order":2,"type":"text","content":"<h3>Subtema</h3><p>Párrafo.</p><ul><li>Punto A</li><li>Punto B</li></ul><p>Cierre.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Resumen — ${modTitle}","order":10,"type":"video","content":"<p>Resumen.</p>","duration":"5 min","points":["Resumen 1","Resumen 2","Próximos pasos"],"tip":"Completa el quiz."}]
Lecciones 2-9 tipo text con HTML rico: <h3>, <ul><li>, <blockquote>. Sin markdown.`, 6000),
          bedrockJSON2(`Genera exactamente 10 preguntas de opción múltiple sobre "${modTitle}".
Array JSON: [{"text":"¿Pregunta real?","options":["Op A","Op B","Op C","Op D"],"correctIndex":0,"order":1}]
10 preguntas, correctIndex entre 0-3, opciones con texto real. Sin markdown.`, 2000),
        ]);

        const lessons = Array.isArray(rawLessons) ? rawLessons.slice(0, 10) : [];
        const questions = shuffleQuestionOptions(Array.isArray(rawQuestions) ? rawQuestions.slice(0, 10) : []);

        const modCount = await prisma.module.count({ where: { courseId } });
        const createdMod = await prisma.module.create({
          data: {
            courseId, title: modTitle, description: modDesc,
            duration: `${lessons.length * 8} min`, passingScore: 70, order: modCount + 1,
          },
        });

        if (lessons.length > 0) {
          await prisma.lesson.createMany({
            data: lessons.map((l: any, i: number) => ({
              moduleId: createdMod.id,
              title: l.title || `Lección ${i + 1}`,
              type: l.type || (i === 0 || i === 9 ? 'video' : 'text'),
              content: l.content || null,
              youtubeId: '',
              imageUrl: null,
              duration: l.duration ? String(l.duration) : (i === 0 || i === 9 ? '5 min' : '8 min'),
              points: Array.isArray(l.points) ? l.points : [],
              tip: l.tip || '',
              order: l.order || i + 1,
            })),
          });
        }

        if (questions.length > 0) {
          await prisma.question.createMany({
            data: questions.map((q: any, i: number) => ({
              moduleId: createdMod.id,
              text: q.text,
              options: q.options,
              correctIndex: Number(q.correctIndex),
              order: i + 1,
            })),
          });
        }

        await saveAiJob(workerJobId, { status: 'done', result: { moduleId: createdMod.id, lessonsCreated: lessons.length, questionsCreated: questions.length } });
      } catch (err: any) {
        await saveAiJob(workerJobId, { status: 'error', error: err.message ?? 'Error' });
      }
      return ok({ ok: true });
    }

    // ── Dispatch branch ─────────────────────────────────────────────────────
    if (!topic) return badRequest('topic es requerido');
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true } });
    if (!course) return notFound('Curso no encontrado');

    const jobId = `mod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveAiJob(jobId, { status: 'processing' });

    const asyncPayload = {
      requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
      rawPath: `/admin/courses/${courseId}/modules/ai-generate`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, _jobId: jobId, _courseTitle: course.title }),
    };
    await lambdaClient.send(new LambdaInvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(asyncPayload)),
    }));

    return ok({ jobId });
  }

  // ── POST /admin/modules/:moduleId/lessons/ai-generate ──────────────────────
  const moduleLessonAiMatch = path.match(/^\/admin\/modules\/([^/]+)\/lessons\/ai-generate$/);
  if (moduleLessonAiMatch && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const moduleId = moduleLessonAiMatch[1]!;
    const { topic, _jobId: lessonWorkerJobId } = body as any;

    // ── Async worker branch ─────────────────────────────────────────────────
    if (lessonWorkerJobId) {
      try {
        const mod = await prisma.module.findUnique({
          where: { id: moduleId },
          include: { course: { select: { title: true } } },
        });
        if (!mod) throw new Error('Módulo no encontrado');

        const lessonCount = await prisma.lesson.count({ where: { moduleId } });
        const lessonData = await invokeBedrockForJson(
          `Genera una lección educativa sobre "${topic}" para el módulo "${mod.title}" del curso "${(mod as any).course?.title ?? ''}".
Responde ÚNICAMENTE con JSON: {"title":"Título específico de la lección","type":"text","content":"<h3>Sección</h3><p>Párrafo 1 educativo con 2ª persona.</p><ul><li>Punto clave 1</li><li>Punto clave 2</li><li>Punto clave 3</li></ul><blockquote>Cita relevante sobre el tema.</blockquote><p>Párrafo de cierre práctico.</p>","duration":"8 min","points":["Concepto 1","Concepto 2","Concepto 3"],"tip":"Consejo práctico aplicable."}
HTML rico obligatorio: <h3>, <ul><li>, <blockquote>. Sin markdown.`, 1500);

        const lesson = await prisma.lesson.create({
          data: {
            moduleId, order: lessonCount + 1,
            title: lessonData.title || topic,
            type: lessonData.type || 'text',
            content: lessonData.content || `<p>Contenido sobre ${topic}.</p>`,
            youtubeId: '',
            imageUrl: null,
            duration: lessonData.duration || '8 min',
            points: Array.isArray(lessonData.points) ? lessonData.points : [],
            tip: lessonData.tip || '',
          },
        });
        await saveAiJob(lessonWorkerJobId, { status: 'done', result: { lessonId: lesson.id } });
      } catch (err: any) {
        await saveAiJob(lessonWorkerJobId, { status: 'error', error: err.message ?? 'Error' });
      }
      return ok({ ok: true });
    }

    // ── Dispatch branch ─────────────────────────────────────────────────────
    if (!topic) return badRequest('topic es requerido');
    const modExists = await prisma.module.count({ where: { id: moduleId } });
    if (!modExists) return notFound('Módulo no encontrado');

    const lessonJobId = `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveAiJob(lessonJobId, { status: 'processing' });

    const asyncPayload = {
      requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
      rawPath: `/admin/modules/${moduleId}/lessons/ai-generate`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, _jobId: lessonJobId }),
    };
    await lambdaClient.send(new LambdaInvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(asyncPayload)),
    }));

    return ok({ jobId: lessonJobId });
  }

  // ── /admin/lessons/:lessonId ────────────────────────────────────────────────
  const lessonMatch = path.match(/^\/admin\/lessons\/([^/]+)$/);
  if (lessonMatch) {
    const lessonId = lessonMatch[1]!;

    if (method === 'PUT') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const { title, duration, youtubeId, imageUrl, points, tip, order, content } = body;
      if (!title || !duration) {
        return badRequest('title y duration son requeridos');
      }
      // Snapshot current version before overwriting
      const currentLesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
      const prevSnapshot = currentLesson ? JSON.stringify({
        title: currentLesson.title, duration: currentLesson.duration,
        youtubeId: currentLesson.youtubeId, imageUrl: currentLesson.imageUrl,
        content: currentLesson.content, points: currentLesson.points,
        tip: currentLesson.tip, order: currentLesson.order,
      }) : null;
      const lesson = await prisma.lesson.update({
        where: { id: lessonId },
        data: {
          title, duration, youtubeId: youtubeId || '',
          imageUrl: imageUrl || null,
          content: content || null,
          points: Array.isArray(points) ? points : [],
          tip: tip ?? '',
          order: Number(order),
          prevSnapshot,
        },
      });
      await invalidateTranslation('lesson', lessonId);
      return ok(lesson);
    }

    if (method === 'DELETE') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      // Clean up S3 files before deleting DB record
      const lessonToDelete = await prisma.lesson.findUnique({ where: { id: lessonId } });
      if (lessonToDelete?.imageUrl) {
        const key = s3KeyFromUrl(lessonToDelete.imageUrl);
        if (key) await s3Client.send(new DeleteObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: key })).catch(() => {});
      }
      if (lessonToDelete?.audioUrl) {
        const key = s3KeyFromUrl(lessonToDelete.audioUrl);
        if (key) await s3Client.send(new DeleteObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: key })).catch(() => {});
      }
      await prisma.lesson.delete({ where: { id: lessonId } });
      return ok({ deleted: true });
    }
  }

  // ── POST /admin/modules/:moduleId/questions/ai-generate ────────────────────
  const aiQuestionsMatch = path.match(/^\/admin\/modules\/([^/]+)\/questions\/ai-generate$/);
  if (aiQuestionsMatch && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const moduleId = aiQuestionsMatch[1]!;
    const { content, count = 5 } = body as { content?: string; count?: number };

    if (!content || content.trim().length < 20) {
      return badRequest('content (mínimo 20 caracteres) es requerido');
    }
    const safeCount = Math.min(Math.max(Number(count) || 5, 3), 10);

    const mod = await prisma.module.findUnique({
      where: { id: moduleId },
      include: { questions: { select: { order: true } } },
    });
    if (!mod) return notFound('Módulo no encontrado');

    const nextOrder = mod.questions.length > 0
      ? Math.max(...mod.questions.map((q: any) => q.order)) + 1
      : 1;

    const aiPrompt = `Eres un diseñador instruccional experto. Basándote en el siguiente contenido educativo del módulo "${mod.title}", genera exactamente ${safeCount} preguntas de opción múltiple de alta calidad para evaluar la comprensión del estudiante.

CONTENIDO:
"""
${content.slice(0, 4000)}
"""

REGLAS:
- Cada pregunta debe tener exactamente 4 opciones
- Una sola respuesta correcta por pregunta (correctIndex entre 0 y 3)
- Las preguntas deben cubrir diferentes conceptos del contenido
- Redacta en español, con lenguaje claro y preciso
- Evalúa comprensión y aplicación, no memorización pura

Responde ÚNICAMENTE con un array JSON (sin markdown, sin texto extra):
[{"text":"¿Pregunta?","options":["Op A","Op B","Op C","Op D"],"correctIndex":0}]`;

    const rawQuestions = await invokeBedrockForJson(aiPrompt, 3000);

    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
      return serverError('Bedrock no generó preguntas válidas');
    }

    const validated = rawQuestions.filter((q: any) =>
      typeof q.text === 'string' && q.text.trim().length > 0 &&
      Array.isArray(q.options) && q.options.length === 4 &&
      typeof q.correctIndex === 'number' &&
      q.correctIndex >= 0 && q.correctIndex < 4
    ).slice(0, safeCount);

    if (validated.length === 0) {
      return serverError('Las preguntas generadas no pasaron validación');
    }

    const shuffled = shuffleQuestionOptions(validated);

    const createdResult = await prisma.question.createMany({
      data: shuffled.map((q: any, i: number) => ({
        moduleId,
        text: String(q.text).trim(),
        options: q.options.map((o: any) => String(o).trim()),
        correctIndex: Number(q.correctIndex),
        order: nextOrder + i,
      })),
    });

    // Invalidar traducciones: refetch los IDs recién creados
    const newQuestions = await prisma.question.findMany({
      where: { moduleId, order: { gte: nextOrder } },
      select: { id: true },
    });
    await Promise.all(newQuestions.map((q: any) => invalidateTranslation('question', q.id)));

    return ok({ created: createdResult.count });
  }

  // ── POST /admin/modules/:moduleId/questions ─────────────────────────────────
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
    // Shuffle options so correct answer is distributed across A/B/C/D positions
    const [shuffled] = shuffleQuestionOptions([{ text, options, correctIndex: Number(correctIndex) }]);
    const question = await prisma.question.create({
      data: { moduleId, text: shuffled.text, options: shuffled.options, correctIndex: shuffled.correctIndex, order: Number(questionOrder) },
    });
    return created(question);
  }

  // ── /admin/questions/:questionId ────────────────────────────────────────────
  const questionMatch = path.match(/^\/admin\/questions\/([^/]+)$/);
  if (questionMatch) {
    const questionId = questionMatch[1]!;

    if (method === 'PUT') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const { text, options, correctIndex, order } = body;
      if (!text || !Array.isArray(options) || options.length < 2 || correctIndex == null) {
        return badRequest('text, options (mínimo 2) y correctIndex son requeridos');
      }
      const question = await prisma.question.update({
        where: { id: questionId },
        data: { text, options, correctIndex: Number(correctIndex), order: Number(order) },
      });
      await invalidateTranslation('question', questionId);
      return ok(question);
    }

    if (method === 'DELETE') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      await prisma.question.delete({ where: { id: questionId } });
      return ok({ deleted: true });
    }
  }

  return null; // not handled by this domain
}
