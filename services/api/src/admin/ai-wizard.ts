// AI wizard domain handler for lux-admin.
// Handles: wizard/copilot (plan generation), wizard/save, and their async workers.
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { saveAiJob } from '../shared/db-dynamo';
import { getCurrentEnv } from '../shared/env-context';
import { upsertChat } from '../shared/db-messages';
import { ok, created, badRequest, forbidden, serverError } from '../shared/response';
import {
  AdminCtx, isAuthorized, isAdmin, getCallerName, shuffleQuestionOptions,
  S3_IMAGES_BUCKET, lambdaClient, s3Client, invokeBedrockForJson,
} from './ctx';
import { generateWizardPlanDocument, createWizardCourseSessions, syncWizardCalendarEvents } from './ai-wizard-docx';

/**
 * Convert residual Markdown artifacts to HTML so lesson content renders cleanly.
 * AI models sometimes ignore the "no markdown" instruction — this catches the most common cases.
 */
function sanitizeLessonContent(raw: string): string {
  if (!raw || typeof raw !== 'string') return raw;
  let out = raw
    // ATX headings (##/###) → <h3> — visual chunking / subtítulos
    .replace(/^#{2,3}\s+(.+)$/gm, '<h3>$1</h3>')
    // H1 fallback → <h3>
    .replace(/^#\s+(.+)$/gm, '<h3>$1</h3>')
    // Bold **text** → <strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic *text* → <em>
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')
    // Inline code `code` → <code>
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Horizontal rules
    .replace(/^---+$/gm, '<hr/>');
  // Bullet lists (viñetas): group consecutive "- item" / "* item" lines into <ul><li>
  out = out.replace(/(?:^[-*]\s+.+$\n?)+/gm, (block) => {
    const items = block.trim().split(/\n/).map((line) => line.replace(/^[-*]\s+/, '').trim());
    return `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
  });
  return out;
}

export async function handleAIWizard(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body } = ctx;

  // ── Async worker: wizard bulk lesson generation ──────────────────────────────
  if (ctx.action === 'wizard-lessons-bulk') {
    const {
      _jobId, courseId: blCourseId, moduleIds = [], courseTitle: blTitle = '',
      language: blLang = 'ES', evaluationItems: blEvalItems = [],
      _quizOnlyForExistingModules = false,
      quizModuleIndices: blQuizIndices,
      classModuleIndices: blClassIndices,
    } = body as any;
    const isBlEN = blLang === 'EN';
    // Per-module index sets. Falls back to "all modules" when indices not provided.
    const hasQuizInPlan = (blEvalItems as any[]).some((it: any) => it.type === 'QUIZ');
    const hasClassInPlan = (blEvalItems as any[]).some((it: any) => it.type === 'CLASS');
    const quizIdxSet: Set<number> = new Set(
      Array.isArray(blQuizIndices) ? blQuizIndices :
      hasQuizInPlan ? (moduleIds as string[]).map((_: any, i: number) => i) : []
    );
    const classIdxSet: Set<number> = new Set(
      Array.isArray(blClassIndices) ? blClassIndices :
      hasClassInPlan ? (moduleIds as string[]).map((_: any, i: number) => i) : []
    );
    const failed: string[] = [];
    try {
      for (let moduleIdx = 0; moduleIdx < (moduleIds as string[]).length; moduleIdx++) {
        const moduleId = (moduleIds as string[])[moduleIdx]!;
        try {
          const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true, description: true } });
          if (!mod) continue;

          // When re-using this worker just to generate quiz questions for already-existing modules,
          // skip lesson generation if the module already has lessons.
          if (_quizOnlyForExistingModules) {
            const existingLessonCount = await prisma.lesson.count({ where: { moduleId } });
            if (existingLessonCount > 0 && quizIdxSet.has(moduleIdx)) {
              const qPrompt = isBlEN
                ? `Generate exactly 10 multiple-choice questions about "${mod.title}". JSON array: [{"text":"Question?","options":["A","B","C","D"],"correctIndex":0,"order":1}] No markdown.`
                : `Genera exactamente 10 preguntas de opción múltiple sobre "${mod.title}". Array JSON: [{"text":"¿Pregunta?","options":["A","B","C","D"],"correctIndex":0,"order":1}] Sin markdown.`;
              const rawQ = await invokeBedrockForJson(qPrompt, 2000);
              const questions = shuffleQuestionOptions(Array.isArray(rawQ) ? rawQ.slice(0, 10) : []);
              if (questions.length > 0) {
                await prisma.question.createMany({
                  data: questions.map((q: any, i: number) => ({
                    moduleId, text: q.text, options: q.options,
                    correctIndex: Number(q.correctIndex), order: i + 1,
                  })),
                });
              }
            }
            // Skip lesson generation regardless (module has no lessons, or no quiz planned)
            continue;
          }

          // ── Generate lesson content via Bedrock (one call per module) ──────────
          // Dynamic lesson count based on ~60 min async target per module.
          // 2 video lessons (intro + outro, 5 min each) + text lessons at 10 min
          // active comprehension each (reading + assimilation, not raw WPM).
          // Modules WITH a synchronous class still get the same async content —
          // the class is supplementary, not a replacement for study material.
          const hasClass = classIdxSet.has(moduleIdx);
          const TARGET_ASYNC_MIN = 60;
          const VIDEO_LESSON_MIN = 5;
          const TEXT_COMPREHENSION_MIN = 6; // 5-7 min per lesson — scaffolded chunks, not long monologues
          const textLessonCount = Math.max(4, Math.min(8,
            Math.round((TARGET_ASYNC_MIN - 2 * VIDEO_LESSON_MIN) / TEXT_COMPREHENSION_MIN)
          )); // default: 6 → lessonCount = 10 (≈ 60 min async)
          const lessonCount = 2 + textLessonCount;
          const textDuration = `${TEXT_COMPREHENSION_MIN} min`;

          const classContextNote = hasClass
            ? (isBlEN
              ? `\nThis module includes a 50-minute synchronous Lux Mentor class. The async lessons are the study material students use before and after the class.`
              : `\nEste módulo incluye una sesión sincrónica de 50 minutos en Lux Mentor. Las lecciones asíncronas son el material de estudio que los estudiantes usan antes y después de esa sesión.`)
            : '';

          const lessonPrompt = isBlEN
            ? `You are an expert instructional designer. Generate exactly ${lessonCount} lessons for the module "${mod.title}" in the course "${blTitle}".${classContextNote}
Target: ~${TARGET_ASYNC_MIN} minutes of active async study per module, split into short scaffolded lessons (${TEXT_COMPREHENSION_MIN} min each) — each lesson builds on the previous one's concepts.
Lesson 1 and Lesson ${lessonCount} are video type (introductory/summary, 100-150 words, ~${VIDEO_LESSON_MIN} min). All others are text type (150-220 words each, ~${TEXT_COMPREHENSION_MIN} min active comprehension).
STRUCTURE for every text lesson's "content" field (HTML, no full markdown):
- One specific <h3> subtitle naming the exact concept covered — never generic labels like "Introduction", "Summary", "Hook", "Practical Bridge", or "Reflective Close". The subtitle must name the concept itself (e.g. "<h3>Time Complexity in Sorting Algorithms</h3>").
- Short paragraphs of at most 4-5 lines each — no dense walls of text.
- At least one <strong> bolded key term and one bullet list (use "- item" lines, they get converted to <ul><li>) to break up the reading.
- One brief practical/real-world case connecting the theory to actual application — the <h3> for this section must name the specific example (e.g. "<h3>Application in E-commerce Systems</h3>"), NEVER the generic "Practical Bridge".
- The LAST text lesson of the module must close with a reflective summary — the <h3> must name the module topic (e.g. "<h3>Key Takeaways: Data Structures Fundamentals</h3>"), NEVER the generic "Reflective Close".
Write in neutral, formal international English — no slang or regionalisms.
Return ONLY a JSON array of exactly ${lessonCount} objects with no markdown fencing:
[{"title":"Lesson title","content":"<h3>Specific concept subtitle</h3><p>HTML paragraph content</p>","points":["key point 1","key point 2","key point 3"],"tip":"one practical tip","type":"video|text","duration":"5 min|${TEXT_COMPREHENSION_MIN} min"}]`
            : `Eres un experto en diseño instruccional. Genera exactamente ${lessonCount} lecciones para el módulo "${mod.title}" del curso "${blTitle}".${classContextNote}
Meta: ~${TARGET_ASYNC_MIN} minutos de estudio asíncrono activo por módulo, repartidos en lecciones cortas con andamiaje progresivo (${TEXT_COMPREHENSION_MIN} min cada una) — cada lección construye sobre los conceptos de la anterior.
La lección 1 y la lección ${lessonCount} son tipo video (intro/resumen, 100-150 palabras, ~${VIDEO_LESSON_MIN} min). Las demás son tipo texto (150-220 palabras cada una, ~${TEXT_COMPREHENSION_MIN} min de comprensión activa).
ESTRUCTURA obligatoria para el campo "content" de cada lección de texto (HTML, sin markdown completo):
- Un <h3> subtítulo específico que nombre el concepto exacto que se trata — NUNCA genéricos como "Introducción", "Resumen", "Gancho", "Desarrollo", "Puente Práctico" ni "Cierre Reflexivo". El subtítulo debe nombrar el concepto en sí (ej. "<h3>Complejidad Temporal en Algoritmos de Ordenamiento</h3>").
- Párrafos cortos de máximo 4-5 líneas — evitar bloques densos de texto.
- Al menos un término clave en <strong> y una lista con viñetas (usa líneas "- item", se convierten a <ul><li>) para facilitar la lectura (chunking visual).
- Un caso práctico breve que conecte la teoría con la aplicación real — el <h3> de esa sección debe nombrar el ejemplo concreto (ej. "<h3>Aplicación en Sistemas de E-commerce</h3>"), NUNCA el genérico "Puente Práctico".
- La ÚLTIMA lección de texto del módulo cierra con un resumen de puntos clave más 1-2 preguntas de autoevaluación — el <h3> debe nombrar el tema del módulo (ej. "<h3>Síntesis: Fundamentos de Estructuras de Datos</h3>"), NUNCA el genérico "Cierre Reflexivo".
Redacta en español latino neutro y formal — sin modismos ni jerga local de ningún país.
Devuelve ÚNICAMENTE un array JSON de exactamente ${lessonCount} objetos sin markdown de cercado:
[{"title":"Título lección","content":"<h3>Subtítulo del concepto específico</h3><p>Párrafo HTML con contenido</p>","points":["punto clave 1","punto clave 2","punto clave 3"],"tip":"un consejo práctico","type":"video|text","duration":"5 min|${TEXT_COMPREHENSION_MIN} min"}]`;

          const rawLessons = await invokeBedrockForJson(lessonPrompt, 8000).catch(() => null);
          const validLessons = Array.isArray(rawLessons) && rawLessons.length > 0 && rawLessons[0]?.title
            ? rawLessons : null;

          const lessonData = Array.from({ length: lessonCount }, (_, i) => {
            const isFirst = i === 0;
            const isLast = i === lessonCount - 1;
            const defaultType = isFirst || isLast ? 'video' : 'text';
            const defaultDuration = defaultType === 'video' ? '5 min' : textDuration;
            const gen = validLessons?.[i];
            return {
              moduleId,
              title: gen?.title || (isBlEN ? `Lesson ${i + 1}` : `Lección ${i + 1}`),
              type: gen?.type || defaultType,
              content: gen?.content ? sanitizeLessonContent(gen.content) : null as string | null,
              youtubeId: '',
              imageUrl: null as string | null,
              duration: gen?.duration || defaultDuration,
              points: Array.isArray(gen?.points) ? gen.points : [] as string[],
              tip: gen?.tip || '',
              order: i + 1,
            };
          });

          await prisma.lesson.createMany({ data: lessonData });
          const createdLessons = lessonData.map((l) => ({ duration: l.duration }));

          // Only create quiz questions for designated modules (#18 fix)
          if (quizIdxSet.has(moduleIdx)) {
            const qPrompt = isBlEN
              ? `Generate exactly 10 multiple-choice questions about "${mod.title}". JSON array: [{"text":"Question?","options":["A","B","C","D"],"correctIndex":0,"order":1}] No markdown.`
              : `Genera exactamente 10 preguntas de opción múltiple sobre "${mod.title}". Array JSON: [{"text":"¿Pregunta?","options":["A","B","C","D"],"correctIndex":0,"order":1}] Sin markdown.`;
            const rawQ = await invokeBedrockForJson(qPrompt, 2000);
            const questions = shuffleQuestionOptions(Array.isArray(rawQ) ? rawQ.slice(0, 10) : []);
            if (questions.length > 0) {
              await prisma.question.createMany({
                data: questions.map((q: any, i: number) => ({
                  moduleId, text: q.text, options: q.options,
                  correctIndex: Number(q.correctIndex), order: i + 1,
                })),
              });
            }
          }

          // Create/update CLASS EvaluationEvent for designated modules (#17 fix)
          if (classIdxSet.has(moduleIdx)) {
            const classPrompt = isBlEN
              ? `Generate a Lux Mentor class script for module "${mod.title}". JSON: {"vapiPrompt":"<interactive AI tutor prompt, 150 words max, pose guiding questions>","lessonScript":"<class outline with 3 key topics and activities, 200 words>"}`
              : `Genera un guión de Clase Magistral Lux Mentor para el módulo "${mod.title}". JSON: {"vapiPrompt":"<prompt interactivo para tutor IA, máx 150 palabras, plantea preguntas guía>","lessonScript":"<esquema de clase con 3 temas clave y actividades, 200 palabras>"}`;
            const classContent = await invokeBedrockForJson(classPrompt, 1000).catch(() => null);
            if (classContent?.vapiPrompt) {
              const existingClass = await prisma.evaluationEvent.findFirst({ where: { courseId: blCourseId, moduleId, type: 'CLASS' } });
              if (existingClass) {
                await prisma.evaluationEvent.update({ where: { id: existingClass.id }, data: { vapiPrompt: classContent.vapiPrompt, lessonScript: classContent.lessonScript ?? null } });
              } else {
                await prisma.evaluationEvent.create({ data: { courseId: blCourseId, moduleId, type: 'CLASS', name: isBlEN ? `Lux Mentor Class — ${mod.title}` : `Clase Magistral — ${mod.title}`, weight: 0, order: moduleIdx, vapiPrompt: classContent.vapiPrompt, lessonScript: classContent.lessonScript ?? null } });
              }
            }
          }

          // Module duration = actual sum of created lesson durations
          const totalMin = createdLessons.reduce((sum: number, l) => {
            const m = parseInt(l.duration, 10);
            return sum + (isNaN(m) ? 7 : m);
          }, 0);
          await prisma.module.update({ where: { id: moduleId }, data: { duration: `${totalMin} min` } });
        } catch (modErr: any) {
          console.error(`[wizard-lessons-bulk] module ${moduleId} error:`, modErr);
          failed.push(moduleId);
        }
      }
      await saveAiJob(_jobId, { status: 'done', modulesProcessed: (moduleIds as string[]).length, failed: failed.length });
    } catch (err: any) {
      await saveAiJob(_jobId, { status: 'error', error: err?.message ?? 'Error generando lecciones' });
    }
    return ok({});
  }

  // ── Async worker: wizard copilot ─────────────────────────────────────────────
  if (ctx.action === 'wizard-copilot') {
    const {
      _jobId, title, courseType, description = '', planLanguage = 'ES', modality = '',
      totalWeeks = 16, startDate = '', classDays = [], classSchedule = '',
      academicPeriod = '', evaluationItems = [], syllabusInput = '', exceptionWeeks = [],
    } = body as any;
    try {
      const isEN = planLanguage === 'EN';
      const effectiveWeeks = (totalWeeks as number) - (exceptionWeeks as number[]).length;
      const evalSummary = (evaluationItems as any[])
        .map((it: any) => {
          const label = isEN ? (it.nameEN || it.name) : it.name;
          const countNote = it.count > 1 ? ` (${it.count})` : '';
          return `- ${label}${countNote}: ${it.weight}%, ${it.count} entrega(s)`;
        }).join('\n');
      const exceptionNote = (exceptionWeeks as number[]).length > 0
        ? `\n${isEN ? 'Non-teaching weeks' : 'Semanas con excepciones (NO lectivas)'}: ${(exceptionWeeks as number[]).map((n) => `S${n}`).join(', ')}`
        : '';
      const jsonFormat = isEN
        ? `{"modules":[{"name":"Module","nameEN":"Module","description":"2-3 sentences","descriptionEN":"2-3 sentences","weeks":[1,2,3]}],"weeklyPlan":[{"weekNum":1,"topics":["Specific topic"],"module":"Module","procedure":"Suggested class activity","notes":"Important observation or upcoming deadline","evalEvent":null}]}`
        : `{"modules":[{"name":"Módulo","nameEN":"Module","description":"2-3 oraciones","descriptionEN":"2-3 sentences","weeks":[1,2,3]}],"weeklyPlan":[{"weekNum":1,"topics":["Tema específico"],"module":"Módulo","procedure":"Actividad sugerida en clase","notes":"Observación importante o entrega próxima","evalEvent":null}]}`;
      const isAsync = (modality as string).toUpperCase().includes('ASINC') || (modality as string).toUpperCase().includes('ASYNC');
      const asyncNote = isAsync
        ? (isEN
          ? '\n\nASYNC COURSE RULE: Assign modules at exactly 1 module per week in strict sequential order — no skipping weeks. Example: if 4 modules and 16 weeks, assign ~4 weeks per module; every week in the plan must belong to a module.'
          : '\n\nREGLA CURSO ASÍNCRONO: Asigna módulos a razón de exactamente 1 módulo por semana en orden secuencial estricto — sin saltar semanas. Ejemplo: si hay 4 módulos y 16 semanas, asigna ~4 semanas por módulo; cada semana del plan debe pertenecer a un módulo.')
        : '';
      // For sync/lecture courses: one distinct topic per teaching week — no topic spans multiple weeks.
      const syncNote = !isAsync
        ? (isEN
          ? `\n\nSYNC/LECTURE COURSE RULE: Generate exactly ${effectiveWeeks} modules — one per teaching week. Each module covers a completely distinct topic developed fully in that single week. Do NOT repeat or span one topic across multiple weeks. If the syllabus has fewer topics than weeks, subdivide topics into subtopics to fill each week.`
          : `\n\nREGLA CURSO SINCRÓNICO/TEÓRICO: Genera exactamente ${effectiveWeeks} módulos — uno por semana lectiva. Cada módulo cubre un tema completamente distinto que se desarrolla en esa sola semana. NO repitas ni distribuyas el mismo tema en múltiples semanas. Si el temario tiene menos temas que semanas, subdivide los temas en subtemas para completar cada semana.`)
        : '';
      const prompt = isEN
        ? `You are an expert instructional designer. Generate a week-by-week curriculum plan.\n\nCOURSE: ${title}\nTYPE: ${courseType}\nDESCRIPTION: ${description}\nPERIOD: ${academicPeriod}\nMODALITY: ${modality}\nSCHEDULE: ${classSchedule} | Days: ${(classDays as string[]).join(', ')}\nTOTAL TEACHING WEEKS: ${effectiveWeeks} (out of ${totalWeeks} calendar weeks)\nSTART DATE: ${startDate}${exceptionNote}${asyncNote}${syncNote}\n\nCONFIGURED EVALUATIONS:\n${evalSummary}\n\nSYLLABUS:\n${(syllabusInput as string).slice(0, 2500)}\n\nDistribute the syllabus progressively week by week. For weeks with evaluations, include the evaluation in evalEvent. For each week include: procedure (suggested classroom activity) and notes (important observations, upcoming deadlines, or reminders).\n\nRespond ONLY with valid JSON (no markdown):\n${jsonFormat}`
        : `Eres un experto en diseño curricular. Genera un plan de estudios detallado semana por semana.\n\nCURSO: ${title}\nTIPO: ${courseType}\nDESCRIPCIÓN: ${description}\nPERÍODO: ${academicPeriod}\nMODALIDAD: ${modality}\nHORARIO: ${classSchedule} | Días: ${(classDays as string[]).join(', ')}\nSEMANAS LECTIVAS: ${effectiveWeeks} (de ${totalWeeks} semanas calendario)\nFECHA INICIO: ${startDate}${exceptionNote}${asyncNote}${syncNote}\n\nEVALUACIONES CONFIGURADAS:\n${evalSummary}\n\nCONTENIDO / TEMARIO:\n${(syllabusInput as string).slice(0, 2500)}\n\nDistribuye el temario progresivamente semana a semana. Para semanas con evaluaciones, inclúyelas en evalEvent. Por cada semana incluye: procedure (actividad sugerida en clase) y notes (observaciones importantes, entregas próximas o recordatorios).\n\nResponde ÚNICAMENTE con JSON válido (sin markdown):\n${jsonFormat}`;

      const result = await invokeBedrockForJson(prompt, 6000);
      if (!result?.weeklyPlan || !Array.isArray(result.weeklyPlan)) {
        await saveAiJob(_jobId, { status: 'error', error: 'El modelo no pudo generar el plan. Intenta de nuevo.' });
      } else {
        await saveAiJob(_jobId, { status: 'done', weeklyPlan: result.weeklyPlan, modules: result.modules ?? [] });
      }
    } catch (err: any) {
      await saveAiJob(_jobId, { status: 'error', error: err?.message ?? 'Error generando plan' });
    }
    return ok({});
  }

  // ── POST /admin/courses/wizard/generate-instruction — sync AI for EVIDENCE ────
  if (path === '/admin/courses/wizard/generate-instruction' && method === 'POST') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
    const { courseTitle, evalName, syllabusInput = '' } = body as any;
    if (!courseTitle || !evalName) return badRequest('courseTitle y evalName son requeridos');
    const syllabusSnippet = (syllabusInput as string).slice(0, 400);
    const prompt = `Eres un diseñador instruccional experto. Genera una instrucción clara y concisa para una evaluación de tipo Entrega (evidence) en un curso universitario.

Curso: ${courseTitle}
Nombre de la evaluación: ${evalName}
${syllabusSnippet ? `Extracto del temario:\n${syllabusSnippet}` : ''}

Devuelve ÚNICAMENTE un JSON con este formato (sin texto extra):
{"instruction":"<1-3 oraciones de instrucción para el estudiante, específica y accionable>"}

Ejemplo: {"instruction":"Entrega un ensayo argumentativo de 2 páginas sobre el impacto de las estructuras de control en algoritmos eficientes, con al menos 2 referencias bibliográficas en formato APA."}`;
    try {
      const raw = await invokeBedrockForJson(prompt, 300);
      const instruction = (raw?.instruction ?? '').toString().trim();
      if (!instruction) return badRequest('No se pudo generar la instrucción. Intenta de nuevo.');
      return ok({ instruction });
    } catch (err: any) {
      return serverError('No se pudo generar la instrucción: ' + (err?.message ?? ''));
    }
  }

  // ── POST /admin/courses/wizard/copilot — dispatch async job ─────────────────
  if (path === '/admin/courses/wizard/copilot' && method === 'POST') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
    const { title, syllabusInput } = body as any;
    if (!title || !(syllabusInput as string)?.trim()) return badRequest('title y syllabusInput son requeridos');
    const jobId = `wiz-cop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveAiJob(jobId, { status: 'processing' });
    try {
      await lambdaClient.send(new LambdaInvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ _action: 'wizard-copilot', _jobId: jobId, _env: getCurrentEnv(), ...body })),
      }));
    } catch (invokeErr: any) {
      await saveAiJob(jobId, { status: 'error', error: 'No se pudo iniciar el generador. Intenta de nuevo.' });
      console.error('[wizard-copilot] Lambda invoke failed:', invokeErr?.message);
      return serverError('No se pudo iniciar el generador de plan');
    }
    return ok({ jobId });
  }

  // ── GET /admin/courses/wizard/plan-doc — fresh presigned URL for course plan ─
  if (path === '/admin/courses/wizard/plan-doc' && method === 'GET') {
    if (!isAuthorized(event)) return forbidden('Se requiere autenticación');
    const courseId = event.queryStringParameters?.courseId;
    if (!courseId) return badRequest('courseId es requerido');
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { planDocumentS3Key: true } });
    if (!course?.planDocumentS3Key) return badRequest('Este curso no tiene un plan Word generado');
    const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: course.planDocumentS3Key, ResponseContentDisposition: `attachment; filename="plan-${courseId}.docx"` }), { expiresIn: 3600 });
    return ok({ url });
  }

  // ── POST /admin/courses/wizard/save ─────────────────────────────────────────
  if (path === '/admin/courses/wizard/save' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const callerRole = event.requestContext.authorizer?.lambda?.role ?? 'ADMIN';
    const {
      title, description = '', imageUrl: rawImageUrl, courseType, academicPeriod, classDays = [],
      classSchedule, modality, startDate, totalWeeks, planLanguage = 'ES',
      cardColor, cardBorderColor, cardLabels = [], calendarExceptions = [],
      evaluationItems = [], weeklyPlan = [], suggestedModules = [], editingCourseId,
      pilotoAutomatico = false, syllabusInput = '', replaceModules = false,
    } = body as any;
    if (!title) return badRequest('title es requerido');

    // Modality → display tag mapping
    const MODALITY_LABEL_MAP: Record<string, string> = {
      PRESENCIAL: 'Presencial',
      SINCRONICA: 'Sincrónico',
      ASINCRONICA: 'Asincrónico',
      HIBRIDA: 'Híbrido',
    };
    const allModalityTags = Object.values(MODALITY_LABEL_MAP);
    // On edit: strip old modality tag so it gets replaced with the current one
    const finalLabels: string[] = Array.isArray(cardLabels)
      ? cardLabels.filter((l: string) => !allModalityTags.includes(l))
      : [];
    if (academicPeriod && !finalLabels.includes(academicPeriod)) finalLabels.unshift(academicPeriod);
    const modalityTag = modality ? MODALITY_LABEL_MAP[modality as string] : undefined;
    if (modalityTag && !finalLabels.includes(modalityTag)) finalLabels.push(modalityTag);

    const callerName = await getCallerName(event);

    // Auto-upsert academic period so it appears in the reusable dropdown
    if (academicPeriod?.trim()) {
      await prisma.academicPeriod.upsert({
        where: { name: academicPeriod.trim() },
        update: {},
        create: { name: academicPeriod.trim() },
      }).catch(() => {}); // non-fatal
    }

    const wizardCourseData = {
      title, description: description || title, imageUrl: rawImageUrl || null,
      courseType: courseType || null, academicPeriod: academicPeriod || null,
      classDays: Array.isArray(classDays) ? classDays : [],
      classSchedule: classSchedule || null, modality: modality || null,
      startDate: startDate ? new Date(startDate) : null,
      totalWeeks: totalWeeks ? parseInt(String(totalWeeks), 10) : null,
      planLanguage: planLanguage || 'ES', cardColor: cardColor || null,
      cardBorderColor: cardBorderColor || null, cardLabels: finalLabels,
      calendarExceptions: calendarExceptions.length > 0 ? calendarExceptions : undefined,
      evaluationConfig: evaluationItems.length > 0 ? evaluationItems : undefined,
      pilotoAutomatico: Boolean(pilotoAutomatico),
      isAutoevaluated: modality === 'ASINCRONICA',
      planWeeklyPlan: weeklyPlan.length > 0 ? weeklyPlan : undefined,
      planSyllabusInput: syllabusInput || undefined,
    };

    let course: { id: string; slug: string; planDocumentS3Key?: string | null };

    if (editingCourseId) {
      course = await prisma.course.update({
        where: { id: editingCourseId },
        data: wizardCourseData,
        select: { id: true, slug: true, planDocumentS3Key: true },
      });
    } else {
      const slugBase = title.toLowerCase()
        .normalize('NFD').replace(/[̀-͟]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      const slugRand = Math.random().toString(36).slice(2, 6);
      const slug = `${slugBase}-${slugRand}`;
      course = await prisma.course.create({
        data: { ...wizardCourseData, slug, isDraft: true, tags: [], createdByName: callerName },
        select: { id: true, slug: true, planDocumentS3Key: true },
      });
    }

    const courseTitle = title as string;

    if (editingCourseId) {
      // Delete only planner-managed types (QUIZ, EVIDENCE, EXAM, ATTENDANCE, INTERVIEW).
      // CLASS events are created and managed separately via admin/classes — never delete them here.
      await prisma.evaluationEvent.deleteMany({
        where: { courseId: course.id, type: { notIn: ['CLASS'] } },
      }).catch((e: any) => console.error('[wizard/save] deleteMany eval events error:', e));
    }

    for (let i = 0; i < evaluationItems.length; i++) {
      const item = evaluationItems[i];
      const firstDate = item.dueDates?.[0] ? new Date(item.dueDates[0]) : null;
      try {
        await prisma.evaluationEvent.create({
          data: {
            courseId: course.id, type: item.type ?? 'EXAM',
            name: item.name ?? item.nameEN ?? 'Evaluación',
            dueDate: firstDate, weight: parseFloat(String(item.weight ?? 0)),
            instructions: item.instructions || null, vapiPrompt: item.vapiPrompt || null,
            vapiObjectives: item.vapiObjectives || null, order: i,
          },
        });
      } catch (evalErr: any) { console.error('[wizard/save] evaluationEvent create error:', evalErr?.message); }
    }

    // Sync evaluation due dates to calendar (helper in ai-wizard-docx.ts)
    await syncWizardCalendarEvents({ courseId: course.id, courseTitle: title, editingCourseId, evaluationItems, callerRole });

    // Generate Word document plan (non-fatal) — logic lives in ai-wizard-docx.ts (file-size limit)
    const { docPublicUrl } = await generateWizardPlanDocument(ctx, {
      course, title, courseType, academicPeriod, classDays, classSchedule, modality,
      startDate, totalWeeks, planLanguage, evaluationItems, suggestedModules, weeklyPlan,
    });

    let lessonJobId: string | null = null;
    const isEN_save = planLanguage === 'EN';

    // Compute which module indices get quiz/class from weeklyPlan (#17/#18 fix)
    const _modNamesNew: string[] = (suggestedModules as any[]).map((m: any) => isEN_save ? (m.nameEN || m.name) : m.name);
    const _quizSetNew = new Set<number>(); const _classSetNew = new Set<number>();
    for (const wk of weeklyPlan as any[]) {
      if (!wk.evalEvent?.type) continue;
      const mi = _modNamesNew.indexOf(wk.module as string);
      if (mi < 0) continue;
      const et = (wk.evalEvent.type as string).toUpperCase();
      if (et === 'QUIZ') _quizSetNew.add(mi);
      if (et === 'CLASS') _classSetNew.add(mi);
    }
    const quizModuleIndices = Array.from(_quizSetNew);
    const classModuleIndices = Array.from(_classSetNew);

    if (!editingCourseId || replaceModules) {
      // NEW course OR edit with replace: delete existing modules first, then create fresh
      if (editingCourseId && replaceModules) {
        await prisma.module.deleteMany({ where: { courseId: course.id } });
        await prisma.courseSession.deleteMany({ where: { courseId: course.id } });
      }
      const createdModuleIds: string[] = [];
      for (let mi = 0; mi < (suggestedModules as any[]).length; mi++) {
        const mod = (suggestedModules as any[])[mi];
        try {
          const createdMod = await prisma.module.create({
            data: {
              courseId: course.id,
              title: isEN_save ? (mod.nameEN || mod.name) : mod.name,
              description: isEN_save ? (mod.descriptionEN || mod.description) : (mod.description || mod.descriptionEN || ''),
              duration: '80 min', passingScore: 70, order: mi + 1,
            },
          });
          createdModuleIds.push(createdMod.id);
        } catch (e: any) { console.error('[wizard/save] module create error:', e); }
      }

      if (createdModuleIds.length > 0) {
        lessonJobId = `wiz-lessons-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await saveAiJob(lessonJobId, { status: 'processing', modules: createdModuleIds.length });
        try {
          await lambdaClient.send(new LambdaInvokeCommand({
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify({
              _action: 'wizard-lessons-bulk', _jobId: lessonJobId, _env: getCurrentEnv(),
              courseId: course.id, moduleIds: createdModuleIds,
              courseTitle: title, language: planLanguage,
              evaluationItems,
              // Only pass indices when non-empty — otherwise the worker falls back to
              // hasQuizInPlan / hasClassInPlan which correctly covers all modules.
              ...(quizModuleIndices.length > 0 ? { quizModuleIndices } : {}),
              ...(classModuleIndices.length > 0 ? { classModuleIndices } : {}),
            })),
          }));
        } catch (invokeErr: any) {
          console.error('[wizard/save] lesson bulk invoke error:', invokeErr?.message);
          await saveAiJob(lessonJobId, { status: 'error', error: 'No se pudo iniciar la generación de lecciones' });
          lessonJobId = null;
        }
      }

      if (!editingCourseId) {
        await upsertChat(`group_${course.id}`, { type: 'GROUP', name: `Curso: ${courseTitle}`, participants: [] }).catch(() => {});
      }
    } else {
      // EDIT mode (add-only): create any suggested modules that don't yet exist in the DB.
      // Match by name (case-insensitive) to avoid duplicating modules on re-save.
      const existingModules = await prisma.module.findMany({
        where: { courseId: course.id },
        select: { id: true, title: true, order: true },
      });
      const existingTitles = new Set(existingModules.map((m: any) => m.title.toLowerCase().trim()));
      const maxOrder = existingModules.reduce((max: number, m: any) => Math.max(max, m.order ?? 0), 0);

      const newModuleIds: string[] = [];
      let nextOrder = maxOrder;
      for (const mod of suggestedModules as any[]) {
        const modTitle = isEN_save ? (mod.nameEN || mod.name) : mod.name;
        if (!modTitle || existingTitles.has(modTitle.toLowerCase().trim())) continue;
        try {
          nextOrder++;
          const createdMod = await prisma.module.create({
            data: {
              courseId: course.id,
              title: modTitle,
              description: isEN_save ? (mod.descriptionEN || mod.description) : (mod.description || mod.descriptionEN || ''),
              duration: '80 min', passingScore: 70, order: nextOrder,
            },
          });
          newModuleIds.push(createdMod.id);
        } catch (e: any) { console.error('[wizard/save][edit] module create error:', e); }
      }

      if (newModuleIds.length > 0) {
        lessonJobId = `wiz-lessons-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await saveAiJob(lessonJobId, { status: 'processing', modules: newModuleIds.length });
        try {
          await lambdaClient.send(new LambdaInvokeCommand({
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify({
              _action: 'wizard-lessons-bulk', _jobId: lessonJobId, _env: getCurrentEnv(),
              courseId: course.id, moduleIds: newModuleIds,
              courseTitle: title, language: planLanguage,
              evaluationItems,
              ...(quizModuleIndices.length > 0 ? { quizModuleIndices } : {}),
              ...(classModuleIndices.length > 0 ? { classModuleIndices } : {}),
            })),
          }));
        } catch (invokeErr: any) {
          console.error('[wizard/save][edit] lesson bulk invoke error:', invokeErr?.message);
          await saveAiJob(lessonJobId, { status: 'error', error: 'No se pudo iniciar la generación de lecciones' });
          lessonJobId = null;
        }
      }
    }

    // When editing a course: if QUIZ was added to the eval plan, auto-generate questions
    // for modules that currently have no questions.
    if (editingCourseId) {
      const hasQuizInNewPlan = (evaluationItems as any[]).some((it: any) => it.type === 'QUIZ');
      if (hasQuizInNewPlan) {
        try {
          const courseModules = await prisma.module.findMany({
            where: { courseId: course.id },
            select: { id: true, title: true },
          });
          const modulesWithoutQuiz = await Promise.all(
            courseModules.map(async (mod: any) => {
              const count = await prisma.question.count({ where: { moduleId: mod.id } });
              return count === 0 ? mod : null;
            })
          );
          const missingQuizModules = modulesWithoutQuiz.filter(Boolean) as { id: string; title: string }[];
          for (const mod of missingQuizModules) {
            const jobId = `quiz-gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await saveAiJob(jobId, { status: 'processing' });
            await lambdaClient.send(new LambdaInvokeCommand({
              FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
              InvocationType: 'Event',
              Payload: Buffer.from(JSON.stringify({
                _action: 'wizard-lessons-bulk', _jobId: jobId, _env: getCurrentEnv(),
                courseId: course.id, moduleIds: [mod.id],
                courseTitle: title, language: planLanguage,
                evaluationItems,
                _quizOnlyForExistingModules: true,
              })),
            })).catch(() => {});
          }
        } catch { /* non-fatal */ }
      }
    }

    // Generate CourseSession records from schedule (helper in ai-wizard-docx.ts)
    if (!editingCourseId && startDate && Array.isArray(classDays) && classDays.length > 0 && totalWeeks) {
      await createWizardCourseSessions({ prisma, courseId: course.id, startDate, classDays, totalWeeks: totalWeeks as number, calendarExceptions });
    }

    return editingCourseId
      ? ok({ courseId: course.id, slug: course.slug, docUrl: docPublicUrl, isDraft: false, lessonJobId })
      : created({ courseId: course.id, slug: course.slug, docUrl: docPublicUrl, isDraft: true, lessonJobId });
  }

  return null; // not handled by this domain
}
