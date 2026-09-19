// Trello DmPpbrff (Mack, 2026-09-18): Diapositivas IA por módulo en portal evaluador.
// Estructura 55 min: 5 magistral + 10 Q&A + 20 actividad + 15 discusión + 5 reflexión.
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from '../shared/db-dynamo';
import { ok, badRequest, serverError } from '../shared/response';
import { bedrock } from './ctx';
import type { EvalCtx } from './ctx';

const HAIKU = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
const PEXELS_KEY = process.env.PEXELS_API_KEY ?? '';
const SLIDES_SK = 'SLIDES';

export interface Slide {
  index: number;
  type: 'MAGISTRAL' | 'QA' | 'ACTIVITY' | 'DISCUSSION' | 'REFLECTION';
  timeRange: string;
  title: string;
  content: string;
  speakerNotes: string;
  imageUrl: string | null;
  imageCredit: string | null;
}

async function bedrockJson(prompt: string, maxTokens = 2000): Promise<any> {
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

async function generateSlides(moduleTitle: string, moduleDescription: string, lang: string): Promise<Slide[]> {
  const isES = lang !== 'EN';
  const prompt = isES
    ? `Eres un diseñador instruccional experto en formación corporativa presencial.
Crea exactamente 11 diapositivas para una clase de 55 minutos sobre el módulo "${moduleTitle}".
Descripción: ${moduleDescription.slice(0, 800)}

Estructura obligatoria:
- Diapositivas 1-3 (MAGISTRAL, 00-05 min): Exposición magistral de alto impacto, concepto núcleo del módulo.
- Diapositiva 4 (QA, 05-15 min): "Open Floor" — espacio para preguntas sobre la exposición.
- Diapositivas 5-7 (ACTIVITY, 15-35 min): Actividad lúdica sugerida (debate, juego de roles, dinámica grupal).
- Diapositivas 8-10 (DISCUSSION, 35-50 min): Preguntas socráticas directas para profundizar el tema.
- Diapositiva 11 (REFLECTION, 50-55 min): Preparación para la reflexión obligatoria del módulo.

Reglas: tono académico-profesional, sin lenguaje de videojuego, sin emojis en contenido.
Para imageKeywords usa 2-3 palabras en inglés relacionadas al tema (para búsqueda en banco de imágenes).
Devuelve ÚNICAMENTE un JSON array, sin markdown:
[{
  "index": 0,
  "type": "MAGISTRAL",
  "timeRange": "00-05",
  "title": "Título de la diapositiva",
  "content": "Texto principal (máx 60 palabras)",
  "speakerNotes": "Notas del orador (1-2 oraciones)",
  "imageKeywords": "corporate training team"
}]`
    : `You are an expert instructional designer for corporate training.
Create exactly 11 slides for a 55-minute class on the module "${moduleTitle}".
Description: ${moduleDescription.slice(0, 800)}

Required structure:
- Slides 1-3 (MAGISTRAL, 00-05 min): High-impact lecture slides, module core concept.
- Slide 4 (QA, 05-15 min): "Open Floor" — space for questions about the lecture.
- Slides 5-7 (ACTIVITY, 15-35 min): AI-suggested dynamic activity (debate, role-play, group exercise).
- Slides 8-10 (DISCUSSION, 35-50 min): Socratic questions to deepen the topic.
- Slide 11 (REFLECTION, 50-55 min): Preparation for the module's mandatory reflection.

Rules: professional academic tone, no gamification language, no emojis in content.
For imageKeywords use 2-3 English words related to the topic (for stock image search).
Return ONLY a JSON array, no markdown:
[{
  "index": 0,
  "type": "MAGISTRAL",
  "timeRange": "00-05",
  "title": "Slide title",
  "content": "Main text (max 60 words)",
  "speakerNotes": "Speaker note (1-2 sentences)",
  "imageKeywords": "corporate training team"
}]`;

  const raw = await bedrockJson(prompt, 3000);
  if (!Array.isArray(raw)) return [];

  const slides: Slide[] = await Promise.all(
    raw.slice(0, 11).map(async (s: any, i: number) => {
      const img = await fetchPexelsImage(s.imageKeywords ?? moduleTitle).catch(() => null);
      return {
        index: i,
        type: s.type as Slide['type'],
        timeRange: s.timeRange ?? '',
        title: s.title ?? '',
        content: s.content ?? '',
        speakerNotes: s.speakerNotes ?? '',
        imageUrl: img?.url ?? null,
        imageCredit: img?.credit ?? null,
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
    // Access check: evaluator must own the course, or be admin
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

    // Fetch current slides
    const item = await ddb.send(new GetCommand({ TableName: TABLES.SLIDES, Key: { moduleId, sk: SLIDES_SK } }));
    const slides: Slide[] = item.Item?.slides ?? [];
    const current = slides[slideIndex];
    if (!current) return badRequest('Diapositiva no encontrada');

    const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true, course: { select: { planLanguage: true } } } });
    const isES = (mod?.course?.planLanguage ?? 'ES') !== 'EN';

    const prompt = isES
      ? `Eres un diseñador instruccional. Tienes esta diapositiva de una presentación de "${mod?.title ?? 'módulo'}":

Tipo: ${current.type} | Rango: ${current.timeRange} min
Título: ${current.title}
Contenido: ${current.content}

El evaluador pide este cambio: "${feedback.trim()}"

Genera una nueva versión de ESTA DIAPOSITIVA corrigiendo lo solicitado. Mantén el tipo, timeRange e imageKeywords similares.
Devuelve SOLO el JSON (sin markdown):
{"type":"${current.type}","timeRange":"${current.timeRange}","title":"...","content":"...","speakerNotes":"...","imageKeywords":"..."}`
      : `You are an instructional designer. You have this slide from a "${mod?.title ?? 'module'}" presentation:

Type: ${current.type} | Range: ${current.timeRange} min
Title: ${current.title}
Content: ${current.content}

The evaluator requests this change: "${feedback.trim()}"

Generate a new version of THIS SLIDE addressing the request. Keep the type, timeRange and similar imageKeywords.
Return ONLY JSON (no markdown):
{"type":"${current.type}","timeRange":"${current.timeRange}","title":"...","content":"...","speakerNotes":"...","imageKeywords":"..."}`;

    const res = await bedrock.send(new InvokeModelCommand({
      modelId: HAIKU,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
    }));
    const text = JSON.parse(new TextDecoder().decode(res.body)).content[0].text as string;
    const match = text.match(/\{[\s\S]*\}/);
    let updated: any = null;
    try { if (match) updated = JSON.parse(match[0]); } catch { /* ignore */ }
    if (!updated) return serverError(new Error('Error generando nueva versión'));

    const img = await fetchPexelsImage(updated.imageKeywords ?? current.title).catch(() => null);
    const newSlide: Slide = {
      index: slideIndex,
      type: updated.type as Slide['type'] ?? current.type,
      timeRange: updated.timeRange ?? current.timeRange,
      title: updated.title ?? current.title,
      content: updated.content ?? current.content,
      speakerNotes: updated.speakerNotes ?? current.speakerNotes,
      imageUrl: img?.url ?? current.imageUrl,
      imageCredit: img?.credit ?? current.imageCredit,
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
