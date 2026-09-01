// ─── ai-image-helpers.ts ──────────────────────────────────────────────────────
// Domain: AI-generated lesson images/infographics (Bedrock Haiku prompt-crafting +
// Stability Image Core). Extracted out of ctx.ts to keep it under the shared-helper
// file-size limit (Trello DmPpbrff item 4, 2026-08-30: adding English Polly voices
// pushed ctx.ts over 400 lines).
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { bedrock, bedrockImageClient, s3Client, S3_IMAGES_BUCKET } from './ctx';

// ── Image generation ─────────────────────────────────────────────────────────
export const STYLE_SUFFIXES: Record<string, string> = {
  realistic:    ', photorealistic, high detail, professional photography',
  illustration: ', flat illustration, colorful, modern vector art style',
  diagram:      ', clean technical illustration, professional schematic, flat design',
  comic:        ', comic book style, bold outlines, vibrant colors, graphic novel',
  minimal:      ', minimal design, clean white background, simple shapes',
  colorful:     ', vibrant multicolor palette, energetic, dynamic composition',
  corporate:    ', professional corporate style, blue and gray tones, business',
};

// Converts arbitrary user text (may contain "infografía", "diagrama", etc.) into a
// diffusion-safe visual scene description. Prevents pseudo-text hallucination.
export async function sanitizeUserPromptForImage(userPrompt: string): Promise<string> {
  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json', accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31', max_tokens: 120,
        messages: [{ role: 'user', content:
          `Convert this user request into a diffusion model image prompt (max 70 words). Rules: describe ONLY visual elements — objects, people, settings, lighting, colors, composition. NEVER mention text, labels, titles, banners, infographic layouts, charts, or diagrams in any form. NEVER describe a software interface, app screen, UI mockup, dashboard, screenshot, menu bar, toolbar, or buttons — a diffusion model always hallucinates illegible pseudo-text trying to render those. If the request describes one, replace it with a physical/conceptual object or scene instead (e.g. a software interface becomes a control panel with knobs and sliders, or an abstract representation of the concept). Flat illustration style, clean white background.\nUser request: "${userPrompt}"\nReturn ONLY the visual prompt, nothing else.`
        }],
      }),
    }));
    const text = JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text?.trim() ?? '';
    if (text.length > 20) return text;
  } catch { /* fall through to deterministic fallback */ }
  const cleaned = userPrompt
    .replace(/\b(infograph\w*|infografía|charts?|diagrama?s?|tables?|texto|texts?|labels?|banners?|posters?|flyers?|slides?|títulos?|titl\w*|interfaz(?:es)?|interface|software|screenshots?|captura(?:s)? de pantalla|mockups?|dashboards?|barra(?:s)? de (?:herramientas|menú)|toolbars?|menu ?bars?|apps?)\b/gi, '')
    .replace(/\s+/g, ' ').trim();
  return `${cleaned || 'colorful educational scene'}, flat illustration, colorful educational scene, clean white background, no text, no labels, no words, no user interface, no screen mockup`;
}

// Haiku → visual prompt for Stability AI (pure scene description, no text in image)
export async function buildVisualPrompt(lessonTitle: string, moduleTitle: string, content: string): Promise<string> {
  const snippet = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json', accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31', max_tokens: 150,
        messages: [{ role: 'user', content:
          `Visual art director task: convert this lesson content into a diffusion model image prompt (max 80 words).\nRules: describe only visual elements (objects, people, settings, colors). NO text, labels, diagrams anywhere in the image. Flat illustration style, colorful, white background.\nLesson: "${lessonTitle}"\nContent: ${snippet}\nReturn ONLY the prompt, nothing else.`
        }],
      }),
    }));
    const text = JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text?.trim() ?? '';
    if (text.length > 20) return text;
  } catch { /* fall through */ }
  return `Flat illustration of "${lessonTitle.slice(0, 60)}", colorful educational scene with objects and people, clean white background, modern design, no text, no labels`;
}

// Haiku → SVG infographic with real readable text (for regenType 'infographic')
export async function generateLessonInfographic(lessonTitle: string, moduleTitle: string, lessonContent: string): Promise<string | null> {
  const snippet = lessonContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  const prompt = `Create a clean educational SVG infographic (1200x1200px) for this lesson.

Lesson: "${lessonTitle}"
Module: "${moduleTitle}"
Content: ${snippet}

Generate a complete, valid SVG with:
- White background (#FFFFFF)
- Title at top in dark color, large font (32-40px), in Spanish, wrapped with tspan if needed
- 3-4 content sections, each with: a colored rounded rectangle header, a simple SVG icon built from basic shapes (circle/rect/path — no external images or base64), 2-3 lines of explanatory text in Spanish
- Color palette: complementary colors (blues #3B82F6, greens #10B981, oranges #F59E0B, purples #8B5CF6)
- font-family="Arial, Helvetica, sans-serif" on all text elements
- All text content in Spanish, directly related to the lesson
- NO external images, NO base64, NO JavaScript, NO CSS classes — pure SVG attributes only
- viewBox="0 0 1200 1200" width="1200" height="1200"

Return ONLY the raw SVG markup starting with <svg and ending with </svg>. No markdown, no explanation.`;

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json', accept: 'application/json',
      body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }] }),
    }));
    let svgRaw = JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text?.trim() ?? '';
    const match = svgRaw.match(/<svg[\s\S]*<\/svg>/i);
    if (!match) { console.error('[InfographicGen] No valid SVG in response'); return null; }
    const svg = match[0]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/javascript\s*:/gi, 'nojavascript:')
      .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');
    const key = `lessons/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.svg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_IMAGES_BUCKET, Key: key,
      Body: Buffer.from(svg, 'utf-8'),
      ContentType: 'image/svg+xml',
      ContentDisposition: 'attachment',
      CacheControl: 'public, max-age=31536000',
    }));
    return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
  } catch (err) {
    console.error('[InfographicGen] Error:', err);
    return null;
  }
}

export async function generateLessonImage(
  lessonTitle: string,
  moduleTitle: string,
  order: number,
  override?: { promptText?: string; style?: string; lessonContent?: string }
): Promise<string | null> {
  // Build prompt: sanitize user text via Haiku first → lessonContent → simple fallback
  let prompt: string;
  if (override?.promptText) {
    prompt = await sanitizeUserPromptForImage(override.promptText);
  } else if (override?.lessonContent) {
    prompt = await buildVisualPrompt(lessonTitle, moduleTitle, override.lessonContent);
  } else {
    prompt = `Flat illustration of "${lessonTitle.slice(0, 60)}" from "${moduleTitle.slice(0, 60)}", colorful educational scene, clean white background, modern design, no text`;
  }
  if (override?.style && STYLE_SUFFIXES[override.style]) {
    prompt = prompt + STYLE_SUFFIXES[override.style];
  }
  // Branding: append Lux Learning watermark instruction to every image prompt
  const LUX_WATERMARK = ', bottom-right corner overlay: semi-transparent white circular minimalist icon at 45% opacity as brand watermark, flat solid colors no gradients';
  prompt = prompt + LUX_WATERMARK;
  try {
    // Stability Image Core — ACTIVE model in us-west-2, native Bedrock, no external API key
    const resp = await bedrockImageClient.send(new InvokeModelCommand({
      modelId: 'stability.stable-image-core-v1:1',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        prompt,
        negative_prompt: 'text, words, letters, labels, captions, writing, typography, fonts, pseudo-text, fake text, illegible text, handwriting, script, headline, subtitle, ui, interface, user interface, app screenshot, screen mockup, dashboard, menu bar, toolbar, buttons with text, icons with labels, software application, infographic, chart, diagram, table, banner, poster, signs, blurry, low quality, distorted',
        mode: 'text-to-image',
        aspect_ratio: '1:1',
        output_format: 'jpeg',
      }),
    }));
    const result = JSON.parse(new TextDecoder().decode(resp.body));
    const base64 = result.images?.[0];
    if (!base64) { console.error('[ImageGen] Stability returned no image'); return null; }
    const imgBuffer = Buffer.from(base64, 'base64');
    if (imgBuffer.length === 0) return null;
    const key = `lessons/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_IMAGES_BUCKET,
      Key: key,
      Body: imgBuffer,
      ContentType: 'image/jpeg',
    }));
    return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
  } catch (err) {
    console.error('[ImageGen] Error generating lesson image:', err);
    return null;
  }
}
