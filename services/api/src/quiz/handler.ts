import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getPrismaClient } from '../shared/db-neon';
import { saveQuizAttempt, getQuizAttempts, getLessonProgress, autoCompleteTasks } from '../shared/db-dynamo';
import { sendTemplatedEmail } from '../shared/email';
import { ok, badRequest, forbidden, serverError, cors, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const userId = event.requestContext.authorizer?.lambda?.userId!;
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const prisma = await getPrismaClient();

  try {
    // GET /quiz/:moduleId/attempts
    const attemptsMatch = path.match(/^\/quiz\/([^/]+)\/attempts$/);
    if (method === 'GET' && attemptsMatch) {
      const moduleId = attemptsMatch[1]!;
      const attempts = await getQuizAttempts(userId, moduleId);
      return ok(attempts);
    }

    // POST /quiz/:moduleId/submit
    const submitMatch = path.match(/^\/quiz\/([^/]+)\/submit$/);
    if (method === 'POST' && submitMatch) {
      const moduleId = submitMatch[1]!;
      const body = JSON.parse(event.body ?? '{}');
      const { answers, courseId } = body as { answers: number[]; courseId: string };

      if (!answers || !Array.isArray(answers)) {
        return badRequest('answers array is required');
      }

      // Load module with questions
      const module = await prisma.module.findUnique({
        where: { id: moduleId },
        include: { questions: { orderBy: { order: 'asc' } }, lessons: true },
      });

      if (!module) return badRequest('Module not found');
      if (!module.questions.length) return badRequest('Este módulo no tiene preguntas configuradas');

      // Verify all lessons are completed before allowing quiz
      const progress = await getLessonProgress(userId, courseId);
      const completedLessonIds = new Set(progress.map((p) => p.lessonId));
      const allCompleted = module.lessons.every((l) => completedLessonIds.has(l.id));

      if (!allCompleted) {
        return forbidden('Complete all lessons before taking the quiz');
      }

      // Grade
      let correctCount = 0;
      module.questions.forEach((q, i) => {
        if (answers[i] === q.correctIndex) correctCount++;
      });

      const score = Math.round((correctCount / module.questions.length) * 100);
      const passed = score >= module.passingScore;

      // Get attempt number
      const prevAttempts = await getQuizAttempts(userId, moduleId);
      const attemptNumber = prevAttempts.length + 1;

      await saveQuizAttempt({
        userId,
        moduleId,
        attemptNumber,
        score,
        passed,
        answers,
        submittedAt: new Date().toISOString(),
      });

      const results = module.questions.map((q, i) => ({
        questionText: q.text,
        options: q.options,
        selectedIndex: answers[i] ?? -1,
        correctIndex: q.correctIndex,
        isCorrect: answers[i] === q.correctIndex,
      }));

      // If passed → auto-complete tasks + send email (non-fatal)
      if (passed) {
        const email = event.requestContext.authorizer?.lambda?.email;
        const frontendUrl = process.env.FRONTEND_URL ?? '';
        autoCompleteTasks(userId, 'pass_quiz', moduleId).catch(() => {});
        if (email) {
          sendTemplatedEmail(email, 'QUIZ_PASSED', {
            studentName: userId,
            moduleTitle: module.title,
            score: String(score),
            actionUrl: `${frontendUrl}/courses/${courseId}/modules/${moduleId}/quiz`,
          }).catch(() => {});
        }
      }

      return ok({
        score,
        passed,
        passingScore: module.passingScore,
        attempt: attemptNumber,
        correctCount,
        totalQuestions: module.questions.length,
        results,
      });
    }

    // POST /quiz/:moduleId/gap-analysis — AI analysis of wrong answers
    const gapMatch = path.match(/^\/quiz\/([^/]+)\/gap-analysis$/);
    if (gapMatch && method === 'POST') {
      const moduleId = gapMatch[1]!;
      const body = JSON.parse(event.body ?? '{}');
      const results: Array<{
        questionText: string; options: string[];
        selectedIndex: number; correctIndex: number; isCorrect: boolean;
      }> = body.results ?? [];

      if (!Array.isArray(results) || results.length === 0) {
        return badRequest('results array es requerido');
      }

      const incorrect = results.filter((r) => !r.isCorrect);
      if (incorrect.length === 0) return ok({ gaps: [], overallPattern: null });

      const mod = await prisma.module.findUnique({
        where: { id: moduleId },
        select: { title: true },
      });

      const prompt = `Eres un pedagogo experto en identificar brechas de conocimiento.
Un estudiante falló las siguientes preguntas del módulo "${mod?.title ?? 'del curso'}":

${incorrect.map((r, i) =>
  `${i + 1}. "${r.questionText}"
   Seleccionó: "${r.options[r.selectedIndex] ?? 'Sin respuesta'}"
   Correcto era: "${r.options[r.correctIndex]}"`
).join('\n\n')}

Analiza los errores e identifica las brechas de conocimiento. Sé conciso y orientado a la acción.

Responde ÚNICAMENTE con JSON (sin markdown):
{
  "gaps": [
    {
      "concept": "Nombre del concepto donde tiene debilidad",
      "suggestedFocus": "1 oración concreta de qué revisar o practicar"
    }
  ],
  "overallPattern": "1 oración sobre el patrón general de errores (o null si son errores aislados)"
}
Máximo ${Math.min(incorrect.length, 3)} gaps.`;

      try {
        const bedrockRes = await bedrock.send(new InvokeModelCommand({
          modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 600,
            messages: [{ role: 'user', content: prompt }],
          }),
        }));
        const raw = JSON.parse(new TextDecoder().decode(bedrockRes.body)).content?.[0]?.text ?? '{}';
        const clean = raw.replace(/```json\s*|```/g, '').trim();
        const jsonMatch = clean.match(/\{[\s\S]*/);
        const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
        return ok({
          gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 3) : [],
          overallPattern: parsed.overallPattern ?? null,
        });
      } catch (bedrockErr) {
        console.error('[gap-analysis] Bedrock error:', bedrockErr);
        return ok({ gaps: [], overallPattern: null });
      }
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
