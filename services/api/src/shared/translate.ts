import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
const MEM_TTL_MS = 60 * 60 * 1000; // 1 hour

export type TranslatableEntityType = 'course' | 'module' | 'lesson' | 'question' | 'emailTemplate' | 'notification';
export type TranslatableFields = Record<string, string | string[] | null | undefined>;

interface TranslatableEntity {
  type: TranslatableEntityType;
  id: string;
  fields: TranslatableFields;
}

const memCache = new Map<string, { fields: TranslatableFields; ts: number }>();
const cacheKey = (lang: string, type: string, id: string) => `${lang}#${type}#${id}`;

const LANG_NAMES: Record<string, string> = { en: 'English', es: 'Spanish', fr: 'French', pt: 'Portuguese' };

async function translateWithBedrock(fields: TranslatableFields, lang: string): Promise<TranslatableFields | null> {
  const targetLang = LANG_NAMES[lang] ?? lang;
  const input = JSON.stringify(fields);
  const prompt = `Translate the values in this JSON object to ${targetLang}. Rules:
- If a value is already in ${targetLang}, keep it unchanged.
- Preserve the exact same JSON keys and structure.
- For array values, translate each element individually and keep the EXACT same number of elements.
- If a value is null, keep it null.
- Preserve all {{variable}} placeholders exactly as-is — do not translate them.
- For HTML values, preserve all HTML tags, attributes, and inline styles — only translate visible text content inside the tags.
Return ONLY the translated JSON, no explanation, no markdown fences.

Input:
${input}`;

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    }));
    const payload = JSON.parse(new TextDecoder().decode(res.body));
    const text = payload.content?.[0]?.text ?? '{}';
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[translate] Bedrock error', err);
    return null;
  }
}

/**
 * Translates a batch of entities to the target language.
 * Uses an in-process memory cache (1-hour TTL) — no external database.
 * Returns a map of `${type}#${id}` -> translated fields.
 */
export async function batchTranslate(
  entities: TranslatableEntity[],
  lang: string
): Promise<Map<string, TranslatableFields>> {
  const result = new Map<string, TranslatableFields>();
  if (entities.length === 0) return result;

  const now = Date.now();
  const cached = new Map<string, TranslatableFields>();

  for (const e of entities) {
    const key = cacheKey(lang, e.type, e.id);
    const entry = memCache.get(key);
    if (entry && now - entry.ts < MEM_TTL_MS) {
      cached.set(key, entry.fields);
    }
  }

  const uncached = entities.filter((e) => !cached.has(cacheKey(lang, e.type, e.id)));

  const translated = await Promise.all(
    uncached.map(async (e) => ({ entity: e, fields: await translateWithBedrock(e.fields, lang) }))
  );

  for (const t of translated) {
    if (t.fields !== null) {
      memCache.set(cacheKey(lang, t.entity.type, t.entity.id), { fields: t.fields, ts: now });
    }
  }

  for (const e of entities) {
    const key = cacheKey(lang, e.type, e.id);
    const translatedFields = translated.find((t) => t.entity === e)?.fields ?? null;
    result.set(`${e.type}#${e.id}`, cached.get(key) ?? translatedFields ?? e.fields);
  }

  return result;
}

/** No-op: memory cache expires naturally after 1 hour. */
export async function invalidateTranslation(_type: TranslatableEntityType, _id: string): Promise<void> {}
