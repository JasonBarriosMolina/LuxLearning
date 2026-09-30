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
2. HEADER BAR: rect y="0" height="80" fill="url(#headerGrad)". Gradient headerGrad: #0B3A6F → #1565C0 horizontal. Module title: text y="52" x="600" text-anchor="middle" fill="#FFFFFF" font-size="32" font-weight="700" font-family="system-ui, -apple-system, 'Segoe UI', Arial, Helvetica, sans-serif". Clip to header rect.
3. SUBTITLE: rect y="80" height="44" fill="#FFC107". Lesson title: text y="108" x="600" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="600" font-family="system-ui, -apple-system, 'Segoe UI', Arial, Helvetica, sans-serif". Clip to subtitle rect.
4. CARD GRID (4 cards, 2×2): Each card 540×210, with 30px gaps. Positions: card1(x=30,y=140), card2(x=600,y=140), card3(x=30,y=380), card4(x=600,y=380).

CARD STRUCTURE — use this exact SVG pattern for each card (replace CARD_X, CARD_Y, N, STRIP_COLOR, TITLE, content):
In <defs> add for card N:
  <clipPath id="strip-clip-N"><rect x="CARD_X" y="CARD_Y" width="540" height="38"/></clipPath>
  <clipPath id="icon-clip-N"><rect x="CARD_X+14" y="CARD_Y+46" width="56" height="56"/></clipPath>
  <clipPath id="body-clip-N"><rect x="CARD_X+80" y="CARD_Y+44" width="450" height="155"/></clipPath>
Card SVG:
  <rect x="CARD_X" y="CARD_Y" width="540" height="210" rx="12" fill="#FFFFFF" filter="url(#card-shadow)"/>
  <rect x="CARD_X" y="CARD_Y" width="540" height="38" fill="STRIP_COLOR" rx="4"/>
  <text x="CARD_X+16" y="CARD_Y+26" font-size="17" font-weight="600" font-family="system-ui,Arial,sans-serif" fill="#FFFFFF" clip-path="url(#strip-clip-N)">TITLE HERE</text>
  <g clip-path="url(#icon-clip-N)">
    <!-- ALL icon shapes MUST use coordinates within the box: x in [CARD_X+14 .. CARD_X+70], y in [CARD_Y+46 .. CARD_Y+102]. NEVER coordinates outside this range. -->
    <!-- Example: <circle cx="CARD_X+42" cy="CARD_Y+74" r="22" stroke="STRIP_COLOR" stroke-width="2.5" fill="none"/> -->
  </g>
  <text font-size="16" font-family="system-ui,Arial,sans-serif" fill="#475569" clip-path="url(#body-clip-N)">
    <tspan x="CARD_X+84" y="CARD_Y+72">line 1 text max 44 chars</tspan>
    <tspan x="CARD_X+84" dy="24">line 2 text max 44 chars</tspan>
    <tspan x="CARD_X+84" dy="24">line 3 text max 44 chars</tspan>
  </text>
Strip colors (one per card): card1=#0B3A6F, card2=#00BCD4, card3=#7C4DFF, card4=#FFC107. For yellow strip (#FFC107), use fill="#0F172A" on text.

5. CONNECTING LINES: thin dashed lines stroke="#0B3A6F" stroke-width="1" stroke-dasharray="4,4" between cards (center-to-center), with small circle markers stroke="#FFC107" fill="#FFC107" r="5".
6. FOOTER: rect y="860" height="40" fill="#0B3A6F". In <defs>, include this <symbol> VERBATIM (copy paths exactly):
<symbol id="lux-mark" viewBox="768 48 507 479">
  <path fill="#E2B84E" d="M1102.38 196.731C1116.83 192.19 1134.78 187.663 1146.77 178.259C1157.56 169.792 1158.69 148.571 1165.19 138.567L1166.49 138.207C1169.61 142.744 1173.24 155.651 1174.86 161.393C1181.63 185.499 1208.08 188.771 1228.68 196.672C1210.64 202.641 1188.85 206.26 1179.95 223.56C1174.85 233.49 1171.6 253.35 1168.21 258.882L1166.44 259.367C1161.79 255.465 1157.62 238.44 1155.66 231.751C1129.54 274.43 1092.93 314.142 1058.55 350.563C1013.37 398.418 966.232 445.714 913.503 485.333C880.197 510.358 832.788 542.465 790.59 518.131C764.298 502.799 762.916 467.434 778.265 443.835C791.338 423.144 812.114 410.931 834.329 400.866C849.81 394.675 872.333 387.848 886.418 381.311C986.498 349.7 1070.34 287.786 1139.39 209.748C1127.61 204.349 1114.77 200.724 1102.38 196.731ZM810.861 492.374C834.91 505.024 871.621 475.763 890.359 461.656C925.707 435.044 960.769 404.159 991.303 372.152L991.601 370.467L989.927 369.874A756 756 0 0 1 922.867 401.42C884.59 416.77 836.993 424.743 809.079 456.983C799.309 468.265 799.334 482.246 810.861 492.374Z"/>
  <path fill="#19547F" d="M1108.27 315.843C1111.85 320.688 1119.16 333.934 1122.47 339.536L1149.81 385.654L1183.87 443.12C1195.02 461.95 1219.8 493.429 1199.92 514.128C1189.87 524.595 1166.99 522.075 1152.96 522.076L1098.95 522.073L911.98 522.015L895.534 522.255C909.366 511.854 922.852 500.616 936.717 490.085C1014.74 488.996 1095.27 490.071 1173.49 489.924C1163.45 474.728 1152.29 454.825 1142.83 438.962A6399 6399 0 0 1 1087.64 345.471C1093.69 336.085 1101.76 325.147 1108.27 315.843ZM834.329 400.866C840.72 392.535 853.063 370.532 859.221 360.259L938.272 227.509C950.969 206.106 963.309 184.651 976.321 163.346C985.056 149.044 1003.39 144.91 1014.41 159.025C1022 168.747 1028.24 180.71 1034.57 191.473L1070.65 252.669L1045.08 273.799C1028.5 247.69 1013.36 219.932 997.154 193.461C991.385 202.048 984.233 215.075 978.862 224.187L945.03 281.347L908.745 342.454C901.505 354.673 892.712 368.763 886.418 381.311C872.333 387.848 849.81 394.675 834.329 400.866Z"/>
</symbol>
Then in footer: <use href="#lux-mark" x="490" y="861" width="38" height="36"/> <text x="534" y="884" font-size="15" font-weight="700" font-family="system-ui,Arial,sans-serif"><tspan fill="#FFC107">Lux </tspan><tspan fill="#FFFFFF">Learning</tspan></text>.

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
- EVERY text element MUST have clip-path="url(#...)" referencing a <clipPath> in <defs> that wraps its container bounds.
- Multi-line body text: use ONE <text> element with multiple <tspan> children. Each <tspan> must have explicit x="..." and dy="..." attributes. NEVER use separate <text> elements for each line.
- Strip title: clip-path to strip rect. Body text: clip-path to body area rect. Header/subtitle: clip-path to header/subtitle rect.
- NEVER place text outside its enclosing rect. NEVER position text that would render outside the viewBox (0 0 1200 900).

ICON DISCIPLINE (CRITICAL):
- Icons live ONLY inside the designated icon box per card (56×56 box at card_x+14, card_y+46).
- Icon group MUST use <g clip-path="url(#icon-clip-N)">. All child shapes MUST have coordinates computed RELATIVE to that box.
- For card at (CARD_X, CARD_Y): icon center = (CARD_X+42, CARD_Y+74). NEVER use absolute coordinates that ignore CARD_X/CARD_Y.
- Use only simple shapes: circle, rect, line, polyline, simple path. Stroke-based (fill="none") preferred.
- ZERO icon shapes outside the icon box. If unsure, just draw a single circle at the box center.

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
