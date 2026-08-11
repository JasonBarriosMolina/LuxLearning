// AI domain router for lux-admin — thin dispatcher to sub-domain handlers.
// Split by area: media (generation/publish/images), regen (lesson/module/course regen + audio), wizard (plan + save).
import type { AdminCtx } from './ctx';
import { handleAIMedia } from './ai-media';
import { handleAIRegen } from './ai-regen';
import { handleAIWizard } from './ai-wizard';

export async function handleAI(ctx: AdminCtx): Promise<any | null> {
  // Media first: captures ai-generate worker (_jobId) before wizard check
  return await handleAIMedia(ctx) ?? await handleAIRegen(ctx) ?? await handleAIWizard(ctx) ?? null;
}
