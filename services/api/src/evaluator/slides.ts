// Trello DmPpbrff (Mack, 2026-09-18): Diapositivas IA por módulo en portal evaluador.
// Estructura 55 min: 5 magistral + 10 Q&A + 10 video + 15 actividad + 10 discusión + 5 conclusión.
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from '../shared/db-dynamo';
import { ok, badRequest, serverError } from '../shared/response';
import { bedrock } from './ctx';
import type { EvalCtx } from './ctx';

const HAIKU = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
const PEXELS_KEY = process.env.PEXELS_API_KEY ?? '';
const YOUTUBE_KEY = process.env.YOUTUBE_API_KEY ?? '';
const SLIDES_SK = 'SLIDES';

export interface Slide {
  index: number;
  type: 'MAGISTRAL' | 'QA' | 'ACTIVITY' | 'DISCUSSION' | 'CONCLUSION' | 'VIDEO';
  timeRange: string;
  title: string;
  content: string;
  bullets?: string[];
  speakerNotes: string;
  imageUrl: string | null;
  imageCredit: string | null;
  videoId?: string | null;
  watchPoints?: string[];
}

async function bedrockJson(prompt: string, maxTokens = 2500): Promise<any> {
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: HAIKU,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  }));
  const text = JSON.parse(new TextDecoder().decode(res.body)).content[0].text as string;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function fetchPexelsImage(keywords: string): Promise<{ url: string; credit: string } | null> {
  if (!PEXELS_KEY) return null;
  try {
    const q = encodeURIComponent(keywords);
    const res = await fetch(`https://api.pexels.com/v1/search?query=${q}&per_page=5&orientation=landscape`, {
      headers: { Authorization: PEXELS_KEY },
    });
    const data = await res.json() as any;
    const photo = data?.photos?.[0];
    if (!photo) return null;
    return { url: photo.src.large2x ?? photo.src.large, credit: photo.photographer };
  } catch { return null; }
}

async function fetchYouTubeVideo(keywords: string): Promise<string | null> {
  if (!YOUTUBE_KEY) return null;
  try {
    const q = encodeURIComponent(keywords);
    // videoDuration=medium excludes Shorts (<4 min); relevanceLanguage=en prefers English; maxResults=10 for duration filtering
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=id&q=${q}&type=video&videoCategoryId=27&safeSearch=strict&videoEmbeddable=true&videoDuration=medium&relevanceLanguage=en&order=relevance&maxResults=10&key=${YOUTUBE_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json() as any;
    const ids: string[] = (searchData?.items ?? []).map((it: any) => it?.id?.videoId).filter(Boolean);
    if (!ids.length) return null;

    // Filter to max 10 min via contentDetails
    const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(',')}&key=${YOUTUBE_KEY}`;
    const detailRes = await fetch(detailUrl);
    const detailData = await detailRes.json() as any;
    for (const item of (detailData?.items ?? [])) {
      const dur = item?.contentDetails?.duration ?? '';
      const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?/);
      if (!m) continue;
      if (parseInt(m[1] ?? '0') > 0) continue;
      if (parseInt(m[2] ?? '0') > 10) continue;
      return item.id as string;
    }
    return ids[0] ?? null;
  } catch { return null; }
}

async function generateSlides(moduleTitle: string, moduleDescription: string, lang: string): Promise<Slide[]> {
  const isES = lang !== 'EN';
  const prompt = isES
    ? `Eres un diseñador instruccional experto en formación corporativa presencial.
Crea exactamente 11 diapositivas para una clase de 55 minutos sobre el módulo "${moduleTitle}".
Descripción: ${moduleDescription.slice(0, 800)}

Estructura obligatoria:
- Diapositivas 1-3 (MAGISTRAL, 00-05 min): Exposición magistral. Usa bullet points cortos y directos.
- Diapositiva 4 (QA, 05-15 min): "Preguntas de Análisis" — espacio para preguntas de la audiencia.
- Diapositiva 5 (VIDEO, 15-25 min): Recurso audiovisual educativo con puntos de observación.
- Diapositivas 6-7 (ACTIVITY, 25-40 min): Actividad lúdica (debate, juego de roles, dinámica grupal).
- Diapositivas 8-10 (DISCUSSION, 40-50 min): "Preguntas de Análisis" socráticas para debate.
- Diapositiva 11 (CONCLUSION, 50-55 min): "Conclusión Clave" — resumen y punto de retención.

Reglas:
- Tono académico-profesional, sin emojis en contenido.
- content y bullets son texto visible en la diapositiva: NUNCA incluyas instrucciones al orador ahí (esas van solo en speakerNotes).
- Títulos PROHIBIDOS (nunca usar en title ni content): "Bienvenida", "Bienvenidos", "Debate socrático", "Reflexión obligatoria", "Pregunta socrática". Los títulos deben ser temáticos y descriptivos del módulo.
- Para imageKeywords: 2-3 palabras en inglés (búsqueda Pexels).
- Para videoSearchTerms (solo tipo VIDEO): términos de búsqueda en inglés para YouTube educativo.
- bullets: array de 3-5 puntos cortos (solo para MAGISTRAL, DISCUSSION, CONCLUSION).
- speakerNotes: SOLO para el orador, NO visible en pantalla. Formato exacto: "GANCHO: una oración. DESARROLLO: una oración. CIERRE: una pregunta." — todo en una sola cadena de texto plano, sin saltos de línea.
- watchPoints (solo VIDEO): array de 2-3 frases "Observa cómo..." para guiar la atención.
- CRÍTICO: el campo "content" debe ser UNA SOLA frase o párrafo corto para el público. NUNCA incluyas "GANCHO:", "DESARROLLO:", "CIERRE:" ni ninguna etiqueta de orador en content ni en bullets.

Devuelve ÚNICAMENTE un JSON array, sin markdown:
[{
  "index": 0,
  "type": "MAGISTRAL",
  "timeRange": "00-05",
  "title": "Título temático del módulo",
  "content": "Una frase de apertura para la audiencia (máx 30 palabras).",
  "bullets": ["Concepto clave 1", "Concepto clave 2", "Concepto clave 3"],
  "speakerNotes": "GANCHO: cómo captar atención. DESARROLLO: qué enfatizar. CIERRE: pregunta para el grupo.",
  "imageKeywords": "corporate training"
}]`
    : `You are an expert instructional designer for corporate training.
Create exactly 11 slides for a 55-minute class on module "${moduleTitle}".
Description: ${moduleDescription.slice(0, 800)}

Required structure:
- Slides 1-3 (MAGISTRAL, 00-05 min): High-impact lecture with bullet points.
- Slide 4 (QA, 05-15 min): "Analysis Questions" — audience questions space.
- Slide 5 (VIDEO, 15-25 min): Educational video resource with observation points.
- Slides 6-7 (ACTIVITY, 25-40 min): Dynamic activity (debate, role-play, group exercise).
- Slides 8-10 (DISCUSSION, 40-50 min): "Analysis Questions" for deep discussion.
- Slide 11 (CONCLUSION, 50-55 min): "Key Conclusion" — retention point summary.

Rules:
- Professional academic tone, no emojis in content.
- content and bullets are text visible on the slide: NEVER include presenter instructions there (those go only in speakerNotes).
- FORBIDDEN titles (never use in title or content): "Welcome", "Socratic debate", "Mandatory reflection", "Socratic question". Titles must be thematic and descriptive of the module topic.
- imageKeywords: 2-3 English words for Pexels search.
- videoSearchTerms (VIDEO type only): English search terms for YouTube educational search.
- bullets: array of 3-5 short points (MAGISTRAL, DISCUSSION, CONCLUSION only).
- speakerNotes: ONLY for the speaker, NOT visible on screen. Exact format: "HOOK: one sentence. DEVELOP: one sentence. CLOSE: one question." — all in a single plain text string, no line breaks.
- watchPoints (VIDEO only): array of 2-3 "Notice how..." phrases.
- CRITICAL: the "content" field must be ONE short phrase or paragraph for the audience. NEVER include "HOOK:", "DEVELOP:", "CLOSE:" or any speaker labels in content or bullets.

Return ONLY a JSON array, no markdown:
[{
  "index": 0,
  "type": "MAGISTRAL",
  "timeRange": "00-05",
  "title": "Thematic slide title",
  "content": "One opening sentence for the audience (max 30 words).",
  "bullets": ["Key concept 1", "Key concept 2", "Key concept 3"],
  "speakerNotes": "HOOK: how to capture attention. DEVELOP: what to emphasize. CLOSE: question for the group.",
  "imageKeywords": "corporate training"
}]`;

  const raw = await bedrockJson(prompt, 3500);
  if (!Array.isArray(raw)) return [];

  const slides: Slide[] = await Promise.all(
    raw.slice(0, 11).map(async (s: any, i: number) => {
      const isVideo = s.type === 'VIDEO';
      const [img, videoId] = await Promise.all([
        isVideo ? Promise.resolve(null) : fetchPexelsImage(s.imageKeywords ?? moduleTitle).catch(() => null),
        isVideo ? fetchYouTubeVideo(s.videoSearchTerms ?? moduleTitle).catch(() => null) : Promise.resolve(null),
      ]);
      return {
        index: i,
        type: s.type as Slide['type'],
        timeRange: s.timeRange ?? '',
        title: s.title ?? '',
        content: s.content ?? '',
        bullets: Array.isArray(s.bullets) ? s.bullets : undefined,
        speakerNotes: s.speakerNotes ?? '',
        imageUrl: img?.url ?? null,
        imageCredit: img?.credit ?? null,
        videoId: videoId ?? null,
        watchPoints: Array.isArray(s.watchPoints) ? s.watchPoints : undefined,
      };
    })
  );
  return slides;
}

export async function handleSlides(ctx: EvalCtx): Promise<any | null> {
  const { method, path, prisma, body, userId, isAdminRole } = ctx;

  // GET /evaluator/courses/{courseId}/modules/{moduleId}/presentation
  const getMatch = path.match(/^\/evaluator\/courses\/([^/]+)\/modules\/([^/]+)\/presentation$/);
  if (method === 'GET' && getMatch) {
    const [, courseId, moduleId] = getMatch;
    if (!isAdminRole) {
      const course = await prisma.course.findFirst({ where: { id: courseId, evaluatorId: userId }, select: { id: true } });
      if (!course) return badRequest('No autorizado para este curso');
    }
    const item = await ddb.send(new GetCommand({ TableName: TABLES.SLIDES, Key: { moduleId, sk: SLIDES_SK } }));
    return ok({ slides: item.Item?.slides ?? null, generatedAt: item.Item?.generatedAt ?? null });
  }

  // POST /evaluator/courses/{courseId}/modules/{moduleId}/presentation/generate
  const genMatch = path.match(/^\/evaluator\/courses\/([^/]+)\/modules\/([^/]+)\/presentation\/generate$/);
  if (method === 'POST' && genMatch) {
    const [, courseId, moduleId] = genMatch;
    if (!isAdminRole) {
      const course = await prisma.course.findFirst({ where: { id: courseId, evaluatorId: userId }, select: { id: true } });
      if (!course) return badRequest('No autorizado para este curso');
    }
    const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true, description: true, course: { select: { planLanguage: true } } } });
    if (!mod) return badRequest('Módulo no encontrado');

    const lang = mod.course?.planLanguage ?? 'ES';
    const slides = await generateSlides(mod.title, mod.description ?? mod.title, lang);
    if (!slides.length) return serverError(new Error('No se pudo generar el contenido de las diapositivas'));

    await ddb.send(new PutCommand({
      TableName: TABLES.SLIDES,
      Item: { moduleId, sk: SLIDES_SK, courseId, slides, generatedAt: new Date().toISOString() },
    }));
    return ok({ slides, generatedAt: new Date().toISOString() });
  }

  // POST /evaluator/courses/{courseId}/modules/{moduleId}/presentation/regenerate
  const regenMatch = path.match(/^\/evaluator\/courses\/([^/]+)\/modules\/([^/]+)\/presentation\/regenerate$/);
  if (method === 'POST' && regenMatch) {
    const [, courseId, moduleId] = regenMatch;
    if (!isAdminRole) {
      const course = await prisma.course.findFirst({ where: { id: courseId, evaluatorId: userId }, select: { id: true } });
      if (!course) return badRequest('No autorizado para este curso');
    }
    const { slideIndex, feedback } = body as { slideIndex: number; feedback: string };
    if (typeof slideIndex !== 'number' || !feedback?.trim()) return badRequest('slideIndex y feedback requeridos');

    const item = await ddb.send(new GetCommand({ TableName: TABLES.SLIDES, Key: { moduleId, sk: SLIDES_SK } }));
    const slides: Slide[] = item.Item?.slides ?? [];
    const current = slides[slideIndex];
    if (!current) return badRequest('Diapositiva no encontrada');

    const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true, course: { select: { planLanguage: true } } } });
    const isES = (mod?.course?.planLanguage ?? 'ES') !== 'EN';

    const prompt = isES
      ? `Eres un diseñador instruccional. Tienes esta diapositiva de "${mod?.title ?? 'módulo'}":
Tipo: ${current.type} | Rango: ${current.timeRange} min
Título: ${current.title}
Contenido: ${current.content}
El evaluador pide: "${feedback.trim()}"
Genera una nueva versión corrigiendo lo solicitado. Mantén tipo y timeRange.
Devuelve SOLO el JSON (sin markdown):
{"type":"${current.type}","timeRange":"${current.timeRange}","title":"...","content":"...","bullets":["..."],"speakerNotes":"GANCHO:... DESARROLLO:... CIERRE:...","imageKeywords":"...","videoSearchTerms":"...","watchPoints":["..."]}`
      : `You are an instructional designer. You have this slide from "${mod?.title ?? 'module'}":
Type: ${current.type} | Range: ${current.timeRange} min
Title: ${current.title}
Content: ${current.content}
The evaluator requests: "${feedback.trim()}"
Generate a new version addressing the request. Keep same type and timeRange.
Return ONLY JSON (no markdown):
{"type":"${current.type}","timeRange":"${current.timeRange}","title":"...","content":"...","bullets":["..."],"speakerNotes":"HOOK:... DEVELOP:... CLOSE:...","imageKeywords":"...","videoSearchTerms":"...","watchPoints":["..."]}`;

    const res = await bedrock.send(new InvokeModelCommand({
      modelId: HAIKU,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
    }));
    const text = JSON.parse(new TextDecoder().decode(res.body)).content[0].text as string;
    const match = text.match(/\{[\s\S]*\}/);
    let updated: any = null;
    try { if (match) updated = JSON.parse(match[0]); } catch { /* ignore */ }
    if (!updated) return serverError(new Error('Error generando nueva versión'));

    const isVideo = updated.type === 'VIDEO';
    const [img, videoId] = await Promise.all([
      isVideo ? Promise.resolve(null) : fetchPexelsImage(updated.imageKeywords ?? current.title).catch(() => null),
      isVideo ? fetchYouTubeVideo(updated.videoSearchTerms ?? current.title).catch(() => null) : Promise.resolve(null),
    ]);

    const newSlide: Slide = {
      index: slideIndex,
      type: (updated.type as Slide['type']) ?? current.type,
      timeRange: updated.timeRange ?? current.timeRange,
      title: updated.title ?? current.title,
      content: updated.content ?? current.content,
      bullets: Array.isArray(updated.bullets) ? updated.bullets : current.bullets,
      speakerNotes: updated.speakerNotes ?? current.speakerNotes,
      imageUrl: img?.url ?? (isVideo ? null : current.imageUrl),
      imageCredit: img?.credit ?? (isVideo ? null : current.imageCredit),
      videoId: videoId ?? (isVideo ? current.videoId : null),
      watchPoints: Array.isArray(updated.watchPoints) ? updated.watchPoints : (isVideo ? current.watchPoints : undefined),
    };

    const updatedSlides = [...slides];
    updatedSlides[slideIndex] = newSlide;
    await ddb.send(new PutCommand({
      TableName: TABLES.SLIDES,
      Item: { ...item.Item, slides: updatedSlides, updatedAt: new Date().toISOString() },
    }));
    return ok({ slide: newSlide });
  }

  return null;
}
