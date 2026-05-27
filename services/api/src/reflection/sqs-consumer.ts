import type { SQSEvent, SQSRecord } from 'aws-lambda';
import webpush from 'web-push';
import { createId } from '@paralleldrive/cuid2';
import { getReflection, updateReflectionStatus, createNotification, getPushSubscriptionsByUserId } from '../shared/db-dynamo';
import { detectAI } from './detect-ai';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@luxlearning.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

const AI_CONFIDENCE_THRESHOLD = 60;

async function processRecord(record: SQSRecord) {
  const { userId, moduleId } = JSON.parse(record.body) as { userId: string; moduleId: string };

  console.log(`[AI Detection] Processing reflection userId=${userId} moduleId=${moduleId}`);

  const reflection = await getReflection(userId, moduleId);
  if (!reflection) {
    console.warn(`[AI Detection] Reflection not found: ${userId}/${moduleId}`);
    return;
  }

  if (reflection.status !== 'PENDING_AI') {
    console.warn(`[AI Detection] Skipping — status is ${reflection.status}`);
    return;
  }

  const analyzedAt = new Date().toISOString();
  let aiResult;
  try {
    aiResult = await detectAI(reflection.text);
  } catch (err) {
    console.error('[AI Detection] Bedrock error:', err);
    // On Bedrock failure, forward to evaluator instead of blocking student
    await updateReflectionStatus(userId, moduleId, { status: 'PENDING_EVAL', analyzedAt });
    // Still notify evaluator
    if (reflection.evaluatorId) {
      const evaluatorId = reflection.evaluatorId as string;
      const moduleTitle = (reflection.moduleTitle as string | undefined) ?? moduleId;
      try {
        await createNotification({
          userId: evaluatorId,
          notifId: createId(),
          type: 'GENERAL',
          message: `📋 Reflexión lista para evaluar — ${moduleTitle}`,
          read: false,
          createdAt: new Date().toISOString(),
        });
      } catch { /* non-fatal */ }
    }
    return;
  }

  console.log(`[AI Detection] Result: ${JSON.stringify(aiResult)}`);

  const isAI = aiResult.isAI && aiResult.confidence >= AI_CONFIDENCE_THRESHOLD;
  const newStatus = isAI ? 'REJECTED' : 'PENDING_EVAL';

  await updateReflectionStatus(userId, moduleId, {
    status: newStatus,
    aiResult,
    analyzedAt,
  });

  console.log(`[AI Detection] Updated status to ${newStatus}`);

  // Notify evaluator when reflection is ready to review
  if (newStatus === 'PENDING_EVAL' && reflection.evaluatorId) {
    const evaluatorId = reflection.evaluatorId as string;
    const moduleTitle = (reflection.moduleTitle as string | undefined) ?? moduleId;
    try {
      await createNotification({
        userId: evaluatorId,
        notifId: createId(),
        type: 'GENERAL',
        message: `📋 Reflexión lista para evaluar — ${moduleTitle}`,
        read: false,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[AI Detection] Failed to create in-app notification:', e);
    }
    try {
      if (VAPID_PUBLIC && VAPID_PRIVATE) {
        const subs = await getPushSubscriptionsByUserId(evaluatorId);
        if (subs.length > 0) {
          const payload = JSON.stringify({
            title: 'Reflexión lista para evaluar',
            body: moduleTitle,
            url: '/evaluator/reflections',
          });
          await Promise.allSettled(
            subs.map((sub) => webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload))
          );
        }
      }
    } catch (e) {
      console.warn('[AI Detection] Failed to send push notification:', e);
    }
  }
}

export const handler = async (event: SQSEvent): Promise<void> => {
  const results = await Promise.allSettled(event.Records.map(processRecord));

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`[SQS Consumer] ${failures.length} record(s) failed`);
    // Re-throw to trigger SQS retry / DLQ
    throw new Error(`${failures.length} record(s) failed processing`);
  }
};
