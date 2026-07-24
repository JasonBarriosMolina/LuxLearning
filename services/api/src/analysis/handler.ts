/**
 * Nightly Analysis Lambda — triggered by EventBridge at 02:00 UTC
 * Analyzes reflections and quiz data per module using Bedrock Sonnet 4.5
 * Stores results in ReportAnalysis + CurriculumRecommendations tables
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getPrismaClient } from '../shared/db-neon';
import {
  getAllReflections, getAllQuizAttempts, getAllEnrollments,
  saveReportAnalysis, saveRecommendations,
  getAttendanceMatrix, saveRiskScores, type RiskScore,
} from '../shared/db-dynamo';

const ses = new SESClient({ region: 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });
const SES_FROM = process.env.SES_FROM_EMAIL ?? 'jason.rbm@gmail.com';
const FRONTEND_URL = process.env.FRONTEND_URL ?? '';
import { createId } from '@paralleldrive/cuid2';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
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
  const prisma = await getPrismaClient();

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

    // ── Risk Score per course ──────────────────────────────────────────────
    try {
      const courses = await prisma.course.findMany({
        where: { isDraft: false, isArchived: false },
        select: { id: true, title: true, evaluatorId: true, totalWeeks: true },
      });
      const allEnrollments = await getAllEnrollments();

      for (const course of courses) {
        try {
          const [attendanceRecords, sessions] = await Promise.all([
            getAttendanceMatrix(course.id),
            prisma.courseSession.findMany({ where: { courseId: course.id }, select: { id: true } }),
          ]);
          const totalSessions = sessions.length;
          if (totalSessions === 0) continue;

          const enrolledUserIds = allEnrollments
            .filter((e: any) => e.courseId === course.id)
            .map((e: any) => e.userId);
          if (enrolledUserIds.length === 0) continue;

          // Count per-student metrics
          const courseReflections = allReflections.filter((r: any) => r.courseId === course.id || allAttempts.some(() => false));
          const courseAttempts = allAttempts.filter((a: any) => a.courseId === course.id);

          const riskScores: RiskScore[] = [];
          for (const uid of enrolledUserIds) {
            const myAttendance = attendanceRecords.filter((r: any) => r.userId === uid && r.sk !== 'RISK_SCORES');
            const absences = myAttendance.filter((r: any) => r.status === 'ABSENT' || r.status === 'REJECTED').length;
            const absenceRate = totalSessions > 0 ? absences / totalSessions : 0;

            const myReflections = allReflections.filter((r: any) => r.userId === uid);
            const rejectedReflections = myReflections.filter((r: any) => r.status === 'REJECTED').length;
            const reflectionRejectRate = myReflections.length > 0 ? rejectedReflections / myReflections.length : 0;

            const myAttempts = allAttempts.filter((a: any) => a.userId === uid);
            const failedAttempts = myAttempts.filter((a: any) => !a.passed).length;
            const quizFailRate = myAttempts.length > 0 ? failedAttempts / myAttempts.length : 0;

            const score = (absenceRate * 0.4) + (quizFailRate * 0.3) + (reflectionRejectRate * 0.3);
            const riskLevel: 'LOW' | 'MODERATE' | 'HIGH' = score > 0.6 ? 'HIGH' : score > 0.3 ? 'MODERATE' : 'LOW';

            const reasons: string[] = [];
            if (absenceRate > 0.2) reasons.push(`${Math.round(absenceRate * 100)}% de ausencias`);
            if (quizFailRate > 0.3) reasons.push(`${Math.round(quizFailRate * 100)}% de quizzes fallidos`);
            if (reflectionRejectRate > 0.2) reasons.push(`${Math.round(reflectionRejectRate * 100)}% de reflexiones rechazadas`);

            riskScores.push({
              userId: uid,
              name: uid,
              riskLevel,
              riskScore: Math.round(score * 100),
              absenceRate: Math.round(absenceRate * 100),
              reason: reasons.join(', ') || 'Sin indicadores de riesgo',
              suggestedAction: riskLevel === 'HIGH'
                ? 'Enviar mensaje de apoyo y programar tutoría de nivelación'
                : riskLevel === 'MODERATE'
                ? 'Enviar recordatorio motivador'
                : 'Sin acción requerida',
            });
          }

          // AI cohort insight with Bedrock Sonnet
          let cohortInsight = '';
          const atRisk = riskScores.filter((r) => r.riskLevel !== 'LOW');
          if (atRisk.length > 0) {
            const insightPrompt = `Eres un analista pedagógico de Lux Learning. Analiza estos datos de riesgo de abandono para el curso "${course.title}":

Estudiantes en riesgo:
${atRisk.map((r) => `- UserId ${r.userId}: ${r.riskLevel} (score: ${r.riskScore}%) — ${r.reason}`).join('\n')}

Genera UN párrafo conciso (máximo 3 oraciones) con el patrón general de riesgo del grupo y una recomendación para el evaluador.
Responde solo con el párrafo, sin JSON ni formato extra.`;
            try {
              cohortInsight = await callBedrock(insightPrompt, 300);
            } catch { /* non-fatal */ }
          }

          await saveRiskScores(course.id, riskScores, cohortInsight);

          // Email morning summary to evaluator if there are critical cases
          const criticalCases = riskScores.filter((r) => r.riskLevel === 'HIGH');
          if (criticalCases.length > 0 && course.evaluatorId) {
            try {
              const evUser = await cognito.send(new AdminGetUserCommand({
                UserPoolId: process.env.COGNITO_USER_POOL_ID!,
                Username: course.evaluatorId,
              })).catch(() => null);
              const evEmail = evUser?.UserAttributes?.find((a) => a.Name === 'email')?.Value;
              const evName = evUser?.UserAttributes?.find((a) => a.Name === 'name')?.Value ?? 'Evaluador';
              if (evEmail) {
                const criticalList = criticalCases
                  .map((r) => `<li><strong>${r.userId}</strong> — ${r.reason} (Score: ${r.riskScore}%)<br><em>Acción sugerida:</em> ${r.suggestedAction}</li>`)
                  .join('');
                await ses.send(new SendEmailCommand({
                  Source: SES_FROM,
                  Destination: { ToAddresses: [evEmail] },
                  Message: {
                    Subject: { Data: `🚨 Resumen de Riesgo — ${course.title}`, Charset: 'UTF-8' },
                    Body: {
                      Html: {
                        Data: `<p>Hola ${evName},</p>
<p>El análisis nocturno de Lux Learning detectó <strong>${criticalCases.length} estudiante(s) en estado CRÍTICO</strong> en el curso <strong>${course.title}</strong>:</p>
<ul>${criticalList}</ul>
${cohortInsight ? `<p><em>Insight del grupo:</em> ${cohortInsight}</p>` : ''}
<p><a href="${FRONTEND_URL}/admin/attendance/${course.id}">Ver panel de asistencia →</a></p>`,
                        Charset: 'UTF-8',
                      },
                    },
                  },
                }));
              }
            } catch (emailErr) {
              console.warn('[Analysis] Risk email error:', emailErr);
            }
          }

          console.log(`[Analysis] Risk scores for ${course.title}: ${riskScores.length} students, ${criticalCases.length} critical`);
        } catch (courseErr) {
          console.warn(`[Analysis] Risk score failed for course ${course.id}:`, courseErr);
        }
      }
    } catch (riskErr) {
      console.warn('[Analysis] Risk score block failed:', riskErr);
    }

    return { analyzed, skipped };

  } catch (err) {
    console.error('[Analysis] Fatal error:', err);
    throw err;
  }
};
