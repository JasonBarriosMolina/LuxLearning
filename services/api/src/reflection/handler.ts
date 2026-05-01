import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import type { SQSEvent } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import webpush from 'web-push';
import { getPrismaClient } from '../shared/db-neon';
import { saveReflection, getReflection, updateReflectionStatus, hasPassedQuiz, isModuleUnlocked, getPushSubscriptionsByRole } from '../shared/db-dynamo';
import { ok, badRequest, forbidden, serverError, cors } from '../shared/response';

// Configure web-push VAPID
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@luxlearning.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

const MIN_WORDS = 80;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

// ─── HTTP Handler ─────────────────────────────────────────────────────────────

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const userId = event.requestContext.authorizer?.lambda?.userId ?? '';
  const studentEmail = event.requestContext.authorizer?.lambda?.email ?? '';
  if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const prisma = getPrismaClient();

  try {
    // GET /reflection/:moduleId
    const getMatch = path.match(/^\/reflection\/([^/]+)$/);
    if (method === 'GET' && getMatch) {
      const moduleId = getMatch[1]!;
      const reflection = await getReflection(userId, moduleId);
      return ok(reflection);
    }

    // POST /reflection
    if (method === 'POST') {
      const body = JSON.parse(event.body ?? '{}');
      const { moduleId, text } = body as { moduleId: string; text: string };

      if (!moduleId || !text) return badRequest('moduleId and text are required');

      // Word count validation (backend security)
      const wordCount = countWords(text);
      if (wordCount < MIN_WORDS) {
        return badRequest(`Reflection must be at least ${MIN_WORDS} words. Current: ${wordCount}`);
      }

      // Verify quiz was passed
      const quizPassed = await hasPassedQuiz(userId, moduleId);
      if (!quizPassed) return forbidden('You must pass the quiz before submitting a reflection');

      // Check module unlock
      const module = await prisma.module.findUnique({
        where: { id: moduleId },
        include: { course: { include: { modules: { orderBy: { order: 'asc' }, select: { id: true, order: true } } } } },
      });

      if (!module) return badRequest('Module not found');

      const moduleRefs = module.course.modules.map((m) => ({ id: m.id, order: m.order }));
      const unlocked = await isModuleUnlocked(userId, module.order, moduleRefs);
      if (!unlocked) return forbidden('Module is locked');

      // Save reflection with PENDING_AI status
      const submittedAt = new Date().toISOString();
      const deadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const reflection = {
        userId,
        studentEmail,
        moduleId,
        text,
        wordCount,
        status: 'PENDING_AI' as const,
        submittedAt,
        deadline,
      };

      await saveReflection(reflection);

      // Send to SQS for AI processing
      await sqs.send(new SendMessageCommand({
        QueueUrl: process.env.SQS_REFLECTION_QUEUE_URL!,
        MessageBody: JSON.stringify({ userId, moduleId }),
        // Standard queue — MessageGroupId is not used (only valid for FIFO queues)
      }));

      // Fire-and-forget push notification to all evaluators
      // Use IIFE so any synchronous throw (e.g. missing VAPID config) is also caught
      void (async () => {
        try {
          if (!VAPID_PUBLIC || !VAPID_PRIVATE) return; // VAPID not configured — skip silently
          const subs = await getPushSubscriptionsByRole('EVALUATOR');
          if (!subs.length) return;
          const payload = JSON.stringify({
            title: 'Nueva reflexión pendiente',
            body: `${module.title} · ${wordCount} palabras`,
            url: '/evaluator/reflections',
          });
          await Promise.allSettled(
            subs.map((sub) =>
              webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
            )
          );
        } catch {
          // Non-fatal — push failure must never block the student's response
        }
      })();

      return ok(reflection, 'Reflection submitted. Processing with AI...');
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
