// AI content regeneration domain handler for lux-admin.
// Handles: lesson audio, lesson/module/course regeneration, regen workers.
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { saveAiJob } from '../shared/db-dynamo';
import { getCurrentEnv } from '../shared/env-context';
import { invalidateTranslation } from '../shared/translate';
import { ok, badRequest, forbidden, notFound, serverError } from '../shared/response';
import {
  AdminCtx, isAuthorized, isAdmin, s3KeyFromUrl, S3_IMAGES_BUCKET,
  lambdaClient, s3Client, generateLessonAudio, generateLessonImage, generateLessonInfographic,
  invokeBedrockForJson, shuffleQuestionOptions,
} from './ctx';

export async function handleAIRegen(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body } = ctx;

  // ── POST /admin/lessons/:lessonId/audio (Polly TTS) ─────────────────────────
  const lessonAudioMatch = path.match(/^\/admin\/lessons\/([^/]+)\/audio$/);
  if (lessonAudioMatch && method === 'POST') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
    try {
      const lessonId = lessonAudioMatch[1]!;
      const voiceId = (body as any).voiceId ?? 'Mia';
      console.log('[audio] START lessonId=%s voiceId=%s bucket=%s', lessonId, voiceId, S3_IMAGES_BUCKET);
      const allowedVoices = ['Mia', 'Lupe', 'Lucia', 'Sergio', 'Pedro'];
      if (!allowedVoices.includes(voiceId)) return badRequest('Voz no válida');

      const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
      if (!lesson) return notFound('Lección no encontrada');

      // Delete old audio from S3 if exists
      if (lesson.audioUrl) {
        const oldKey = s3KeyFromUrl(lesson.audioUrl);
        if (oldKey) await s3Client.send(new DeleteObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: oldKey })).catch(() => {});
      }

      const text = [lesson.title, lesson.content ?? '', ...(lesson.points ?? []), lesson.tip ?? ''].join('. ');
      console.log('[audio] calling Polly, text length=%d', text.length);
      const audioUrl = await generateLessonAudio(lessonId, text, voiceId);
      console.log('[audio] Polly result=%s', audioUrl ?? 'NULL');
      if (!audioUrl) return serverError('No se pudo generar el audio. Verifica permisos IAM de Polly.');

      const updated = await prisma.lesson.update({ where: { id: lessonId }, data: { audioUrl } });
      return ok(updated);
    } catch (e: any) {
      console.error('[audio] Error:', e?.message, e?.code, e?.name);
      return serverError(e?.message ?? 'Error generando audio con Polly');
    }
  }

  // ── POST /admin/lessons/:lessonId/regenerate (X-1) ──────────────────────────
  const lessonRegenMatch = path.match(/^\/admin\/lessons\/([^/]+)\/regenerate$/);
  if (lessonRegenMatch && method === 'POST') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
    const lessonId = lessonRegenMatch[1]!;
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { select: { title: true, course: { select: { title: true } } } } },
    });
    if (!lesson) return notFound('Lección no encontrada');
    const modTitle = lesson.module.title;
    const courseTitle = lesson.module.course.title;

    const regenType = (body as any).type as 'text' | 'image' | 'infographic' | undefined ?? 'text';
    const regenLevel = (body as any).level as 'basic' | 'intermediate' | 'advanced' | undefined ?? 'intermediate';
    const regenStyle = (body as any).style as string | undefined;
    const previewMode = (body as any).preview as boolean ?? false;
    const combineMode = (body as any).combineMode as boolean ?? false;
    const previewData = (body as any).previewData as any;
    // extraContext: sanitize (strip control chars) and truncate to 500 chars
    const rawExtra = typeof (body as any).extraContext === 'string' ? (body as any).extraContext : '';
    const extraContext = rawExtra.replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, 500);

    // ── Confirm phase: apply already-generated previewData to DB ───────────────
    if (previewData && !previewMode) {
      if (regenType === 'text') {
        const updateData = combineMode ? {
          points: [...new Set([...(lesson.points ?? []), ...(Array.isArray(previewData.points) ? previewData.points : [])])],
          tip: previewData.tip ?? lesson.tip,
        } : {
          title: previewData.title ?? lesson.title,
          content: previewData.content ?? lesson.content,
          points: Array.isArray(previewData.points) ? previewData.points : lesson.points,
          tip: previewData.tip ?? lesson.tip,
        };
        const updated = await prisma.lesson.update({ where: { id: lessonId }, data: updateData });
        await invalidateTranslation('lesson', lessonId);
        return ok(updated);
      }
      if ((regenType === 'image' || regenType === 'infographic') && previewData.imageUrl) {
        const updated = await prisma.lesson.update({ where: { id: lessonId }, data: { imageUrl: previewData.imageUrl } });
        return ok(updated);
      }
    }

    if (regenType === 'image') {
      const imageUrl = await generateLessonImage(lesson.title, modTitle, lesson.order, { style: regenStyle, lessonContent: lesson.content ?? '' });
      if (!imageUrl) return badRequest('No se pudo generar la imagen. Intenta de nuevo en unos segundos.');
      if (previewMode) return ok({ imageUrl, preview: true });
      const updated = await prisma.lesson.update({ where: { id: lessonId }, data: { imageUrl } });
      return ok(updated);
    }

    if (regenType === 'infographic') {
      const imageUrl = await generateLessonInfographic(lesson.title, modTitle, lesson.content ?? '');
      if (!imageUrl) return badRequest('No se pudo generar la infografía');
      if (previewMode) return ok({ imageUrl, preview: true });
      const updated = await prisma.lesson.update({ where: { id: lessonId }, data: { imageUrl } });
      return ok(updated);
    }

    // Default: type === 'text' — regenerate lesson content at specified level
    const levelInstructions: Record<string, string> = {
      basic:        'vocabulario simple y didáctico, frases cortas, ejemplos cotidianos, sin tecnicismos. Ideal para principiantes.',
      intermediate: 'lenguaje claro, ejemplos prácticos, estructura bien definida. Para estudiantes con conocimiento básico.',
      advanced:     'profundidad técnica, conceptos avanzados, terminología especializada. Para estudiantes con experiencia.',
    };
    const levelNote = levelInstructions[regenLevel] ?? levelInstructions.intermediate;
    const extraContextSuffix = extraContext ? `\n\nContexto adicional del instructor: ${extraContext}` : '';

    const regen = await invokeBedrockForJson(
      `Eres experto en diseño instruccional. Regenera la lección "${lesson.title}" (orden ${lesson.order}) del módulo "${modTitle}" del curso "${courseTitle}".
Nivel de dificultad: ${regenLevel} — ${levelNote}
Responde ÚNICAMENTE con JSON: {"title":"Título específico","content":"<h3>Subtítulo</h3><p>Párrafo 1 educativo real.</p><ul><li>Punto A</li><li>Punto B</li></ul><p>Párrafo de cierre.</p>","points":["Punto clave 1","Punto clave 2","Punto clave 3"],"tip":"Consejo práctico."}
Genera contenido auténtico sobre el tema, diferente al existente. Voz activa en 2ª persona.${extraContextSuffix}`, 4000
    );
    const regenPayload = {
      title: regen.title ?? lesson.title,
      content: regen.content ?? lesson.content,
      points: Array.isArray(regen.points) ? regen.points : lesson.points,
      tip: regen.tip ?? lesson.tip,
    };
    if (previewMode) return ok({ ...regenPayload, preview: true });
    const updateData = combineMode ? {
      points: [...new Set([...(lesson.points ?? []), ...regenPayload.points])],
      tip: regenPayload.tip,
    } : regenPayload;
    const updated = await prisma.lesson.update({ where: { id: lessonId }, data: updateData });
    await invalidateTranslation('lesson', lessonId);
    return ok(updated);
  }

  // ── POST /admin/modules/:moduleId/regenerate (X-1) ──────────────────────────
  const moduleRegenMatch = path.match(/^\/admin\/modules\/([^/]+)\/regenerate$/);
  if (moduleRegenMatch && method === 'POST') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
    const moduleId = moduleRegenMatch[1]!;
    const mod = await prisma.module.findUnique({
      where: { id: moduleId },
      include: { course: { select: { title: true } } },
    });
    if (!mod) return notFound('Módulo no encontrado');

    const lessonCount = await prisma.lesson.count({ where: { moduleId } });

    const jobId = `regen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveAiJob(jobId, { status: 'processing' });

    const asyncPayload = {
      _env: getCurrentEnv(),
      requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
      rawPath: '/admin/modules/_regen_worker',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        _jobId: jobId,
        _moduleId: moduleId,
        _moduleTitle: mod.title,
        _moduleDesc: mod.description ?? '',
        _courseTitle: mod.course.title,
        _lessonCount: lessonCount > 0 ? lessonCount : 10,
      }),
    };
    await lambdaClient.send(new LambdaInvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(asyncPayload)),
    }));
    return ok({ jobId });
  }

  // ── Async worker for module regeneration ─────────────────────────────────────
  if (path === '/admin/modules/_regen_worker' && method === 'POST') {
    const { _jobId, _moduleId, _moduleTitle, _moduleDesc, _courseTitle, _lessonCount } = body as any;
    if (!_jobId || !_moduleId) return ok({ ok: true });
    try {
      const targetCount: number = Number(_lessonCount) || 10;

      // Check if THIS module has a QUIZ evaluation event planned — only then regenerate
      // questions. Was course-wide before (any QUIZ anywhere in the course), which could
      // add/skip quiz questions on the wrong modules in a course mixing quiz and non-quiz
      // modules (Trello DmPpbrff comment 6a91f73f — same root cause class as the
      // "Preguntas del quiz (0)" visibility bug: no per-module planned signal was used).
      const hasQuizInCourse = await prisma.evaluationEvent.count({ where: { moduleId: _moduleId, type: 'QUIZ' } }) > 0;

      const descContext = _moduleDesc ? ` Descripción del módulo: "${_moduleDesc}".` : '';
      // Same depth standard as the main wizard lesson generation (Trello DmPpbrff comment
      // 6a9232ef — top-tier e-learning design, 700-900 words with a fully worked example
      // and a self-practice section, not a shallow list). max_tokens raised 6000->32000
      // to match (10-16 lessons at 700-900 words each no longer fits in 6000).
      const newLessons = await invokeBedrockForJson(
        `Eres un diseñador instruccional de e-learning de primer nivel. Regenera exactamente ${targetCount} lecciones del módulo "${_moduleTitle}" del curso "${_courseTitle}".${descContext}
Responde ÚNICAMENTE con array JSON válido de exactamente ${targetCount} elementos. Cada lección: title, order, type, content, duration, points (array 3 frases), tip.
Lección 1 y ${targetCount}: type "video" (100-150 palabras). Lecciones intermedias: type "text", 700-900 palabras cada una, con HTML rico (<h3>,<ul><li>,<blockquote>,<p>) y esta estructura: apertura con pregunta real, desarrollo a fondo del concepto (el por qué y el cómo), un ejemplo real trabajado paso a paso (no solo nombrado), y un ejercicio de práctica propia. Voz activa 2ª persona. Sin markdown.`, 32000);

      // Validate BEFORE touching DB — never delete if Bedrock failed
      const lessons = Array.isArray(newLessons) ? newLessons.slice(0, targetCount) : [];
      if (lessons.length === 0) throw new Error('Bedrock no generó lecciones válidas — se conservan las lecciones originales');

      let questions: any[] = [];
      if (hasQuizInCourse) {
        const lessonTitles = lessons.map((l: any, i: number) => `${i + 1}. ${l.title ?? `Lección ${i + 1}`}`).join('\n');
        const newQuestions = await invokeBedrockForJson(
          `Genera exactamente 10 preguntas de opción múltiple para el módulo "${_moduleTitle}" del curso "${_courseTitle}".
Las preguntas deben cubrir el contenido de estas lecciones:\n${lessonTitles}
Array JSON: [{"text":"¿Pregunta?","options":["A","B","C","D"],"correctIndex":0,"order":1},...]. 10 preguntas exactas, correctIndex entre 0-3.`, 2500);
        questions = shuffleQuestionOptions(Array.isArray(newQuestions) ? newQuestions.slice(0, 10) : []);
      }

      // Delete old data and create new — only now that we have valid content
      await prisma.$transaction([
        prisma.lesson.deleteMany({ where: { moduleId: _moduleId } }),
        prisma.question.deleteMany({ where: { moduleId: _moduleId } }),
      ]);

      await prisma.lesson.createMany({
        data: lessons.map((l: any, i: number) => ({
          moduleId: _moduleId,
          title: l.title ?? `Lección ${i + 1}`,
          order: i + 1,
          duration: l.duration ? String(l.duration) : (i === 0 || i === targetCount - 1 ? '5 min' : '8 min'),
          type: i === 0 || i === targetCount - 1 ? 'video' : (l.type ?? 'text'),
          youtubeId: '',
          content: l.content ?? null,
          points: Array.isArray(l.points) ? l.points : [],
          tip: l.tip ?? '',
        })),
      });

      if (questions.length > 0) {
        await prisma.question.createMany({
          data: questions.map((q: any, i: number) => ({
            moduleId: _moduleId,
            text: q.text ?? `Pregunta ${i + 1}`,
            options: Array.isArray(q.options) ? q.options : ['A', 'B', 'C', 'D'],
            correctIndex: Number(q.correctIndex ?? 0),
            order: i + 1,
          })),
        });
      }

      await saveAiJob(_jobId, { status: 'done', result: { moduleId: _moduleId, lessonsCreated: lessons.length, questionsCreated: questions.length } });
    } catch (err: any) {
      await saveAiJob(_jobId, { status: 'error', error: err.message ?? 'Error' });
    }
    return ok({ ok: true });
  }

  // ── POST /admin/courses/:courseId/regenerate (X-1) ───────────────────────────
  const courseRegenMatch = path.match(/^\/admin\/courses\/([^/]+)\/regenerate$/);
  if (courseRegenMatch && method === 'POST') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
    const courseId = courseRegenMatch[1]!;
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true, description: true } });
    if (!course) return notFound('Curso no encontrado');
    const structure = await invokeBedrockForJson(
      `Eres un experto en diseño instruccional. Para el curso "${course.title}" sobre: "${(course.description ?? '').slice(0, 500)}"
Genera una nueva estructura de módulos. Responde ÚNICAMENTE con JSON: {"modules":[{"order":1,"title":"Módulo 1","description":"Descripción breve"},...]}`, 1200
    );
    return ok({ courseId, title: course.title, modules: structure.modules ?? [] });
  }

  return null; // not handled by this domain
}
