// AI wizard async workers — extracted from ai-wizard.ts to keep files ≤ 600 lines.
// Handles: wizard-lessons-bulk, wizard-copilot (self-invoked async Lambda workers).
import { saveAiJob, createNotification } from '../shared/db-dynamo';
import { ok } from '../shared/response';
import { AdminCtx, shuffleQuestionOptions, invokeBedrockForJson } from './ctx';

/** Convert residual Markdown artifacts to HTML so lesson content renders cleanly. */
function sanitizeLessonContent(raw: string): string {
  if (!raw || typeof raw !== 'string') return raw;
  return raw
    .replace(/^#{2,3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^---+$/gm, '<hr/>');
}

export async function handleAIWizardWorkers(ctx: AdminCtx): Promise<any | null> {
  const { body } = ctx;

  // ── Async worker: wizard bulk lesson generation ──────────────────────────────
  if (ctx.action === 'wizard-lessons-bulk') {
    const {
      _jobId, courseId: blCourseId, moduleIds = [], courseTitle: blTitle = '',
      language: blLang = 'ES', evaluationItems: blEvalItems = [],
      _quizOnlyForExistingModules = false, _userId: blUserId,
      quizModuleIndices: blQuizIndices, classModuleIndices: blClassIndices,
    } = body as any;
    const isBlEN = blLang === 'EN';
    const { prisma } = ctx;
    // Only generate quiz questions if the evaluation plan explicitly includes a QUIZ type.
    const hasQuizInPlan = (blEvalItems as any[]).some((it: any) => it.type === 'QUIZ');
    const hasClassInPlan = (blEvalItems as any[]).some((it: any) => it.type === 'CLASS');
    // Module indices (0-based) that should receive quiz questions and class sessions
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
              continue; // Skip lesson generation for this module
            }
          }

          // ── Generate lesson content via Bedrock (one call per module) ──────────
          // hasClass → 3 lessons (video intro + text core + video reflection)
          // no class  → 8 lessons (video intro + 6 text + video summary)
          const hasClass = classIdxSet.has(moduleIdx);
          const lessonCount = hasClass ? 3 : 8;
          const textDuration = hasClass ? '8 min' : '7 min';

          const lessonPrompt = isBlEN
            ? `You are an expert instructional designer. Generate exactly ${lessonCount} lessons for the module "${mod.title}" in the course "${blTitle}".
Lessons 1 and ${lessonCount} are video type (introductory/summary, 100-150 words content). The rest are text type (deeper content, 200-300 words each).
Return ONLY a JSON array of exactly ${lessonCount} objects with no markdown:
[{"title":"Lesson title","content":"<p>HTML paragraph content</p>","points":["key point 1","key point 2","key point 3"],"tip":"one practical tip","type":"video|text","duration":"5 min|7 min"}]`
            : `Eres un experto en diseño instruccional. Genera exactamente ${lessonCount} lecciones para el módulo "${mod.title}" del curso "${blTitle}".
La lección 1 y la lección ${lessonCount} son tipo video (intro/resumen, 100-150 palabras de contenido). Las demás son tipo texto (contenido más profundo, 200-300 palabras cada una).
Devuelve ÚNICAMENTE un array JSON de exactamente ${lessonCount} objetos sin markdown:
[{"title":"Título lección","content":"<p>Párrafo HTML con contenido</p>","points":["punto clave 1","punto clave 2","punto clave 3"],"tip":"un consejo práctico","type":"video|text","duration":"5 min|7 min"}]`;

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
              content: gen?.content ? sanitizeLessonContent(gen.content) : null,
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

          // Bug #18: Only create quiz questions for modules explicitly designated for QUIZ
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

          // Bug #17: Create CLASS EvaluationEvent (Lux Mentor Class) for designated modules
          if (classIdxSet.has(moduleIdx)) {
            try {
              const classPrompt = isBlEN
                ? `You are an expert instructor. For the module "${mod.title}" in the course "${blTitle}", generate a 5-minute oral lecture script (monologue) suitable for a voice-based class session. Also generate 3 Q&A questions students might ask.\nRespond ONLY with JSON: {"lessonScript":"...(5-min lecture text)...","vapiPrompt":"You are a Lux Mentor instructor. Start by delivering this lecture: [insert lessonScript summary]. Then ask students if they have questions and answer them using your knowledge of ${mod.title}."}`
                : `Eres un experto docente. Para el módulo "${mod.title}" del curso "${blTitle}", genera un guión de clase oral de 5 minutos (monólogo) apto para sesión magistral por voz. También genera 3 preguntas de Q&A que los estudiantes podrían hacer.\nResponde ÚNICAMENTE con JSON: {"lessonScript":"...(texto de clase de 5 min)...","vapiPrompt":"Eres el Mentor Lux del módulo ${mod.title}. Inicia dictando esta clase magistral: [resumen del lessonScript]. Luego invita preguntas y respóndelas usando tu conocimiento de ${mod.title}."}`;
              const classContent = await invokeBedrockForJson(classPrompt, 2000).catch(() => null);
              if (classContent?.vapiPrompt) {
                const existingClass = await prisma.evaluationEvent.findFirst({
                  where: { courseId: blCourseId, moduleId, type: 'CLASS' },
                });
                if (existingClass) {
                  await prisma.evaluationEvent.update({
                    where: { id: existingClass.id },
                    data: { vapiPrompt: classContent.vapiPrompt, lessonScript: classContent.lessonScript ?? null },
                  });
                } else {
                  await prisma.evaluationEvent.create({
                    data: {
                      courseId: blCourseId, moduleId, type: 'CLASS',
                      name: isBlEN ? `Lux Mentor Class — ${mod.title}` : `Clase Magistral — ${mod.title}`,
                      weight: 0, order: moduleIdx,
                      vapiPrompt: classContent.vapiPrompt,
                      lessonScript: classContent.lessonScript ?? null,
                    },
                  });
                }
              }
            } catch (classErr: any) {
              console.error(`[wizard-lessons-bulk] CLASS event error module ${moduleId}:`, classErr?.message);
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
      if (blUserId) {
        const totalMods = (moduleIds as string[]).length;
        const msg = failed.length > 0
          ? `El curso "${blTitle}" se generó con ${totalMods - failed.length}/${totalMods} módulos completados (${failed.length} fallaron).`
          : `El curso "${blTitle}" ha sido generado exitosamente con ${totalMods} módulo${totalMods !== 1 ? 's' : ''} y sus lecciones. ¡Listo para revisar!`;
        await createNotification({
          userId: blUserId,
          notifId: `wiz-done-${_jobId}`,
          type: 'COURSE_UPDATED',
          message: msg,
          read: false,
          createdAt: new Date().toISOString(),
          actionUrl: blCourseId ? `/admin/courses/${blCourseId}` : undefined,
        }).catch(() => {});
      }
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
      // 1 teaching week = 1 module.
      const jsonFormat = isEN
        ? `{"modules":[{"name":"Module 1","nameEN":"Module 1","description":"2-3 sentences","descriptionEN":"2-3 sentences","week":1},{"name":"Module 2","nameEN":"Module 2","description":"2-3 sentences","descriptionEN":"2-3 sentences","week":2}],"weeklyPlan":[{"weekNum":1,"topics":["Specific topic"],"module":"Module 1","procedure":"Suggested class activity","notes":"Important observation or upcoming deadline","evalEvent":null}]}`
        : `{"modules":[{"name":"Módulo 1","nameEN":"Module 1","description":"2-3 oraciones","descriptionEN":"2-3 sentences","week":1},{"name":"Módulo 2","nameEN":"Module 2","description":"2-3 oraciones","descriptionEN":"2-3 sentences","week":2}],"weeklyPlan":[{"weekNum":1,"topics":["Tema específico"],"module":"Módulo 1","procedure":"Actividad sugerida en clase","notes":"Observación importante o entrega próxima","evalEvent":null}]}`;
      const prompt = isEN
        ? `You are an expert instructional designer. Generate a week-by-week curriculum plan.\n\nCOURSE: ${title}\nTYPE: ${courseType}\nDESCRIPTION: ${description}\nPERIOD: ${academicPeriod}\nMODALITY: ${modality}\nSCHEDULE: ${classSchedule} | Days: ${(classDays as string[]).join(', ')}\nTOTAL TEACHING WEEKS: ${effectiveWeeks} (out of ${totalWeeks} calendar weeks)\nSTART DATE: ${startDate}${exceptionNote}\n\nCONFIGURED EVALUATIONS:\n${evalSummary}\n\nSYLLABUS:\n${(syllabusInput as string).slice(0, 2500)}\n\nCRITICAL RULES:\n- Create EXACTLY ${effectiveWeeks} modules — one module per teaching week, no exceptions.\n- Each module covers exactly ONE week. Do not group multiple weeks under one module.\n- If the syllabus has fewer topics than weeks, expand each topic with deeper subtopics to fill all ${effectiveWeeks} weeks.\n- Never leave a week without a module or topic.\n- For weeks with evaluations, include the evaluation in evalEvent.\n- For each week include: procedure (suggested classroom activity) and notes (important observations, upcoming deadlines, or reminders).\n\nRespond ONLY with valid JSON (no markdown):\n${jsonFormat}`
        : `Eres un experto en diseño curricular. Genera un plan de estudios detallado semana por semana.\n\nCURSO: ${title}\nTIPO: ${courseType}\nDESCRIPCIÓN: ${description}\nPERÍODO: ${academicPeriod}\nMODALIDAD: ${modality}\nHORARIO: ${classSchedule} | Días: ${(classDays as string[]).join(', ')}\nSEMANAS LECTIVAS: ${effectiveWeeks} (de ${totalWeeks} semanas calendario)\nFECHA INICIO: ${startDate}${exceptionNote}\n\nEVALUACIONES CONFIGURADAS:\n${evalSummary}\n\nCONTENIDO / TEMARIO:\n${(syllabusInput as string).slice(0, 2500)}\n\nREGLAS CRÍTICAS:\n- Crea EXACTAMENTE ${effectiveWeeks} módulos — un módulo por semana lectiva, sin excepción.\n- Cada módulo cubre exactamente UNA semana. No agrupes varias semanas en un mismo módulo.\n- Si el temario tiene menos temas que semanas, expande cada tema con subtemas más profundos para cubrir las ${effectiveWeeks} semanas.\n- Nunca dejes una semana sin módulo ni tema.\n- Para semanas con evaluaciones, inclúyelas en evalEvent.\n- Por cada semana incluye: procedure (actividad sugerida en clase) y notes (observaciones importantes, entregas próximas o recordatorios).\n\nResponde ÚNICAMENTE con JSON válido (sin markdown):\n${jsonFormat}`;

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

  return null;
}
