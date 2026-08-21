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

          // ── Dynamic lesson count: ~60 min/module target ──────────────────────
          // With Lux Mentor Class (~50 min sync): 3 async lessons (prep + core + reflect).
          // Without class: 8 async lessons for full coverage.
          const hasClass = classIdxSet.has(moduleIdx);
          const lessonCount = hasClass ? 3 : 8;
          const textRange = lessonCount > 3 ? `Lessons 2-${lessonCount - 1}` : 'Lesson 2';
          const textRangeES = lessonCount > 3 ? `Lecciones 2-${lessonCount - 1}` : 'Lección 2';

          // ── Lesson prompt (4-pillar structure, active-reading durations) ────────
          const lessonPrompt = isBlEN
            ? `You are an expert e-learning instructional designer. Generate exactly ${lessonCount} lessons for the module "${mod.title}" in the course "${blTitle}".
${hasClass ? `\nCONTEXT: This module has a live Lux Mentor Class (~50 min synchronous). Lessons are async support material: brief pre-class prep (lesson 1) + core reading (lesson 2) + post-class reflection (lesson ${lessonCount}).` : ''}

STRUCTURE for each text lesson (${textRange}) — 4 mandatory sections in order:
1. OPENING (attention hook): 2-3 compelling sentences that capture attention and contextualize the topic. Give this section a thematic <h3> title derived from the lesson content — NOT the word "Hook".
2. CORE CONTENT (development): 4-6 substantive paragraphs with real examples, analogies, and practical connections. Each paragraph must have 4-6 sentences. Use <h3> for topic-specific sub-headings, <blockquote> for key concepts or citations. Headings must reflect the actual subject matter.
3. APPLIED PRACTICE (bridge): A concrete real-world application or case study (1-2 paragraphs). Give this section a thematic <h3> title based on the specific application — NOT "Practical Bridge".
4. KEY TAKEAWAYS (close): 2-3 key takeaways as <ul><li> + 1-2 self-assessment questions. Use a thematic <h3> title — NOT "Reflective Close" or "Key Takeaways".

CRITICAL RULE FOR HEADINGS: All <h3> tags must use titles that reflect the lesson's actual subject matter. Generic methodology labels like "Hook", "Development", "Practical Bridge", "Reflective Close", or "Key Takeaways" are FORBIDDEN as headings.

REQUIREMENTS:
- ${textRange} (type "text"): minimum ${hasClass ? '500' : '700'} words each (${hasClass ? '6-8' : '7-9'} min active reading). Rich HTML ONLY: <h3>, <p>, <ul><li>, <blockquote>, <strong>. NO markdown.
- Lesson 1 (type "video"): short ${hasClass ? 'pre-class prep' : 'intro'} ~100 words, HTML only, duration "5 min".
- Lesson ${lessonCount} (type "video"): ${hasClass ? 'post-class reflection and key takeaways' : 'module summary and transition to next topic'}, HTML only, duration "5 min".
- Neutral professional English. No filler phrases or padding.
- duration field: "5 min" for video, "${hasClass ? '8' : '7'} min" for text lessons.

Return ONLY a valid JSON array of exactly ${lessonCount} objects:
[{"title":"string","order":1,"type":"video","content":"<p>...</p>","duration":"5 min","points":["Key 1","Key 2","Key 3"],"tip":"string"},
{"title":"string","order":2,"type":"text","content":"<h3>[Thematic opening title about the topic]</h3><p>...</p><h3>[Specific concept or subtopic name]</h3><p>...</p><blockquote>...</blockquote><h3>[Real-world application title]</h3><p>...</p><h3>[Thematic close title]</h3><ul><li>...</li></ul>","duration":"${hasClass ? '8' : '7'} min","points":["Key 1","Key 2","Key 3"],"tip":"string"}]`
            : `Eres un experto en diseño instruccional para e-learning. Genera exactamente ${lessonCount} lecciones para el módulo "${mod.title}" del curso "${blTitle}".
${hasClass ? `\nCONTEXTO: Este módulo tiene una Clase Magistral con Lux Mentor (~50 min sincrónica). Las lecciones son material de apoyo asíncrono: preparación breve pre-clase (lección 1) + lectura central (lección 2) + reflexión post-clase (lección ${lessonCount}).` : ''}

ESTRUCTURA para cada lección tipo texto (${textRangeES}) — 4 secciones obligatorias en orden:
1. APERTURA (gancho de atención): 2-3 oraciones contundentes que capturan la atención y contextualizan el tema. El título del <h3> debe ser temático y derivarse del contenido de la lección — NUNCA usar la palabra "Gancho".
2. CONTENIDO CENTRAL (desarrollo): 4-6 párrafos sustanciales con ejemplos reales, analogías y conexiones prácticas. Cada párrafo debe tener 4-6 oraciones. Usa <h3> para sub-títulos específicos del tema, <blockquote> para conceptos clave o citas relevantes. Los títulos deben reflejar la materia real.
3. APLICACIÓN PRÁCTICA (puente): Aplicación real o caso de estudio concreto (1-2 párrafos). El título del <h3> debe basarse en la aplicación específica — NUNCA usar "Puente Práctico".
4. CIERRE (consolidación): 2-3 puntos clave como <ul><li> + 1-2 preguntas de autoevaluación. Usa un título <h3> temático — NUNCA usar "Cierre Reflexivo" ni "Puntos Clave".

REGLA CRÍTICA PARA LOS TÍTULOS: Todos los <h3> deben usar títulos que reflejen la materia específica de la lección. Etiquetas metodológicas genéricas como "Gancho", "Desarrollo", "Puente Práctico", "Cierre Reflexivo" o "Puntos Clave" están PROHIBIDAS como títulos de sección.

REQUISITOS:
- ${textRangeES} (tipo "text"): mínimo ${hasClass ? '500' : '700'} palabras cada una (${hasClass ? '6-8' : '7-9'} min lectura activa). Solo HTML rico: <h3>, <p>, <ul><li>, <blockquote>, <strong>. SIN markdown.
- Lección 1 (tipo "video"): ${hasClass ? 'preparación breve pre-clase' : 'introducción breve'} ~100 palabras, solo HTML, duration "5 min".
- Lección ${lessonCount} (tipo "video"): ${hasClass ? 'reflexión post-clase y puntos clave de repaso' : 'resumen del módulo y transición al siguiente tema'}, solo HTML, duration "5 min".
- Español latino neutro, formal. Sin modismos locales. Sin frases de relleno.
- Campo duration: "5 min" para video, "${hasClass ? '8' : '7'} min" para lecciones de texto.

Devuelve ÚNICAMENTE un array JSON válido de exactamente ${lessonCount} objetos:
[{"title":"string","order":1,"type":"video","content":"<p>...</p>","duration":"5 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"string"},
{"title":"string","order":2,"type":"text","content":"<h3>[Título temático de apertura sobre el tema]</h3><p>...</p><h3>[Nombre del concepto o subtema específico]</h3><p>...</p><blockquote>...</blockquote><h3>[Título de la aplicación en contexto real]</h3><p>...</p><h3>[Título temático del cierre]</h3><ul><li>...</li></ul>","duration":"${hasClass ? '8' : '7'} min","points":["Clave 1","Clave 2","Clave 3"],"tip":"string"}]`;

          const rawLessons = await invokeBedrockForJson(lessonPrompt, 8000);
          const lessons = Array.isArray(rawLessons) ? rawLessons.slice(0, lessonCount + 2) : [];
          if (lessons.length === 0) { failed.push(moduleId); continue; }

          await prisma.lesson.createMany({
            data: lessons.map((l: any, i: number) => ({
              moduleId,
              title: l.title || `Lección ${i + 1}`,
              type: l.type || (i === 0 || i === lessons.length - 1 ? 'video' : 'text'),
              content: l.content ? sanitizeLessonContent(String(l.content)) : null,
              youtubeId: '',
              imageUrl: null,
              duration: l.duration ? String(l.duration) : (i === 0 || i === lessons.length - 1 ? '5 min' : (hasClass ? '8 min' : '7 min')),
              points: Array.isArray(l.points) ? l.points : [],
              tip: l.tip || '',
              order: l.order || i + 1,
            })),
          });

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

          // Module duration = actual sum of lesson durations (not fixed 7×n)
          const totalMin = lessons.reduce((sum: number, l: any) => {
            const m = parseInt(String(l.duration ?? '7'), 10);
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
