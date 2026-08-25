import type { SQSEvent, SQSRecord } from 'aws-lambda';
import webpush from 'web-push';
import { createId } from '@paralleldrive/cuid2';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getReflection, updateReflectionStatus, createNotification, getPushSubscriptionsByUserId, getUserLang, updateAttendanceRecord } from '../shared/db-dynamo';
import { getVapidKeys } from '../shared/vapid';
import { setCurrentEnv, AppEnv } from '../shared/env-context';
import { sendTemplatedEmail } from '../shared/email';
import { detectAI } from './detect-ai';

const s3 = new S3Client({ region: 'us-east-1' });
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const S3_BUCKET = process.env.S3_IMAGES_BUCKET ?? 'lux-learning-images';
const FRONTEND_URL = process.env.FRONTEND_URL ?? '';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

// VAPID keys loaded lazily from Secrets Manager via shared/vapid.ts

// AI detection thresholds:
// ≥ 85%  → REJECTED automatically
// 70–84% → PENDING_EVAL with aiSuspect flag (evaluator must review manually)
// < 70%  → PENDING_EVAL (treated as human)
const AI_REJECT_THRESHOLD = 85;
const AI_SUSPECT_THRESHOLD = 70;

// ── Attendance OCR via Bedrock Vision ────────────────────────────────────────
async function processAttendanceOcr(payload: {
  courseId: string; sk: string; userId: string; sessionId: string;
  sessionDate: string; documentKey: string; studentEmail: string;
}): Promise<void> {
  const { courseId, sk, userId, sessionDate, documentKey, studentEmail } = payload;
  console.log(`[AttendanceOCR] Processing ${documentKey} for user ${userId}`);

  // Size check before download — reject oversized files to avoid Bedrock payload limit
  const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: documentKey }));
  if ((head.ContentLength ?? 0) > 10 * 1024 * 1024) { // 10 MB max
    await updateAttendanceRecord(courseId, sk, { aiOcrData: {}, status: 'ERROR', aiOcrError: 'Archivo demasiado grande (máx 10MB)' });
    console.warn(`[AttendanceOCR] File too large: ${head.ContentLength} bytes — skipping Bedrock`);
    return;
  }

  // Download document from S3
  const s3Obj = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: documentKey }));
  const bytes = await s3Obj.Body?.transformToByteArray();
  if (!bytes) throw new Error('Empty S3 object');

  const ext = documentKey.split('.').pop()?.toLowerCase() ?? 'pdf';
  const mediaType = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg';
  const base64Doc = Buffer.from(bytes).toString('base64');

  const studentName = studentEmail.split('@')[0] ?? userId;
  const absenceDateFmt = new Date(sessionDate).toLocaleDateString('es-CR', { year: 'numeric', month: 'long', day: 'numeric' });

  const systemPrompt = `Eres el Agente de Control de Asistencia de Lux Learning. Tu tarea es analizar comprobantes de justificación de ausencias y extraer información clave.

REGLAS ESTRICTAS:
1. Tu única salida debe ser un objeto JSON válido, sin texto adicional.
2. Verifica si existe sello oficial, firma médica o membrete institucional (CCSS, INS, clínicas privadas, empresas son válidos).
3. Calcula un nivel de confianza (0-100) sobre la legibilidad y autenticidad visual del documento.
4. Asigna una recomendación:
   - "VALID_MATCH": Nombres coinciden, fechas cubren la ausencia, sello presente.
   - "NEEDS_REVIEW": Fechas dudosas, borroso, o falta de sellos claros.
   - "REJECTED_AUTO": Documento irrelevante, alterado visiblemente, o fecha que no corresponde.

INFORMACIÓN DEL CONTEXTO:
- Nombre del estudiante esperado: ${studentName}
- Fecha de la ausencia a justificar: ${absenceDateFmt}

FORMATO DE SALIDA (JSON):
{"extractedName":null,"extractedDate":null,"hasMedicalStamp":false,"issuer":null,"aiConfidenceScore":0,"aiRecommendation":"NEEDS_REVIEW","reasoning":""}`;

  const bedrockBody = mediaType === 'application/pdf'
    ? {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64Doc } },
            { type: 'text', text: 'Analiza este comprobante y devuelve el JSON requerido.' },
          ],
        }],
        system: systemPrompt,
      }
    : {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Doc } },
            { type: 'text', text: 'Analiza este comprobante y devuelve el JSON requerido.' },
          ],
        }],
        system: systemPrompt,
      };

  const res = await bedrock.send(new InvokeModelCommand({
    modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(bedrockBody),
  }));

  const rawText = JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text ?? '{}';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  let aiOcrData: any = {};
  try { aiOcrData = JSON.parse(jsonMatch?.[0] ?? '{}'); } catch { /* ignore */ }

  await updateAttendanceRecord(courseId, sk, { aiOcrData, status: 'JUSTIFICATION_PENDING' });
  console.log(`[AttendanceOCR] Done — recommendation: ${aiOcrData.aiRecommendation}`);
}

// ── SQS router ────────────────────────────────────────────────────────────────
async function processRecord(record: SQSRecord) {
  const parsed = JSON.parse(record.body);
  const msgType = parsed.type as string | undefined;

  // Route by type field; legacy messages without type are REFLECTION_AI
  if (msgType === 'ATTENDANCE_OCR') {
    setCurrentEnv((parsed.env as AppEnv | undefined) ?? 'prod');
    return processAttendanceOcr(parsed);
  }

  // REFLECTION_AI (default)
  const { userId, moduleId, env, isAutoevaluated = false } = parsed as { userId: string; moduleId: string; env?: string; isAutoevaluated?: boolean };
  setCurrentEnv((env as AppEnv | undefined) ?? 'prod');

  console.log(`[AI Detection] Processing reflection userId=${userId} moduleId=${moduleId} env=${env ?? 'prod'}`);

  const reflection = await getReflection(userId, moduleId);
  if (!reflection) {
    console.warn(`[AI Detection] Reflection not found: ${userId}/${moduleId}`);
    return;
  }

  if (reflection.status !== 'PENDING_AI') {
    console.warn(`[AI Detection] Skipping — status is ${reflection.status}`);
    return;
  }

  // Cost optimization: skip Bedrock if already scored (SQS duplicate delivery race condition)
  // updateReflectionStatus stores `aiResult` object, not `aiScore`
  if ((reflection as any).aiResult !== undefined) {
    console.log('[AI Detection] Cache hit — aiResult already stored, skipping Bedrock');
    return;
  }

  const analyzedAt = new Date().toISOString();
  let aiResult;
  try {
    aiResult = await detectAI(reflection.text);
  } catch (err) {
    console.error('[AI Detection] Bedrock error:', err);
    // On Bedrock failure: async self-evaluated courses auto-approve; others forward to evaluator
    const failStatus = (isAutoevaluated || (reflection as any).isAutoevaluated) ? 'APPROVED' : 'PENDING_EVAL';
    await updateReflectionStatus(userId, moduleId, { status: failStatus, analyzedAt });
    if (failStatus === 'APPROVED') return; // no evaluator to notify
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
          actionUrl: `/evaluator/reflections/${userId}?moduleId=${moduleId}`,
        });
      } catch { /* non-fatal */ }
    }
    return;
  }

  console.log(`[AI Detection] Result: ${JSON.stringify(aiResult)}`);

  // Tri-level decision
  let newStatus: 'REJECTED' | 'PENDING_EVAL' | 'APPROVED';
  let aiSuspect = false;

  if (aiResult.isAI && aiResult.confidence >= AI_REJECT_THRESHOLD) {
    // Auto-reject regardless of course modality
    newStatus = 'REJECTED';
  } else if (isAutoevaluated || (reflection as any).isAutoevaluated) {
    // Async self-evaluated course: skip human review, auto-approve
    newStatus = 'APPROVED';
  } else if (aiResult.isAI && aiResult.confidence >= AI_SUSPECT_THRESHOLD) {
    newStatus = 'PENDING_EVAL';
    aiSuspect = true;
  } else {
    newStatus = 'PENDING_EVAL';
  }

  await updateReflectionStatus(userId, moduleId, {
    status: newStatus,
    aiResult,
    analyzedAt,
    aiSuspect,
  });

  console.log(`[AI Detection] Updated status to ${newStatus}${aiSuspect ? ' (aiSuspect)' : ''}${newStatus === 'APPROVED' ? ' (isAutoevaluated bypass)' : ''}`);

  const moduleTitle = (reflection.moduleTitle as string | undefined) ?? moduleId;
  const courseTitle = (reflection.courseTitle as string | undefined) ?? '';

  // When auto-approved (async isAutoevaluated course): notify student
  if (newStatus === 'APPROVED') {
    const studentLang = await getUserLang(userId).catch(() => 'es');
    try {
      await createNotification({
        userId,
        notifId: createId(),
        type: 'GENERAL',
        message: studentLang === 'en'
          ? `✅ Your reflection for "${moduleTitle}" was automatically approved.`
          : `✅ Tu reflexión del módulo "${moduleTitle}" fue aprobada automáticamente.`,
        read: false,
        createdAt: new Date().toISOString(),
        actionUrl: '/courses',
      });
    } catch (e) {
      console.warn('[AI Detection] Failed to create auto-approval notification:', e);
    }
    return;
  }

  // When AI auto-rejects: notify student via in-app + email
  if (newStatus === 'REJECTED') {
    const studentLang = await getUserLang(userId).catch(() => 'es');
    try {
      await createNotification({
        userId,
        notifId: createId(),
        type: 'GENERAL',
        message: studentLang === 'en'
          ? `Your reflection for module "${moduleTitle}" was rejected by the AI detection system.`
          : `Tu reflexión del módulo "${moduleTitle}" fue rechazada por el sistema de detección de IA.`,
        read: false,
        createdAt: new Date().toISOString(),
        actionUrl: '/courses',
      });
    } catch (e) {
      console.warn('[AI Detection] Failed to create rejection in-app notification for student:', e);
    }
    const studentEmail = reflection.studentEmail as string | undefined;
    if (studentEmail) {
      try {
        const aiRejectionFeedback = studentLang === 'en'
          ? 'The automated detection system identified AI-generated writing patterns in your reflection. Please write a reflection in your own words and try again.'
          : 'El sistema de detección automática identificó patrones de escritura generada por IA en tu reflexión. Por favor, escribe una reflexión con tus propias palabras y vuelve a intentarlo.';
        await sendTemplatedEmail(studentEmail, 'REFLECTION_REJECTED', {
          studentName: studentEmail.split('@')[0],
          moduleTitle,
          feedback: aiRejectionFeedback,
        }, studentLang);
      } catch (e) {
        console.warn('[AI Detection] Failed to send rejection email to student:', e);
      }
    }
    return;
  }

  // Notify evaluator when reflection is ready to review (PENDING_EVAL)
  if (reflection.evaluatorId) {
    const evaluatorId = reflection.evaluatorId as string;
    const evaluatorLang = await getUserLang(evaluatorId).catch(() => 'es');
    const notifMessage = evaluatorLang === 'en'
      ? aiSuspect
        ? `⚠️ Possible AI detected (${aiResult.confidence}%) — manual review required: ${moduleTitle}`
        : `📋 Reflection ready for review — ${moduleTitle}`
      : aiSuspect
        ? `⚠️ Reflexión con posible IA (${aiResult.confidence}%) — requiere revisión manual: ${moduleTitle}`
        : `📋 Reflexión lista para evaluar — ${moduleTitle}`;
    try {
      await createNotification({
        userId: evaluatorId,
        notifId: createId(),
        type: 'GENERAL',
        message: notifMessage,
        read: false,
        createdAt: new Date().toISOString(),
        actionUrl: `/evaluator/reflections/${userId}?moduleId=${moduleId}`,
      });
    } catch (e) {
      console.warn('[AI Detection] Failed to create in-app notification:', e);
    }
    // Email to evaluator
    try {
      const evUser = await cognito.send(new AdminGetUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID!,
        Username: evaluatorId,
      }));
      const evaluatorEmail = evUser.UserAttributes?.find((a) => a.Name === 'email')?.Value;
      const evaluatorName = evUser.UserAttributes?.find((a) => a.Name === 'name')?.Value ?? evaluatorEmail?.split('@')[0] ?? evaluatorId;
      if (evaluatorEmail) {
        const studentEmail = reflection.studentEmail as string | undefined;
        await sendTemplatedEmail(evaluatorEmail, 'REFLECTION_SUBMITTED', {
          evaluatorName,
          studentName: studentEmail ? studentEmail.split('@')[0] : userId,
          moduleTitle,
          courseTitle,
          actionUrl: `${process.env.FRONTEND_URL ?? ''}/evaluator/reflections/${userId}?moduleId=${moduleId}`,
        }, evaluatorLang);
      }
    } catch (e) {
      console.warn('[AI Detection] Failed to send email to evaluator:', e);
    }
    try {
      const vapid = await getVapidKeys().catch(() => null);
      if (vapid) {
        webpush.setVapidDetails(vapid.email, vapid.public, vapid.private);
        const subs = await getPushSubscriptionsByUserId(evaluatorId);
        if (subs.length > 0) {
          const pushTitle = evaluatorLang === 'en'
            ? aiSuspect ? '⚠️ Manual review required' : 'Reflection ready for review'
            : aiSuspect ? '⚠️ Revisión manual requerida' : 'Reflexión lista para evaluar';
          const payload = JSON.stringify({
            title: pushTitle,
            body: moduleTitle,
            url: `/evaluator/reflections/${userId}?moduleId=${moduleId}`,
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
