// ─── ai-image-helpers.ts ──────────────────────────────────────────────────────
// Domain: AI-generated lesson images/infographics (Bedrock Haiku prompt-crafting +
// Stability Image Core). Extracted out of ctx.ts to keep it under the shared-helper
// file-size limit (Trello DmPpbrff item 4, 2026-08-30: adding English Polly voices
// pushed ctx.ts over 400 lines).
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { bedrock, bedrockImageClient, bedrockNovaClient, s3Client, S3_IMAGES_BUCKET } from './ctx';
import { applyLuxWatermark } from '../shared/lux-watermark';
import { generateImageWithGemini, isGeminiImageConfigured } from './ai-image-gemini';

// ── Image generation ─────────────────────────────────────────────────────────
export const STYLE_SUFFIXES: Record<string, string> = {
  realistic:    ', photorealistic, high detail, professional photography',
  illustration: ', flat illustration, colorful, modern vector art style',
  // Trello DmPpbrff, 2026-09-05 (Mack): "¿Recuerda usar flechas, como si fuera un mapa
  // conceptual, inclusive líneas de tiempo?" — the old suffix ("clean technical
  // illustration, professional schematic") was too vague and left Stability free to draw
  // arbitrary, sometimes odd-looking icon shapes ("íconos extraños"). Steered explicitly
  // toward the concrete diagram vocabulary she asked for.
  diagram:      ', clean flat-design educational diagram, simple geometric icons, connecting arrows and lines, conceptual map / mind-map layout, timeline elements, minimal color palette, professional infographic aesthetic (no readable text)',
  comic:        ', comic book style, bold outlines, vibrant colors, graphic novel',
  minimal:      ', minimal design, clean white background, simple shapes',
  colorful:     ', vibrant multicolor palette, energetic, dynamic composition',
  corporate:    ', professional corporate style, blue and gray tones, business',
};

// Trello DmPpbrff, 2026-09-05 (Mack): the same negative_prompt was used for every style,
// including 'diagram' — but it excluded "diagram, chart, infographic, icons with labels",
// directly fighting the 'diagram' style's own positive prompt above. That tug-of-war is
// a real contributor to the inconsistent/odd results she flagged. Diagram-style requests
// drop just those terms from the negative list; every style still excludes actual
// legible text (Stability can never render that reliably) and UI/screenshot artifacts.
const NEGATIVE_PROMPT_BASE = 'text, words, letters, labels, captions, writing, typography, fonts, pseudo-text, fake text, illegible text, handwriting, script, headline, subtitle, ui, interface, user interface, app screenshot, screen mockup, dashboard, menu bar, toolbar, buttons with text, software application, table, banner, poster, signs, blurry, low quality, distorted, cluttered icons, overlapping elements';
const NEGATIVE_PROMPT_NON_DIAGRAM = `${NEGATIVE_PROMPT_BASE}, icons with labels, infographic, chart, diagram`;

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
          `Visual art director task: convert this lesson content into a diffusion model image prompt (max 80 words).\nRules: describe only visual elements (objects, people, settings, colors). NO text, labels, diagrams anywhere in the image. NEVER describe a software interface, app screen, UI mockup, dashboard, or screenshot — a diffusion model always hallucinates illegible pseudo-text trying to render those; use a physical/conceptual object or scene instead. Flat illustration style, colorful, white background.\nLesson: "${lessonTitle}"\nContent: ${snippet}\nReturn ONLY the prompt, nothing else.`
        }],
      }),
    }));
    const text = JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text?.trim() ?? '';
    if (text.length > 20) return text;
  } catch { /* fall through */ }
  return `Flat illustration of "${lessonTitle.slice(0, 60)}", colorful educational scene with objects and people, clean white background, modern design, no text, no labels`;
}

// Claude Haiku → SVG infographic (card-grid, multi-color) for lesson cards.
// Original design (Trello DmPpbrff, pre-Sep-29): 2×2 card grid, institutional blue
// (#1E3A5F) + gold (#F5C518), 8192 max_tokens so SVG fits without truncation.
export async function generateLessonInfographic(lessonTitle: string, moduleTitle: string, lessonContent: string): Promise<string | null> {
  const snippet = lessonContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  const prompt = `Create a complete, modern, colorful educational SVG infographic for Lux Learning (viewBox="0 0 1200 900").

Lesson: "${lessonTitle}"
Module: "${moduleTitle}"
Content: ${snippet}

VISUAL STYLE — Flat UI with depth (soft drop shadows):
- Each card/container: <filter> with <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#0B3A6F" flood-opacity="0.15"/> for floating effect.
- Colors VIVID and INSTITUTIONAL: primary #0B3A6F (navy), accent #FFC107 (gold), complementary accents (turquoise #00BCD4 or soft purple #7C4DFF) for variety. White or ultra-light gray (#F8FAFC) background.
- Use subtle linear gradients on card headers: from #0B3A6F to #1565C0 or similar.

LAYOUT (exact coordinates):
1. viewBox="0 0 1200 900", background rect fill="#F8FAFC".
2. HEADER BAR: rect y="0" height="75" fill="url(#headerGrad)". Gradient headerGrad: #0B3A6F → #1565C0 horizontal. Module title: text y="48" x="600" text-anchor="middle" fill="#FFFFFF" font-size="28" font-weight="700" font-family="system-ui, -apple-system, 'Segoe UI', Arial, Helvetica, sans-serif". Clip to header rect.
3. SUBTITLE: rect y="75" height="38" fill="#FFC107". Lesson title: text y="101" x="600" text-anchor="middle" fill="#0F172A" font-size="16" font-weight="600" font-family="system-ui, -apple-system, 'Segoe UI', Arial, Helvetica, sans-serif". Clip to subtitle rect.
4. CARD GRID (4 cards, 2×2): Each card 540×175, with 30px gaps. Positions: card1(x=30,y=130), card2(x=600,y=130), card3(x=30,y=335), card4(x=600,y=335).
   Per card:
   a. Drop shadow filter applied to card group.
   b. Background: rect fill="#FFFFFF" rx="10" stroke="none".
   c. Top accent strip height=32 with gradient fill (alternate colors: #0B3A6F, #00BCD4, #7C4DFF, #FFC107) rx="10" (top corners only via separate rect).
   d. Section title in strip: text fill="#FFFFFF" (or fill="#0F172A" if yellow strip) font-size="14" font-weight="600" font-family="system-ui, -apple-system, 'Segoe UI', Arial, Helvetica, sans-serif" x=card_x+16 y=card_y+22. Clip to strip rect width.
   e. ICON (left): simple SVG path/circle/line icon, stroke color matching strip, fill="none" stroke-width="2", in 52×52 box at (card_x+14, card_y+46). Use clipPath to contain it.
   f. TEXT (right of icon): 2 lines font-size="13" fill="#475569" font-family="system-ui, -apple-system, 'Segoe UI', Arial, Helvetica, sans-serif" at x=card_x+80, y=card_y+62 and y=card_y+82. Max 52 chars per line. Paired with clipPath of width=460 from x=card_x+76.
5. CONNECTING LINES: thin dashed lines stroke="#0B3A6F" stroke-width="1" stroke-dasharray="4,4" between cards (center-to-center), with small circle markers stroke="#FFC107" fill="#FFC107" r="4".
6. FOOTER: rect y="860" height="40" fill="#0B3A6F". Logo mark at x=480 y=865: (a) navy triangle <polygon points="480,895 498,865 516,895" fill="#FFFFFF" opacity="0.9"/>; (b) gold swoosh arc <path d="M482,892 Q499,870 514,868" stroke="#FFC107" stroke-width="2.5" fill="none" stroke-linecap="round"/>; (c) gold star dot <circle cx="514" cy="866" r="2.5" fill="#FFC107"/>. Wordmark right of mark: text x="522" y="885" font-size="15" font-weight="700" font-family="system-ui, Arial, sans-serif"><tspan fill="#FFC107">Lux </tspan><tspan fill="#FFFFFF">Learning</tspan></text>.

TYPOGRAPHY (Lux Learning platform standard):
- Font family: font-family="system-ui, -apple-system, 'Segoe UI', Arial, Helvetica, sans-serif" on ALL text elements.
- Weights: titles bold (font-weight="700"), section labels semibold (font-weight="600"), body regular (font-weight="400").
- Color palette (NO pure black #000000):
  • Primary titles / active labels: #1E293B (dark navy-black, soft).
  • Section headers on white background: #0F172A.
  • Secondary / body text: #475569 (neutral gray).
  • Captions / metadata: #64748B.
  • White-on-dark text (strip headers): #FFFFFF.

TEXT CONTAINMENT (critical — no floating or overflowing text):
- Every text element must be paired with a <clipPath> that matches its parent container bounds minus 12px padding on all sides.
- Card text area (right of icon): max width = 460px. Use two lines max, each max 52 chars, clipped by clipPath.
- Section title in accent strip: max width = card_width - 32px, clipped to strip bounds.
- NEVER place text outside its enclosing rect. NEVER position text that would render outside the viewBox.

ICON DISCIPLINE:
- Icons ONLY inside designated icon boxes (the 52×52 area per card). NEVER free-floating elsewhere.
- Use only simple geometric SVG shapes (lines, circles, rects, simple paths) — no ornamental or random icon placement.
- Each icon group wrapped in <g clip-path="url(#icon-clip-N)"> with matching clipPath rect.

REQUIREMENTS:
- NO external images, NO base64, NO JavaScript, NO <style> blocks — pure SVG attributes only.
- Use <defs> for all filters, gradients, clipPaths (one per icon + one per text area).
- Text must be fully legible: minimum 13px, line-height via y offsets of 20px.
- Validate mentally: every text x/y coordinate must fall inside its container rect.

Return ONLY <svg>...</svg>. No markdown, no explanation.`;

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json', accept: 'application/json',
      body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }] }),
    }));
    const svgRaw: string = JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text?.trim() ?? '';
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
  const isDiagram = override?.style === 'diagram';
  try {
    // Provider selection (Trello DmPpbrff, 2026-09-08 — Jason: "adelante" on
    // trying Nano Banana Pro / Gemini for image quality). Stability stays the
    // default so nothing changes unless IMAGE_PROVIDER='gemini' AND a key is
    // configured — either missing condition transparently falls back to
    // Stability, same non-fatal convention as applyLuxWatermark below.
    let imgBuffer: Buffer | null = null;
    if (process.env.IMAGE_PROVIDER === 'gemini' && isGeminiImageConfigured()) {
      try {
        imgBuffer = await generateImageWithGemini(prompt);
      } catch (err) {
        console.error('[ImageGen] Gemini provider failed, falling back to Stability:', err);
      }
    }
    if (!imgBuffer) {
      // Stability Image Core — ACTIVE model in us-west-2, native Bedrock, no external API key
      const resp = await bedrockImageClient.send(new InvokeModelCommand({
        modelId: 'stability.stable-image-core-v1:1',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          prompt,
          negative_prompt: isDiagram ? NEGATIVE_PROMPT_BASE : NEGATIVE_PROMPT_NON_DIAGRAM,
          mode: 'text-to-image',
          aspect_ratio: '1:1',
          output_format: 'jpeg',
        }),
      }));
      const result = JSON.parse(new TextDecoder().decode(resp.body));
      const base64 = result.images?.[0];
      if (!base64) { console.error('[ImageGen] Stability returned no image'); return null; }
      imgBuffer = Buffer.from(base64, 'base64');
    }
    if (imgBuffer.length === 0) return null;
    // Real Lux Learning icon composited onto the image, not an AI-imagined watermark
    // (Trello DmPpbrff, 2026-09-05 — Mack: "utilizando el Lux Learning Icon Full Color").
    // Previously this was just a prompt instruction asking Stability to hallucinate its
    // own generic watermark shape — a real contributor to the "íconos extraños ... encima
    // de las letras" complaint. Non-fatal: falls back to the un-watermarked image on any
    // failure (e.g. sharp's native binding missing for this Lambda's architecture).
    imgBuffer = await applyLuxWatermark(imgBuffer).catch((err) => {
      console.error('[ImageGen] Watermark compositing failed, using unwatermarked image:', err);
      return imgBuffer;
    });
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

// Generates a flat vector illustration for the Lux Carrousel using Mack's Sep-29 spec
// (Trello DmPpbrff comment 6abc0cf5): clean Flat UI / Vector Art scene or object that
// exemplifies the concept — NO text at all, deep navy + warm gold + neutral background.
export async function generateCarouselInfographic(concept: string): Promise<string | null> {
  const safeConcept = concept.replace(/"/g, "'").replace(/<[^>]+>/g, ' ').trim().slice(0, 120);
  const prompt =
    `A clean, professional flat vector illustration (Flat UI / Vector Art style), 16:9 aspect ratio. ` +
    `Visually exemplifies the concept: "${safeConcept}". ` +
    `Show only the relevant object, scene, or conceptual diagram directly related to this topic — no abstract geometric shapes disconnected from the subject. ` +
    `Color palette: deep navy blue (#1E3A5F) dominant structures and accents, warm golden yellow (#F5C518) highlights, ultra-clear neutral/white background. ` +
    `Clean editorial appearance, no visual noise, no complex gradients. ` +
    `STRICTLY NO text, words, letters, numbers, labels, or typography of any kind inside the image. 100% graphic and visual only. ` +
    `NO human faces, NO photorealistic elements, NO 3D renders, NO dark backgrounds.`;
  try {
    const resp = await bedrockImageClient.send(new InvokeModelCommand({
      modelId: 'stability.stable-image-core-v1:1',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        prompt,
        negative_prompt: NEGATIVE_PROMPT_BASE + ', faces, human figures, bodies, photography, photorealistic, realistic photo',
        mode: 'text-to-image',
        aspect_ratio: '16:9',
        output_format: 'jpeg',
      }),
    }));
    const result = JSON.parse(new TextDecoder().decode(resp.body));
    const base64 = result.images?.[0];
    if (!base64) { console.error('[CarouselInfographic] Stability returned no image'); return null; }
    let imgBuffer = Buffer.from(base64, 'base64');
    imgBuffer = await applyLuxWatermark(imgBuffer).catch((err) => {
      console.error('[CarouselInfographic] Watermark failed, using unwatermarked:', err);
      return imgBuffer;
    });
    const key = `lessons/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    await s3Client.send(new PutObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: key, Body: imgBuffer, ContentType: 'image/jpeg' }));
    return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
  } catch (err) {
    console.error('[CarouselInfographic] failed:', err);
    return null;
  }
}
