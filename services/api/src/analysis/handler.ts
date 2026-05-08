/**
 * Nightly Analysis Lambda — triggered by EventBridge at 02:00 UTC
 * Analyzes reflections and quiz data per module using Bedrock Haiku 4.5
 * Stores results in ReportAnalysis + CurriculumRecommendations tables
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getPrismaClient } from '../shared/db-neon';
import {
  getAllReflections, getAllQuizAttempts,
  saveReportAnalysis, saveRecommendations,
} from '../shared/db-dynamo';
import { createId } from '@paralleldrive/cuid2';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
const MIN_REFLECTIONS = 3; // minimum reflections needed to run AI analysis

async function callBedrock(prompt: string, maxTokens = 1024): Promise<string> {
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  }));
  const parsed = JSON.parse(new TextDecoder().decode(res.body));
  return parsed.content?.[0]?.text ?? '{}';
}

function parseJSON(raw: string): any {
  const clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export const handler = async () => {
  console.log('[Analysis] Starting nightly analysis job...');
  const prisma = getPrismaClient();

  try {
    const [allReflections, allAttempts, modules] = await Promise.all([
      getAllReflections(),
      getAllQuizAttempts(),
      prisma.module.findMany({
        include: {
          course: { select: { title: true } },
          questions: { orderBy: { order: 'asc' }, select: { id: true, text: true, options: true, correctIndex: true } },
        },
      }),
    ]);

    let analyzed = 0;
    let skipped = 0;

    for (const mod of modules) {
      try {
        // Filter approved reflections for this module
        const modReflections = allReflections.filter(
          (r) => r.moduleId === mod.id && r.status === 'APPROVED' && r.text
        );

        // Compute quiz weak topics (no AI needed — pure math)
        const modAttempts = allAttempts.filter((a) => a.moduleId === mod.id);
        const weakQuizTopics = mod.questions.map((q, i) => {
          const total = modAttempts.filter((a) => Array.isArray(a.answers) && a.answers.length > i).length;
          const errors = modAttempts.filter((a) => Array.isArray(a.answers) && a.answers.length > i && a.answers[i] !== q.correctIndex).length;
          return { questionText: q.text.slice(0, 120), errorRate: total > 0 ? Math.round((errors / total) * 100) : 0 };
        }).filter((q) => q.errorRate > 30).sort((a, b) => b.errorRate - a.errorRate).slice(0, 5);

        if (modReflections.length < MIN_REFLECTIONS) {
          // Still save quiz weak topics even without enough reflections
          if (weakQuizTopics.length > 0) {
            await saveReportAnalysis({
              moduleId: mod.id,
              keyTopics: [],
              reflectionSummary: `Aún no hay suficientes reflexiones para análisis cualitativo (${modReflections.length} de ${MIN_REFLECTIONS} mínimas).`,
              weakQuizTopics,
              reflectionCount: modReflections.length,
              analyzedAt: new Date().toISOString(),
            });
          }
          skipped++;
          continue;
        }

        // Build context for Bedrock (limit text to avoid token overflow)
        const reflectionsSample = modReflections.slice(0, 20).map((r, i) =>
          `[${i + 1}] ${(r.text ?? '').slice(0, 400)}`
        ).join('\n\n');

        // Step 1: Analyze reflection themes
        const analysisPrompt = `Eres un analista pedagógico especializado en "${mod.course.title}" — módulo "${mod.title}".

Analiza estas ${modReflections.length} reflexiones de estudiantes y extrae patrones de aprendizaje:

REFLEXIONES:
"""
${reflectionsSample}
"""

Proporciona:
1. Los 5 temas principales que emergen, con su frecuencia estimada (1-${modReflections.length}) y sentimiento (positive/neutral/negative)
2. Un resumen de 2-3 oraciones de los patrones comunes de aprendizaje

Responde ÚNICAMENTE con JSON válido:
{
  "keyTopics": [
    {"topic": "nombre del tema", "count": n, "sentiment": "positive|neutral|negative"}
  ],
  "reflectionSummary": "resumen de 2-3 oraciones"
}`;

        const analysisRaw = await callBedrock(analysisPrompt, 800);
        const analysisData = parseJSON(analysisRaw);

        await saveReportAnalysis({
          moduleId: mod.id,
          keyTopics: analysisData?.keyTopics ?? [],
          reflectionSummary: analysisData?.reflectionSummary ?? '',
          weakQuizTopics,
          reflectionCount: modReflections.length,
          analyzedAt: new Date().toISOString(),
        });

        // Step 2: Generate curriculum recommendations only if there are weak topics
        if (weakQuizTopics.length > 0) {
          const recsPrompt = `Eres un experto en diseño curricular. El módulo "${mod.title}" del curso "${mod.course.title}" tiene los siguientes conceptos donde los estudiantes cometen errores frecuentes:

${weakQuizTopics.map((t) => `- "${t.questionText}" (${t.errorRate}% de error)`).join('\n')}

Sugiere 3-5 recursos de aprendizaje específicos y accesibles (artículos online reales, libros reconocidos, videos de YouTube o plataformas educativas). Deben ser directamente relevantes a los conceptos débiles identificados.

Responde ÚNICAMENTE con JSON válido:
{
  "resources": [
    {
      "weakTopic": "concepto al que aplica",
      "title": "Título real del recurso",
      "type": "article|book|video|link",
      "url": "URL o ISBN del recurso",
      "description": "Por qué este recurso ayuda con este concepto específico (1-2 oraciones)"
    }
  ]
}`;

          const recsRaw = await callBedrock(recsPrompt, 1024);
          const recsData = parseJSON(recsRaw);

          if (recsData?.resources?.length > 0) {
            const items = recsData.resources.map((r: any) => ({
              id: createId(),
              weakTopic: String(r.weakTopic ?? '').slice(0, 100),
              title: String(r.title ?? '').slice(0, 200),
              type: ['article', 'book', 'video', 'link'].includes(r.type) ? r.type : 'link',
              url: String(r.url ?? '').slice(0, 500),
              description: String(r.description ?? '').slice(0, 500),
              aiGenerated: true,
            }));
            await saveRecommendations(mod.id, items);
          }
        }

        analyzed++;
        console.log(`[Analysis] ✓ ${mod.title} (${modReflections.length} reflexiones, ${weakQuizTopics.length} temas débiles)`);

        // Small delay to avoid Bedrock rate limits
        await new Promise((r) => setTimeout(r, 300));

      } catch (modErr) {
        console.warn(`[Analysis] Failed for module ${mod.id}:`, modErr);
        skipped++;
      }
    }

    console.log(`[Analysis] Done — analyzed: ${analyzed}, skipped: ${skipped}`);
    return { analyzed, skipped };

  } catch (err) {
    console.error('[Analysis] Fatal error:', err);
    throw err;
  }
};
