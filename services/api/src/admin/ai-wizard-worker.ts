// Async worker actions for the AI course wizard, split out of ai-wizard.ts to
// stay under the domain-module line limit (CLAUDE.md: ≤600 lines).
// Handles: wizard-lessons-bulk (lesson + quiz + class generation) and wizard-copilot
// (weekly plan generation). Both run as self-invoked Lambda background jobs.
import { saveAiJob } from '../shared/db-dynamo';
import { ok } from '../shared/response';
import {
  AdminCtx, shuffleQuestionOptions, invokeBedrockForJson,
} from './ctx';
import { dispatchLessonAudioGeneration } from './ai-audio-worker';
import {
  notifyCourseGenerationDone, sanitizeLessonContent, generateAndSaveQuizQuestions,
  isPlaceholderContent, verifyAndRepairModule,
} from './ai-wizard-repair';

export async function handleAIWizardWorker(ctx: AdminCtx): Promise<any | null> {
  const { prisma, body } = ctx;

  // ── Async worker: wizard bulk lesson generation ──────────────────────────────
  if (ctx.action === 'wizard-lessons-bulk') {
    const {
      _jobId, courseId: blCourseId, moduleIds = [], courseTitle: blTitle = '',
      language: blLang = 'ES',
      _quizOnlyForExistingModules = false,
      quizModuleIndices: blQuizIndices,
      classModuleIndices: blClassIndices,
      reflexModuleIndices: blReflexIndices,
      interviewModuleIndices: blInterviewIndices,
      creatorUserId: blCreatorUserId,
    } = body as any;
    const isBlEN = blLang === 'EN';
    // Per-module index sets — explicit ONLY, no "assign to all modules" fallback. That
    // fallback (hasQuizInPlan/hasClassInPlan ? every module : none) was the root cause of
    // quiz/class/reflection/interview appearing on modules the evaluator never selected in
    // Lux Planner (Trello DmPpbrff comment 6a9269e2). ai-wizard.ts now always sends
    // explicit indices computed from the per-module quizWeek/reflexWeek/interviewWeek
    // selectors and luxMentorWeeks — an empty array here means "genuinely none", not
    // "wasn't told, guess everyone".
    const quizIdxSet: Set<number> = new Set(Array.isArray(blQuizIndices) ? blQuizIndices : []);
    const classIdxSet: Set<number> = new Set(Array.isArray(blClassIndices) ? blClassIndices : []);
    const reflexIdxSet: Set<number> = new Set(Array.isArray(blReflexIndices) ? blReflexIndices : []);
    const interviewIdxSet: Set<number> = new Set(Array.isArray(blInterviewIndices) ? blInterviewIndices : []);
    const failed: string[] = [];
    // Process one module (all its Bedrock calls + DB writes). Extracted from the old
    // sequential `for` loop so modules can run CONCURRENTLY in bounded batches below —
    // sequential processing of all modules in one Lambda invocation was blowing past the
    // function timeout on courses with several modules, silently killing the invocation
    // mid-loop and leaving the remaining modules with ZERO lessons (not even the
    // placeholder fallback, since that code path was never reached). Confirmed via
    // CloudWatch: lux-admin-staging REPORT line "Duration: 600000.00 ms ... Status: timeout"
    // (Trello DmPpbrff comment 6a91f73f, course cmtdfn06w0001f82rbt2ni2ta, modules 7-8 empty).
    const processModule = async (moduleIdx: number): Promise<void> => {
      const moduleId = (moduleIds as string[])[moduleIdx]!;
      try {
        const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true, description: true } });
        if (!mod) return;

        // Record INTENT immediately via EvaluationEvent rows, independent of whether the
        // Bedrock generation below succeeds. This is the durable "was X planned for this
        // module" signal the frontend needs (Trello DmPpbrff comments 6a91f73f, 6a9269e2)
        // — mod.questions.length===0 alone can't distinguish "never planned" from "planned
        // but failed to generate", so the UI can't safely hide a section on count alone.
        // Same pattern for QUIZ, REFLECTION, and INTERVIEW — CLASS has its own creation
        // block further down since it also carries generated vapiPrompt/lessonScript content.
        const recordIntent = async (type: 'QUIZ' | 'REFLECTION' | 'INTERVIEW', name: string) => {
          const existing = await prisma.evaluationEvent.findFirst({ where: { courseId: blCourseId, moduleId, type } });
          if (!existing) {
            await prisma.evaluationEvent.create({
              data: { courseId: blCourseId, moduleId, type, name, weight: 0, order: moduleIdx },
            });
          }
        };
        if (quizIdxSet.has(moduleIdx)) await recordIntent('QUIZ', isBlEN ? 'Quiz' : 'Cuestionario');
        if (reflexIdxSet.has(moduleIdx)) await recordIntent('REFLECTION', isBlEN ? 'Reflection' : 'Reflexión');
        if (interviewIdxSet.has(moduleIdx)) await recordIntent('INTERVIEW', isBlEN ? 'Lux Mentor Interview' : 'Entrevista con Lux Mentor');

        // When re-using this worker just to generate quiz questions for already-existing modules,
        // skip lesson generation if the module already has lessons.
        if (_quizOnlyForExistingModules) {
            const existingLessonCount = await prisma.lesson.count({ where: { moduleId } });
            if (existingLessonCount > 0 && quizIdxSet.has(moduleIdx)) {
              await generateAndSaveQuizQuestions(prisma, moduleId, mod.title, isBlEN);
            }
            // Skip lesson generation regardless (module has no lessons, or no quiz planned)
            return;
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
          // Raised from 6 to 9 min/lesson (Trello DmPpbrff comment 6a9232ef — lessons were
          // too short, wanted a top-tier e-learning designer's depth: fully worked real
          // examples + a self-practice section, not just a longer word count). Fewer,
          // richer lessons instead of many short ones — keeps the ~60 min/module async
          // budget roughly intact while each lesson carries meaningfully more content
          // (approved by the user knowing this raises Bedrock output tokens per module).
          const TEXT_COMPREHENSION_MIN = 9;
          const textLessonCount = Math.max(4, Math.min(8,
            Math.round((TARGET_ASYNC_MIN - 2 * VIDEO_LESSON_MIN) / TEXT_COMPREHENSION_MIN)
          )); // default: 6 → lessonCount = 8 (≈ 60 min async)
          const lessonCount = 2 + textLessonCount;
          const textDuration = `${TEXT_COMPREHENSION_MIN} min`;

          const classContextNote = hasClass
            ? (isBlEN
              ? `\nThis module includes a 50-minute synchronous Lux Mentor class. The async lessons are the study material students use before and after the class.`
              : `\nEste módulo incluye una sesión sincrónica de 50 minutos en Lux Mentor. Las lecciones asíncronas son el material de estudio que los estudiantes usan antes y después de esa sesión.`)
            : '';

          const lessonPrompt = isBlEN
            ? `You are a top-tier e-learning instructional designer. Generate exactly ${lessonCount} lessons for the module "${mod.title}" in the course "${blTitle}".${classContextNote}
Target: ~${TARGET_ASYNC_MIN} minutes of active async study per module, split into scaffolded lessons (${TEXT_COMPREHENSION_MIN} min each) — each lesson builds on the previous one's concepts.
Lesson 1 and Lesson ${lessonCount} are video type (introductory/summary, 100-150 words, ~${VIDEO_LESSON_MIN} min). All others are text type (700-900 words each, ~${TEXT_COMPREHENSION_MIN} min active study) — real instructional depth, not a shallow list: explain the WHY and the HOW, not just the WHAT.
STRUCTURE for every text lesson's "content" field (HTML, no full markdown) — 5 sections with progressive scaffolding:
1. OPENING — specific <h3> that poses a real question or concrete scenario related to the concept (e.g. "<h3>Why Don't GPS Maps Always Give the Shortest Route?</h3>"). NEVER use "Hook" or "Introduction" as the title.
2. DEVELOPMENT — specific <h3> naming the exact concept (e.g. "<h3>Heuristics in Search Algorithms</h3>"). Explain it thoroughly: the underlying idea, why it matters, and how it works step by step. Short paragraphs, max 4-5 lines each. At least one <strong> bolded key term and one bullet list (use "- item" lines, converted to <ul><li>). NEVER use "Development" or "Content" as the title.
3. WORKED EXAMPLE — specific <h3> naming a concrete real-world case (e.g. "<h3>Tracing an A* Search Step by Step in GPS Routing</h3>"). Walk through an actual example with specifics (numbers, a named scenario, or a step-by-step trace) — do not just NAME an application, actually work through it so the student sees the concept in action. NEVER use "Practical Bridge" or "Example" alone as the title.
4. PRACTICE IT YOURSELF — specific <h3> (e.g. "<h3>Try It: Estimate the Heuristic for Your Own Route</h3>") with ONE short self-guided exercise or thought experiment the student can attempt alone, using only what was just taught — not graded, just applied practice. NEVER title it "Exercise" or "Practice" alone.
5. (Last text lesson of the module only) CLOSING — specific <h3> naming the module topic (e.g. "<h3>Key Takeaways: Heuristic Search Algorithms</h3>") with a bullet summary of key points and 1-2 self-assessment questions. NEVER use "Reflective Close" or "Summary" as the title.
Write in neutral, formal international English — no slang or regionalisms.
Return ONLY a JSON array of exactly ${lessonCount} objects with no markdown fencing:
[{"title":"Lesson title","content":"<h3>Specific concept subtitle</h3><p>HTML paragraph content</p>","points":["key point 1","key point 2","key point 3"],"tip":"one practical tip","type":"video|text","duration":"5 min|${TEXT_COMPREHENSION_MIN} min"}]`
            : `Eres un diseñador instruccional de e-learning de primer nivel. Genera exactamente ${lessonCount} lecciones para el módulo "${mod.title}" del curso "${blTitle}".${classContextNote}
Meta: ~${TARGET_ASYNC_MIN} minutos de estudio asíncrono activo por módulo, repartidos en lecciones con andamiaje progresivo (${TEXT_COMPREHENSION_MIN} min cada una) — cada lección construye sobre los conceptos de la anterior.
La lección 1 y la lección ${lessonCount} son tipo video (intro/resumen, 100-150 palabras, ~${VIDEO_LESSON_MIN} min). Las demás son tipo texto (700-900 palabras cada una, ~${TEXT_COMPREHENSION_MIN} min de estudio activo) — profundidad instructiva real, no una lista superficial: explica el POR QUÉ y el CÓMO, no solo el QUÉ.
ESTRUCTURA obligatoria para el campo "content" de cada lección de texto (HTML, sin markdown completo) — 5 secciones con andamiaje progresivo:
1. APERTURA — <h3> específico que plantee una pregunta real o escenario concreto relacionado al concepto (ej. "<h3>¿Por qué los mapas GPS no siempre dan la ruta más corta?</h3>"). NUNCA usar "Gancho", "Hook" ni "Introducción" como título.
2. DESARROLLO — <h3> específico que nombre el concepto exacto (ej. "<h3>Heurísticas en Algoritmos de Búsqueda</h3>"). Explícalo a fondo: la idea de base, por qué importa, y cómo funciona paso a paso. Párrafos cortos máx 4-5 líneas. Al menos un <strong> clave y una lista con viñetas (usa líneas "- item", se convierten a <ul><li>). NUNCA usar "Desarrollo" ni "Contenido" como título.
3. EJEMPLO TRABAJADO — <h3> que nombre un caso concreto del mundo real (ej. "<h3>Trazando A* Paso a Paso en Navegación GPS</h3>"). Desarrolla un ejemplo real con datos concretos (números, un escenario nombrado, o una traza paso a paso) — no basta con NOMBRAR una aplicación, hay que desarrollarla para que el estudiante vea el concepto en acción. NUNCA usar "Puente Práctico" ni solo "Ejemplo" como título.
4. PONLO EN PRÁCTICA — <h3> específico (ej. "<h3>Inténtalo: Estima la Heurística de tu Propia Ruta</h3>") con UN ejercicio autoguiado corto o experimento mental que el estudiante pueda intentar solo, usando solo lo que se acaba de enseñar — no es calificado, es práctica aplicada. NUNCA titularlo solo "Ejercicio" o "Práctica".
5. (Solo última lección de texto del módulo) CIERRE — <h3> que nombre el tema del módulo (ej. "<h3>Síntesis: Algoritmos de Búsqueda Heurística</h3>") con resumen en puntos clave y 1-2 preguntas de autoevaluación. NUNCA usar "Cierre Reflexivo" ni "Resumen" como título.
Redacta en español latino neutro y formal — sin modismos ni jerga local de ningún país.
Devuelve ÚNICAMENTE un array JSON de exactamente ${lessonCount} objetos sin markdown de cercado:
[{"title":"Título lección","content":"<h3>Subtítulo del concepto específico</h3><p>Párrafo HTML con contenido</p>","points":["punto clave 1","punto clave 2","punto clave 3"],"tip":"un consejo práctico","type":"video|text","duration":"5 min|${TEXT_COMPREHENSION_MIN} min"}]`;

          // Parallelize: lesson content + module resources (bibliography + YouTube suggestions)
          const resourcesPrompt = isBlEN
            ? `For the module "${mod.title}" in the course "${blTitle}": generate 2 APA bibliography references and 2 YouTube search queries for relevant educational videos. JSON only: {"references":["APA ref 1","APA ref 2"],"youtubeQueries":["search query 1","search query 2"]}`
            : `Para el módulo "${mod.title}" del curso "${blTitle}": genera 2 referencias bibliográficas APA y 2 consultas de búsqueda YouTube para videos educativos relevantes. Solo JSON: {"references":["Ref APA 1","Ref APA 2"],"youtubeQueries":["búsqueda 1","búsqueda 2"]}`;

          const [rawLessons, moduleResources] = await Promise.all([
            // 64000 = max output tokens for global.anthropic.claude-haiku-4-5-20251001-v1:0 (raised from 8000 — truncation fix)
            // Logged now instead of a bare `.catch(() => null)` — that silent swallow left
            // zero trace in CloudWatch for a run that clearly had failures (Trello DmPpbrff
            // comment 6a926775 investigation).
            invokeBedrockForJson(lessonPrompt, 64000).catch((e: any) => {
              console.error(`[wizard-lessons-bulk] module ${moduleId} lessonPrompt failed: ${e?.name ?? 'UnknownError'}: ${e?.message ?? e}`);
              return null;
            }),
            invokeBedrockForJson(resourcesPrompt, 400).catch((e: any) => {
              console.error(`[wizard-lessons-bulk] module ${moduleId} resourcesPrompt failed: ${e?.name ?? 'UnknownError'}: ${e?.message ?? e}`);
              return null;
            }),
          ]);
          let validLessons: any[] | null = Array.isArray(rawLessons) && rawLessons.length > 0 && rawLessons[0]?.title
            ? rawLessons : null;

          // Retry for missing lessons when Bedrock truncated the response (Bug B fix)
          if (validLessons && validLessons.length < lessonCount) {
            const missing = lessonCount - validLessons.length;
            console.warn(`[wizard-lessons-bulk] module ${moduleId}: got ${validLessons.length}/${lessonCount} — retrying for ${missing} missing lessons`);
            const retryPrompt = isBlEN
              ? `Continue generating the remaining ${missing} lessons (lessons ${validLessons.length + 1} to ${lessonCount}) for module "${mod.title}" in course "${blTitle}".
These are the LAST ${missing} lessons of a ${lessonCount}-lesson module. Lesson ${lessonCount} is video type (summary, 100-150 words, ~5 min). All others in this batch are text type (700-900 words each) — same 5-section structure as the main lesson set (opening question, development, a fully worked real example, a self-practice exercise, and a closing summary on the last text lesson).
Return ONLY a JSON array of exactly ${missing} lesson objects with no markdown fencing:
[{"title":"Lesson title","content":"<h3>subtitle</h3><p>HTML content</p>","points":["point 1","point 2","point 3"],"tip":"practical tip","type":"video|text","duration":"5 min|${textDuration}"}]`
              : `Continúa generando las ${missing} lecciones faltantes (lecciones ${validLessons.length + 1} a ${lessonCount}) para el módulo "${mod.title}" del curso "${blTitle}".
Estas son las ÚLTIMAS ${missing} lecciones de un módulo de ${lessonCount} lecciones. La lección ${lessonCount} es tipo video (resumen, 100-150 palabras, ~5 min). Las demás en este lote son tipo texto (700-900 palabras cada una) — misma estructura de 5 secciones que el set principal (pregunta de apertura, desarrollo, un ejemplo real trabajado a fondo, un ejercicio de práctica propia, y cierre-resumen solo en la última lección de texto).
Devuelve ÚNICAMENTE un array JSON de exactamente ${missing} objetos sin markdown de cercado:
[{"title":"Título","content":"<h3>subtítulo</h3><p>Contenido HTML</p>","points":["punto 1","punto 2","punto 3"],"tip":"consejo práctico","type":"video|text","duration":"5 min|${textDuration}"}]`;
            const retryRaw = await invokeBedrockForJson(retryPrompt, 64000).catch((e: any) => {
              console.error(`[wizard-lessons-bulk] module ${moduleId} retryPrompt failed: ${e?.name ?? 'UnknownError'}: ${e?.message ?? e}`);
              return null;
            });
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
    };

    try {
      // Bounded concurrency: 3 modules at a time. Wall-clock time is now driven by
      // ceil(N/3) batches instead of N sequential modules — a 16-module course that
      // used to risk a ~10min timeout now finishes in roughly 1/3 of that time, with
      // enough Bedrock request headroom to avoid tripping throttling in a burst.
      const MODULE_CONCURRENCY = 3;
      const allIdx = (moduleIds as string[]).map((_, i) => i);
      const totalModules = allIdx.length;
      for (let i = 0; i < allIdx.length; i += MODULE_CONCURRENCY) {
        const batch = allIdx.slice(i, i + MODULE_CONCURRENCY);
        await Promise.all(batch.map((idx) => processModule(idx)));
        // Incremental progress — lets the wizard UI poll real "N/total módulos listos"
        // instead of a static "ready in a few minutes" message that never updates
        // (Jason, 2026-08-30: no completion indicator in the wizard at all).
        await saveAiJob(_jobId, { status: 'processing', modulesProcessed: Math.min(i + MODULE_CONCURRENCY, totalModules), totalModules });
      }

      // ── Completeness sweep — the "sí o sí" guarantee (Jason, 2026-08-30) ────────
      // The in-line retry-once inside processModule() gives up after one extra attempt
      // and leaves a placeholder / empty-quiz permanently if that also fails. Verify every
      // module against the DB (not in-memory state) and give genuinely incomplete ones
      // MORE real attempts — bounded, so a persistently-broken module (real network/
      // Bedrock outage) can't loop forever — before ever reporting the job "done".
      const MAX_SWEEPS = 3; // up to 3 real repair passes after the main loop's own attempt
      let incompleteIdx: number[] = [];
      if (!_quizOnlyForExistingModules) {
        for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
          incompleteIdx = [];
          for (const idx of allIdx) {
            const moduleId = (moduleIds as string[])[idx]!;
            const complete = await verifyAndRepairModule(
              prisma, moduleId, blTitle, isBlEN, quizIdxSet.has(idx), () => processModule(idx),
            );
            if (!complete) incompleteIdx.push(idx);
          }
          if (incompleteIdx.length === 0) break;
          console.warn(`[wizard-lessons-bulk] sweep ${sweep + 1}/${MAX_SWEEPS}: ${incompleteIdx.length}/${totalModules} module(s) still incomplete, repairing`);
        }
      }

      const incompleteModuleIds = incompleteIdx.map((idx) => (moduleIds as string[])[idx]);
      if (incompleteModuleIds.length > 0) {
        console.error(`[wizard-lessons-bulk] job ${_jobId}: gave up after ${MAX_SWEEPS} repair sweeps — still incomplete: ${incompleteModuleIds.join(', ')}`);
      }
      await saveAiJob(_jobId, {
        status: incompleteModuleIds.length > 0 ? 'done_incomplete' : 'done',
        modulesProcessed: totalModules, totalModules, failed: failed.length,
        incompleteModuleIds,
      });
      await notifyCourseGenerationDone(blCreatorUserId, blCourseId, blTitle, isBlEN, incompleteModuleIds.length > 0);
      // Fire-and-forget: Polly neural audio for every lesson, as its own background phase
      // (item 4) — never blocks or risks the completeness status set just above.
      await dispatchLessonAudioGeneration(blCourseId);
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
          ? `\n\nASYNC COURSE RULE — NON-NEGOTIABLE:
1. Generate EXACTLY ${effectiveWeeks} modules — one per teaching week. No more, no less.
2. EVERY weeklyPlan entry MUST have a UNIQUE "module" value. The same module name MUST NOT appear in more than one week under ANY circumstance — a module must never span 2 weeks.
3. Each module in the "modules" array MUST have "weeks" as a single-element array, e.g. "weeks":[3].
4. If the syllabus has fewer topics than ${effectiveWeeks} weeks, SUBDIVIDE each topic into specific subtopics. Every week must have its own uniquely named module.
5. VERIFY before responding: count the unique "module" values in weeklyPlan — it must equal ${effectiveWeeks}.`
          : `\n\nREGLA CURSO ASÍNCRONO — NO NEGOCIABLE:
1. Genera EXACTAMENTE ${effectiveWeeks} módulos — uno por semana lectiva. Ni más, ni menos.
2. CADA entrada de weeklyPlan DEBE tener un valor "module" ÚNICO. El mismo nombre de módulo NO DEBE aparecer en más de una semana BAJO NINGUNA CIRCUNSTANCIA — un módulo nunca debe repartirse entre 2 semanas.
3. Cada módulo en el array "modules" DEBE tener "weeks" como array de UN SOLO elemento, ej: "weeks":[3].
4. Si el temario tiene menos temas que ${effectiveWeeks} semanas, SUBDIVIDE cada tema en subtemas específicos. Cada semana debe tener su propio módulo con nombre único.
5. VERIFICA antes de responder: cuenta los valores "module" únicos en weeklyPlan — debe ser igual a ${effectiveWeeks}.`)
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

      const result = await invokeBedrockForJson(prompt, 64000);
      if (!result?.weeklyPlan || !Array.isArray(result.weeklyPlan)) {
        await saveAiJob(_jobId, { status: 'error', error: 'El modelo no pudo generar el plan. Intenta de nuevo.' });
      } else {
        // Post-process: enforce unique module per week (sync AND async — a module must
        // never span 2 weeks in either modality). Even with the strict prompt, Bedrock
        // sometimes reuses module names across weeks.
        {
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
              console.warn(`[wizard-copilot] dedup (${isAsync ? 'async' : 'sync'}): week ${wk.weekNum} had duplicate module "${orig}" → renamed "${newName}"`);
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
