// ─── bedrock-usage.ts ────────────────────────────────────────────────────────
// Per-environment Bedrock token/call counters (TEST and STAGING only; prod is a no-op).
// Bedrock bills by model and not by caller, so Cost Explorer cannot say which environment
// or Lambda spends on Haiku. InvokeModel responses carry the token counts as HTTP headers
// (`x-amzn-bedrock-input-token-count` / `-output-token-count`), readable from a middleware
// without consuming the response body the caller still has to parse.
//
// Counters land in the LuxMediaUsage-<Env> table: pk `use#YYYY-MM-DD`, sk
// `bedrock#<lambda>#<modelId>`, attributes calls / inTok / outTok.
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { addUsage } from './media-budget';
import { getCurrentEnv } from './env-context';

export function trackBedrockUsage<T extends BedrockRuntimeClient>(client: T): T {
  // Unit tests replace BedrockRuntimeClient with a bare `{ send }` stub.
  const stack = (client as any)?.middlewareStack;
  if (!stack || typeof stack.add !== 'function') return client;

  stack.add(
    (next: any, context: any) => async (args: any) => {
      const result = await next(args);
      if (getCurrentEnv() !== 'prod') {
        try {
          const headers = result?.response?.headers ?? {};
          const inTok = Number(headers['x-amzn-bedrock-input-token-count'] ?? 0) || 0;
          const outTok = Number(headers['x-amzn-bedrock-output-token-count'] ?? 0) || 0;
          const fn = (process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'local').replace(/^lux-/, '');
          const model = String(args?.input?.modelId ?? context?.commandName ?? 'unknown');
          await addUsage(`bedrock#${fn}#${model}`, { calls: 1, inTok, outTok });
        } catch { /* usage tracking must never break a model call */ }
      }
      return result;
    },
    { step: 'deserialize', name: 'luxBedrockUsage', override: true },
  );
  return client;
}
