// AI wizard domain handler for lux-admin.
// Handles: wizard/copilot (plan generation), wizard/save, and their async workers.
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { saveAiJob, batchCreateCalendarEvents, deleteWizardCalendarEvents, saveResource } from '../shared/db-dynamo';
import { getCurrentEnv } from '../shared/env-context';
import type { CalendarEvent } from '../shared/db-calendar';
import { upsertChat } from '../shared/db-messages';
import { ok, created, badRequest, forbidden, serverError } from '../shared/response';
import {
  AdminCtx, isAuthorized, isAdmin, getCallerName, shuffleQuestionOptions,
  S3_IMAGES_BUCKET, lambdaClient, s3Client, invokeBedrockForJson,
} from './ctx';

export async function handleAIWizard(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body } = ctx;

  // ── Async worker: wizard bulk lesson generation ──────────────────────────────
  if (ctx.action === 'wizard-lessons-bulk') {
    const { _jobId, courseId: blCourseId, moduleIds = [], courseTitle: blTitle = '', language: blLang = 'ES' } = body as any;
    const isBlEN = blLang === 'EN';
    const failed: string[] = [];
    try {
      for (const moduleId of moduleIds as string[]) {
        try {
          const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true, description: true } });
          if (!mod) continue;

          const lessonPrompt = isBlEN
            ? `You are an expert instructional designer. Generate exactly 10 lessons for module "${mod.title}" in course "${blTitle}".
Return ONLY a JSON array (10 elements):
[{"title":"Introduction to ${mod.title}","order":1,"type":"video","content":"<p>Introductory paragraph.</p>","duration":"5 min","points":["Point 1","Point 2","Point 3"],"tip":"Helpful tip."},
{"title":"Topic A","order":2,"type":"text","content":"<h3>Heading</h3><p>Paragraph.</p><ul><li>Item A</li><li>Item B</li></ul>","duration":"8 min","points":["Key 1","Key 2","Key 3"],"tip":"Tip."},
{"title":"Summary — ${mod.title}","order":10,"type":"video","content":"<p>Summary.</p>","duration":"5 min","points":["Summary 1","Summary 2","Next steps"],"tip":"Complete the quiz."}]
Lessons 2-9 must be type text with rich HTML: <h3>, <ul><li>, <blockquote>. No markdown.`
            : `Eres experto en diseño instruccional. Genera exactamente 10 lecciones para el módulo "${mod.title}" del curso "${blTitle}".
Devuelve ÚNICAMENTE un array JSON (10 elementos):
[{"title":"Introducción — ${mod.title}","order":1,"type":"video","content":"<p>Párrafo introductorio.</p>","duration":"5 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Consejo útil."},
{"title":"Subtema A","order":2,"type":"text","content":"<h3>Encabezado</h3><p>Párrafo.</p><ul><li>Punto A</li><li>Punto B</li></ul>","duration":"8 min","points":["Clave 1","Clave 2","Clave 3"],"tip":"Tip."},
{"title":"Resumen — ${mod.title}","order":10,"type":"video","content":"<p>Resumen.</p>","duration":"5 min","points":["Resumen 1","Resumen 2","Próximos pasos"],"tip":"Completa el quiz."}]
Lecciones 2-9 tipo text con HTML rico: <h3>, <ul><li>, <blockquote>. Sin markdown.`;

          const rawLessons = await invokeBedrockForJson(lessonPrompt, 5000);
          const lessons = Array.isArray(rawLessons) ? rawLessons.slice(0, 10) : [];
          if (lessons.length === 0) { failed.push(moduleId); continue; }

          await prisma.lesson.createMany({
            data: lessons.map((l: any, i: number) => ({
              moduleId,
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
          await prisma.module.update({ where: { id: moduleId }, data: { duration: `${lessons.length * 8} min` } });
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
      const prompt = isEN
        ? `You are an expert instructional designer. Generate a week-by-week curriculum plan.\n\nCOURSE: ${title}\nTYPE: ${courseType}\nDESCRIPTION: ${description}\nPERIOD: ${academicPeriod}\nMODALITY: ${modality}\nSCHEDULE: ${classSchedule} | Days: ${(classDays as string[]).join(', ')}\nTOTAL TEACHING WEEKS: ${effectiveWeeks} (out of ${totalWeeks} calendar weeks)\nSTART DATE: ${startDate}${exceptionNote}\n\nCONFIGURED EVALUATIONS:\n${evalSummary}\n\nSYLLABUS:\n${(syllabusInput as string).slice(0, 2500)}\n\nDistribute the syllabus progressively week by week. For weeks with evaluations, include the evaluation in evalEvent. Group topics into logical modules (3-6 modules). For each week include: procedure (suggested classroom activity) and notes (important observations, upcoming deadlines, or reminders).\n\nRespond ONLY with valid JSON (no markdown):\n${jsonFormat}`
        : `Eres un experto en diseño curricular. Genera un plan de estudios detallado semana por semana.\n\nCURSO: ${title}\nTIPO: ${courseType}\nDESCRIPCIÓN: ${description}\nPERÍODO: ${academicPeriod}\nMODALIDAD: ${modality}\nHORARIO: ${classSchedule} | Días: ${(classDays as string[]).join(', ')}\nSEMANAS LECTIVAS: ${effectiveWeeks} (de ${totalWeeks} semanas calendario)\nFECHA INICIO: ${startDate}${exceptionNote}\n\nEVALUACIONES CONFIGURADAS:\n${evalSummary}\n\nCONTENIDO / TEMARIO:\n${(syllabusInput as string).slice(0, 2500)}\n\nDistribuye el temario progresivamente semana a semana. Para semanas con evaluaciones, inclúyelas en evalEvent. Organiza los temas en módulos lógicos (3-6 módulos). Por cada semana incluye: procedure (actividad sugerida en clase) y notes (observaciones importantes, entregas próximas o recordatorios).\n\nResponde ÚNICAMENTE con JSON válido (sin markdown):\n${jsonFormat}`;

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
      pilotoAutomatico = false, syllabusInput = '',
    } = body as any;
    if (!title) return badRequest('title es requerido');

    const finalLabels: string[] = Array.isArray(cardLabels) ? [...cardLabels] : [];
    if (academicPeriod && !finalLabels.includes(academicPeriod)) finalLabels.unshift(academicPeriod);

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
      await prisma.evaluationEvent.deleteMany({ where: { courseId: course.id } }).catch((e: any) => console.error('[wizard/save] deleteMany eval events error:', e));
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

    // Sync evaluation due dates to calendar
    {
      if (editingCourseId) {
        await deleteWizardCalendarEvents(course.id).catch((e: any) => console.error('[wizard] calendar delete error:', e));
      }
      const calendarEventsToCreate: CalendarEvent[] = [];
      const now = new Date().toISOString();
      const wizCreatorId = `wiz-${course.id}`;
      for (const item of (evaluationItems as any[])) {
        const dueDates: string[] = Array.isArray(item.dueDates) ? item.dueDates.filter(Boolean) : [];
        for (const dueDate of dueDates) {
          const dayStart = new Date(dueDate + 'T08:00:00').toISOString();
          const dayEnd   = new Date(dueDate + 'T09:00:00').toISOString();
          calendarEventsToCreate.push({
            creatorId: wizCreatorId,
            eventId: `wiz-${course.id}-${Math.random().toString(36).slice(2, 8)}`,
            title: `${item.name || item.nameEN} — ${title}`,
            description: item.instructions || undefined,
            type: 'deadline', startDate: dayStart, endDate: dayEnd, allDay: true,
            visibility: 'community', creatorRole: callerRole, createdAt: now,
          });
        }
      }
      if (calendarEventsToCreate.length > 0) {
        await batchCreateCalendarEvents(calendarEventsToCreate).catch((e: any) => console.error('[wizard] calendar sync error:', e));
      }
    }

    // Generate Word document plan (non-fatal)
    let planDocumentS3Key: string | null = null;
    let docPublicUrl: string | null = null;
    try {
      const { default: docxPkg } = await import('docx') as any;
      const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, HeadingLevel } = docxPkg;
      const isEN = planLanguage === 'EN';
      const L = (es: string, en: string) => isEN ? en : es;
      const border = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
      const cellBorders = { top: border, bottom: border, left: border, right: border };
      const hCell = (text: string, shade = 'DBEAFE') => new TableCell({ shading: { fill: shade }, borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18 })] })] });
      const dCell = (text: string) => new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text, size: 18 })] })] });
      const startDateFmt = startDate ? new Date(startDate).toLocaleDateString(isEN ? 'en-US' : 'es-CR') : '—';
      const COURSE_TYPE_LABELS: Record<string, string> = { TEORICO: L('Teórico','Theoretical'), TEORICO_PRACTICO: L('Teórico-Práctico','Theoretical-Practical'), PROYECTOS: L('Taller / Proyectos','Workshop / Projects'), PROGRAMA_ESPECIAL: L('Programa Especial','Special Program'), CURSO_CORTO: L('Curso Corto','Short Course'), LIBRE: L('Curso Libre / Tutoría','Free Course / Tutoring') };
      const MODALITY_LABELS: Record<string, string> = { PRESENCIAL: L('Presencial','In-Person'), SINCRONICA: L('Sincrónica','Synchronous'), ASINCRONICA: L('Asincrónica','Asynchronous'), HIBRIDA: L('Híbrida','Hybrid') };
      const EVAL_TYPE_LABELS: Record<string, string> = { QUIZ: 'Quiz', EVIDENCE: L('Entrega','Submission'), EXAM: L('Examen','Exam'), ATTENDANCE: L('Asistencia','Attendance') };
      const infoRows = [[L('Nombre del curso','Course name'), title],[L('Tipo de curso','Course type'), COURSE_TYPE_LABELS[courseType] ?? courseType ?? '—'],[L('Modalidad','Modality'), MODALITY_LABELS[modality] ?? modality ?? '—'],[L('Período académico','Academic period'), academicPeriod || '—'],[L('Fecha de inicio','Start date'), startDateFmt],[L('Horario','Schedule'), classSchedule || '—'],[L('Días de clase','Class days'), (classDays as string[]).join(', ') || '—'],[L('Semanas lectivas','Teaching weeks'), String(totalWeeks || '—')]];
      const infoTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: infoRows.map(([k, v]) => new TableRow({ children: [hCell(k, 'EFF6FF'), dCell(v)] })) });
      const DAY_TO_JS: Record<string, number> = { 'Lunes':1,'Martes':2,'Miércoles':3,'Jueves':4,'Viernes':5,'Sábado':6,'Domingo':0 };
      const getClassDates = (weekIdx: number): string => {
        if (!startDate || !(classDays as string[]).length) return '';
        const base = new Date(startDate + 'T12:00:00'); const dow = base.getDay();
        const mondayOffset = dow === 0 ? -6 : 1 - dow;
        const weekMonday = new Date(base); weekMonday.setDate(base.getDate() + mondayOffset + weekIdx * 7);
        return (classDays as string[]).map((day: string) => { const offset = ((DAY_TO_JS[day] ?? 1) - 1 + 7) % 7; const d = new Date(weekMonday); d.setDate(weekMonday.getDate() + offset); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }).join(', ');
      };
      let bibliography: string[] = []; let guidelines: string[] = [];
      try {
        const moduleNames = (suggestedModules as any[]).map((m: any) => isEN ? (m.nameEN || m.name) : m.name).slice(0, 5);
        const extra = await invokeBedrockForJson(isEN ? `For a course titled "${title}" with modules: ${moduleNames.join(', ')}. Generate: 1) 4 academic bibliography references in APA format. 2) 4 general course guidelines. Respond ONLY with JSON: {"bibliography":["APA ref 1","APA ref 2","APA ref 3","APA ref 4"],"guidelines":["Rule 1.","Rule 2.","Rule 3.","Rule 4."]}` : `Para el curso "${title}" con módulos: ${moduleNames.join(', ')}. Genera: 1) 4 referencias bibliográficas en formato APA. 2) 4 indicaciones generales para estudiantes. Responde ÚNICAMENTE con JSON: {"bibliography":["Ref APA 1","Ref APA 2","Ref APA 3","Ref APA 4"],"guidelines":["Indicación 1.","Indicación 2.","Indicación 3.","Indicación 4."]}`, 1000);
        if (Array.isArray(extra?.bibliography)) bibliography = extra.bibliography;
        if (Array.isArray(extra?.guidelines)) guidelines = extra.guidelines;
      } catch { /* non-fatal */ }
      const evalRows = [new TableRow({ children: [hCell(L('Evaluación','Evaluation')), hCell(L('Tipo','Type')), hCell(L('Porcentaje','Percentage')), hCell(L('Habilidades por evaluar','Skills to Evaluate'))] }), ...(evaluationItems as any[]).map((it: any) => { const nameFmt = `${isEN ? (it.nameEN || it.name) : it.name}${(it.count ?? 1) > 1 ? ` (${it.count})` : ''}`; return new TableRow({ children: [dCell(nameFmt), dCell(EVAL_TYPE_LABELS[it.type] ?? it.type), dCell(`${it.weight ?? 0}%`), dCell(it.instructions || '')] }); }), new TableRow({ children: [hCell(L('TOTAL','TOTAL'), 'FEF9C3'), dCell(''), hCell(`${(evaluationItems as any[]).reduce((s: number, i: any) => s + (parseFloat(i.weight) || 0), 0)}%`, 'FEF9C3'), dCell('')] })];
      const evalTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: evalRows });
      const planRows = [new TableRow({ children: [hCell(L('Nº Semana','Wk#')), hCell(L('Fecha de clases','Class dates')), hCell(L('Habilidades (tópicos y subtópicos)','Skills (topics & subtopics)')), hCell(L('Módulo','Module')), hCell(L('Procedimiento','Procedure')), hCell(L('Observaciones','Notes'))] }), ...(weeklyPlan as any[]).map((wk: any) => { const classDatesStr = getClassDates(wk.weekNum - 1); const obsText = wk.evalEvent ? `${L('Entrega','Delivery')}: ${wk.evalEvent.name}` : (wk.notes || ''); return new TableRow({ children: [dCell(`${L('S','W')}${wk.weekNum}`), dCell(classDatesStr), dCell((wk.topics as string[]).join('; ')), dCell(wk.module || '—'), dCell(wk.procedure || ''), dCell(obsText)] }); })];
      const planTable = weeklyPlan.length > 0 ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: planRows }) : null;
      const h1 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, bold: true, size: 32, color: '17527E' })] });
      const h2 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true, size: 24, color: '17527E' })] });
      const spacer = () => new Paragraph({ children: [] });
      const docChildren: any[] = [h1(L('PLAN DE ESTUDIOS','COURSE PLAN')), new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 28 })] }), spacer(), h2(L('1. Datos Generales','1. General Information')), infoTable, spacer(), h2(L('2. Sistema de Evaluación','2. Evaluation System')), evalTable, spacer()];
      let sec = 2;
      if (planTable) { sec++; docChildren.push(h2(L(`${sec}. Cronograma Mensual de Habilidades`,`${sec}. Monthly Skills Schedule`))); docChildren.push(planTable); docChildren.push(spacer()); }
      if ((suggestedModules as any[]).length > 0) { sec++; docChildren.push(h2(L(`${sec}. Módulos del Curso`,`${sec}. Course Modules`))); for (const mod of suggestedModules as any[]) { docChildren.push(new Paragraph({ children: [new TextRun({ text: isEN ? (mod.nameEN || mod.name) : mod.name, bold: true, size: 22 })] })); docChildren.push(new Paragraph({ children: [new TextRun({ text: isEN ? (mod.descriptionEN || mod.description) : mod.description, size: 18 })] })); docChildren.push(spacer()); } }
      if (bibliography.length > 0) { sec++; docChildren.push(h2(L(`${sec}. Bibliografía`,`${sec}. Bibliography`))); for (const ref of bibliography) docChildren.push(new Paragraph({ children: [new TextRun({ text: `• ${ref}`, size: 18 })] })); docChildren.push(spacer()); }
      if (guidelines.length > 0) { sec++; docChildren.push(h2(L(`${sec}. Indicaciones Generales`,`${sec}. General Guidelines`))); for (const rule of guidelines) docChildren.push(new Paragraph({ children: [new TextRun({ text: `• ${rule}`, size: 18 })] })); docChildren.push(spacer()); }
      docChildren.push(h2(L('Revisado y Aprobado:','Reviewed and Approved:'))); docChildren.push(spacer()); docChildren.push(new Paragraph({ children: [new TextRun({ text: '_____________________      _____________________', size: 18 })] })); docChildren.push(new Paragraph({ children: [new TextRun({ text: L('Docente                                  Director Académico','Instructor                         Academic Director'), size: 18 })] })); docChildren.push(spacer());
      const doc = new Document({ sections: [{ children: docChildren }] });
      const buffer = await Packer.toBuffer(doc);
      const s3Key = `plans/${course.id}/plan-${planLanguage.toLowerCase()}.docx`;
      await s3Client.send(new PutObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: s3Key, Body: buffer, ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ContentDisposition: `attachment; filename="plan-${course.id}.docx"` }));
      planDocumentS3Key = s3Key;
      docPublicUrl = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: s3Key, ResponseContentDisposition: `attachment; filename="plan-${course.id}.docx"` }), { expiresIn: 604800 });
      await prisma.course.update({ where: { id: course.id }, data: { planDocumentS3Key: s3Key } });
      const now = new Date().toISOString();
      await saveResource({
        evaluatorId: ctx.userId ?? 'system',
        resourceId: `res-plan-${course.id}-${planLanguage.toLowerCase()}`,
        title: `Plan de Estudios — ${title}`,
        description: `Generado por Lux Planner (${planLanguage})`,
        fileUrl: `plan://${course.id}`,
        fileName: `plan-${course.id}.docx`,
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: buffer.byteLength,
        folder: 'Planes de Estudio',
        courseIds: [course.id],
        archived: false,
        createdAt: now,
        updatedAt: now,
      }).catch((e: any) => console.error('[wizard/save] saveResource error:', e));
    } catch (docErr) { console.error('[wizard/save] DOCX generation error:', docErr); }

    let lessonJobId: string | null = null;
    if (!editingCourseId) {
      const isEN_save = planLanguage === 'EN';
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
            })),
          }));
        } catch (invokeErr: any) {
          console.error('[wizard/save] lesson bulk invoke error:', invokeErr?.message);
          await saveAiJob(lessonJobId, { status: 'error', error: 'No se pudo iniciar la generación de lecciones' });
          lessonJobId = null;
        }
      }

      await upsertChat(`group_${course.id}`, { type: 'GROUP', name: `Curso: ${courseTitle}`, participants: [] }).catch(() => {});
    }

    // Generate CourseSession records from schedule
    if (!editingCourseId && startDate && Array.isArray(classDays) && classDays.length > 0 && totalWeeks) {
      try {
        const dayNameToIndex: Record<string, number> = { Domingo:0, Lunes:1, Martes:2, Miércoles:3, Jueves:4, Viernes:5, Sábado:6, Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
        const classDayIndices = (classDays as string[]).map((d: string) => dayNameToIndex[d]).filter((n) => n !== undefined) as number[];
        const exceptionDates = new Set((calendarExceptions as any[]).filter((ex: any) => ex.type === 'day' && ex.date).map((ex: any) => ex.date.split('T')[0]));
        const exceptionWeekIdxs = new Set((calendarExceptions as any[]).filter((ex: any) => ex.type === 'week' && ex.weekIndex != null).map((ex: any) => ex.weekIndex as number));
        const sessions: Array<{ courseId: string; sessionDate: Date; weekIndex: number; order: number }> = [];
        let order = 1;
        for (let w = 0; w < (totalWeeks as number); w++) {
          if (exceptionWeekIdxs.has(w)) continue;
          for (const dayIdx of classDayIndices) {
            const weekStart = new Date(startDate); weekStart.setDate(weekStart.getDate() + w * 7);
            const diff = (dayIdx - weekStart.getDay() + 7) % 7;
            const sessionDate = new Date(weekStart); sessionDate.setDate(weekStart.getDate() + diff);
            const isoDate = sessionDate.toISOString().split('T')[0]!;
            if (exceptionDates.has(isoDate)) continue;
            sessions.push({ courseId: course.id, sessionDate, weekIndex: w, order: order++ });
          }
        }
        if (sessions.length > 0) await prisma.courseSession.createMany({ data: sessions });
      } catch (sessErr) { console.error('[wizard/save] courseSession error:', sessErr); }
    }

    return editingCourseId
      ? ok({ courseId: course.id, slug: course.slug, docUrl: docPublicUrl, isDraft: false, lessonJobId })
      : created({ courseId: course.id, slug: course.slug, docUrl: docPublicUrl, isDraft: true, lessonJobId });
  }

  return null; // not handled by this domain
}
