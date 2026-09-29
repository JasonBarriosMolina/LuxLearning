// Trello DmPpbrff (Mack, 2026-09-18): retos de atención — Fase 1 (SOCRÁTICA + ORÁCULO).
// Fase 2 (2026-09-28): added BIFURCACIÓN and ESLABÓN types.
// Genera 1-3 retos por módulo, aleatorios entre las lecciones de texto.
import { invokeBedrockForJson } from './ctx';

// All 4 challenge types — 2 per lesson call, picked randomly from this pool.
const CHALLENGE_TYPES_ES = ['SOCRÁTICA', 'ORÁCULO', 'BIFURCACIÓN', 'ESLABÓN'] as const;
const CHALLENGE_TYPES_EN = ['SOCRÁTICA', 'ORÁCULO', 'BIFURCACIÓN', 'ESLABÓN'] as const;

function pickTwoTypes(isBlEN: boolean): [string, string] {
  const pool = [...(isBlEN ? CHALLENGE_TYPES_EN : CHALLENGE_TYPES_ES)];
  pool.sort(() => Math.random() - 0.5);
  return [pool[0]!, pool[1]!];
}

export async function generateModuleChallenges(prisma: any, moduleId: string, moduleTitle: string, isBlEN: boolean): Promise<void> {
  const textLessons = await prisma.lesson.findMany({
    where: { moduleId, type: 'text' },
    select: { id: true, content: true, order: true },
    orderBy: { order: 'asc' },
  });

  if (textLessons.length === 0) return;

  // Pick 1-2 random text lessons — avoid first and last (video) to maintain focus flow.
  const pool = [...textLessons];
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const targets = shuffled.slice(0, Math.min(2, shuffled.length));

  for (const lesson of targets) {
    // Strip HTML tags for the prompt — use first ~1200 chars of content.
    const rawText = (lesson.content as string ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200);

    if (rawText.length < 100) continue;

    const [type1, type2] = pickTwoTypes(isBlEN);

    const typeDescEN: Record<string, string> = {
      'SOCRÁTICA': 'Write a believable but FALSE myth about the main concept. Student decides: true or false?\nFormat: {"type":"SOCRÁTICA","question":"[the myth]","options":["True","False"],"correctIndex":1,"explanation":"[why it\'s false]"}',
      'ORÁCULO': 'Write a 1-line scenario where something goes wrong. Give 2 decision options, one correct per the lesson.\nFormat: {"type":"ORÁCULO","question":"[scenario]","options":["[A]","[B]"],"correctIndex":0,"explanation":"[why A is correct]"}',
      'BIFURCACIÓN': 'Present a professional dilemma with 2 strategic options (e.g., "Speed vs. Precision"). Only one aligns with best practices from the lesson.\nFormat: {"type":"BIFURCACIÓN","question":"[the dilemma]","options":["[option A]","[option B]"],"correctIndex":0,"explanation":"[why A is the right approach]"}',
      'ESLABÓN': 'Write 1 sentence naming a concept just covered, then ask which of 3 options is the logical bridge to the NEXT logical concept in the domain. One option is correct.\nFormat: {"type":"ESLABÓN","question":"[linking question]","options":["[A]","[B]","[C]"],"correctIndex":0,"explanation":"[why A is the bridge]"}',
    };
    const typeDescES: Record<string, string> = {
      'SOCRÁTICA': 'Redacta un mito creíble pero FALSO. El estudiante decide: ¿verdadero o falso?\nFormato: {"type":"SOCRÁTICA","question":"[el mito]","options":["Verdadero","Falso"],"correctIndex":1,"explanation":"[por qué es falso]"}',
      'ORÁCULO': 'Redacta un escenario de 1 línea donde algo sale mal. Ofrece 2 opciones de decisión, solo una correcta.\nFormato: {"type":"ORÁCULO","question":"[escenario]","options":["[A]","[B]"],"correctIndex":0,"explanation":"[por qué A es correcto]"}',
      'BIFURCACIÓN': 'Presenta un dilema profesional con 2 opciones estratégicas (ej. "¿Velocidad o Precisión?"). Solo una alinea con las mejores prácticas de la lección.\nFormato: {"type":"BIFURCACIÓN","question":"[el dilema]","options":["[opción A]","[opción B]"],"correctIndex":0,"explanation":"[por qué A es el enfoque correcto]"}',
      'ESLABÓN': 'Nombra un concepto recién cubierto y pregunta cuál de 3 opciones es el puente lógico al siguiente concepto del dominio. Una es correcta.\nFormato: {"type":"ESLABÓN","question":"[pregunta de conexión]","options":["[A]","[B]","[C]"],"correctIndex":0,"explanation":"[por qué A es el eslabón]"}',
    };

    const typeDescs = isBlEN ? typeDescEN : typeDescES;

    const prompt = isBlEN
      ? `You are an expert in corporate learning design. Read this lesson excerpt and create exactly 2 attention challenges.

LESSON: ${rawText}

Challenge 1 (type ${type1}):
${typeDescs[type1]}

Challenge 2 (type ${type2}):
${typeDescs[type2]}

Rules: professional tone, no childish language, no "Congratulations!" framing, no game language. Return ONLY a JSON array with exactly 2 objects, no markdown.`
      : `Eres un experto en diseño de experiencias de aprendizaje corporativo. Lee este fragmento y crea exactamente 2 retos de atención.

LECCIÓN: ${rawText}

Reto 1 (tipo ${type1}):
${typeDescs[type1]}

Reto 2 (tipo ${type2}):
${typeDescs[type2]}

Reglas: tono profesional, directo, elegante. Sin lenguaje infantil. Sin frases de videojuego. Devuelve ÚNICAMENTE un array JSON con exactamente 2 objetos, sin markdown.`;

    const raw = await invokeBedrockForJson(prompt, 800).catch(() => null);
    if (!Array.isArray(raw) || raw.length === 0) continue;

    // Calculate paragraph index: insert after 40-60% into the lesson paragraphs.
    const paraCount = (lesson.content as string ?? '').split(/<\/p>|<\/h3>|<\/div>/i).length;
    const paragraphIndex = Math.max(1, Math.floor(paraCount * (0.4 + Math.random() * 0.2)));

    const challengeData = raw
      .filter((c: any) => c?.type && c?.question && Array.isArray(c?.options) && c?.options.length >= 2)
      .slice(0, 2)
      .map((c: any) => ({
        moduleId,
        lessonId: lesson.id,
        paragraphIndex,
        type: c.type as string,
        question: c.question as string,
        options: c.options as string[],
        correctIndex: typeof c.correctIndex === 'number' ? c.correctIndex : 1,
        explanation: (c.explanation as string) ?? '',
        xpReward: 5,
      }));

    if (challengeData.length > 0) {
      await prisma.lessonChallenge.createMany({ data: challengeData, skipDuplicates: true });
    }
  }
}
