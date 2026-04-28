import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { getPrismaClient } from '../shared/db-neon.js';
import { saveQuizAttempt, getQuizAttempts, getLessonProgress } from '../shared/db-dynamo.js';
import { ok, badRequest, forbidden, serverError, cors } from '../shared/response.js';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const userId = event.requestContext.authorizer?.lambda?.userId!;
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const prisma = getPrismaClient();

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

      return ok({
        score,
        passed,
        passingScore: module.passingScore,
        attempt: attemptNumber,
        correctCount,
        totalQuestions: module.questions.length,
      });
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
