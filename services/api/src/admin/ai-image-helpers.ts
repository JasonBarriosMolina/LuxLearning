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

// Claude Haiku → SVG 3D Neumorphic infographic for lesson cards.
// Spec: Trello DmPpbrff comment 6abc28f1 (2026-09-29 Mack). Haiku generates a full
// self-contained SVG (viewBox 0 0 1200 800): central node + 5-6 peripheral nodes,
// drop-shadow filters, navy/gold palette, inline SVG path icons, Lux logo bottom-right.
// SVG uploaded to S3 as image/svg+xml so existing <img> tags render it natively.
export async function generateLessonInfographic(lessonTitle: string, moduleTitle: string, lessonContent: string): Promise<string | null> {
  const safeModule = moduleTitle.replace(/"/g, "'").replace(/<[^>]+>/g, ' ').trim().slice(0, 80);
  const safeLesson = lessonTitle.replace(/"/g, "'").replace(/<[^>]+>/g, ' ').trim().slice(0, 80);
  const snippet = lessonContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);

  const systemPrompt =
    `Eres un diseñador UI/UX experto en educación digital y desarrollo SVG vectorial para la plataforma "Lux Learning". ` +
    `Genera un código SVG completo, limpio y responsivo (viewBox "0 0 1200 800") que represente un mapa conceptual / infografía 3D flotante para el módulo especificado.\n\n` +
    `ESTILO VISUAL Y PROFUNDIDAD (3D NEUMORFISMO):\n` +
    `Incluye filtros de sombra paralela sutiles (<feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0B3A6F" flood-opacity="0.12"/>) aplicados a los contenedores para dar la sensación de que flotan sobre el fondo.\n` +
    `Utiliza degradados suaves (<linearGradient>) en los bordes y biseles de los círculos o tarjetas.\n` +
    `Fondo del canvas: Gris ultra claro limpio (#F8FAFC).\n\n` +
    `PALETA DE COLORES INSTITUCIONAL (LUX LEARNING):\n` +
    `Color Primario: Azul marino profundo (#0B3A6F) para el nodo central, conectores y títulos.\n` +
    `Color de Acento: Amarillo/Dorado cálido (#FFC107) para nodos destacados y resaltados.\n` +
    `Nodos Flotantes: Blanco puro (#FFFFFF) con bordes en degradado azul y dorado.\n\n` +
    `COMPOSICIÓN Y TIPOGRAFÍA:\n` +
    `Estructura: Un nodo central flotante redondeado con el título del módulo, conectado con líneas punteadas elegantes y marcadores de punto a 5 o 6 nodos circulares periféricos.\n` +
    `Tipografía: Usa fuentes sans-serif nítidas (font-family="system-ui, -apple-system, sans-serif"). Títulos en bold legibles de gran tamaño (mínimo 16px para subtítulos, 20px+ para títulos), con suficiente espacio de respiración.\n` +
    `Iconografía: Dentro de cada nodo periférico, dibuja un icono lineal fino en código SVG (<path>) alusivo al concepto de esa lección.\n\n` +
    `LOGOTIPO E IDENTIDAD:\n` +
    `En la esquina inferior derecha o pie de página central, incluye el isotipo/logo horizontal de Lux Learning utilizando el triángulo azul (#0B3A6F) atravesado por la estrella fugaz dorada (#FFC107) y el texto "Lux Learning".\n\n` +
    `FORMATO DE SALIDA:\n` +
    `Devuelve ÚNICAMENTE el bloque <svg>...</svg> válido y auto-contenido, sin texto explicativo alrededor, sin Markdown adicional, directo para ser renderizado en la aplicación.`;

  const userMessage =
    `Módulo: "${safeModule}"\nLección: "${safeLesson}"\n` +
    (snippet ? `Contenido clave: ${snippet}\n` : '') +
    `Genera la infografía SVG completa ahora.`;

  try {
    const resp = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    }));
    const raw: string = JSON.parse(new TextDecoder().decode(resp.body)).content?.[0]?.text ?? '';
    // Haiku often wraps output in ```svg or ```xml fences — strip them before extracting
    const text = raw.replace(/```(?:svg|xml|html)?\s*/gi, '').replace(/```\s*/g, '');
    const svgMatch = text.match(/<svg[\s\S]*<\/svg>/i);
    if (!svgMatch) { console.error('[InfographicGen] Haiku returned no SVG block'); return null; }
    const svgBuffer = Buffer.from(svgMatch[0], 'utf-8');
    const key = `lessons/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.svg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_IMAGES_BUCKET, Key: key, Body: svgBuffer,
      ContentType: 'image/svg+xml',
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
