// ─── study-plans/plans.ts ────────────────────────────────────────────────────
// Student CRUD routes for weekly study plans.
import { createId } from '@paralleldrive/cuid2';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { ok, badRequest } from '../shared/response';
import {
  getStudyPlan, getStudyPlans, saveStudyPlan, updateStudyPlanField,
  getMonday, getStudyPlanPrefs, saveStudyPlanPrefs,
  type StudyPlan, type DayPlan, type PlanItem,
} from '../shared/db-study-plans';
import { createNotification, getEnrollments, getLessonProgress, getAllQuizAttemptsForUser } from '../shared/db-dynamo';
import { isModuleUnlocked } from '../shared/db-progress';
import { getPrismaClient } from '../shared/db-neon';
import { extractYoutubeId, isYoutubeVideoAvailable } from '../shared/youtube';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

type Ctx = { method: string; path: string; body: any; userId: string; event: any };

// Build an empty 7-day grid for a given weekOf (Monday ISO date)
function buildEmptyDays(weekOf: string): DayPlan[] {
  const days: DayPlan[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekOf + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    days.push({ dayIndex: i, date: d.toISOString().slice(0, 10), items: [] });
  }
  return days;
}

/** Parse "12 min" → 12, "8 min" → 8, etc. Fallback to 30 if unparseable. */
function parseDurationMin(raw?: string | null): number {
  if (!raw) return 30;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** Sync lesson/quiz completion from real DDB progress into plan items (in-memory only; persists if changed). */
async function syncPlanCompletion(userId: string, plan: StudyPlan): Promise<StudyPlan> {
  const courseIds = [...new Set(
    plan.days.flatMap((d) => d.items.map((i) => i.courseId).filter(Boolean) as string[])
  )];
  if (courseIds.length === 0) return plan;

  const [progressResults, quizAttempts] = await Promise.all([
    Promise.all(courseIds.map((cid) => getLessonProgress(userId, cid))),
    getAllQuizAttemptsForUser(userId),
  ]);
  const completedLessonIds = new Set(progressResults.flat().map((p: any) => p.lessonId as string));
  const passedModuleIds = new Set(quizAttempts.filter((a: any) => a.passed).map((a: any) => a.moduleId as string));

  let changed = false;
  const syncedDays = plan.days.map((d) => ({
    ...d,
    items: d.items.map((item) => {
      let newCompleted = item.completed;
      if (!item.completed) {
        if (item.type === 'lesson' && item.lessonId && completedLessonIds.has(item.lessonId)) newCompleted = true;
        else if (item.type === 'quiz' && item.moduleId && passedModuleIds.has(item.moduleId)) newCompleted = true;
      }
      if (newCompleted !== item.completed) { changed = true; return { ...item, completed: newCompleted }; }
      return item;
    }),
  }));

  if (changed) {
    await updateStudyPlanField(userId, plan.weekOf, { days: syncedDays, updatedAt: new Date().toISOString() });
    return { ...plan, days: syncedDays };
  }
  return plan;
}

/** Auto-populate a plan from course progress — used for student self-generation */
async function buildPlanItems(userId: string): Promise<{ days: DayPlan[]; promptLines: string[] }> {
  const prisma = await getPrismaClient();
  const weekOf = getMonday();
  const days = buildEmptyDays(weekOf);

  const [courseIds, quizAttempts] = await Promise.all([
    getEnrollments(userId),
    getAllQuizAttemptsForUser(userId),
  ]);
  if (courseIds.length === 0) return { days, promptLines: [] };

  const courses = await prisma.course.findMany({
    where: { id: { in: courseIds } },
    include: { modules: { orderBy: { order: 'asc' }, include: { lessons: { select: { id: true, title: true, duration: true }, orderBy: { order: 'asc' } } } } },
  });

  const progressResults = await Promise.all(courseIds.map((cid: string) => getLessonProgress(userId, cid)));
  const completedLessonIds = new Set(progressResults.flat().map((p: any) => p.lessonId));
  const passedModuleIds = new Set(quizAttempts.filter((a: any) => a.passed).map((a: any) => a.moduleId));

  const promptLines: string[] = [];
  let dayIndex = 0;

  for (const course of courses) {
    promptLines.push(`Curso: ${course.title}`);
    const moduleRefs = (course as any).modules.map((m: any) => ({ id: m.id, order: m.order }));

    for (const mod of (course as any).modules) {
      // Only include content from modules the student can actually access
      const unlocked = await isModuleUnlocked(userId, mod.order, moduleRefs);
      if (!unlocked) break; // Sequential lock — all further modules are also locked

      const quizPassed = passedModuleIds.has(mod.id);
      if (quizPassed) continue; // Already finished this module

      const pendingLessons = mod.lessons.filter((l: any) => !completedLessonIds.has(l.id));
      const needsQuiz = pendingLessons.length === 0 && !quizPassed;

      promptLines.push(`  Módulo ${mod.order}: ${mod.title} (${course.title})`);

      if (pendingLessons.length > 0) {
        // Distribute pending lessons across Mon–Fri
        for (const lesson of pendingLessons.slice(0, 5)) {
          const targetDay = Math.min(dayIndex % 5, 4);
          days[targetDay].items.push({
            id: createId(),
            type: 'lesson',
            title: lesson.title,
            description: `${mod.title} · ${course.title}`,
            courseId: course.id,
            moduleId: mod.id,
            lessonId: lesson.id,
            pinned: false,
            completed: false,
            estimatedMinutes: parseDurationMin((lesson as any).duration),
            source: 'auto',
          });
          dayIndex++;
          promptLines.push(`    Lección pendiente: ${lesson.title}`);
        }
      }

      if (needsQuiz) {
        const targetDay = Math.min(dayIndex % 5, 4);
        days[targetDay].items.push({
          id: createId(),
          type: 'quiz',
          title: `Quiz — ${mod.title}`,
          description: `${course.title}`,
          courseId: course.id,
          moduleId: mod.id,
          pinned: false,
          completed: false,
          estimatedMinutes: 20,
          source: 'auto',
        });
        dayIndex++;
        promptLines.push(`    Quiz pendiente`);
      }
    }
  }

  return { days, promptLines };
}

async function triggerSuggestionsJob(userId: string, weekOf: string, promptLines: string[]): Promise<string> {
  const jobId = `splan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await updateStudyPlanField(userId, weekOf, { suggestionsStatus: 'processing' });

  const payload = {
    _studyPlanSuggestionsWorker: true,
    userId, weekOf, jobId,
    promptLines,
  };
  await lambda.send(new LambdaInvokeCommand({
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
  return jobId;
}

export async function runSuggestionsWorker(userId: string, weekOf: string, promptLines: string[]): Promise<void> {
  try {
    const context = promptLines.join('\n');
    const prompt = `Eres el Mentor de Lux Learning. El estudiante tiene este contenido pendiente esta semana:\n\n${context}\n\nGenera exactamente 5 sugerencias de "Sugerencias de Mentor" que le ayuden a avanzar CON LO QUE TIENE DISPONIBLE AHORA.\n\nREGLAS ESTRICTAS:\n- Solo recursos 100% educativos y verificados: Khan Academy, Coursera (cursos gratuitos), MIT OpenCourseWare, YouTube EDU (3Blue1Brown, CrashCourse, Professor Leonard, StatQuest, Organic Chemistry Tutor, etc.), libros clásicos de dominio público\n- NO inventes URLs. Si no conoces la URL exacta del recurso, omite el campo "url"\n- Mezcla obligatoria:\n  * 2 recursos externos concretos sobre los TEMAS del contenido pendiente (video de YouTube EDU o artículo verificado)\n  * 1 libro o lectura complementaria relacionada con el tema\n  * 2 estrategias de estudio accionables y realistas\n- Las estrategias deben ser específicas al material Y al tiempo disponible (ej: "Si tienes 30 min al día: completa una lección por día y reserva el viernes para el quiz")\n- Si el estudiante tiene material atrasado, incluye una estrategia de recuperación concreta y motivadora\n- Priorización dinámica: si hay mucho contenido, sugiere qué hacer primero según impacto en el avance del curso\n- Sin lenguaje profano, sin fuentes dudosas, sin contenido inapropiado\n- description: máx 2 frases, práctica y directa\n\nResponde SOLO con JSON array válido, sin texto extra:\n[{"title":"...","type":"article|video|exercise|book|strategy","description":"...","url":"..."},...]`;

    const res = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    }));
    const parsed = JSON.parse(new TextDecoder().decode(res.body));
    const raw = parsed.content?.[0]?.text?.trim() ?? '[]';
    const jsonStart = raw.indexOf('[');
    const jsonEnd = raw.lastIndexOf(']');
    const suggestions = jsonStart >= 0 && jsonEnd > jsonStart
      ? JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
      : [];

    // The prompt tells the model not to invent URLs, but an LLM has no way to actually
    // know whether a specific video is still live — it can hallucinate a well-formed,
    // plausible YouTube link to a video that's removed/private/never existed. Verify every
    // YouTube link before showing it to the student instead of trusting it blindly (Trello
    // Nk0XDBvJ comment 6a926aaa: "me está llevando a enlaces... válidos, pero el video no
    // se encuentra disponible"). A dead link just loses its url — the title/description
    // still stands as guidance, so nothing is silently dropped.
    const verifiedSuggestions = Array.isArray(suggestions)
      ? await Promise.all((suggestions as any[]).slice(0, 5).map(async (s) => {
          if (s?.type !== 'video' || !s?.url) return s;
          const videoId = extractYoutubeId(s.url);
          const available = videoId ? await isYoutubeVideoAvailable(videoId) : false;
          return available ? s : { ...s, url: undefined };
        }))
      : [];

    await updateStudyPlanField(userId, weekOf, {
      bedrockSuggestions: verifiedSuggestions,
      suggestionsStatus: 'done',
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[StudyPlan] Suggestions worker error:', err);
    await updateStudyPlanField(userId, weekOf, { suggestionsStatus: 'error', updatedAt: new Date().toISOString() });
  }
}

export async function handleStudyPlans(ctx: Ctx): Promise<any | null> {
  const { method, path, body, userId } = ctx;

  // GET /study-plan?weeks=N — list last N weeks (default 4)
  if (method === 'GET' && path === '/study-plan') {
    const weeksParam = ctx.event.queryStringParameters?.weeks;
    const weeks = Math.min(parseInt(weeksParam ?? '4', 10), 12);
    const plans = await getStudyPlans(userId, weeks);
    return ok(plans);
  }

  // GET /study-plan/current — current week (auto-create if missing)
  if (method === 'GET' && path === '/study-plan/current') {
    const weekOf = getMonday();
    let plan = await getStudyPlan(userId, weekOf);
    if (!plan) {
      const { days, promptLines } = await buildPlanItems(userId);
      plan = {
        userId, weekOf,
        planId: createId(),
        days,
        generatedBy: 'student',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveStudyPlan(plan);
      // Kick off suggestions async
      if (promptLines.length > 0) {
        triggerSuggestionsJob(userId, weekOf, promptLines).catch(() => {});
      }
    } else {
      // Sync lesson/quiz completion from real progress
      plan = await syncPlanCompletion(userId, plan);

      if (!plan.suggestionsStatus || plan.suggestionsStatus === 'error') {
        // Plan exists but has no suggestions or previous attempt errored — trigger/retry
        const totalItems = plan.days.reduce((s, d) => s + d.items.length, 0);
        if (totalItems > 0) {
          const promptLines = plan.days.flatMap((d) =>
            d.items.map((i) => `${i.type}: ${i.title}${i.description ? ` (${i.description})` : ''}`)
          );
          triggerSuggestionsJob(userId, weekOf, promptLines).catch(() => {});
          plan = { ...plan, suggestionsStatus: 'processing' };
        }
      }
    }
    return ok(plan);
  }

  // GET /study-plan/suggestions — poll suggestions status for current week
  if (method === 'GET' && path === '/study-plan/suggestions') {
    const weekOf = getMonday();
    const plan = await getStudyPlan(userId, weekOf);
    if (!plan) return ok({ status: 'none', suggestions: [] });
    return ok({
      status: plan.suggestionsStatus ?? 'none',
      suggestions: plan.bedrockSuggestions ?? [],
    });
  }

  // PUT /study-plan/:weekOf/items/:itemId — toggle pin / complete
  const itemMatch = path.match(/^\/study-plan\/(\d{4}-\d{2}-\d{2})\/items\/([^/]+)$/);
  if (itemMatch && method === 'PUT') {
    const [, weekOf, itemId] = itemMatch;
    const plan = await getStudyPlan(userId, weekOf!);
    if (!plan) return badRequest('Plan not found');
    if (plan.lockedBy && plan.lockedBy !== userId) return badRequest('Plan bloqueado por evaluador — solicita cambio');

    const { pinned, completed } = body as { pinned?: boolean; completed?: boolean };
    const days = plan.days.map((d) => ({
      ...d,
      items: d.items.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          ...(pinned !== undefined ? { pinned } : {}),
          ...(completed !== undefined ? { completed } : {}),
        };
      }),
    }));
    await updateStudyPlanField(userId, weekOf!, { days, updatedAt: new Date().toISOString() });
    return ok({ updated: true });
  }

  // POST /study-plan/:weekOf/items — add custom item
  const addItemMatch = path.match(/^\/study-plan\/(\d{4}-\d{2}-\d{2})\/items$/);
  if (addItemMatch && method === 'POST') {
    const [, weekOf] = addItemMatch;
    const plan = await getStudyPlan(userId, weekOf!);
    if (!plan) return badRequest('Plan not found');
    if (plan.lockedBy && plan.lockedBy !== userId) return badRequest('Plan bloqueado por evaluador — solicita cambio');

    const { dayIndex, title, description, type, estimatedMinutes, courseId, moduleId, lessonId } = body;
    if (typeof dayIndex !== 'number' || !title) return badRequest('dayIndex y title requeridos');
    const idx = Math.max(0, Math.min(6, dayIndex));
    const newItem: PlanItem = {
      id: createId(),
      type: type ?? 'custom',
      title: String(title).slice(0, 120),
      description: description ? String(description).slice(0, 300) : undefined,
      courseId, moduleId, lessonId,
      pinned: false, completed: false,
      estimatedMinutes: estimatedMinutes ?? 30,
      source: 'student',
    };
    const days = plan.days.map((d, i) =>
      i === idx ? { ...d, items: [...d.items, newItem] } : d
    );
    await updateStudyPlanField(userId, weekOf!, { days, updatedAt: new Date().toISOString() });
    return ok({ item: newItem });
  }

  // DELETE /study-plan/:weekOf/items/:itemId
  const delMatch = path.match(/^\/study-plan\/(\d{4}-\d{2}-\d{2})\/items\/([^/]+)$/);
  if (delMatch && method === 'DELETE') {
    const [, weekOf, itemId] = delMatch;
    const plan = await getStudyPlan(userId, weekOf!);
    if (!plan) return badRequest('Plan not found');
    if (plan.lockedBy && plan.lockedBy !== userId) return badRequest('Plan bloqueado — solicita cambio');

    const days = plan.days.map((d) => ({ ...d, items: d.items.filter((i) => i.id !== itemId) }));
    await updateStudyPlanField(userId, weekOf!, { days, updatedAt: new Date().toISOString() });
    return ok({ deleted: true });
  }

  // GET /study-plan/preferences — return student's study preferences
  if (method === 'GET' && path === '/study-plan/preferences') {
    const prefs = await getStudyPlanPrefs(userId);
    return ok(prefs ?? { hoursPerDay: 2 });
  }

  // PUT /study-plan/preferences — save study preferences
  if (method === 'PUT' && path === '/study-plan/preferences') {
    const { hoursPerDay } = body as { hoursPerDay?: number };
    if (!hoursPerDay || ![1, 2, 3].includes(hoursPerDay)) return badRequest('hoursPerDay debe ser 1, 2 o 3');
    await saveStudyPlanPrefs({ userId, hoursPerDay: hoursPerDay as 1 | 2 | 3 });
    return ok({ saved: true, hoursPerDay });
  }

  // GET /study-plan/current/ics — export current week plan as iCalendar
  if (method === 'GET' && path === '/study-plan/current/ics') {
    const weekOf = getMonday();
    const plan = await getStudyPlan(userId, weekOf);
    if (!plan) return ok({ ics: '', filename: `plan-${weekOf}.ics` });

    const typeLabel: Record<string, string> = {
      lesson: 'Lección', quiz: 'Quiz', reflection: 'Reflexión', review: 'Repaso', custom: 'Tarea',
    };
    const lines: string[] = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'PRODID:-//Lux Learning//Plan de Estudio//ES',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ];

    for (const day of plan.days) {
      for (const item of day.items) {
        if (item.completed) continue;
        const start = new Date(day.date + 'T09:00:00Z');
        const end = new Date(start.getTime() + (item.estimatedMinutes ?? 30) * 60000);
        const fmt = (d: Date) => d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
        lines.push('BEGIN:VEVENT');
        lines.push(`DTSTART:${fmt(start)}`);
        lines.push(`DTEND:${fmt(end)}`);
        lines.push(`SUMMARY:[${typeLabel[item.type] ?? item.type}] ${item.title}`);
        if (item.description) lines.push(`DESCRIPTION:${item.description.replace(/[,;\n]/g, (c) => c === '\n' ? '\\n' : `\\${c}`)}`);
        lines.push(`UID:${item.id}@luxlearning.academy`);
        lines.push('END:VEVENT');
      }
    }
    lines.push('END:VCALENDAR');
    return ok({ ics: lines.join('\r\n'), filename: `plan-semana-${weekOf}.ics` });
  }

  // POST /study-plan/request-change — student requests unlock from evaluator
  if (method === 'POST' && path === '/study-plan/request-change') {
    const { weekOf, note } = body as { weekOf?: string; note?: string };
    const targetWeek = weekOf ?? getMonday();
    const plan = await getStudyPlan(userId, targetWeek);
    if (!plan) return badRequest('Plan not found');
    if (!plan.lockedBy) return ok({ alreadyUnlocked: true });

    await updateStudyPlanField(userId, targetWeek, {
      changeRequested: true,
      changeRequestNote: note ? String(note).slice(0, 400) : undefined,
      updatedAt: new Date().toISOString(),
    });

    // Notify evaluator
    await createNotification({
      userId: plan.lockedBy,
      notifId: `splan-chg-${createId()}`,
      type: 'STUDY_PLAN_CHANGE_REQUEST',
      message: `Un estudiante solicitó modificar su plan de estudio (semana ${targetWeek})${note ? `: "${note}"` : ''}`,
      actionUrl: `/evaluator/students?userId=${userId}`,
      read: false,
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    return ok({ requested: true });
  }

  return null;
}
