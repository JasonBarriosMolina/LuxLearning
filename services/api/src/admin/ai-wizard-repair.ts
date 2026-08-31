// ─── ai-wizard-repair.ts ──────────────────────────────────────────────────────
// Verification/repair/notification helpers for the Lux Planner bulk-generation
// worker, split out of ai-wizard-worker.ts to stay under the domain-module line
// limit (CLAUDE.md: ≤600 lines) — this file grew again adding the audio-generation
// dispatch call (Trello DmPpbrff item 4, 2026-08-30).
import webpush from 'web-push';
import { createId } from '@paralleldrive/cuid2';
import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { SendEmailCommand } from '@aws-sdk/client-ses';
import { createNotification, getPushSubscriptionsByUserId } from '../shared/db-dynamo';
import {
  AdminCtx, shuffleQuestionOptions, invokeBedrockForJson,
  ses, cognito, FROM_EMAIL, FRONTEND_URL, USER_POOL_ID,
} from './ctx';
import { lessonDurationLabel } from '../shared/reading-time';

async function sendPushAndInApp(userId: string, type: 'GENERAL' | 'COURSE_READY_FOR_REVIEW', message: string, courseId: string): Promise<void> {
  await createNotification({
    userId, notifId: createId(), type, message, read: false,
    createdAt: new Date().toISOString(), actionUrl: `/admin/courses/${courseId}`,
  });
  // lux-admin's VAPID keys are plain Lambda env vars (not Secrets Manager) — see CLAUDE.md.
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL;
  if (!vapidPublic || !vapidPrivate || !vapidEmail) return; // env vars unset — in-app notification above still landed
  webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);
  const subs = await getPushSubscriptionsByUserId(userId);
  if (!subs.length) return;
  const payload = JSON.stringify({ title: 'Lux Learning', body: message, url: `/admin/courses/${courseId}` });
  await Promise.allSettled(subs.map((sub: any) => webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)));
}

/** Notifies the course creator (in-app + push) once course generation truly finishes —
 *  Jason, 2026-08-30: no completion signal exists today, the wizard just shows a static
 *  "ready in a few minutes" message forever. Non-fatal: a notification failure must never
 *  fail the job itself, which already succeeded or gave an honest partial result.
 *
 *  Also notifies the course's evaluator (email + push + in-app) that it's ready to
 *  review and activate, when that's a different person from whoever ran the wizard —
 *  Trello DmPpbrff item 8 (2026-08-30 20:30): "notificar... cuando el curso está listo
 *  para poder ser revisado... para que el curso se active y esté disponible." */
export async function notifyCourseGenerationDone(
  creatorUserId: string | undefined, courseId: string, courseTitle: string, isEN: boolean, incomplete: boolean,
  evaluatorId?: string | null,
): Promise<void> {
  const message = incomplete
    ? (isEN
      ? `⚠️ "${courseTitle}" is ready, but some modules need manual review (generation attempts exhausted).`
      : `⚠️ "${courseTitle}" está listo, pero algunos módulos necesitan revisión manual (se agotaron los intentos de generación).`)
    : (isEN
      ? `✅ "${courseTitle}" is 100% ready — all lessons and quizzes were generated successfully.`
      : `✅ "${courseTitle}" está 100% listo — todas las lecciones y quices se generaron correctamente.`);

  if (creatorUserId) {
    try {
      await sendPushAndInApp(creatorUserId, 'GENERAL', message, courseId);
    } catch (e) {
      console.error('[wizard-lessons-bulk] completion notification failed (non-fatal):', e);
    }
  }

  if (evaluatorId && evaluatorId !== creatorUserId) {
    const reviewMessage = isEN
      ? `📋 "${courseTitle}" is ready for review — check it and activate it when approved.`
      : `📋 "${courseTitle}" está listo para revisión — revísalo y actívalo cuando esté aprobado.`;
    try {
      await sendPushAndInApp(evaluatorId, 'COURSE_READY_FOR_REVIEW', reviewMessage, courseId);
      const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: evaluatorId }));
      const email = res.UserAttributes?.find((a) => a.Name === 'email')?.Value;
      if (email) {
        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Data: isEN ? `📋 "${courseTitle}" is ready for review` : `📋 "${courseTitle}" está listo para revisión`, Charset: 'UTF-8' },
            Body: { Html: { Data: `<p>${reviewMessage}</p><p><a href="${FRONTEND_URL}/admin/courses/${courseId}">${isEN ? 'Open course' : 'Abrir curso'}</a></p>`, Charset: 'UTF-8' } },
          },
        }));
      }
    } catch (e) {
      console.error('[wizard-lessons-bulk] evaluator ready-for-review notification failed (non-fatal):', e);
    }
  }
}

/**
 * Convert residual Markdown artifacts to HTML so lesson content renders cleanly.
 * AI models sometimes ignore the "no markdown" instruction — this catches the most common cases.
 */
export function sanitizeLessonContent(raw: string): string {
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
export async function generateAndSaveQuizQuestions(
  prisma: AdminCtx['prisma'], moduleId: string, moduleTitle: string, isEN: boolean
): Promise<void> {
  const qPrompt = isEN
    ? `Generate exactly 10 multiple-choice questions about "${moduleTitle}". JSON array: [{"text":"Question?","options":["A","B","C","D"],"correctIndex":0,"order":1}] No markdown.`
    : `Genera exactamente 10 preguntas de opción múltiple sobre "${moduleTitle}". Array JSON: [{"text":"¿Pregunta?","options":["A","B","C","D"],"correctIndex":0,"order":1}] Sin markdown.`;
  let rawQ = await invokeBedrockForJson(qPrompt, 4000);
  // Retry once if the model returned nothing usable — a planned quiz silently ending up
  // with 0 questions was one of the reliability complaints in Trello DmPpbrff comment
  // 6a9232ef ("se están creando quizzes automáticos... sin preguntas"). Mirrors the
  // retry-on-truncation safety net already used for lesson generation (Bug B fix).
  if (!Array.isArray(rawQ) || rawQ.length === 0) {
    console.warn(`[generateAndSaveQuizQuestions] module ${moduleId}: empty/invalid response, retrying once`);
    rawQ = await invokeBedrockForJson(qPrompt, 4000).catch(() => null);
  }
  const questions = shuffleQuestionOptions(Array.isArray(rawQ) ? rawQ.slice(0, 10) : []);
  if (questions.length === 0) {
    console.error(`[generateAndSaveQuizQuestions] module ${moduleId}: failed to generate questions after retry`);
  }
  if (questions.length > 0) {
    await prisma.question.createMany({
      data: questions.map((q: any, i: number) => ({
        moduleId, text: q.text, options: q.options,
        correctIndex: Number(q.correctIndex), order: i + 1,
      })),
    });
  }
}

/** True only for the exact placeholder text used when a lesson's content couldn't be
 *  generated — real lesson content never legitimately contains this emoji, so it's a
 *  reliable, language-agnostic marker for "this lesson still needs repair". */
export function isPlaceholderContent(content: string | null | undefined): boolean {
  return !!content && content.includes('⚠');
}

/** Verifies a module's lessons + (if planned) quiz are genuinely complete, and repairs
 *  whatever isn't — targeted regeneration of just the placeholder lesson slots (by
 *  position, updated in place; never re-creates rows that are already fine) and a quiz
 *  retry if one was planned but still has 0 questions. Returns true once the module is
 *  verified complete (either it already was, or the repair succeeded).
 *
 *  This is the "sí o sí" completeness guarantee requested after Jason's report (2026-08-30):
 *  the in-line retry-once inside processModule() gives up after a single extra attempt and
 *  leaves the placeholder/empty-quiz state permanently if that also fails. This function is
 *  called in bounded sweep rounds AFTER the main batch loop finishes, so a module that still
 *  needed help gets more real attempts before the job is ever reported "done". */
export async function verifyAndRepairModule(
  prisma: AdminCtx['prisma'], moduleId: string, courseTitle: string, isEN: boolean, quizPlanned: boolean,
  regenerateFromScratch: () => Promise<void>,
): Promise<boolean> {
  const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true } });
  if (!mod) return true; // module was deleted/never created — nothing to verify

  let lessons = await prisma.lesson.findMany({ where: { moduleId }, orderBy: { order: 'asc' } });
  // No lesson rows at all means the module's processModule() call threw before ever
  // reaching createMany (e.g. a transient error on the very first Bedrock call) — there's
  // nothing to target-repair, so re-run the whole per-module generation from scratch.
  if (lessons.length === 0) {
    await regenerateFromScratch();
    lessons = await prisma.lesson.findMany({ where: { moduleId }, orderBy: { order: 'asc' } });
  }
  const placeholders = lessons.filter((l: any) => isPlaceholderContent(l.content));

  if (placeholders.length > 0) {
    const lessonCount = lessons.length;
    const slotDescriptions = placeholders.map((l: any) => {
      const type = l.order === 1 || l.order === lessonCount ? 'video' : 'text';
      return isEN ? `Lesson ${l.order} (type ${type})` : `Lección ${l.order} (tipo ${type})`;
    }).join(', ');
    const repairPrompt = isEN
      ? `You are a top-tier e-learning instructional designer. Regenerate the content for these ${placeholders.length} specific lessons of module "${mod.title}" in course "${courseTitle}" (module has ${lessonCount} lessons total): ${slotDescriptions}.
Text lessons: 700-900 words, 5-section structure (opening question, development, a fully worked real example, a self-practice exercise, and — only if this is the module's last lesson — a closing summary). Video lessons: 100-150 word summary.
Return ONLY a JSON array of exactly ${placeholders.length} objects, IN THE SAME ORDER as listed above:
[{"title":"...","content":"<h3>...</h3><p>...</p>","points":["...","...","..."],"tip":"...","duration":"5 min|9 min"}]`
      : `Eres un diseñador instruccional de e-learning de primer nivel. Regenera el contenido de estas ${placeholders.length} lecciones específicas del módulo "${mod.title}" del curso "${courseTitle}" (el módulo tiene ${lessonCount} lecciones en total): ${slotDescriptions}.
Lecciones de texto: 700-900 palabras, estructura de 5 secciones (pregunta de apertura, desarrollo, un ejemplo real trabajado a fondo, un ejercicio de práctica propia, y — solo si es la última lección del módulo — un cierre-resumen). Lecciones de video: resumen de 100-150 palabras.
Devuelve ÚNICAMENTE un array JSON de exactamente ${placeholders.length} objetos, EN EL MISMO ORDEN listado arriba:
[{"title":"...","content":"<h3>...</h3><p>...</p>","points":["...","...","..."],"tip":"...","duration":"5 min|9 min"}]`;

    const repaired = await invokeBedrockForJson(repairPrompt, 64000).catch((e: any) => {
      console.error(`[verifyAndRepairModule] module ${moduleId} lesson repair failed: ${e?.name ?? 'UnknownError'}: ${e?.message ?? e}`);
      return null;
    });
    if (Array.isArray(repaired)) {
      await Promise.all(placeholders.map(async (l: any, j: number) => {
        const gen = repaired[j];
        if (!gen?.content) return;
        const content = sanitizeLessonContent(gen.content);
        const points = Array.isArray(gen.points) ? gen.points : l.points;
        const tip = gen.tip || l.tip;
        await prisma.lesson.update({
          where: { id: l.id },
          data: {
            title: gen.title || l.title,
            content,
            points,
            tip,
            // Repaired content replaces whatever placeholder/short duration the lesson
            // had before — recompute honestly from the real word count now (Trello
            // DmPpbrff, 2026-08-31 15:19), same rule ai-wizard-lesson-visuals.ts applies
            // on the main generation path.
            duration: lessonDurationLabel(content, points, tip),
          },
        });
      }));
    }
  }

  if (quizPlanned) {
    const questionCount = await prisma.question.count({ where: { moduleId } });
    if (questionCount === 0) {
      await generateAndSaveQuizQuestions(prisma, moduleId, mod.title, isEN);
    }
  }

  // Re-check from the DB (not in-memory) — this is the actual verification.
  const freshLessons = await prisma.lesson.findMany({ where: { moduleId }, select: { content: true } });
  const lessonsOk = freshLessons.length > 0 && freshLessons.every((l: any) => !isPlaceholderContent(l.content));
  const quizOk = !quizPlanned || (await prisma.question.count({ where: { moduleId } })) > 0;
  return lessonsOk && quizOk;
}
