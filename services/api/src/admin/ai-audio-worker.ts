// ─── ai-audio-worker.ts ───────────────────────────────────────────────────────
// Domain: automatic Polly neural audio generation for every lesson of a course,
// run as its own self-invoked background phase after Lux Planner finishes.
//
// Trello DmPpbrff item 4 (2026-08-30 20:20): Polly neural infrastructure already
// existed (ctx.ts) but was never wired to actually run — no lesson ever got an
// audioUrl, so every student heard the browser's free voice regardless. Rather
// than generating audio inline during the main lessons/quiz/reflection loop (which
// already had a completeness/timeout problem fixed earlier the same day), this
// runs as a separate self-invoke fired AFTER the course is marked done — it never
// competes with that budget, and a slow/failed audio pass can't mark a course
// incomplete.
import { InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { AdminCtx, lambdaClient, generateLessonAudio, defaultVoiceForLanguage } from './ctx';
import { ok } from '../shared/response';
import { getCurrentEnv } from '../shared/env-context';

const AUDIO_CONCURRENCY = 4;

/** Fire-and-forget dispatch — call this right after a course's generation job is marked done. */
export async function dispatchLessonAudioGeneration(courseId: string): Promise<void> {
  try {
    await lambdaClient.send(new LambdaInvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ _action: 'lesson-audio-gen', _env: getCurrentEnv(), courseId })),
    }));
  } catch (err: any) {
    // Non-fatal — the course is already usable without audio; a manual regen (per-lesson
    // "generate audio" action) still exists as a fallback.
    console.error(`[lesson-audio-gen] dispatch failed for course ${courseId}:`, err?.message ?? err);
  }
}

export async function handleAIAudioWorker(ctx: AdminCtx): Promise<any | null> {
  if (ctx.action !== 'lesson-audio-gen') return null;
  const { prisma, body } = ctx;
  const { courseId } = body as { courseId: string };

  try {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { planLanguage: true, modules: { select: { lessons: { select: { id: true, content: true, audioUrl: true } } } } },
    });
    if (!course) { console.warn(`[lesson-audio-gen] course ${courseId} not found`); return ok({}); }

    const voiceId = defaultVoiceForLanguage(course.planLanguage);
    // Only lessons with real content and no audio yet — safe to re-trigger without redoing work.
    const lessons = course.modules.flatMap((m: any) => m.lessons).filter((l: any) => l.content && !l.audioUrl);

    let done = 0, failed = 0;
    for (let i = 0; i < lessons.length; i += AUDIO_CONCURRENCY) {
      const batch = lessons.slice(i, i + AUDIO_CONCURRENCY);
      await Promise.all(batch.map(async (lesson: any) => {
        try {
          const audioUrl = await generateLessonAudio(lesson.id, lesson.content ?? '', voiceId);
          if (audioUrl) {
            await prisma.lesson.update({ where: { id: lesson.id }, data: { audioUrl } });
            done++;
          } else {
            failed++;
          }
        } catch (err) {
          failed++;
          console.error(`[lesson-audio-gen] lesson ${lesson.id} failed:`, err);
        }
      }));
    }
    console.log(`[lesson-audio-gen] course ${courseId}: ${done} generated, ${failed} failed, voice=${voiceId}`);
  } catch (err: any) {
    console.error(`[lesson-audio-gen] course ${courseId} fatal:`, err?.message ?? err);
  }
  return ok({});
}
