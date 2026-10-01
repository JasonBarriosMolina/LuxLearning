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

// Pre-defined icon symbols and logo mark — injected into SVG after Bedrock response
// to keep the prompt short and avoid Lambda timeout.
const INFOGRAPHIC_SYMBOLS = `<symbol id="ico-lightbulb" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21h6M12 3a6 6 0 0 1 6 6c0 2.22-1.2 4.16-3 5.2V17H9v-2.8A6 6 0 0 1 6 9a6 6 0 0 1 6-6z"/></symbol>
<symbol id="ico-book" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></symbol>
<symbol id="ico-star" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></symbol>
<symbol id="ico-check" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></symbol>
<symbol id="ico-chart" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="18" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="2" y="13" width="4" height="8"/></symbol>
<symbol id="ico-music" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></symbol>
<symbol id="ico-user" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></symbol>
<symbol id="ico-gear" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></symbol>
<symbol id="ico-search" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></symbol>
<symbol id="ico-clock" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></symbol>
<symbol id="ico-target" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></symbol>
<symbol id="ico-zap" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></symbol>
<symbol id="ico-layers" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></symbol>
<symbol id="ico-mic" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></symbol>
<symbol id="ico-headphones" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></symbol>
<symbol id="ico-award" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></symbol>
<symbol id="lux-mark" viewBox="768 48 507 479"><path fill="#E2B84E" d="M1102.38 196.731C1116.83 192.19 1134.78 187.663 1146.77 178.259C1157.56 169.792 1158.69 148.571 1165.19 138.567L1166.49 138.207C1169.61 142.744 1173.24 155.651 1174.86 161.393C1181.63 185.499 1208.08 188.771 1228.68 196.672C1210.64 202.641 1188.85 206.26 1179.95 223.56C1174.85 233.49 1171.6 253.35 1168.21 258.882L1166.44 259.367C1161.79 255.465 1157.62 238.44 1155.66 231.751C1129.54 274.43 1092.93 314.142 1058.55 350.563C1013.37 398.418 966.232 445.714 913.503 485.333C880.197 510.358 832.788 542.465 790.59 518.131C764.298 502.799 762.916 467.434 778.265 443.835C791.338 423.144 812.114 410.931 834.329 400.866C849.81 394.675 872.333 387.848 886.418 381.311C986.498 349.7 1070.34 287.786 1139.39 209.748C1127.61 204.349 1114.77 200.724 1102.38 196.731ZM810.861 492.374C834.91 505.024 871.621 475.763 890.359 461.656C925.707 435.044 960.769 404.159 991.303 372.152L991.601 370.467L989.927 369.874A756 756 0 0 1 922.867 401.42C884.59 416.77 836.993 424.743 809.079 456.983C799.309 468.265 799.334 482.246 810.861 492.374Z"/><path fill="#19547F" d="M1108.27 315.843C1111.85 320.688 1119.16 333.934 1122.47 339.536L1149.81 385.654L1183.87 443.12C1195.02 461.95 1219.8 493.429 1199.92 514.128C1189.87 524.595 1166.99 522.075 1152.96 522.076L1098.95 522.073L911.98 522.015L895.534 522.255C909.366 511.854 922.852 500.616 936.717 490.085C1014.74 488.996 1095.27 490.071 1173.49 489.924C1163.45 474.728 1152.29 454.825 1142.83 438.962A6399 6399 0 0 1 1087.64 345.471C1093.69 336.085 1101.76 325.147 1108.27 315.843ZM834.329 400.866C840.72 392.535 853.063 370.532 859.221 360.259L938.272 227.509C950.969 206.106 963.309 184.651 976.321 163.346C985.056 149.044 1003.39 144.91 1014.41 159.025C1022 168.747 1028.24 180.71 1034.57 191.473L1070.65 252.669L1045.08 273.799C1028.5 247.69 1013.36 219.932 997.154 193.461C991.385 202.048 984.233 215.075 978.862 224.187L945.03 281.347L908.745 342.454C901.505 354.673 892.712 368.763 886.418 381.311C872.333 387.848 849.81 394.675 834.329 400.866Z"/></symbol>`;

// SVG builder — constructs infographic from JSON card data (no AI involvement)
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

interface InfographicCard { title: string; lines: string[]; icon: string; }
const VALID_ICONS = new Set(['ico-lightbulb','ico-book','ico-star','ico-check','ico-chart','ico-music','ico-user','ico-gear','ico-search','ico-clock','ico-target','ico-zap','ico-layers','ico-mic','ico-headphones','ico-award']);
const STRIP_COLORS = ['#0B3A6F','#00BCD4','#7C4DFF','#FFC107'];
const STRIP_TEXT  = ['#FFFFFF','#FFFFFF','#FFFFFF','#0F172A'];
const CARD_POS    = [{x:30,y:140},{x:600,y:140},{x:30,y:380},{x:600,y:380}];

function buildInfographicSVG(cards: InfographicCard[], lessonTitle: string, moduleTitle: string): string {
  const ht = escapeXml(moduleTitle.slice(0, 55));
  const st = escapeXml(lessonTitle.slice(0, 65));
  const clipDefs = CARD_POS.map(({x, y}, i) =>
    `<clipPath id="sc${i}"><rect x="${x}" y="${y}" width="540" height="38"/></clipPath>` +
    `<clipPath id="bc${i}"><rect x="${x+80}" y="${y+44}" width="450" height="155"/></clipPath>`
  ).join('');
  const cardsSvg = cards.slice(0,4).map((card, i) => {
    const {x, y} = CARD_POS[i];
    const sc = STRIP_COLORS[i], stc = STRIP_TEXT[i];
    const title = escapeXml((card.title || '').slice(0, 30));
    const lines = (card.lines || []).slice(0, 3).map(l => escapeXml(String(l).slice(0, 52)));
    const icon = VALID_ICONS.has(card.icon) ? card.icon : 'ico-lightbulb';
    const tspans = lines.map((l, li) =>
      li === 0 ? `<tspan x="${x+82}" y="${y+72}">${l}</tspan>`
               : `<tspan x="${x+82}" dy="24">${l}</tspan>`
    ).join('');
    return `<rect x="${x}" y="${y}" width="540" height="210" rx="12" fill="#FFFFFF" filter="url(#cs)"/>` +
      `<rect x="${x}" y="${y}" width="540" height="38" fill="${sc}" rx="4"/>` +
      `<text x="${x+16}" y="${y+26}" font-size="17" font-weight="600" font-family="system-ui,Arial,sans-serif" fill="${stc}" clip-path="url(#sc${i})">${title}</text>` +
      `<use href="#${icon}" x="${x+14}" y="${y+50}" width="52" height="52" stroke="${sc}" fill="none"/>` +
      `<text font-size="16" font-family="system-ui,Arial,sans-serif" fill="#475569" clip-path="url(#bc${i})">${tspans}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">` +
    `<defs><filter id="cs"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#0B3A6F" flood-opacity="0.15"/></filter>` +
    `<linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#0B3A6F"/><stop offset="100%" stop-color="#1565C0"/></linearGradient>` +
    `<clipPath id="hc"><rect x="0" y="0" width="1200" height="80"/></clipPath>` +
    `<clipPath id="stc"><rect x="0" y="80" width="1200" height="44"/></clipPath>` +
    `${clipDefs}${INFOGRAPHIC_SYMBOLS}</defs>` +
    `<rect width="1200" height="900" fill="#F8FAFC"/>` +
    `<rect y="0" width="1200" height="80" fill="url(#hg)"/>` +
    `<text x="600" y="52" text-anchor="middle" fill="#FFFFFF" font-size="32" font-weight="700" font-family="system-ui,Arial,sans-serif" clip-path="url(#hc)">${ht}</text>` +
    `<rect y="80" width="1200" height="44" fill="#FFC107"/>` +
    `<text x="600" y="108" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="600" font-family="system-ui,Arial,sans-serif" clip-path="url(#stc)">${st}</text>` +
    // connecting lines (behind cards)
    `<line x1="300" y1="245" x2="870" y2="245" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="6,4"/>` +
    `<line x1="300" y1="245" x2="300" y2="485" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="6,4"/>` +
    `<line x1="870" y1="245" x2="870" y2="485" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="6,4"/>` +
    `<line x1="300" y1="485" x2="870" y2="485" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="6,4"/>` +
    `<circle cx="585" cy="245" r="6" fill="#FFC107"/><circle cx="300" cy="365" r="6" fill="#FFC107"/>` +
    `<circle cx="870" cy="365" r="6" fill="#FFC107"/><circle cx="585" cy="485" r="6" fill="#FFC107"/>` +
    cardsSvg +
    `<rect y="860" width="1200" height="40" fill="#0B3A6F"/>` +
    `<use href="#lux-mark" x="490" y="861" width="38" height="36"/>` +
    `<text x="534" y="884" font-size="15" font-weight="700" font-family="system-ui,Arial,sans-serif"><tspan fill="#FFC107">Lux </tspan><tspan fill="#FFFFFF">Learning</tspan></text>` +
    `</svg>`;
}

// Claude Haiku → JSON card data → TypeScript SVG template (fast, avoids API GW 29s timeout)
export async function generateLessonInfographic(lessonTitle: string, moduleTitle: string, lessonContent: string): Promise<string | null> {
  const snippet = lessonContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  const prompt = `Extract exactly 4 key concepts from this lesson as a JSON array.
Each element: {"title": "max 30 chars", "lines": ["line1 max 52 chars", "line2", "line3"], "icon": "one of: ico-lightbulb ico-book ico-star ico-check ico-chart ico-music ico-user ico-gear ico-search ico-clock ico-target ico-zap ico-layers ico-mic ico-headphones ico-award"}
Pick the most relevant icon for each concept topic.
Lesson: "${lessonTitle}"
Module: "${moduleTitle}"
Content: ${snippet}
Return ONLY a valid JSON array, no markdown, no explanation.`;

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json', accept: 'application/json',
      body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 600,
        messages: [{ role: 'user', content: prompt }] }),
    }));
    const raw = JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text?.trim() ?? '';
    let cards: InfographicCard[] = [];
    try {
      const parsed = JSON.parse(raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, ''));
      cards = Array.isArray(parsed) ? parsed : [];
    } catch { console.error('[InfographicGen] JSON parse error, raw:', raw.slice(0, 200)); }
    if (cards.length === 0) return null;
    const svg = buildInfographicSVG(cards, lessonTitle, moduleTitle);
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
