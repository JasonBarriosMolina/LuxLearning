// ─── carousel.ts ──────────────────────────────────────────────────────────────
// Lux Carrousel — Mini Wizard sync routes (script draft + async generation dispatch).
// Trello N1bbWdz0 (2026-08-30): opt-in per module, evaluator-triggered from the
// module editor — NOT part of the bulk Lux Planner course-generation worker (the
// script needs human review/approval before assets are generated, unlike quiz/class).
import { InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { AdminCtx, isAuthorized, lambdaClient, invokeBedrockForJson } from './ctx';
import { saveAiJob } from '../shared/db-dynamo';
import { getCurrentEnv } from '../shared/env-context';
import { ok, badRequest, forbidden } from '../shared/response';

export const TARGET_SLIDES = 9; // ~9 slides for a 5-7 min carousel keeps cost near the $0.7 target

/**
 * Generates the Lux Carrousel script (slides with on-screen text + narration + image
 * prompt) via Bedrock, with a one-shot retry if the model under-delivers slides.
 * Shared by the manual Mini Wizard route below and the automatic per-module phase
 * in ai-wizard-carousel-phase.ts (Trello DmPpbrff, 2026-08-31 14:02 — "los carruseles
 * ... deberían incluirse automáticamente en la creación del curso").
 */
export async function draftCarouselScript(
  mod: { title: string; description: string | null },
  topic: string | undefined,
  moduleId: string,
): Promise<{ slides: any[]; topic: string } | null> {
  const effectiveTopic = (topic ?? '').trim() || `${mod.title} — ${mod.description ?? ''}`;
  const prompt = `Eres un guionista instruccional experto en microlearning audiovisual. Crea el guion de un "Lux Carrousel": una lección de 5-7 minutos narrada, dividida en exactamente ${TARGET_SLIDES} diapositivas.

Tema: ${effectiveTopic}

Tono profesional y educativo — sin emojis en ningún campo (ni títulos, ni viñetas, ni narración).

Para cada diapositiva genera:
- "onScreenText": 1 título corto + hasta 3 viñetas breves (lo que se lee en pantalla)
- "narrationSegment": 1-2 oraciones completas que un narrador leerá en voz alta para esa diapositiva — deben sonar naturales al narrarse en secuencia, cada una terminando en punto
- "imagePrompt": descripción puramente visual (objetos, composición, diagrama, sin texto) para generar una imagen de fondo tipo infografía — nunca menciones texto, letras o palabras a dibujar

Devuelve ÚNICAMENTE un array JSON de exactamente ${TARGET_SLIDES} objetos:
[{"onScreenText":{"title":"...","bullets":["...","..."]},"narrationSegment":"...","imagePrompt":"..."}]`;

  let raw = await invokeBedrockForJson(prompt, 4000).catch((e: any) => {
    console.error('[carousel/draft] Bedrock failed:', e?.message ?? e);
    return null;
  });
  // Retry once if the model under-delivered — same reliability pattern already used for
  // lesson generation (Bug B fix, ai-wizard-worker.ts). Found missing here in review
  // (2026-08-30): without it, a truncated response silently gave the evaluator fewer
  // slides than requested with no error and no second attempt.
  if (!Array.isArray(raw) || raw.filter((s: any) => s?.narrationSegment).length < TARGET_SLIDES) {
    console.warn(`[carousel/draft] module ${moduleId}: got ${Array.isArray(raw) ? raw.length : 0}/${TARGET_SLIDES} slides — retrying once`);
    const retryRaw = await invokeBedrockForJson(prompt, 4000).catch((e: any) => {
      console.error('[carousel/draft] retry failed:', e?.message ?? e);
      return null;
    });
    if (Array.isArray(retryRaw) && retryRaw.length > (Array.isArray(raw) ? raw.length : 0)) raw = retryRaw;
  }
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const slides = raw.slice(0, TARGET_SLIDES).map((s: any, i: number) => ({
    order: i + 1,
    onScreenText: { title: s?.onScreenText?.title ?? `Punto ${i + 1}`, bullets: Array.isArray(s?.onScreenText?.bullets) ? s.onScreenText.bullets.slice(0, 3) : [] },
    narrationSegment: (s?.narrationSegment ?? '').trim(),
    imagePrompt: (s?.imagePrompt ?? '').trim(),
  })).filter((s: any) => s.narrationSegment);
  return slides.length > 0 ? { slides, topic: effectiveTopic } : null;
}

export async function handleCarousel(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body, userId } = ctx;

  // ── POST /admin/modules/:moduleId/carousel/draft — script draft (sync, not saved) ──
  const draftMatch = path.match(/^\/admin\/modules\/([^/]+)\/carousel\/draft$/);
  if (draftMatch && method === 'POST') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de evaluador o administrador');
    const moduleId = draftMatch[1]!;
    const { topic } = body as { topic?: string };
    const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true, description: true } });
    if (!mod) return badRequest('Módulo no encontrado');

    const result = await draftCarouselScript(mod, topic, moduleId);
    if (!result) return badRequest('No se pudo generar el guion. Intenta de nuevo.');
    return ok(result);
  }

  // ── POST /admin/modules/:moduleId/carousel/generate — dispatch async asset generation ──
  const genMatch = path.match(/^\/admin\/modules\/([^/]+)\/carousel\/generate$/);
  if (genMatch && method === 'POST') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de evaluador o administrador');
    const moduleId = genMatch[1]!;
    const { slides, order, courseLanguage } = body as { slides?: any[]; order?: number; courseLanguage?: string };
    if (!Array.isArray(slides) || slides.length === 0) return badRequest('slides es requerido');

    const jobId = `carousel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveAiJob(jobId, { status: 'processing' });
    try {
      await lambdaClient.send(new LambdaInvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          _action: 'carousel-generate', _jobId: jobId, _env: getCurrentEnv(),
          moduleId, slides, order: order ?? null, courseLanguage: courseLanguage ?? 'ES', creatorUserId: userId,
        })),
      }));
    } catch (invokeErr: any) {
      await saveAiJob(jobId, { status: 'error', error: 'No se pudo iniciar la generación. Intenta de nuevo.' });
      console.error('[carousel/generate] Lambda invoke failed:', invokeErr?.message);
      return badRequest('No se pudo iniciar la generación del carrousel');
    }
    return ok({ jobId });
  }

  return null;
}
