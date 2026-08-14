// Lesson, question, and AI generation domain handler for lux-admin.
// Handles: lesson CRUD, question CRUD, per-module AI generation.
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { saveAiJob } from '../shared/db-dynamo';
import { getCurrentEnv } from '../shared/env-context';
import { invalidateTranslation } from '../shared/translate';
import { ok, created, badRequest, forbidden, notFound, serverError } from '../shared/response';
import {
  AdminCtx, isAuthorized, isAdmin, shuffleQuestionOptions, s3KeyFromUrl,
  S3_IMAGES_BUCKET, lambdaClient, s3Client, generateLessonAudio, invokeBedrockForJson,
} from './ctx';

export async function handleCoursesContent(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body } = ctx;

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
        // Check if this course's evaluation plan includes a QUIZ type.
        // Only generate quiz questions when the plan explicitly requires it.
        const course = await prisma.course.findUnique({
          where: { id: courseId },
          select: { evaluationConfig: true },
        });
        const evalConfig = Array.isArray((course as any)?.evaluationConfig) ? (course as any).evaluationConfig : [];
        const hasQuizInPlan = evalConfig.some((it: any) => it.type === 'QUIZ');

        const modMeta = await invokeBedrockForJson(
          `Eres experto en diseño instruccional. Genera título y descripción para un módulo sobre "${topic}" dentro del curso "${workerCourseTitle}".
Responde ÚNICAMENTE con JSON: {"title":"Título real del módulo","description":"Descripción de 1-2 oraciones."}`, 400);
        const modTitle = (modMeta.title as string) || topic;
        const modDesc = (modMeta.description as string) || `Módulo sobre ${topic}`;

        // Generate lessons (and quiz questions only if QUIZ is in the evaluation plan)
        const lessonPromise = invokeBedrockForJson(`Genera exactamente 10 lecciones para el módulo "${modTitle}" del curso "${workerCourseTitle}".
Array JSON (10 elementos):
[{"title":"Introducción — ${modTitle}","order":1,"type":"video","content":"<p>Párrafo introductorio.</p>","duration":"5 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Consejo."},
{"title":"Subtema A","order":2,"type":"text","content":"<h3>Subtema</h3><p>Párrafo.</p><ul><li>Punto A</li><li>Punto B</li></ul><p>Cierre.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Resumen — ${modTitle}","order":10,"type":"video","content":"<p>Resumen.</p>","duration":"5 min","points":["Resumen 1","Resumen 2","Próximos pasos"],"tip":"Completa el quiz."}]
Lecciones 2-9 tipo text con HTML rico: <h3>, <ul><li>, <blockquote>. Sin markdown.`, 6000);
        const questionPromise = hasQuizInPlan
          ? invokeBedrockForJson(`Genera exactamente 10 preguntas de opción múltiple sobre "${modTitle}".
Array JSON: [{"text":"¿Pregunta real?","options":["Op A","Op B","Op C","Op D"],"correctIndex":0,"order":1}]
10 preguntas, correctIndex entre 0-3, opciones con texto real. Sin markdown.`, 2000)
          : Promise.resolve([]);

        const [rawLessons, rawQuestions] = await Promise.all([lessonPromise, questionPromise]);

        const lessons = Array.isArray(rawLessons) ? rawLessons.slice(0, 10) : [];
        const questions = hasQuizInPlan
          ? shuffleQuestionOptions(Array.isArray(rawQuestions) ? rawQuestions.slice(0, 10) : [])
          : [];

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
      _env: getCurrentEnv(),
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
      _env: getCurrentEnv(),
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

    // Invalidate translations for newly created questions
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
