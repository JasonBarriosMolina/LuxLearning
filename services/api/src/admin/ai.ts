// AI course generation, publish, and content regeneration domain handler for lux-admin.
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { saveAiJob } from '../shared/db-dynamo';
import { batchTranslate, invalidateTranslation } from '../shared/translate';
import { upsertChat } from '../shared/db-messages';
import { ok, created, badRequest, forbidden, notFound, serverError } from '../shared/response';
import { jsonrepair } from 'jsonrepair';
import {
  AdminCtx, isAuthorized, isAdmin, getCallerName, shuffleQuestionOptions, s3KeyFromUrl,
  S3_IMAGES_BUCKET, lambdaClient, s3Client, bedrock, generateLessonAudio, generateLessonImage,
  generateLessonInfographic,
} from './ctx';

export async function handleAI(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body } = ctx;

  // ── POST /admin/courses/ai-generate ─────────────────────────────────────────
  if (path === '/admin/courses/ai-generate' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { method: genMethod, input, _jobId, _context } = body as { method?: string; input?: string; _jobId?: string; _context?: string };

    // ── ASYNC WORKER: invoked by self with _jobId ───────────────────────────
    if (_jobId && _context) {
      // This branch runs as a fire-and-forget Lambda invocation — no API GW timeout
      const context = _context;

      // ── Bedrock helper ───────────────────────────────────────────────────────
      // Escape control chars ONLY inside JSON string values (not structural whitespace)
      const fixJsonControlChars = (str: string): string => {
        let out = ''; let inStr = false; let esc = false;
        for (let i = 0; i < str.length; i++) {
          const c = str[i]!; const code = str.charCodeAt(i);
          if (esc) { out += c; esc = false; continue; }
          if (c === '\\' && inStr) { out += c; esc = true; continue; }
          if (c === '"') { inStr = !inStr; out += c; continue; }
          if (inStr && code < 0x20) {
            if (code === 0x0A) out += '\\n';
            else if (code === 0x0D) out += '\\r';
            else if (code === 0x09) out += '\\t';
            else out += `\\u${code.toString(16).padStart(4, '0')}`;
          } else { out += c; }
        }
        return out;
      };

      const bedrockJSON = async (prompt: string, maxTokens = 2000): Promise<any> => {
        const res = await bedrock.send(new InvokeModelCommand({
          modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }],
          }),
        }));
        const parsed = JSON.parse(new TextDecoder().decode(res.body));
        const raw = (parsed.content?.[0]?.text ?? '{}').replace(/```json\s*|```/g, '').trim();
        const match = raw.match(/[\[{][\s\S]*/);
        const jsonStr = fixJsonControlChars(match?.[0] ?? '{}');
        try { return JSON.parse(jsonStr); } catch {
          // Use jsonrepair to fix unescaped quotes, trailing commas, truncation, etc.
          try { return JSON.parse(jsonrepair(jsonStr)); } catch {
            return {};
          }
        }
      };

      try {
        // FASE 1: Estructura
        const structure = await bedrockJSON(`Eres un experto en diseño instruccional. Para un curso sobre:
"""
${context.slice(0, 3000)}
"""
Determina cuántos módulos necesita este curso según la complejidad del tema (mínimo 5, máximo 10). Genera la estructura en JSON. Responde ÚNICAMENTE con JSON válido:
{"title":"Título del curso","description":"Descripción 2-3 oraciones","modules":[{"order":1,"title":"Módulo 1","description":"Descripción breve"},{"order":2,"title":"Módulo 2","description":"Descripción breve"},{"order":3,"title":"Módulo 3","description":"Descripción breve"}]}`, 1200);

        if (!structure.title || !Array.isArray(structure.modules)) throw new Error('Estructura inválida');

        // FASE 2: Módulos en paralelo — cada uno genera lecciones y preguntas simultáneamente
        const generateModule = async (mod: { order: number; title: string; description: string }) => {
          const [lessons, questions] = await Promise.all([
            bedrockJSON(`Eres experto en diseño instruccional. Genera las 10 lecciones del módulo "${mod.title}" del curso "${structure.title}".
Responde ÚNICAMENTE con array JSON válido. Cada lección incluye: title, order, type, content, duration, points (array 3 frases cortas), tip (1 consejo práctico).
[
{"title":"Introducción — ${mod.title}","order":1,"type":"video","content":"<p>Escribe 1 párrafo introductorio sobre qué aprenderá el estudiante en ${mod.title} y por qué es importante.</p>","duration":"5 min","points":["Concepto clave 1 de ${mod.title}","Concepto clave 2","Para qué sirve este módulo"],"tip":"Toma notas de los conceptos que te resulten nuevos."},
{"title":"Subtema A","order":2,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo introductorio real sobre el subtema en 2ª persona.</p><ul><li>Punto clave con ejemplo concreto</li><li>Segundo punto importante</li><li>Tercer punto práctico</li></ul><p>Párrafo de cierre con aplicación práctica.</p>","duration":"8 min","points":["Punto clave 1","Punto clave 2","Punto clave 3"],"tip":"Consejo práctico aplicable al subtema."},
{"title":"Subtema B","order":3,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><ul><li>Elemento 1</li><li>Elemento 2</li></ul><blockquote>Cita relevante de autor sobre el tema.</blockquote><p>Párrafo de cierre.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip práctico."},
{"title":"Subtema C","order":4,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><p>Párrafo 2 con ejemplos.</p><ul><li>Ejemplo A</li><li>Ejemplo B</li></ul>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema D","order":5,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><ul><li>Punto A</li><li>Punto B</li></ul><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema E","order":6,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><p>Párrafo 2.</p><blockquote>Cita de experto relevante.</blockquote>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema F","order":7,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><ul><li>Elemento 1</li><li>Elemento 2</li><li>Elemento 3</li></ul>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema G","order":8,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema H","order":9,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><ul><li>Punto 1</li><li>Punto 2</li></ul><p>Párrafo final.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Resumen y cierre — ${mod.title}","order":10,"type":"video","content":"<p>Escribe 1 párrafo que resuma los conceptos principales aprendidos en ${mod.title} y los próximos pasos del estudiante.</p>","duration":"5 min","points":["Resumen concepto 1","Resumen concepto 2","Próximos pasos"],"tip":"Completa el quiz para afianzar lo aprendido."}
]
REGLAS ESTRICTAS: 10 lecciones exactas. Lecciones de texto (order 2-9) DEBEN usar HTML rico: <h3> para subtítulos, <ul><li> para listas con al menos 2-3 elementos, <blockquote> para citas relevantes (al menos 2 lecciones por módulo), <p> para párrafos cortos (máx 3-4 líneas). Voz activa en 2ª persona. Sin markdown, sin comillas dentro del content. Genera contenido educativo auténtico y específico, no ejemplos genéricos.`, 6000),

            bedrockJSON(`Genera exactamente 10 preguntas de opción múltiple en español para el módulo "${mod.title}" del curso "${structure.title}".
Responde ÚNICAMENTE con array JSON válido:
[
{"text":"¿Pregunta real sobre ${mod.title}?","options":["Respuesta correcta","Distractor B","Distractor C","Distractor D"],"correctIndex":0,"order":1},
{"text":"¿Segunda pregunta sobre ${mod.title}?","options":["Op A correcta","Op B","Op C","Op D"],"correctIndex":0,"order":2},
{"text":"¿Tercera pregunta?","options":["Op A","Op B correcta","Op C","Op D"],"correctIndex":1,"order":3},
{"text":"¿Cuarta pregunta?","options":["Op A","Op B","Op C correcta","Op D"],"correctIndex":2,"order":4},
{"text":"¿Quinta pregunta?","options":["Op A","Op B","Op C","Op D correcta"],"correctIndex":3,"order":5},
{"text":"¿Sexta pregunta?","options":["Op A correcta","Op B","Op C","Op D"],"correctIndex":0,"order":6},
{"text":"¿Séptima pregunta?","options":["Op A","Op B correcta","Op C","Op D"],"correctIndex":1,"order":7},
{"text":"¿Octava pregunta?","options":["Op A","Op B","Op C correcta","Op D"],"correctIndex":2,"order":8},
{"text":"¿Novena pregunta?","options":["Op A","Op B","Op C","Op D correcta"],"correctIndex":3,"order":9},
{"text":"¿Décima pregunta?","options":["Op A correcta","Op B","Op C","Op D"],"correctIndex":0,"order":10}
]
REGLAS: exactamente 10 preguntas, opciones con texto real (no genérico), específicas al tema "${mod.title}", correctIndex entre 0-3. Sin markdown.`, 2000),
          ]);

          // Garantizar 10 lecciones completas — validar título, content y regenerar si faltan
          const validLessons = Array.isArray(lessons) ? lessons.filter((l: any) => l && typeof l === 'object') : [];

          // Si faltan lecciones (< 10), completar las faltantes
          const existingOrders = new Set(validLessons.map((l: any) => l.order));
          const missingOrders = Array.from({ length: 10 }, (_, i) => i + 1).filter((o) => !existingOrders.has(o));
          const extraLessons = await Promise.all(missingOrders.map(async (order) => {
            const isVideo = order === 1 || order === 10;
            const fallback = await bedrockJSON(
              `Genera la lección ${order} de 10 del módulo "${mod.title}" del curso "${structure.title}".
Responde ÚNICAMENTE con JSON: {"title":"Título real","order":${order},"type":"${isVideo ? 'video' : 'text'}","content":"<p>Contenido educativo real.</p><p>Segundo párrafo.</p>","duration":"${isVideo ? '5' : '8'} min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Consejo práctico."}`, 600
            );
            return { type: isVideo ? 'video' : 'text', duration: isVideo ? '5 min' : '8 min', ...fallback, order };
          }));

          const allLessons = [...validLessons, ...extraLessons].sort((a: any, b: any) => a.order - b.order);

          // Validar y completar campos faltantes en cada lección
          const finalLessons = await Promise.all(allLessons.map(async (l: any) => {
            const needsContent = !l.content || l.content.trim().length < 10;
            const needsTitle = !l.title || l.title.trim().length < 2;
            if (!needsContent && !needsTitle) return l;
            const fallback = await bedrockJSON(
              `Genera datos para la lección ${l.order} "${needsTitle ? 'sin título' : l.title}" del módulo "${mod.title}".
Responde ÚNICAMENTE con JSON: {"title":"Título real específico","content":"<p>Párrafo 1 educativo.</p><p>Párrafo 2.</p>","points":["Punto 1","Punto 2","Punto 3"],"tip":"Consejo práctico."}`, 600
            );
            return {
              ...l,
              title: needsTitle ? (fallback.title ?? `Lección ${l.order} — ${mod.title}`) : l.title,
              content: needsContent ? (fallback.content ?? `<p>Contenido de lección ${l.order} sobre ${mod.title}.</p>`) : l.content,
              points: l.points?.length ? l.points : (fallback.points ?? [`Punto clave de ${mod.title}`]),
              tip: l.tip || fallback.tip || 'Repasa los puntos clave antes de continuar.',
            };
          }));

          // Garantizar 10 preguntas de quiz
          let finalQuestions = Array.isArray(questions) ? questions.filter((q: any) => q?.text && q?.options?.length === 4) : [];
          if (finalQuestions.length < 10) {
            const missing = 10 - finalQuestions.length;
            const extraQ = await bedrockJSON(
              `Genera ${missing} preguntas de opción múltiple sobre "${mod.title}". Array JSON: [{"text":"¿Pregunta?","options":["A","B","C","D"],"correctIndex":0,"order":${finalQuestions.length + 1}},...]. Sin markdown.`, 1000
            );
            if (Array.isArray(extraQ)) finalQuestions = [...finalQuestions, ...extraQ].slice(0, 10);
          }
          finalQuestions = shuffleQuestionOptions(finalQuestions).map((q: any, i: number) => ({ ...q, order: i + 1 }));

          return { order: mod.order, title: mod.title, description: mod.description,
            lessons: finalLessons,
            questions: finalQuestions };
        };

        const modulesWithContent = await Promise.all(structure.modules.map((mod: any) => generateModule(mod)));
        const result = { title: structure.title, description: structure.description,
          modules: modulesWithContent.sort((a: any, b: any) => a.order - b.order) };

        await saveAiJob(_jobId, { status: 'done', result });
      } catch (err: any) {
        await saveAiJob(_jobId, { status: 'error', error: err.message ?? 'Error desconocido' });
      }
      return ok({ ok: true }); // async invocation ignores response
    }

    // ── DISPATCH: first call — save job and fire async ────────────────────────
    if (!input) return badRequest('input es requerido');
    // SSRF guard: block private IPs, metadata service, and non-HTTP schemes
    if (genMethod === 'url') {
      try {
        const parsed = new URL(input);
        if (!['http:', 'https:'].includes(parsed.protocol)) return badRequest('URL no permitida');
        const h = parsed.hostname;
        const blocked = [/^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./];
        if (blocked.some((r) => r.test(h)) || h === 'localhost' || h.endsWith('.local'))
          return badRequest('URL no permitida');
      } catch { return badRequest('URL inválida'); }
    }
    let context = input;
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
      } catch { return badRequest('No se pudo obtener contenido de la URL'); }
    }

    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveAiJob(jobId, { status: 'processing' });

    // Fire-and-forget: invoke self async bypassing API GW timeout
    const asyncPayload = {
      requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
      rawPath: '/admin/courses/ai-generate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ _jobId: jobId, _context: context }),
    };
    await lambdaClient.send(new LambdaInvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
      InvocationType: 'Event', // async — no wait for response
      Payload: Buffer.from(JSON.stringify(asyncPayload)),
    }));

    return ok({ jobId });
  }

  // ── POST /admin/courses/ai-publish ───────────────────────────────────────────
  if (path === '/admin/courses/ai-publish' && method === 'POST') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
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

    const slug = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      + '-' + Math.random().toString(36).slice(2, 8);

    const publisherName = await getCallerName(event);
    const publisherRole = event.requestContext.authorizer?.lambda?.role ?? '';
    const publisherId = event.requestContext.authorizer?.lambda?.userId;

    // Suggest tags with AI (non-blocking — run before course creation)
    let suggestedTags: string[] = [];
    try {
      const tagPrompt = `Eres un experto en clasificación de cursos educativos. Sugiere entre 3 y 5 etiquetas (tags) relevantes para el siguiente curso, en español, cortas (1-3 palabras cada una).

Curso: "${title}"
Descripción: "${(description ?? '').slice(0, 300)}"

Responde ÚNICAMENTE con un array JSON de strings. Ejemplo: ["liderazgo","comunicación","gestión"]`;

      const tagRes = await bedrock.send(new InvokeModelCommand({
        modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 200,
          messages: [{ role: 'user', content: tagPrompt }],
        }),
      }));
      const tagText = JSON.parse(new TextDecoder().decode(tagRes.body)).content[0].text.trim();
      const cleaned = tagText.replace(/```json|```/g, '').trim();
      suggestedTags = JSON.parse(cleaned);
      if (!Array.isArray(suggestedTags)) suggestedTags = [];
    } catch { suggestedTags = []; }

    const course = await prisma.course.create({
      data: {
        title,
        slug,
        description: description ?? '',
        isActive: false,
        isPilot: false,
        tags: suggestedTags,
        createdByName: publisherName,
        evaluatorId: publisherRole === 'EVALUATOR' ? publisherId : null,
        evaluatorName: publisherRole === 'EVALUATOR' ? (publisherName ?? null) : null,
        modules: {
          create: modules.map((m) => ({
            title: m.title,
            description: m.description ?? '',
            order: m.order,
            duration: `${(m.lessons?.length ?? 0) * 5} min`,
            passingScore: 70,
            lessons: {
              // Use array index as order to avoid duplicate (moduleId, order) constraint
              create: (m.lessons ?? []).map((l: any, li: number) => ({
                title: l.title,
                order: li + 1,
                duration: l.duration ? String(l.duration) : (l.type === 'video' ? '5 min' : '8 min'),
                type: l.content ? 'text' : (l.type ?? 'text'),
                youtubeId: '',
                content: l.content ?? null,
                points: Array.isArray(l.points) ? l.points : [],
                tip: l.tip ?? '',
              })),
            },
            questions: {
              // Use array index as order to avoid duplicate (moduleId, order) constraint
              create: shuffleQuestionOptions(m.questions ?? []).map((q: any, qi: number) => ({
                text: q.text,
                options: q.options,
                correctIndex: Number(q.correctIndex),
                order: qi + 1,
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
    // Auto-create group chat for the new course
    await upsertChat(`group_${course.id}`, {
      type: 'GROUP',
      name: `Curso: ${course.title}`,
      participants: [],
    }).catch(() => {});

    // X-3: Generate images for lessons at orders 2, 6, 10 (non-fatal)
    try {
      await Promise.all(
        course.modules.flatMap((mod: any) =>
          mod.lessons
            .filter((l: any) => [2, 6, 10].includes(l.order))
            .map(async (lesson: any) => {
              const url = await generateLessonImage(lesson.title, mod.title, lesson.order, { lessonContent: lesson.content ?? '' });
              if (url) await prisma.lesson.update({ where: { id: lesson.id }, data: { imageUrl: url } });
            })
        )
      );
    } catch (e) { console.warn('[ImageGen] Batch image generation error:', e); }

    // X-4: Generate Polly audio for all lessons asynchronously (fire-and-forget)
    try {
      const allLessonIds = course.modules.flatMap((m: any) => m.lessons.map((l: any) => l.id));
      await lambdaClient.send(new LambdaInvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
        InvocationType: 'Event', // async — returns immediately
        Payload: Buffer.from(JSON.stringify({
          requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
          rawPath: '/_internal/audio',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ _action: 'bulk-audio', lessonIds: allLessonIds, voiceId: 'Mia' }),
        })),
      }));
    } catch (e) { console.warn('[Polly] Failed to schedule bulk audio generation:', e); }

    return created({ ...course, suggestedTags });
  }

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

    // Parse type/level/style/preview flags from request body
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

    const bedrockJSONSimple = async (prompt: string, maxTokens = 2000): Promise<any> => {
      const res = await bedrock.send(new InvokeModelCommand({
        modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      }));
      const raw = (JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text ?? '{}').replace(/```json\s*|```/g, '').trim();
      const match = raw.match(/[\[{][\s\S]*/);
      try { return JSON.parse(match?.[0] ?? '{}'); } catch { try { return JSON.parse(jsonrepair(match?.[0] ?? '{}')); } catch { return {}; } }
    };

    if (regenType === 'image') {
      // Regenerate the lesson image only (generate+upload to S3, then optionally save to DB)
      const imageUrl = await generateLessonImage(lesson.title, modTitle, lesson.order, { style: regenStyle, lessonContent: lesson.content ?? '' });
      if (!imageUrl) return badRequest('No se pudo generar la imagen. Intenta de nuevo en unos segundos.');
      if (previewMode) return ok({ imageUrl, preview: true }); // return URL without saving
      const updated = await prisma.lesson.update({ where: { id: lessonId }, data: { imageUrl } });
      return ok(updated);
    }

    if (regenType === 'infographic') {
      // Generate SVG infographic via Haiku — real readable text, lesson-specific content
      const imageUrl = await generateLessonInfographic(lesson.title, modTitle, lesson.content ?? '');
      if (!imageUrl) return badRequest('No se pudo generar la infografía');
      if (previewMode) return ok({ imageUrl, preview: true }); // return URL without saving
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

    const extraContextSuffix = extraContext
      ? `\n\nContexto adicional del instructor: ${extraContext}`
      : '';
    const regen = await bedrockJSONSimple(
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
    if (previewMode) return ok({ ...regenPayload, preview: true }); // return without saving
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

    // Count existing lessons so worker regenerates the same number
    const lessonCount = await prisma.lesson.count({ where: { moduleId } });

    const jobId = `regen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveAiJob(jobId, { status: 'processing' });

    const asyncPayload = {
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

      // Step 1: Generate lessons first
      const descContext = _moduleDesc ? ` Descripción del módulo: "${_moduleDesc}".` : '';
      const newLessons = await bedrockJSON2(
        `Eres experto en diseño instruccional. Regenera exactamente ${targetCount} lecciones del módulo "${_moduleTitle}" del curso "${_courseTitle}".${descContext}
Responde ÚNICAMENTE con array JSON válido de exactamente ${targetCount} elementos. Cada lección: title, order, type, content, duration, points (array 3 frases), tip.
Lección 1 y ${targetCount}: type "video". Lecciones intermedias: type "text" con HTML rico (<h3>,<ul><li>,<blockquote>,<p>). Voz activa 2ª persona. Sin markdown.`, 6000);

      // Validate BEFORE touching DB — never delete if Bedrock failed
      const lessons = Array.isArray(newLessons) ? newLessons.slice(0, targetCount) : [];
      if (lessons.length === 0) throw new Error('Bedrock no generó lecciones válidas — se conservan las lecciones originales');

      // Step 2: Generate quiz using real lesson titles as context (sequential, not parallel)
      const lessonTitles = lessons.map((l: any, i: number) => `${i + 1}. ${l.title ?? `Lección ${i + 1}`}`).join('\n');
      const newQuestions = await bedrockJSON2(
        `Genera exactamente 10 preguntas de opción múltiple para el módulo "${_moduleTitle}" del curso "${_courseTitle}".
Las preguntas deben cubrir el contenido de estas lecciones:\n${lessonTitles}
Array JSON: [{"text":"¿Pregunta?","options":["A","B","C","D"],"correctIndex":0,"order":1},...]. 10 preguntas exactas, correctIndex entre 0-3.`, 2500);

      const questions = shuffleQuestionOptions(Array.isArray(newQuestions) ? newQuestions.slice(0, 10) : []);

      // Step 3: Delete old data and create new — only now that we have valid content
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
    // Run FASE 1 synchronously (structure only — no publish)
    const structureRes = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json', accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31', max_tokens: 1200,
        messages: [{ role: 'user', content: `Eres un experto en diseño instruccional. Para el curso "${course.title}" sobre: "${(course.description ?? '').slice(0, 500)}"
Genera una nueva estructura de módulos. Responde ÚNICAMENTE con JSON: {"modules":[{"order":1,"title":"Módulo 1","description":"Descripción breve"},...]}` }],
      }),
    }));
    const raw = (JSON.parse(new TextDecoder().decode(structureRes.body)).content?.[0]?.text ?? '{}').replace(/```json\s*|```/g, '').trim();
    const match = raw.match(/[\[{][\s\S]*/);
    let structure: any = {};
    try { structure = JSON.parse(match?.[0] ?? '{}'); } catch { try { structure = JSON.parse(jsonrepair(match?.[0] ?? '{}')); } catch { structure = {}; } }
    return ok({ courseId, title: course.title, modules: structure.modules ?? [] });
  }

  return null; // not handled by this domain
}
