// AI wizard domain handler for lux-admin.
// Handles: wizard/copilot (plan generation), wizard/save, and dispatches their
// async workers (implemented in ai-wizard-worker.ts — kept separate for the
// domain-module line limit, CLAUDE.md: ≤600 lines).
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { saveAiJob } from '../shared/db-dynamo';
import { getCurrentEnv } from '../shared/env-context';
import { upsertChat } from '../shared/db-messages';
import { ok, created, badRequest, forbidden, serverError } from '../shared/response';
import {
  AdminCtx, isAuthorized, isAdmin, getCallerName,
  S3_IMAGES_BUCKET, lambdaClient, s3Client, invokeBedrockForJson,
} from './ctx';
import { generateWizardPlanDocument, createWizardCourseSessions, syncWizardCalendarEvents } from './ai-wizard-docx';
import { handleAIWizardWorker } from './ai-wizard-worker';

/** Builds the index fields for the wizard-lessons-bulk payload. Always includes all 4
 *  keys (even when empty) — an empty array means "explicitly none", which must NOT fall
 *  back to "all modules" (that fallback was the root cause of quiz/reflection/interview/
 *  class showing up on modules the evaluator never selected in Lux Planner — Trello
 *  DmPpbrff comment 6a9269e2). See the matching change in ai-wizard-worker.ts that removes
 *  the hasQuizInPlan-style "assign to every module" fallback. */
function buildIndicesPayload(quizIndices: number[], classIndices: number[], reflexIndices: number[], interviewIndices: number[]) {
  return {
    quizModuleIndices: quizIndices,
    classModuleIndices: classIndices,
    reflexModuleIndices: reflexIndices,
    interviewModuleIndices: interviewIndices,
  };
}

export async function handleAIWizard(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body } = ctx;

  if (ctx.action === 'wizard-lessons-bulk' || ctx.action === 'wizard-copilot') {
    return handleAIWizardWorker(ctx);
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
      luxMentorWeeks = [],
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

    // Which module indices get quiz/reflection/interview/class — driven by the explicit
    // per-module selectors in Lux Planner (quizWeek/reflexWeek/interviewWeek dropdowns +
    // luxMentorWeeks checkboxes), NOT by weeklyPlan[].evalEvent (AI-suggested, not
    // user-controlled, and the source of "system asignó reflexión/entrevista sin que yo
    // los seleccionara" — Trello DmPpbrff comment 6a9269e2). A module gets each feature
    // ONLY when the evaluator explicitly assigned it here — never a course-wide fallback.
    const _quizSetNew = new Set<number>(); const _classSetNew = new Set<number>();
    const _reflexSetNew = new Set<number>(); const _interviewSetNew = new Set<number>();
    (suggestedModules as any[]).forEach((m: any, mi: number) => {
      if (m.quizWeek != null) _quizSetNew.add(mi);
      if (m.reflexWeek != null) _reflexSetNew.add(mi);
      if (m.interviewWeek != null) _interviewSetNew.add(mi);
      if (Array.isArray(m.weeks) && (luxMentorWeeks as number[]).some((w) => m.weeks.includes(w))) _classSetNew.add(mi);
    });
    if (!editingCourseId || replaceModules) {
      // NEW course OR edit with replace: delete existing modules first, then create fresh
      if (editingCourseId && replaceModules) {
        await prisma.module.deleteMany({ where: { courseId: course.id } });
        await prisma.courseSession.deleteMany({ where: { courseId: course.id } });
      }
      // Indices below are positions in createdModuleIds (NOT in suggestedModules) —
      // a failed prisma.module.create mid-loop shifts createdModuleIds shorter than
      // suggestedModules, so we translate _quizSetNew/_classSetNew (suggestedModules
      // positions) into createdModuleIds positions as each module is actually created.
      const createdModuleIds: string[] = [];
      const createdQuizIndices: number[] = [];
      const createdClassIndices: number[] = [];
      const createdReflexIndices: number[] = [];
      const createdInterviewIndices: number[] = [];
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
          const createdIdx = createdModuleIds.length;
          createdModuleIds.push(createdMod.id);
          if (_quizSetNew.has(mi)) createdQuizIndices.push(createdIdx);
          if (_classSetNew.has(mi)) createdClassIndices.push(createdIdx);
          if (_reflexSetNew.has(mi)) createdReflexIndices.push(createdIdx);
          if (_interviewSetNew.has(mi)) createdInterviewIndices.push(createdIdx);
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
              ...buildIndicesPayload(createdQuizIndices, createdClassIndices, createdReflexIndices, createdInterviewIndices),
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

      // Indices below are positions in newModuleIds (NOT in suggestedModules) — this
      // loop skips modules that already exist, so suggestedModules index si no longer
      // matches newModuleIds position; translate _quizSetNew/_classSetNew as we go.
      const newModuleIds: string[] = [];
      const newQuizIndices: number[] = [];
      const newClassIndices: number[] = [];
      const newReflexIndices: number[] = [];
      const newInterviewIndices: number[] = [];
      let nextOrder = maxOrder;
      for (let si = 0; si < (suggestedModules as any[]).length; si++) {
        const mod = (suggestedModules as any[])[si];
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
          const newIdx = newModuleIds.length;
          newModuleIds.push(createdMod.id);
          if (_quizSetNew.has(si)) newQuizIndices.push(newIdx);
          if (_classSetNew.has(si)) newClassIndices.push(newIdx);
          if (_reflexSetNew.has(si)) newReflexIndices.push(newIdx);
          if (_interviewSetNew.has(si)) newInterviewIndices.push(newIdx);
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
              ...buildIndicesPayload(newQuizIndices, newClassIndices, newReflexIndices, newInterviewIndices),
            })),
          }));
        } catch (invokeErr: any) {
          console.error('[wizard/save][edit] lesson bulk invoke error:', invokeErr?.message);
          await saveAiJob(lessonJobId, { status: 'error', error: 'No se pudo iniciar la generación de lecciones' });
          lessonJobId = null;
        }
      }
    }

    // When editing a course: for modules explicitly assigned a quiz (quizWeek) in THIS
    // save that currently have no questions, auto-generate them. Used to trigger off
    // hasQuizInNewPlan (ANY quiz anywhere in the whole eval plan) and catch up EVERY
    // module missing questions — course-wide, not per-module, which is exactly the
    // "quizzes apareciendo sin que yo los seleccionara" bug (Trello DmPpbrff comment
    // 6a9269e2). Now scoped to modules whose title matches a suggestedModules entry
    // with quizWeek set.
    if (editingCourseId) {
      const quizPlannedTitles = new Set(
        (suggestedModules as any[])
          .filter((m: any) => m.quizWeek != null)
          .map((m: any) => String(isEN_save ? (m.nameEN || m.name) : m.name).toLowerCase().trim())
      );
      if (quizPlannedTitles.size > 0) {
        try {
          const courseModules = await prisma.module.findMany({
            where: { courseId: course.id },
            select: { id: true, title: true },
          });
          const modulesWithoutQuiz = await Promise.all(
            courseModules
              .filter((mod: any) => quizPlannedTitles.has(String(mod.title).toLowerCase().trim()))
              .map(async (mod: any) => {
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
                quizModuleIndices: [0], // already filtered to quizPlannedTitles — explicit, no fallback needed
              })),
            })).catch(async (invokeErr: any) => {
              console.error('[wizard/save][quiz-catchup] invoke error:', invokeErr?.message);
              await saveAiJob(jobId, { status: 'error', error: 'No se pudo iniciar la generación de preguntas' });
            });
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
