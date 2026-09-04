// Async worker actions for the AI course wizard, split out of ai-wizard.ts to
// stay under the domain-module line limit (CLAUDE.md: ≤600 lines).
// Handles: wizard-lessons-bulk (lesson + quiz + class generation) and wizard-copilot
// (weekly plan generation). Both run as self-invoked Lambda background jobs.
import { saveAiJob } from '../shared/db-dynamo';
import { ok } from '../shared/response';
import {
  AdminCtx, shuffleQuestionOptions, invokeBedrockForJson, generateLessonAudio, defaultMaleVoiceForLanguage,
  generateCarouselNarration,
} from './ctx';
import { dispatchLessonAudioGeneration } from './ai-audio-worker';
import { generateModuleCarousel } from './ai-wizard-carousel-phase';
import { attachLessonVisuals } from './ai-wizard-lesson-visuals';
import { handleWizardCopilot } from './ai-wizard-copilot-worker';
import {
  notifyCourseGenerationDone, sanitizeLessonContent, generateAndSaveQuizQuestions,
  isPlaceholderContent, verifyAndRepairModule,
} from './ai-wizard-repair';
import { searchYoutubeVideo, isYoutubeVideoAvailable, escapeHtml } from '../shared/youtube';

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

    // Records a durable "was X planned for this module" EvaluationEvent, independent of
    // whether any content generation for it succeeds (Trello DmPpbrff comments 6a91f73f,
    // 6a9269e2) — mod.questions.length===0 alone can't distinguish "never planned" from
    // "planned but failed to generate".
    const recordIntent = async (moduleIdx: number, type: 'QUIZ' | 'REFLECTION' | 'INTERVIEW', name: string) => {
      const moduleId = (moduleIds as string[])[moduleIdx]!;
      const existing = await prisma.evaluationEvent.findFirst({ where: { courseId: blCourseId, moduleId, type } });
      if (!existing) {
        await prisma.evaluationEvent.create({ data: { courseId: blCourseId, moduleId, type, name, weight: 0, order: moduleIdx } });
      }
    };

    // ── Phase functions — Trello DmPpbrff item 8 (2026-08-30 20:30): "primero lecciones
    // de todos los módulos... luego quizzes... luego reflexiones... luego clases... luego
    // entrevistas." Each phase now runs across ALL modules before the next phase starts,
    // instead of the old per-module loop that did lessons+quiz+class for module 1, then
    // module 2, etc. — so an evaluator watching the status bar sees written lessons finish
    // first ("para ver el contenido del curso lo más pronto posible"), and the status bar
    // can name which phase is running instead of one opaque module counter.
    // Carousel phase (Trello DmPpbrff, 2026-08-31 17:30): auto-generated for EVERY module,
    // runs right after this lessons phase, before classes/quiz/reflection — see
    // generateModuleCarousel below.
    const generateModuleLessons = async (moduleIdx: number): Promise<void> => {
      const moduleId = (moduleIds as string[])[moduleIdx]!;
      try {
        // Idempotency guard (Trello DmPpbrff, 2026-08-31 17:30 — Mack: "Lux Planner
        // sigue generando lecciones vacías"). Root cause found in CloudWatch: this whole
        // action was dispatched twice for the same course, and the second run's
        // createMany collided on the (moduleId, order) unique constraint — a genuine DB
        // error, not a Bedrock truncation — leaving every affected module's FIRST (valid)
        // insert attempt aside while the failed second call reported failure. A module
        // that already has lessons should never get a second, colliding batch.
        const existingLessonCount = await prisma.lesson.count({ where: { moduleId } });
        if (existingLessonCount > 0) {
          console.log(`[wizard-lessons-bulk] module ${moduleId}: already has ${existingLessonCount} lessons, skipping (idempotency guard)`);
          return;
        }
        const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true, description: true } });
        if (!mod) return;

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
Lesson 1 and Lesson ${lessonCount} are video type (introductory/summary, 100-150 words, ~${VIDEO_LESSON_MIN} min). All others are text type (900-1100 words each, ~${TEXT_COMPREHENSION_MIN} min active study) — real instructional depth, not a shallow list: explain the WHY and the HOW, not just the WHAT.
STRUCTURE for every text lesson's "content" field (HTML, no full markdown) — 5 sections with progressive scaffolding:
1. OPENING — specific <h3> that poses a real question or concrete scenario related to the concept (e.g. "<h3>Why Don't GPS Maps Always Give the Shortest Route?</h3>"). NEVER use "Hook" or "Introduction" as the title.
2. DEVELOPMENT — specific <h3> naming the exact concept (e.g. "<h3>Heuristics in Search Algorithms</h3>"). Explain it thoroughly: the underlying idea, why it matters, and how it works step by step. Short paragraphs, max 4-5 lines each. At least one <strong> bolded key term and one bullet list (use "- item" lines, converted to <ul><li>). NEVER use "Development" or "Content" as the title.
3. WORKED EXAMPLE — specific <h3> naming a concrete real-world case (e.g. "<h3>Tracing an A* Search Step by Step in GPS Routing</h3>"). Walk through an actual example with specifics (numbers, a named scenario, or a step-by-step trace) — do not just NAME an application, actually work through it so the student sees the concept in action. NEVER use "Practical Bridge" or "Example" alone as the title.
4. PRACTICE IT YOURSELF — specific <h3> (e.g. "<h3>Try It: Estimate the Heuristic for Your Own Route</h3>") with ONE short self-guided exercise or thought experiment the student can attempt alone, using only what was just taught — not graded, just applied practice. NEVER title it "Exercise" or "Practice" alone.
5. (Last text lesson of the module only) CLOSING — specific <h3> naming the module topic (e.g. "<h3>Key Takeaways: Heuristic Search Algorithms</h3>") with a bullet summary of key points and 1-2 self-assessment questions. NEVER use "Reflective Close" or "Summary" as the title.
VISUAL VARIETY (required in every text lesson, not just walls of paragraphs): include exactly one colored callout box highlighting a key insight or warning, using this exact pattern: <div style="background:#EFF6FF;border-left:4px solid #3B82F6;padding:12px 16px;border-radius:8px;margin:16px 0;"><strong>💡 [short label]:</strong> [one or two sentences]</div>. Combined with the required bullet list and bolded term above, this gives the student a visual break from plain text.
Write in neutral, formal international English — no slang or regionalisms.
Return ONLY a JSON array of exactly ${lessonCount} objects with no markdown fencing:
[{"title":"Lesson title","content":"<h3>Specific concept subtitle</h3><p>HTML paragraph content</p>","points":["key point 1","key point 2","key point 3"],"tip":"one practical tip","type":"video|text","duration":"5 min|${TEXT_COMPREHENSION_MIN} min"}]`
          : `Eres un diseñador instruccional de e-learning de primer nivel. Genera exactamente ${lessonCount} lecciones para el módulo "${mod.title}" del curso "${blTitle}".${classContextNote}
Meta: ~${TARGET_ASYNC_MIN} minutos de estudio asíncrono activo por módulo, repartidos en lecciones con andamiaje progresivo (${TEXT_COMPREHENSION_MIN} min cada una) — cada lección construye sobre los conceptos de la anterior.
La lección 1 y la lección ${lessonCount} son tipo video (intro/resumen, 100-150 palabras, ~${VIDEO_LESSON_MIN} min). Las demás son tipo texto (900-1100 palabras cada una, ~${TEXT_COMPREHENSION_MIN} min de estudio activo) — profundidad instructiva real, no una lista superficial: explica el POR QUÉ y el CÓMO, no solo el QUÉ.
ESTRUCTURA obligatoria para el campo "content" de cada lección de texto (HTML, sin markdown completo) — 5 secciones con andamiaje progresivo:
1. APERTURA — <h3> específico que plantee una pregunta real o escenario concreto relacionado al concepto (ej. "<h3>¿Por qué los mapas GPS no siempre dan la ruta más corta?</h3>"). NUNCA usar "Gancho", "Hook" ni "Introducción" como título.
2. DESARROLLO — <h3> específico que nombre el concepto exacto (ej. "<h3>Heurísticas en Algoritmos de Búsqueda</h3>"). Explícalo a fondo: la idea de base, por qué importa, y cómo funciona paso a paso. Párrafos cortos máx 4-5 líneas. Al menos un <strong> clave y una lista con viñetas (usa líneas "- item", se convierten a <ul><li>). NUNCA usar "Desarrollo" ni "Contenido" como título.
3. EJEMPLO TRABAJADO — <h3> que nombre un caso concreto del mundo real (ej. "<h3>Trazando A* Paso a Paso en Navegación GPS</h3>"). Desarrolla un ejemplo real con datos concretos (números, un escenario nombrado, o una traza paso a paso) — no basta con NOMBRAR una aplicación, hay que desarrollarla para que el estudiante vea el concepto en acción. NUNCA usar "Puente Práctico" ni solo "Ejemplo" como título.
4. PONLO EN PRÁCTICA — <h3> específico (ej. "<h3>Inténtalo: Estima la Heurística de tu Propia Ruta</h3>") con UN ejercicio autoguiado corto o experimento mental que el estudiante pueda intentar solo, usando solo lo que se acaba de enseñar — no es calificado, es práctica aplicada. NUNCA titularlo solo "Ejercicio" o "Práctica".
5. (Solo última lección de texto del módulo) CIERRE — <h3> que nombre el tema del módulo (ej. "<h3>Síntesis: Algoritmos de Búsqueda Heurística</h3>") con resumen en puntos clave y 1-2 preguntas de autoevaluación. NUNCA usar "Cierre Reflexivo" ni "Resumen" como título.
VARIEDAD VISUAL (obligatorio en cada lección de texto, no solo párrafos de texto plano): incluye exactamente un recuadro destacado con color resaltando una idea clave o advertencia, usando este patrón exacto: <div style="background:#EFF6FF;border-left:4px solid #3B82F6;padding:12px 16px;border-radius:8px;margin:16px 0;"><strong>💡 [etiqueta corta]:</strong> [una o dos oraciones]</div>. Combinado con la lista de viñetas y el término en negrita ya requeridos arriba, esto le da al estudiante un descanso visual de solo texto plano.
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
        // [] (not null) when Bedrock returned nothing usable — critical fix (Jason,
        // 2026-09-01: "sigues generando lecciones vacías"): invokeBedrockForJson
        // silently resolves to `{}` (not a thrown error) when it can't parse a JSON
        // array out of the response — e.g. a soft refusal or non-JSON prose. With
        // `null` here, the retry block below (`if (validLessons && ...)`) was SKIPPED
        // ENTIRELY for a TOTAL failure, because `null` is falsy — so the worse the
        // failure, the LESS retry effort it got. `[]` is truthy, so a total failure
        // now retries exactly like a partial one (missing = lessonCount - 0).
        let validLessons: any[] = Array.isArray(rawLessons) && rawLessons.length > 0 && rawLessons[0]?.title
          ? rawLessons : [];

        // Retry for missing lessons when Bedrock truncated the response (Bug B fix)
        if (validLessons.length < lessonCount) {
          const missing = lessonCount - validLessons.length;
          console.warn(`[wizard-lessons-bulk] module ${moduleId}: got ${validLessons.length}/${lessonCount} — retrying for ${missing} missing lessons`);
          const retryPrompt = isBlEN
            ? `Continue generating the remaining ${missing} lessons (lessons ${validLessons.length + 1} to ${lessonCount}) for module "${mod.title}" in course "${blTitle}".
These are the LAST ${missing} lessons of a ${lessonCount}-lesson module. Lesson ${lessonCount} is video type (summary, 100-150 words, ~5 min). All others in this batch are text type (900-1100 words each) — same 5-section structure as the main lesson set (opening question, development, a fully worked real example, a self-practice exercise, and a closing summary on the last text lesson), including one colored callout box (<div style="background:#EFF6FF;border-left:4px solid #3B82F6;padding:12px 16px;border-radius:8px;margin:16px 0;">).
Return ONLY a JSON array of exactly ${missing} lesson objects with no markdown fencing:
[{"title":"Lesson title","content":"<h3>subtitle</h3><p>HTML content</p>","points":["point 1","point 2","point 3"],"tip":"practical tip","type":"video|text","duration":"5 min|${textDuration}"}]`
            : `Continúa generando las ${missing} lecciones faltantes (lecciones ${validLessons.length + 1} a ${lessonCount}) para el módulo "${mod.title}" del curso "${blTitle}".
Estas son las ÚLTIMAS ${missing} lecciones de un módulo de ${lessonCount} lecciones. La lección ${lessonCount} es tipo video (resumen, 100-150 palabras, ~5 min). Las demás en este lote son tipo texto (900-1100 palabras cada una) — misma estructura de 5 secciones que el set principal (pregunta de apertura, desarrollo, un ejemplo real trabajado a fondo, un ejercicio de práctica propia, y cierre-resumen solo en la última lección de texto), incluyendo un recuadro destacado con color (<div style="background:#EFF6FF;border-left:4px solid #3B82F6;padding:12px 16px;border-radius:8px;margin:16px 0;">).
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
                  ? `<h3>📚 Bibliography</h3><ol style="font-size:0.875rem;color:#4b5563;">${refs.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ol>`
                  : `<h3>📚 Referencias</h3><ol style="font-size:0.875rem;color:#4b5563;">${refs.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ol>`;
              }
              if (ytQueries.length > 0) {
                // Real, verified video links instead of a keyword-search URL the student
                // has to sift through themselves (Trello Nk0XDBvJ, 2026-09-02 21:43 —
                // Mack). Needs YOUTUBE_API_KEY (Google Cloud "YouTube Data API v3") — until
                // it's set, searchYoutubeVideo returns null and every query keeps falling
                // back to the old search-results link, so this never regresses.
                const resolved = await Promise.all(ytQueries.map(async (q) => {
                  const found = await searchYoutubeVideo(q);
                  // Validate the id shape (real YouTube ids are always exactly this) before
                  // trusting it in an href — defense in depth on top of escapeHtml below,
                  // since this one value comes straight from a third-party API response.
                  if (found && /^[a-zA-Z0-9_-]{11}$/.test(found.videoId) && await isYoutubeVideoAvailable(found.videoId)) {
                    return { href: `https://www.youtube.com/watch?v=${found.videoId}`, label: found.title || q };
                  }
                  return { href: `https://youtube.com/results?search_query=${encodeURIComponent(q)}`, label: q };
                }));
                // escapeHtml on the label — found.title is untrusted third-party text from
                // Google's API, not something Lux controls (code-review finding: stored XSS
                // via dangerouslySetInnerHTML on the student lesson page otherwise).
                const ytLinks = resolved.map(({ href, label }) => `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`).join('');
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

        // Visual variety + honest durations (Trello DmPpbrff, 2026-08-31 15:19): one AI
        // image per lesson (best-effort, never blocks) + duration recomputed from the
        // ACTUAL final word count (content, including the resources just appended above,
        // plus points/tip) — replaces the flat "5 min"/"9 min" guess that let a truncated
        // ~79-word lesson claim 5 minutes.
        await attachLessonVisuals(lessonData, mod.title);

        await prisma.lesson.createMany({ data: lessonData });
        const createdLessons = lessonData.map((l) => ({ duration: l.duration }));

        // Module duration = actual sum of created lesson durations
        const totalMin = createdLessons.reduce((sum: number, l) => {
          const m = parseInt(l.duration, 10);
          return sum + (isNaN(m) ? 7 : m);
        }, 0);
        await prisma.module.update({ where: { id: moduleId }, data: { duration: `${totalMin} min` } });
      } catch (modErr: any) {
        console.error(`[wizard-lessons-bulk] module ${moduleId} lessons error:`, modErr);
        failed.push(moduleId);
      }
    };

    const generateModuleQuiz = async (moduleIdx: number): Promise<void> => {
      if (!quizIdxSet.has(moduleIdx)) return;
      const moduleId = (moduleIds as string[])[moduleIdx]!;
      try {
        await recordIntent(moduleIdx, 'QUIZ', isBlEN ? 'Quiz' : 'Cuestionario');
        const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true } });
        if (mod) await generateAndSaveQuizQuestions(prisma, moduleId, mod.title, isBlEN);
      } catch (e) {
        console.error(`[wizard-lessons-bulk] module ${moduleId} quiz error:`, e);
      }
    };

    const recordModuleReflection = async (moduleIdx: number): Promise<void> => {
      if (!reflexIdxSet.has(moduleIdx)) return;
      try {
        await recordIntent(moduleIdx, 'REFLECTION', isBlEN ? 'Reflection' : 'Reflexión');
      } catch (e) {
        console.error(`[wizard-lessons-bulk] module ${(moduleIds as string[])[moduleIdx]} reflection error:`, e);
      }
    };

    // Auto-carousel — every module, no opt-in index set (Trello DmPpbrff, 2026-08-31
    // 14:02): unlike quiz/class/reflection/interview this isn't evaluator-selected per
    // module, it's a default part of the bulk pipeline now. The manual Mini Wizard
    // (carousel.ts) still exists separately for one-off generation/retries.
    const generateModuleCarouselPhase = async (moduleIdx: number): Promise<void> => {
      const moduleId = (moduleIds as string[])[moduleIdx]!;
      const durationMin = await generateModuleCarousel(prisma, blCourseId, moduleId, blLang);
      if (durationMin !== false) {
        // Carousel's real narration length isn't part of the Phase 1 duration sum (it
        // didn't exist yet) — add the ACTUAL computed minutes, not a flat guess (code
        // review, 2026-09-01: a flat "+6 min" reintroduced the exact duration-honesty
        // bug this session fixed for lessons).
        const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { duration: true } });
        const current = parseInt(mod?.duration ?? '0', 10);
        await prisma.module.update({ where: { id: moduleId }, data: { duration: `${(isNaN(current) ? 0 : current) + durationMin} min` } }).catch(() => {});
      }
    };

    const generateModuleClass = async (moduleIdx: number): Promise<void> => {
      if (!classIdxSet.has(moduleIdx)) return;
      const moduleId = (moduleIds as string[])[moduleIdx]!;
      try {
        const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true } });
        if (!mod) return;
        // Tone constraint added (Trello DmPpbrff item 6, 2026-08-30 20:24): lessonScript
        // is shown verbatim to the student as on-screen class content — a chatty/emoji
        // tone read there like an AI assistant, not an instructor ("no me gusta cómo se
        // ve... se ve como si fuera un chat con alguna inteligencia artificial").
        //
        // Restructured (Trello DmPpbrff, 2026-08-31 04:01): the exposition is now narrated
        // by Polly BEFORE Vapi connects — vapiPrompt drives ONLY the live Q&A (no more
        // "deliver this monologue" instruction, which is what used to leave the class
        // hanging after the mic-mute message). closingScript is new: a short module recap
        // read by Polly after the call ends.
        const classPrompt = isBlEN
          ? `Generate a Lux Mentor class for module "${mod.title}". Professional, formal educational tone — no emojis, no chatbot-style greetings or filler ("Hey!", "Great question!", etc). JSON: {"vapiPrompt":"<prompt for a live Q&A voice tutor — pose guiding questions about the module, 100 words max>","lessonScript":"<class outline as clear bullet points (- item) covering 3 key topics and activities, 400-450 words (this is a narrated 'clase magistral', not a summary — this is close to the maximum a single narration request can hold), written to be read aloud by a narrator, with natural pauses between points>","closingScript":"<~90-110 word spoken closing: briefly recap the key topics covered in this module, then a warm one-sentence congratulation motivating the student to continue>"}`
          : `Genera una Clase Magistral Lux Mentor para el módulo "${mod.title}". Tono profesional y educativo formal — sin emojis, sin saludos ni muletillas de chatbot ("¡Hola!", "¡Buena pregunta!", etc). JSON: {"vapiPrompt":"<prompt para un tutor de voz en vivo — plantea preguntas guía sobre el módulo, máx 100 palabras>","lessonScript":"<esquema de clase en viñetas claras (- item) cubriendo 3 temas clave y actividades, 400-450 palabras (esto es una clase magistral narrada, no un resumen — este es cerca del máximo que una sola narración puede contener), escrito para ser leído en voz alta por un narrador, con pausas naturales entre puntos>","closingScript":"<cierre hablado de ~90-110 palabras: resume brevemente los temas clave vistos en este módulo, luego una felicitación cálida de una oración motivando al estudiante a continuar>"}`;
        let classContent = await invokeBedrockForJson(classPrompt, 1500).catch((e: any) => {
          console.error(`[wizard-lessons-bulk] module ${moduleId} classPrompt failed: ${e?.name ?? 'UnknownError'}: ${e?.message ?? e}`);
          return null;
        });
        // Retry once on a total failure (code review, 2026-09-01: this silently gave up
        // with zero retry and zero trace — the exact bug class already fixed for lesson
        // generation, just never applied here).
        if (!classContent?.vapiPrompt) {
          console.warn(`[wizard-lessons-bulk] module ${moduleId}: class generation returned nothing usable — retrying once`);
          classContent = await invokeBedrockForJson(classPrompt, 1500).catch((e: any) => {
            console.error(`[wizard-lessons-bulk] module ${moduleId} class retry failed: ${e?.name ?? 'UnknownError'}: ${e?.message ?? e}`);
            return null;
          });
        }
        if (classContent?.vapiPrompt) {
          const maleVoice = defaultMaleVoiceForLanguage(isBlEN ? 'EN' : 'ES');
          const transitionLine = isBlEN
            ? ' If you have any questions or doubts, please address them now — the voice session will begin shortly.'
            : ' Si tienes alguna duda o pregunta, por favor coméntala ahora — la sesión de voz comenzará en breve.';
          const lessonScript: string = classContent.lessonScript ?? '';
          const closingScript: string = classContent.closingScript ?? '';
          // Lux Mentor Class exposition redesign (Trello DmPpbrff, 2026-09-01 01:10 —
          // Mack: "puedo ver el close caption de lo que él va diciendo"): the lesson
          // narration now also captures Polly's sentence-level speech marks (same dual-
          // request pattern already used for carousels), so the frontend can highlight
          // the currently-spoken sentence in sync — not just play a silent audio clip.
          const [lessonNarration, closingAudioUrl] = await Promise.all([
            lessonScript ? generateCarouselNarration(`class-${moduleId}`, lessonScript + transitionLine, maleVoice) : Promise.resolve(null),
            closingScript ? generateLessonAudio(`class-closing-${moduleId}`, closingScript, maleVoice) : Promise.resolve(null),
          ]);
          const classData = {
            vapiPrompt: classContent.vapiPrompt, lessonScript: lessonScript || null,
            lessonAudioUrl: lessonNarration?.audioUrl ?? null,
            lessonSpeechMarks: (lessonNarration?.marks as any) ?? null,
            closingScript: closingScript || null, closingAudioUrl,
          };
          const existingClass = await prisma.evaluationEvent.findFirst({ where: { courseId: blCourseId, moduleId, type: 'CLASS' } });
          if (existingClass) {
            await prisma.evaluationEvent.update({ where: { id: existingClass.id }, data: classData });
          } else {
            await prisma.evaluationEvent.create({ data: { courseId: blCourseId, moduleId, type: 'CLASS', name: isBlEN ? `Lux Mentor Class — ${mod.title}` : `Clase Magistral — ${mod.title}`, weight: 0, order: moduleIdx, ...classData } });
          }
        }
      } catch (e) {
        console.error(`[wizard-lessons-bulk] module ${moduleId} class error:`, e);
      }
    };

    const recordModuleInterview = async (moduleIdx: number): Promise<void> => {
      if (!interviewIdxSet.has(moduleIdx)) return;
      try {
        await recordIntent(moduleIdx, 'INTERVIEW', isBlEN ? 'Lux Mentor Interview' : 'Entrevista con Lux Mentor');
      } catch (e) {
        console.error(`[wizard-lessons-bulk] module ${(moduleIds as string[])[moduleIdx]} interview error:`, e);
      }
    };

    try {
      // Bounded concurrency: 3 modules at a time within each phase. Wall-clock time is
      // driven by ceil(N/3) batches instead of N sequential modules — a 16-module course
      // that used to risk a ~10min timeout now finishes each phase in roughly 1/3 of that
      // time, with enough Bedrock request headroom to avoid tripping throttling in a burst.
      const MODULE_CONCURRENCY = 3;
      const allIdx = (moduleIds as string[]).map((_, i) => i);
      const totalModules = allIdx.length;
      let incompleteModuleIds: string[] = [];

      if (_quizOnlyForExistingModules) {
        // Narrow retrofit path — unrelated to the phase restructuring below. Only adds a
        // quiz to modules that already have lessons; never touches lessons/class. Still
        // records REFLECTION/INTERVIEW intents when asked, matching the pre-restructure
        // behavior of this mode.
        for (let i = 0; i < allIdx.length; i += MODULE_CONCURRENCY) {
          const batch = allIdx.slice(i, i + MODULE_CONCURRENCY);
          await Promise.all(batch.map(async (idx) => {
            const moduleId = (moduleIds as string[])[idx]!;
            try {
              if (reflexIdxSet.has(idx)) await recordIntent(idx, 'REFLECTION', isBlEN ? 'Reflection' : 'Reflexión');
              if (interviewIdxSet.has(idx)) await recordIntent(idx, 'INTERVIEW', isBlEN ? 'Lux Mentor Interview' : 'Entrevista con Lux Mentor');
              if (quizIdxSet.has(idx)) {
                const existingLessonCount = await prisma.lesson.count({ where: { moduleId } });
                if (existingLessonCount > 0) await generateModuleQuiz(idx);
              }
            } catch (e) {
              console.error(`[wizard-lessons-bulk] module ${moduleId} quiz-only error:`, e);
              failed.push(moduleId);
            }
          }));
          await saveAiJob(_jobId, { status: 'processing', phase: 'quiz', modulesProcessed: Math.min(i + MODULE_CONCURRENCY, totalModules), totalModules });
        }
      } else {
        // ── Phase 1: lessons, across every module ────────────────────────────────
        for (let i = 0; i < allIdx.length; i += MODULE_CONCURRENCY) {
          const batch = allIdx.slice(i, i + MODULE_CONCURRENCY);
          await Promise.all(batch.map((idx) => generateModuleLessons(idx)));
          // Incremental progress — lets the wizard UI poll real "N/total módulos listos"
          // per phase instead of a static "ready in a few minutes" message that never
          // updates (Jason, 2026-08-30: no completion indicator in the wizard at all).
          await saveAiJob(_jobId, { status: 'processing', phase: 'lessons', modulesProcessed: Math.min(i + MODULE_CONCURRENCY, totalModules), totalModules });
        }

        // ── Phase 2: carousels, for EVERY module (auto-default, item 3) ──────────
        // Order per Mack (Trello DmPpbrff, 2026-08-31 17:30 — his latest word on
        // ordering, superseding two earlier/contradictory versions of this same day):
        // lessons → carousel → class → quiz/reflection → interview.
        for (let i = 0; i < allIdx.length; i += MODULE_CONCURRENCY) {
          const batch = allIdx.slice(i, i + MODULE_CONCURRENCY);
          await Promise.all(batch.map((idx) => generateModuleCarouselPhase(idx)));
          await saveAiJob(_jobId, { status: 'processing', phase: 'carousels', modulesProcessed: Math.min(i + MODULE_CONCURRENCY, totalModules), totalModules });
        }

        // ── Phase 3: classes, only for modules that need one ─────────────────────
        const classIdx = allIdx.filter((idx) => classIdxSet.has(idx));
        for (let i = 0; i < classIdx.length; i += MODULE_CONCURRENCY) {
          const batch = classIdx.slice(i, i + MODULE_CONCURRENCY);
          await Promise.all(batch.map((idx) => generateModuleClass(idx)));
          await saveAiJob(_jobId, { status: 'processing', phase: 'classes', modulesProcessed: Math.min(i + MODULE_CONCURRENCY, classIdx.length), totalModules: classIdx.length });
        }

        // ── Phase 4: quizzes, only for modules that need one ─────────────────────
        const quizIdx = allIdx.filter((idx) => quizIdxSet.has(idx));
        for (let i = 0; i < quizIdx.length; i += MODULE_CONCURRENCY) {
          const batch = quizIdx.slice(i, i + MODULE_CONCURRENCY);
          await Promise.all(batch.map((idx) => generateModuleQuiz(idx)));
          await saveAiJob(_jobId, { status: 'processing', phase: 'quiz', modulesProcessed: Math.min(i + MODULE_CONCURRENCY, quizIdx.length), totalModules: quizIdx.length });
        }

        // ── Phase 5: reflections, only for modules that need one (instant — a record only) ──
        const reflexIdx = allIdx.filter((idx) => reflexIdxSet.has(idx));
        for (const idx of reflexIdx) await recordModuleReflection(idx);
        if (reflexIdx.length > 0) {
          await saveAiJob(_jobId, { status: 'processing', phase: 'reflections', modulesProcessed: reflexIdx.length, totalModules: reflexIdx.length });
        }

        // ── Phase 6: interviews, only for modules that need one (instant — a record only) ──
        const interviewIdx = allIdx.filter((idx) => interviewIdxSet.has(idx));
        for (const idx of interviewIdx) await recordModuleInterview(idx);
        if (interviewIdx.length > 0) {
          await saveAiJob(_jobId, { status: 'processing', phase: 'interviews', modulesProcessed: interviewIdx.length, totalModules: interviewIdx.length });
        }

        // ── Completeness sweep — the "sí o sí" guarantee (Jason, 2026-08-30) ────────
        // The main lessons phase's in-line retry-once gives up after one extra attempt
        // and leaves a placeholder / empty-quiz permanently if that also fails. Verify
        // every module against the DB (not in-memory state) and give genuinely incomplete
        // ones MORE real attempts — bounded, so a persistently-broken module (real network/
        // Bedrock outage) can't loop forever — before ever reporting the job "done".
        const MAX_SWEEPS = 3; // up to 3 real repair passes after the main loop's own attempt
        let incompleteIdx: number[] = [];
        for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
          incompleteIdx = [];
          for (const idx of allIdx) {
            const moduleId = (moduleIds as string[])[idx]!;
            const complete = await verifyAndRepairModule(
              prisma, moduleId, blTitle, isBlEN, quizIdxSet.has(idx), () => generateModuleLessons(idx),
            );
            if (!complete) incompleteIdx.push(idx);
          }
          if (incompleteIdx.length === 0) break;
          console.warn(`[wizard-lessons-bulk] sweep ${sweep + 1}/${MAX_SWEEPS}: ${incompleteIdx.length}/${totalModules} module(s) still incomplete, repairing`);
          await saveAiJob(_jobId, { status: 'processing', phase: 'repair', modulesProcessed: totalModules - incompleteIdx.length, totalModules });
        }

        incompleteModuleIds = incompleteIdx.map((idx) => (moduleIds as string[])[idx]);
        if (incompleteModuleIds.length > 0) {
          console.error(`[wizard-lessons-bulk] job ${_jobId}: gave up after ${MAX_SWEEPS} repair sweeps — still incomplete: ${incompleteModuleIds.join(', ')}`);
        }

        // Carousel catch-up (found in code review, 2026-09-01): Phase 2 skips a module
        // with 0 lessons at that point, and the sweep above only repairs lessons/quiz —
        // never retries carousel generation. Re-running the (idempotent) carousel phase
        // now picks up any module that had 0 lessons initially but has real ones after
        // repair; a module that already got its carousel is a fast no-op via its own guard.
        for (let i = 0; i < allIdx.length; i += MODULE_CONCURRENCY) {
          const batch = allIdx.slice(i, i + MODULE_CONCURRENCY);
          await Promise.all(batch.map((idx) => generateModuleCarouselPhase(idx)));
        }
      }

      await saveAiJob(_jobId, {
        status: incompleteModuleIds.length > 0 ? 'done_incomplete' : 'done',
        modulesProcessed: totalModules, totalModules, failed: failed.length,
        incompleteModuleIds,
      });
      // Also notifies the course's evaluator (email + push + in-app) that it's ready to
      // review and activate, when different from whoever ran the wizard (item 8).
      const courseForNotify = await prisma.course.findUnique({ where: { id: blCourseId }, select: { evaluatorId: true } }).catch(() => null);
      await notifyCourseGenerationDone(blCreatorUserId, blCourseId, blTitle, isBlEN, incompleteModuleIds.length > 0, courseForNotify?.evaluatorId);
      // Fire-and-forget: Polly neural audio for every lesson, as its own background phase
      // (item 4) — never blocks or risks the completeness status set just above.
      await dispatchLessonAudioGeneration(blCourseId);
      // Clears the "still generating" flag the admin course editor polls on — matched to
      // THIS job (updateMany's where clause) so a late-finishing OLD job can't clobber a
      // newer one that started since (2026-08-31 status-visibility fix).
      await prisma.course.updateMany({ where: { id: blCourseId, activeGenerationJobId: _jobId }, data: { activeGenerationJobId: null } }).catch(() => {});
    } catch (err: any) {
      await saveAiJob(_jobId, { status: 'error', error: err?.message ?? 'Error generando lecciones' });
      await prisma.course.updateMany({ where: { id: blCourseId, activeGenerationJobId: _jobId }, data: { activeGenerationJobId: null } }).catch(() => {});
    }
    return ok({});
  }

  // ── Async worker: wizard copilot ─────────────────────────────────────────────
  // Extracted to ai-wizard-copilot-worker.ts (2026-08-31) to stay under the 600-line limit.
  const copilotResult = await handleWizardCopilot(ctx);
  if (copilotResult) return copilotResult;

  return null;
}
