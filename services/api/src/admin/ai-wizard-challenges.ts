// Trello DmPpbrff (Mack, 2026-09-18): retos de atención — Fase 1 (SOCRÁTICA + ORÁCULO).
// Genera 1-2 retos por módulo, aleatorios entre las lecciones de texto.
import { invokeBedrockForJson } from './ctx';

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

    const prompt = isBlEN
      ? `You are an expert in corporate learning design. Read this lesson excerpt and create exactly 2 attention challenges:

LESSON: ${rawText}

Challenge 1 (type SOCRÁTICA): Write a believable but FALSE myth about the main concept. Then write a 1-2 sentence explanation of why it's false. The student must decide: true or false?
Challenge 2 (type ORÁCULO): Write a 1-line practical scenario where something goes wrong related to the topic. Provide exactly 2 decision options — only one is correct per the lesson content.

Rules: professional tone, no childish language, no "Congratulations!" framing. Return ONLY JSON, no markdown:
[
  {"type":"SOCRÁTICA","question":"[the myth statement]","options":["Verdadero","Falso"],"correctIndex":1,"explanation":"[why it's false]"},
  {"type":"ORÁCULO","question":"[the scenario]","options":["[option A]","[option B]"],"correctIndex":0,"explanation":"[why option A is correct]"}
]`
      : `Eres un experto en diseño de experiencias de aprendizaje corporativo. Lee este fragmento de lección y crea exactamente 2 retos de atención:

LECCIÓN: ${rawText}

Reto 1 (tipo SOCRÁTICA): Redacta un mito creíble pero FALSO sobre el concepto principal. Luego escribe una explicación de 1-2 oraciones de por qué es falso. El estudiante debe decidir: ¿verdadero o falso?
Reto 2 (tipo ORÁCULO): Redacta un escenario práctico de 1 línea donde algo sale mal relacionado al tema. Ofrece exactamente 2 opciones de decisión — solo una es correcta según la lección.

Reglas: tono profesional, directo, elegante. Sin lenguaje infantil. Sin frases de videojuego. Devuelve ÚNICAMENTE JSON sin markdown:
[
  {"type":"SOCRÁTICA","question":"[la afirmación mito]","options":["Verdadero","Falso"],"correctIndex":1,"explanation":"[por qué es falso]"},
  {"type":"ORÁCULO","question":"[el escenario]","options":["[opción A]","[opción B]"],"correctIndex":0,"explanation":"[por qué la opción A es correcta]"}
]`;

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
