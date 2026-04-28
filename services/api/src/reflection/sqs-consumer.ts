import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { getReflection, updateReflectionStatus } from '../shared/db-dynamo.js';
import { detectAI } from './detect-ai.js';

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

  let aiResult;
  try {
    aiResult = await detectAI(reflection.text);
  } catch (err) {
    console.error('[AI Detection] Bedrock error:', err);
    // On Bedrock failure, forward to evaluator instead of blocking student
    await updateReflectionStatus(userId, moduleId, { status: 'PENDING_EVAL' });
    return;
  }

  console.log(`[AI Detection] Result: ${JSON.stringify(aiResult)}`);

  const isAI = aiResult.isAI && aiResult.confidence >= AI_CONFIDENCE_THRESHOLD;
  const newStatus = isAI ? 'REJECTED' : 'PENDING_EVAL';

  await updateReflectionStatus(userId, moduleId, {
    status: newStatus,
    aiResult,
  });

  console.log(`[AI Detection] Updated status to ${newStatus}`);
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
