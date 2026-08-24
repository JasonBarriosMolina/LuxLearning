// Support module for admin/ai-wizard.ts — split out to respect the 600-line domain limit.
// Handles: Word plan document generation (docx) and course session record creation.
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { saveResource, batchCreateCalendarEvents, deleteWizardCalendarEvents } from '../shared/db-dynamo';
import type { CalendarEvent } from '../shared/db-calendar';
import { AdminCtx, S3_IMAGES_BUCKET, s3Client, invokeBedrockForJson } from './ctx';

interface WizardCalendarSyncParams {
  courseId: string;
  courseTitle: string;
  editingCourseId?: string | null;
  evaluationItems: any[];
  callerRole: string;
}

/** Deletes and re-creates wizard-managed calendar deadline events from the evaluation plan. */
export async function syncWizardCalendarEvents(p: WizardCalendarSyncParams): Promise<void> {
  const { courseId, courseTitle, editingCourseId, evaluationItems, callerRole } = p;
  if (editingCourseId) {
    await deleteWizardCalendarEvents(courseId).catch((e: any) => console.error('[wizard] calendar delete error:', e));
  }
  const calendarEventsToCreate: CalendarEvent[] = [];
  const now = new Date().toISOString();
  const wizCreatorId = `wiz-${courseId}`;
  for (const item of evaluationItems) {
    const dueDates: string[] = Array.isArray(item.dueDates) ? item.dueDates.filter(Boolean) : [];
    for (const dueDate of dueDates) {
      const dayStart = new Date(dueDate + 'T08:00:00').toISOString();
      const dayEnd = new Date(dueDate + 'T09:00:00').toISOString();
      calendarEventsToCreate.push({
        creatorId: wizCreatorId,
        eventId: `wiz-${courseId}-${Math.random().toString(36).slice(2, 8)}`,
        title: `${item.name || item.nameEN} — ${courseTitle}`,
        description: item.instructions || undefined,
        type: 'deadline', startDate: dayStart, endDate: dayEnd, allDay: true,
        visibility: 'community', creatorRole: callerRole, createdAt: now,
        targetCourseId: courseId,
      });
    }
  }
  if (calendarEventsToCreate.length > 0) {
    await batchCreateCalendarEvents(calendarEventsToCreate).catch((e: any) => console.error('[wizard] calendar sync error:', e));
  }
}

interface WizardDocParams {
  course: { id: string; slug: string; planDocumentS3Key?: string | null };
  title: string;
  courseType?: string;
  academicPeriod?: string;
  classDays: string[];
  classSchedule?: string;
  modality?: string;
  startDate?: string;
  totalWeeks?: number;
  planLanguage: string;
  evaluationItems: any[];
  suggestedModules: any[];
  weeklyPlan: any[];
}

/**
 * Generates the official Word plan document for a wizard-created course, uploads it to S3,
 * and registers it as a resource. Non-fatal — returns null docPublicUrl on any failure.
 */
export async function generateWizardPlanDocument(ctx: AdminCtx, p: WizardDocParams): Promise<{ docPublicUrl: string | null }> {
  const { prisma } = ctx;
  const { course, title, courseType, academicPeriod, classDays, classSchedule, modality, startDate, totalWeeks, planLanguage, evaluationItems, suggestedModules, weeklyPlan } = p;
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
    const infoRows = [[L('Nombre del curso','Course name'), title],[L('Tipo de curso','Course type'), COURSE_TYPE_LABELS[courseType ?? ''] ?? courseType ?? '—'],[L('Modalidad','Modality'), MODALITY_LABELS[modality ?? ''] ?? modality ?? '—'],[L('Período académico','Academic period'), academicPeriod || '—'],[L('Fecha de inicio','Start date'), startDateFmt],[L('Horario','Schedule'), classSchedule || '—'],[L('Días de clase','Class days'), (classDays as string[]).join(', ') || '—'],[L('Semanas lectivas','Teaching weeks'), String(totalWeeks || '—')]];
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

  // If DOCX generation failed but course already has a planDocumentS3Key (edit mode),
  // return a fresh signed URL for the existing document so the download link persists.
  if (!docPublicUrl && course.planDocumentS3Key) {
    try {
      docPublicUrl = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: course.planDocumentS3Key, ResponseContentDisposition: `attachment; filename="plan-${course.id}.docx"` }), { expiresIn: 604800 });
    } catch { /* non-fatal — download link just won't appear */ }
  }
  return { docPublicUrl };
}

interface WizardSessionParams {
  prisma: AdminCtx['prisma'];
  courseId: string;
  startDate: string;
  classDays: string[];
  totalWeeks: number;
  calendarExceptions: any[];
}

/** Generates CourseSession records from the wizard schedule for a brand-new course. */
export async function createWizardCourseSessions(p: WizardSessionParams): Promise<void> {
  const { prisma, courseId, startDate, classDays, totalWeeks, calendarExceptions } = p;
  try {
    const dayNameToIndex: Record<string, number> = { Domingo:0, Lunes:1, Martes:2, Miércoles:3, Jueves:4, Viernes:5, Sábado:6, Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
    const classDayIndices = (classDays as string[]).map((d: string) => dayNameToIndex[d]).filter((n) => n !== undefined) as number[];
    const exceptionDates = new Set((calendarExceptions as any[]).filter((ex: any) => ex.type === 'day' && ex.date).map((ex: any) => ex.date.split('T')[0]));
    const exceptionWeekIdxs = new Set((calendarExceptions as any[]).filter((ex: any) => ex.type === 'week' && ex.weekIndex != null).map((ex: any) => ex.weekIndex as number));
    const sessions: Array<{ courseId: string; sessionDate: Date; weekIndex: number; order: number }> = [];
    let order = 1;
    for (let w = 0; w < totalWeeks; w++) {
      if (exceptionWeekIdxs.has(w)) continue;
      for (const dayIdx of classDayIndices) {
        const weekStart = new Date(startDate); weekStart.setDate(weekStart.getDate() + w * 7);
        const diff = (dayIdx - weekStart.getDay() + 7) % 7;
        const sessionDate = new Date(weekStart); sessionDate.setDate(weekStart.getDate() + diff);
        const isoDate = sessionDate.toISOString().split('T')[0]!;
        if (exceptionDates.has(isoDate)) continue;
        sessions.push({ courseId, sessionDate, weekIndex: w, order: order++ });
      }
    }
    if (sessions.length > 0) await prisma.courseSession.createMany({ data: sessions });
  } catch (sessErr) { console.error('[wizard/save] courseSession error:', sessErr); }
}
