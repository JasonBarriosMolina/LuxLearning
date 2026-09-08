// ─── ai-image-gemini.ts ───────────────────────────────────────────────────────
// Trello DmPpbrff, 2026-09-08 (Mack + Jason): alternate image-generation provider
// — Nano Banana Pro / Gemini 3 Pro Image — evaluated for better illustration
// quality than Stability Image Core. Kept as its own file, sibling to
// ai-image-helpers.ts, so the Stability path (default, zero behavior change)
// stays untouched and this can be reviewed/removed independently.
//
// NOT YET VERIFIED AGAINST A LIVE KEY — Jason has not provisioned GEMINI_API_KEY
// yet (2026-09-08). The request/response shape below follows Google's documented
// generateContent REST contract (inlineData image parts via responseModalities),
// but the exact model id for "Nano Banana Pro" may need correcting once we can
// actually test — see GEMINI_IMAGE_MODEL below, overridable without a redeploy.
// Every call site must keep falling back to Stability on any failure, same
// non-fatal convention as applyLuxWatermark.
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3-pro-image-preview';

export function isGeminiImageConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/** Calls Gemini's generateContent with image output requested, returns the raw
 *  image bytes (still needs the same Lux watermark compositing + S3 upload the
 *  Stability path does — this function only talks to Google). Returns null if
 *  no key is configured (safe no-op, caller should fall back to Stability) and
 *  throws on any request/parse failure so callers can log + fall back the same
 *  way applyLuxWatermark's callers already do. */
export async function generateImageWithGemini(prompt: string): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;

  const res = await fetch(`${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini image API returned ${res.status}: ${body.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
  // Google's JSON uses camelCase (inlineData/mimeType) in current docs, but the
  // protobuf-JSON mapping also accepts snake_case on the wire in places — check
  // both so a minor API version drift doesn't silently break this.
  const imagePart = parts.find((p) => p?.inlineData?.data || p?.inline_data?.data);
  const base64 = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data;
  if (!base64) throw new Error('Gemini image API returned no inline image data');
  return Buffer.from(base64, 'base64');
}
