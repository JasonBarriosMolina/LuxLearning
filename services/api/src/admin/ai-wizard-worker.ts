// Async worker actions for the AI course wizard, split out of ai-wizard.ts to
// stay under the domain-module line limit (CLAUDE.md: ≤600 lines).
// Handles: wizard-lessons-bulk (lesson + quiz + class generation) and wizard-copilot
// (weekly plan generation). Both run as self-invoked Lambda background jobs.
import { saveAiJob } from '../shared/db-dynamo';
import { ok } from '../shared/response';
import {
  AdminCtx, shuffleQuestionOptions, invokeBedrockForJson,
} from './ctx';

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

/** Generates 10 multiple-choice questions for a module and saves them. Shared by
 *  both the "quiz-only for existing modules" retrofit path and the normal bulk path. */
async function generateAndSaveQuizQuestions(
  prisma: AdminCtx['prisma'], moduleId: string, moduleTitle: string, isEN: boolean
): Promise<void> {
  const qPrompt = isEN
    ? `Generate exactly 10 multiple-choice questions about "${moduleTitle}". JSON array: [{"text":"Question?","options":["A","B","C","D"],"correctIndex":0,"order":1}] No markdown.`
    : `Genera exactamente 10 preguntas de opción múltiple sobre "${moduleTitle}". Array JSON: [{"text":"¿Pregunta?","options":["A","B","C","D"],"correctIndex":0,"order":1}] Sin markdown.`;
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

export async function handleAIWizardWorker(ctx: AdminCtx): Promise<any | null> {
  const { prisma, body } = ctx;

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
              await generateAndSaveQuizQuestions(prisma, moduleId, mod.title, isBlEN);
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
Lesson 1 and Lesson ${lessonCount} are video type (introductory/summary, 100-150 words, ~${VIDEO_LESSON_MIN} min). All others are text type (400-500 words each, ~${TEXT_COMPREHENSION_MIN} min active comprehension) with scaffolded depth — not a shallow list, but a real instructional unit.
STRUCTURE for every text lesson's "content" field (HTML, no full markdown) — 3 to 4 sections with progressive scaffolding:
1. OPENING — specific <h3> that poses a real question or concrete scenario related to the concept (e.g. "<h3>Why Don't GPS Maps Always Give the Shortest Route?</h3>"). NEVER use "Hook" or "Introduction" as the title.
2. DEVELOPMENT — specific <h3> naming the exact concept (e.g. "<h3>Heuristics in Search Algorithms</h3>"). Short paragraphs, max 4-5 lines each. At least one <strong> bolded key term and one bullet list (use "- item" lines, converted to <ul><li>). NEVER use "Development" or "Content" as the title.
3. PRACTICAL BRIDGE — specific <h3> naming the concrete real-world application example (e.g. "<h3>Application in GPS Navigation Systems</h3>"). NEVER use "Practical Bridge" as the title.
4. (Last text lesson of the module only) CLOSING — specific <h3> naming the module topic (e.g. "<h3>Key Takeaways: Heuristic Search Algorithms</h3>") with a bullet summary of key points and 1-2 self-assessment questions. NEVER use "Reflective Close" or "Summary" as the title.
Write in neutral, formal international English — no slang or regionalisms.
Return ONLY a JSON array of exactly ${lessonCount} objects with no markdown fencing:
[{"title":"Lesson title","content":"<h3>Specific concept subtitle</h3><p>HTML paragraph content</p>","points":["key point 1","key point 2","key point 3"],"tip":"one practical tip","type":"video|text","duration":"5 min|${TEXT_COMPREHENSION_MIN} min"}]`
            : `Eres un experto en diseño instruccional. Genera exactamente ${lessonCount} lecciones para el módulo "${mod.title}" del curso "${blTitle}".${classContextNote}
Meta: ~${TARGET_ASYNC_MIN} minutos de estudio asíncrono activo por módulo, repartidos en lecciones cortas con andamiaje progresivo (${TEXT_COMPREHENSION_MIN} min cada una) — cada lección construye sobre los conceptos de la anterior.
La lección 1 y la lección ${lessonCount} son tipo video (intro/resumen, 100-150 palabras, ~${VIDEO_LESSON_MIN} min). Las demás son tipo texto (400-500 palabras cada una, ~${TEXT_COMPREHENSION_MIN} min de comprensión activa) con profundidad instructiva real — no listas superficiales, sino unidades didácticas completas.
ESTRUCTURA obligatoria para el campo "content" de cada lección de texto (HTML, sin markdown completo) — 3 a 4 secciones con andamiaje progresivo:
1. APERTURA — <h3> específico que plantee una pregunta real o escenario concreto relacionado al concepto (ej. "<h3>¿Por qué los mapas GPS no siempre dan la ruta más corta?</h3>"). NUNCA usar "Gancho", "Hook" ni "Introducción" como título.
2. DESARROLLO — <h3> específico que nombre el concepto exacto (ej. "<h3>Heurísticas en Algoritmos de Búsqueda</h3>"). Párrafos cortos máx 4-5 líneas. Al menos un <strong> clave y una lista con viñetas (usa líneas "- item", se convierten a <ul><li>). NUNCA usar "Desarrollo" ni "Contenido" como título.
3. PUENTE PRÁCTICO — <h3> que nombre el ejemplo concreto de aplicación real (ej. "<h3>Aplicación en Sistemas de Navegación GPS</h3>"). NUNCA usar "Puente Práctico" como título.
4. (Solo última lección de texto del módulo) CIERRE — <h3> que nombre el tema del módulo (ej. "<h3>Síntesis: Algoritmos de Búsqueda Heurística</h3>") con resumen en puntos clave y 1-2 preguntas de autoevaluación. NUNCA usar "Cierre Reflexivo" ni "Resumen" como título.
Redacta en español latino neutro y formal — sin modismos ni jerga local de ningún país.
Devuelve ÚNICAMENTE un array JSON de exactamente ${lessonCount} objetos sin markdown de cercado:
[{"title":"Título lección","content":"<h3>Subtítulo del concepto específico</h3><p>Párrafo HTML con contenido</p>","points":["punto clave 1","punto clave 2","punto clave 3"],"tip":"un consejo práctico","type":"video|text","duration":"5 min|${TEXT_COMPREHENSION_MIN} min"}]`;

          // Parallelize: lesson content + module resources (bibliography + YouTube suggestions)
          const resourcesPrompt = isBlEN
            ? `For the module "${mod.title}" in the course "${blTitle}": generate 2 APA bibliography references and 2 YouTube search queries for relevant educational videos. JSON only: {"references":["APA ref 1","APA ref 2"],"youtubeQueries":["search query 1","search query 2"]}`
            : `Para el módulo "${mod.title}" del curso "${blTitle}": genera 2 referencias bibliográficas APA y 2 consultas de búsqueda YouTube para videos educativos relevantes. Solo JSON: {"references":["Ref APA 1","Ref APA 2"],"youtubeQueries":["búsqueda 1","búsqueda 2"]}`;

          const [rawLessons, moduleResources] = await Promise.all([
            invokeBedrockForJson(lessonPrompt, 8000).catch(() => null),
            invokeBedrockForJson(resourcesPrompt, 400).catch(() => null),
          ]);
          let validLessons: any[] | null = Array.isArray(rawLessons) && rawLessons.length > 0 && rawLessons[0]?.title
            ? rawLessons : null;

          // Retry for missing lessons when Bedrock truncated the response (Bug B fix)
          if (validLessons && validLessons.length < lessonCount) {
            const missing = lessonCount - validLessons.length;
            console.warn(`[wizard-lessons-bulk] module ${moduleId}: got ${validLessons.length}/${lessonCount} — retrying for ${missing} missing lessons`);
            const retryPrompt = isBlEN
              ? `Continue generating the remaining ${missing} lessons (lessons ${validLessons.length + 1} to ${lessonCount}) for module "${mod.title}" in course "${blTitle}".
These are the LAST ${missing} lessons of a ${lessonCount}-lesson module. Lesson ${lessonCount} is video type (summary, 100-150 words, ~5 min). All others in this batch are text type (400-500 words each).
Return ONLY a JSON array of exactly ${missing} lesson objects with no markdown fencing:
[{"title":"Lesson title","content":"<h3>subtitle</h3><p>HTML content</p>","points":["point 1","point 2","point 3"],"tip":"practical tip","type":"video|text","duration":"5 min|${textDuration}"}]`
              : `Continúa generando las ${missing} lecciones faltantes (lecciones ${validLessons.length + 1} a ${lessonCount}) para el módulo "${mod.title}" del curso "${blTitle}".
Estas son las ÚLTIMAS ${missing} lecciones de un módulo de ${lessonCount} lecciones. La lección ${lessonCount} es tipo video (resumen, 100-150 palabras, ~5 min). Las demás en este lote son tipo texto (400-500 palabras cada una).
Devuelve ÚNICAMENTE un array JSON de exactamente ${missing} objetos sin markdown de cercado:
[{"title":"Título","content":"<h3>subtítulo</h3><p>Contenido HTML</p>","points":["punto 1","punto 2","punto 3"],"tip":"consejo práctico","type":"video|text","duration":"5 min|${textDuration}"}]`;
            const retryRaw = await invokeBedrockForJson(retryPrompt, 5000).catch(() => null);
            if (Array.isArray(retryRaw) && retryRaw.length > 0 && retryRaw[0]?.title) {
              validLessons = [...validLessons, ...retryRaw.slice(0, missing)];
              console.log(`[wizard-lessons-bulk] retry recovered ${retryRaw.slice(0, missing).length} lessons — total now ${validLessons.length}/${lessonCount}`);
            } else {
              console.warn(`[wizard-lessons-bulk] retry failed for module ${moduleId} — placeholder will be used for missing lessons`);
            }
          }

          const PLACEHOLDER_CONTENT = isBlEN
            ? '<p><strong>⚠ Content generation incomplete.</strong> This lesson was not generated due to a truncated AI response. Please use the regenerate button to retry content generation for this module.</p>'
            : '<p><strong>⚠ Generación incompleta.</strong> Esta lección no se generó correctamente debido a una respuesta truncada de la IA. Usa el botón de regenerar para volver a generar el contenido de este módulo.</p>';

          const lessonData = Array.from({ length: lessonCount }, (_, i) => {
            const isFirst = i === 0;
            const isLast = i === lessonCount - 1;
            const defaultType = isFirst || isLast ? 'video' : 'text';
            const defaultDuration = defaultType === 'video' ? '5 min' : textDuration;
            const gen = validLessons?.[i];
            // Per-lesson content validation: if this specific lesson has no content (truncated array
            // or missing field), use a visible placeholder so the lesson is never silently empty.
            const rawContent = gen?.content ?? null;
            const lessonContent = rawContent
              ? sanitizeLessonContent(rawContent)
              : PLACEHOLDER_CONTENT;
            return {
              moduleId,
              title: gen?.title || (isBlEN ? `Lesson ${i + 1}` : `Lección ${i + 1}`),
              type: gen?.type || defaultType,
              content: lessonContent,
              youtubeId: '',
              imageUrl: null as string | null,
              duration: gen?.duration || defaultDuration,
              points: Array.isArray(gen?.points) ? gen.points : [] as string[],
              tip: gen?.tip || '',
              order: i + 1,
            };
          });

          // Append bibliography + YouTube links to the last text lesson (Bug 1)
          if (moduleResources) {
            const refs: string[] = Array.isArray(moduleResources.references) ? moduleResources.references.filter(Boolean) : [];
            const ytQueries: string[] = Array.isArray(moduleResources.youtubeQueries) ? moduleResources.youtubeQueries.filter(Boolean) : [];
            if (refs.length > 0 || ytQueries.length > 0) {
              // Find last text lesson (not video) to append resources
              let targetIdx = lessonData.findLastIndex((l) => l.type === 'text');
              if (targetIdx < 0) targetIdx = lessonData.length - 1; // fallback to last lesson
              if (targetIdx >= 0 && lessonData[targetIdx]) {
                let resourcesHtml = '<section class="lesson-resources" style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">';
                if (refs.length > 0) {
                  resourcesHtml += isBlEN
                    ? `<h3>📚 Bibliography</h3><ol style="font-size:0.875rem;color:#4b5563;">${refs.map((r) => `<li>${r}</li>`).join('')}</ol>`
                    : `<h3>📚 Referencias</h3><ol style="font-size:0.875rem;color:#4b5563;">${refs.map((r) => `<li>${r}</li>`).join('')}</ol>`;
                }
                if (ytQueries.length > 0) {
                  const ytLinks = ytQueries.map((q) => `<li><a href="https://youtube.com/results?search_query=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">${q}</a></li>`).join('');
                  resourcesHtml += isBlEN
                    ? `<h3>🎥 Suggested Videos</h3><ul style="font-size:0.875rem;">${ytLinks}</ul>`
                    : `<h3>🎥 Videos Sugeridos</h3><ul style="font-size:0.875rem;">${ytLinks}</ul>`;
                }
                resourcesHtml += '</section>';
                const existing = lessonData[targetIdx].content ?? '';
                lessonData[targetIdx] = { ...lessonData[targetIdx], content: existing + resourcesHtml };
              }
            }
          }

          await prisma.lesson.createMany({ data: lessonData });
          const createdLessons = lessonData.map((l) => ({ duration: l.duration }));

          // Only create quiz questions for designated modules (#18 fix)
          if (quizIdxSet.has(moduleIdx)) {
            await generateAndSaveQuizQuestions(prisma, moduleId, mod.title, isBlEN);
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
      // For sync/lecture courses: one distinct module per teaching week — no module spans multiple weeks.
      const syncNote = !isAsync
        ? (isEN
          ? `\n\nSYNC/LECTURE COURSE RULE — NON-NEGOTIABLE:
1. Generate EXACTLY ${effectiveWeeks} modules — one per teaching week. No more, no less.
2. EVERY weeklyPlan entry MUST have a UNIQUE "module" value. The same module name MUST NOT appear in more than one week under ANY circumstance.
3. Each module in the "modules" array MUST have "weeks" as a single-element array, e.g. "weeks":[3].
4. If the syllabus has fewer topics than ${effectiveWeeks} weeks, SUBDIVIDE each topic into specific subtopics (e.g. "Linear Algebra" → "Linear Algebra: Vectors", "Linear Algebra: Matrix Operations", "Linear Algebra: Eigenvalues"). Every week must have its own uniquely named module.
5. VERIFY before responding: count the unique "module" values in weeklyPlan — it must equal ${effectiveWeeks}.`
          : `\n\nREGLA ABSOLUTA CURSO SINCRÓNICO — NO NEGOCIABLE:
1. Genera EXACTAMENTE ${effectiveWeeks} módulos — uno por semana lectiva. Ni más, ni menos.
2. CADA entrada de weeklyPlan DEBE tener un valor "module" ÚNICO. El mismo nombre de módulo NO DEBE aparecer en más de una semana BAJO NINGUNA CIRCUNSTANCIA.
3. Cada módulo en el array "modules" DEBE tener "weeks" como array de UN SOLO elemento, ej: "weeks":[3].
4. Si el temario tiene menos temas que ${effectiveWeeks} semanas, SUBDIVIDE cada tema en subtemas específicos (ej: "Álgebra Lineal" → "Álgebra Lineal: Vectores", "Álgebra Lineal: Operaciones con Matrices", "Álgebra Lineal: Valores Propios"). Cada semana debe tener su propio módulo con nombre único.
5. VERIFICA antes de responder: cuenta los valores "module" únicos en weeklyPlan — debe ser igual a ${effectiveWeeks}.`)
        : '';
      const prompt = isEN
        ? `You are an expert instructional designer. Generate a week-by-week curriculum plan.\n\nCOURSE: ${title}\nTYPE: ${courseType}\nDESCRIPTION: ${description}\nPERIOD: ${academicPeriod}\nMODALITY: ${modality}\nSCHEDULE: ${classSchedule} | Days: ${(classDays as string[]).join(', ')}\nTOTAL TEACHING WEEKS: ${effectiveWeeks} (out of ${totalWeeks} calendar weeks)\nSTART DATE: ${startDate}${exceptionNote}${asyncNote}${syncNote}\n\nCONFIGURED EVALUATIONS:\n${evalSummary}\n\nSYLLABUS:\n${(syllabusInput as string).slice(0, 2500)}\n\nDistribute the syllabus progressively week by week. For weeks with evaluations, include the evaluation in evalEvent. For each week include: procedure (suggested classroom activity) and notes (important observations, upcoming deadlines, or reminders).\n\nRespond ONLY with valid JSON (no markdown):\n${jsonFormat}`
        : `Eres un experto en diseño curricular. Genera un plan de estudios detallado semana por semana.\n\nCURSO: ${title}\nTIPO: ${courseType}\nDESCRIPCIÓN: ${description}\nPERÍODO: ${academicPeriod}\nMODALIDAD: ${modality}\nHORARIO: ${classSchedule} | Días: ${(classDays as string[]).join(', ')}\nSEMANAS LECTIVAS: ${effectiveWeeks} (de ${totalWeeks} semanas calendario)\nFECHA INICIO: ${startDate}${exceptionNote}${asyncNote}${syncNote}\n\nEVALUACIONES CONFIGURADAS:\n${evalSummary}\n\nCONTENIDO / TEMARIO:\n${(syllabusInput as string).slice(0, 2500)}\n\nDistribuye el temario progresivamente semana a semana. Para semanas con evaluaciones, inclúyelas en evalEvent. Por cada semana incluye: procedure (actividad sugerida en clase) y notes (observaciones importantes, entregas próximas o recordatorios).\n\nResponde ÚNICAMENTE con JSON válido (sin markdown):\n${jsonFormat}`;

      const result = await invokeBedrockForJson(prompt, 6000);
      if (!result?.weeklyPlan || !Array.isArray(result.weeklyPlan)) {
        await saveAiJob(_jobId, { status: 'error', error: 'El modelo no pudo generar el plan. Intenta de nuevo.' });
      } else {
        // Post-process: enforce unique module per week for sync courses.
        // Even with the strict prompt, Bedrock sometimes reuses module names.
        if (!isAsync) {
          const seenModules = new Map<string, number>();
          const newModules: any[] = Array.isArray(result.modules) ? [...result.modules] : [];
          for (const wk of result.weeklyPlan) {
            const orig: string = wk.module ?? '';
            if (!orig) continue;
            const seen = seenModules.get(orig) ?? 0;
            if (seen > 0) {
              // Duplicate — create a unique sub-module name
              const suffix = isEN ? ` — Part ${seen + 1}` : ` — Parte ${seen + 1}`;
              const newName = `${orig}${suffix}`;
              wk.module = newName;
              // Clone the original module entry with the new name
              const parentMod = newModules.find((m: any) => m.name === orig || m.nameEN === orig);
              if (parentMod) {
                newModules.push({
                  ...parentMod,
                  name: parentMod.name ? `${parentMod.name}${suffix}` : newName,
                  nameEN: parentMod.nameEN ? `${parentMod.nameEN}${isEN ? ` — Part ${seen + 1}` : ` — Part ${seen + 1}`}` : newName,
                  weeks: [wk.weekNum],
                });
              } else {
                newModules.push({ name: newName, nameEN: newName, description: '', descriptionEN: '', weeks: [wk.weekNum] });
              }
              console.warn(`[wizard-copilot] sync dedup: week ${wk.weekNum} had duplicate module "${orig}" → renamed "${newName}"`);
            }
            seenModules.set(orig, seen + 1);
          }
          result.modules = newModules;
        }
        await saveAiJob(_jobId, { status: 'done', weeklyPlan: result.weeklyPlan, modules: result.modules ?? [] });
      }
    } catch (err: any) {
      await saveAiJob(_jobId, { status: 'error', error: err?.message ?? 'Error generando plan' });
    }
    return ok({});
  }

  return null;
}
