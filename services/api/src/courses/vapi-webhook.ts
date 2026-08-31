// ─── vapi-webhook.ts ──────────────────────────────────────────────────────────
// POST /vapi/webhook — end-of-call processing for Lux Mentor Class sessions and
// student oral interviews. Extracted out of courses/handler.ts to keep it under
// the file-size guideline (Trello GTYQ3v1M additions pushed it over — evaluator
// notification + async auto-grading, 2026-08-30).
import { timingSafeEqual } from 'crypto';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import webpush from 'web-push';
import { createId } from '@paralleldrive/cuid2';
import {
  getInterviewByCallId, updateInterview, getClassSessionByCallId, updateClassSession,
  getPushSubscriptionsByUserId, createNotification,
} from '../shared/db-dynamo';
import { getVapidKeys } from '../shared/vapid';
import { getVapiKeys } from '../shared/vapi-keys';
import { ok } from '../shared/response';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.academy';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://luxlearning.academy';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

export async function handleVapiWebhook(event: any, prisma: any): Promise<any> {
  // Load webhook secret from SM — fail closed if unavailable or empty
  const vapiSecrets = await getVapiKeys().catch(() => null);
  const vapiWebhookSecret = vapiSecrets?.webhookSecret ?? '';
  if (!vapiWebhookSecret) {
    console.error('[vapi] VAPI_WEBHOOK_SECRET not configured — rejecting webhook');
    return { statusCode: 401, body: JSON.stringify({ error: 'Webhook not configured' }) };
  }
  // Verify signature with constant-time comparison (prevents timing attacks)
  const { createHmac } = await import('crypto');
  const rawBody = event.body ?? '';
  const incomingSignature = event.headers?.['x-vapi-signature'] ?? event.headers?.['X-Vapi-Signature'] ?? '';
  const expectedSignature = createHmac('sha256', vapiWebhookSecret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  const incomingBuf = Buffer.from(incomingSignature, 'hex');
  const isValidSig = expectedBuf.length > 0 && expectedBuf.length === incomingBuf.length && timingSafeEqual(expectedBuf, incomingBuf);
  if (!isValidSig) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid webhook signature' }) };
  }

  let body: any = {};
  try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }

  const { message } = body as { message?: any };
  if (!message) return ok({ received: true });

  const msgType: string = message.type ?? '';
  const callId: string = message.call?.id ?? message.callId ?? '';

  if (msgType === 'end-of-call-report' && callId) {
    const transcript: string = message.artifact?.transcript ?? message.transcript ?? '';
    const messages: any[] = message.artifact?.messages ?? message.messages ?? [];
    const durationSec: number = message.durationSeconds ?? message.call?.endedAt
      ? Math.round((new Date(message.call.endedAt).getTime() - new Date(message.call.startedAt ?? message.call.createdAt).getTime()) / 1000)
      : 0;
    const endedReason: string = message.call?.endedReason ?? '';
    // Void if network failure: no audio from customer, or call too short with no transcript
    const isVoided = endedReason === 'customer-did-not-give-audio' || (durationSec < 30 && !transcript.trim());

    void (async () => {
      try {
        // ── Try interview first, then class session ───────────────────────
        const interview = await getInterviewByCallId(callId);
        if (!interview) {
          // Check if it's a class session
          const classSession = await getClassSessionByCallId(callId);
          if (!classSession) { console.warn('[vapi] no record for callId=%s', callId); return; }
          if (isVoided) {
            await updateClassSession(classSession.userId, classSession.sessionId, {
              status: 'error', voided: true, voidedReason: endedReason || 'short-duration',
            });
            return;
          }
          let aiAnalysis = ''; let aiScore = 0;
          if (transcript) {
            const analysisPrompt = `Eres un tutor evaluando la sesión de clase de un estudiante con Lux Mentor.\nAnaliza la transcripción y proporciona:\n1. Un puntaje del 0 al 100 basado en: comprensión demostrada, calidad de respuestas, participación.\n2. Retroalimentación formativa (máx. 2 párrafos).\nResponde en el idioma de la transcripción.\nTranscripción:\n${transcript.slice(0, 4000)}\nDevuelve SOLO JSON: {"score": <n>, "analysis": "<texto>"}`;
            try {
              const resp = await bedrock.send(new InvokeModelCommand({
                modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
                contentType: 'application/json', accept: 'application/json',
                body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 450, messages: [{ role: 'user', content: analysisPrompt }] }), // cost: JSON score+analysis ~300-400 tokens
              }));
              const raw = JSON.parse(Buffer.from(resp.body).toString());
              const parsed = JSON.parse((raw.content?.[0]?.text ?? '{}').replace(/```json\n?|\n?```/g, '').trim());
              aiScore = Math.min(100, Math.max(0, Number(parsed.score ?? 0)));
              aiAnalysis = String(parsed.analysis ?? '');
            } catch { /* non-fatal */ }
          }
          await updateClassSession(classSession.userId, classSession.sessionId, {
            status: 'completed', hasCompletedQA: true, transcript, messages, aiAnalysis, aiScore,
            durationSeconds: durationSec, completedAt: new Date().toISOString(),
          });
          const vapidCs = await getVapidKeys().catch(() => null);
          if (vapidCs) {
            webpush.setVapidDetails(vapidCs.email, vapidCs.public, vapidCs.private);
            const subs = await getPushSubscriptionsByUserId(classSession.userId);
            const payload = JSON.stringify({ title: 'Clase completada', body: 'Tu sesión con Lux Mentor ha sido procesada. Tu evaluador revisará tu resultado pronto.' });
            await Promise.allSettled(subs.map((sub: any) => webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)));
          }
          return;
        }

        if (isVoided) {
          await updateInterview(interview.userId, interview.interviewId, {
            status: 'error', voided: true, voidedReason: endedReason || 'short-duration',
          } as any);
          return;
        }

        // Run Bedrock analysis
        let aiAnalysis = '';
        let aiScore = 0;
        if (transcript) {
          const analysisPrompt = `Analiza la siguiente transcripción de una entrevista oral de evaluación.
Proporciona:
1. Un puntaje formativo del 0 al 100 basado en: claridad de ideas, dominio del tema, fluidez y profundidad de respuestas.
2. Un análisis formativo breve (máx. 3 párrafos) con fortalezas y áreas de mejora.
3. Responde en el mismo idioma de la transcripción.

Transcripción:
${transcript.slice(0, 4000)}

Responde ÚNICAMENTE con este JSON (sin markdown):
{"score": <número>, "analysis": "<texto análisis>"}`;

          const resp = await bedrock.send(new InvokeModelCommand({
            modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 550, // cost: JSON score+2-paragraph analysis ~400-500 tokens
              messages: [{ role: 'user', content: analysisPrompt }],
            }),
          }));
          const raw = JSON.parse(Buffer.from(resp.body).toString());
          const text: string = raw.content?.[0]?.text ?? '';
          try {
            const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
            aiScore = Math.min(100, Math.max(0, Number(parsed.score ?? 0)));
            aiAnalysis = String(parsed.analysis ?? '');
          } catch {
            aiAnalysis = text;
          }
        }

        // Async courses auto-grade from the AI pre-evaluation instead of waiting for an
        // evaluator to grade manually — Trello GTYQ3v1M (2026-08-29): "si el curso es
        // asincrónico... la entrevista debería calificarse en el backend y poner un
        // comentario de feedback." Mirrors the same isAutoevaluated pattern already
        // used for reflections (reflection/sqs-consumer.ts).
        const interviewCourse = await prisma.course.findUnique({
          where: { id: interview.courseId }, select: { evaluatorId: true, isAutoevaluated: true, title: true },
        }).catch(() => null);
        const autoGradeFields = interviewCourse?.isAutoevaluated
          ? { grade: aiScore, feedback: aiAnalysis, gradedBy: 'AI_AUTO', gradedAt: new Date().toISOString() }
          : {};

        await updateInterview(interview.userId, interview.interviewId, {
          status: 'completed',
          transcript,
          messages,
          aiAnalysis,
          aiScore,
          durationSeconds: durationSec,
          questionsAsked: messages.filter((m: any) => m.role === 'assistant').length,
          completedAt: new Date().toISOString(),
          ...autoGradeFields,
        });

        // Push notification to student
        const vapidIv = await getVapidKeys().catch(() => null);
        if (vapidIv) {
          webpush.setVapidDetails(vapidIv.email, vapidIv.public, vapidIv.private);
          const subs = await getPushSubscriptionsByUserId(interview.userId);
          const payload = JSON.stringify({ title: 'Entrevista completada', body: 'Tu entrevista oral ha sido procesada. El evaluador revisará tu resultado pronto.' });
          await Promise.allSettled(subs.map((sub: any) =>
            webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
          ));
        }

        // Notify the evaluator (email + push + in-app) — Trello GTYQ3v1M (2026-08-29):
        // "como evaluador... no tengo ninguna notificación... de que algún estudiante
        // acaba de hacer una entrevista." Non-fatal: never breaks the webhook response.
        if (interviewCourse?.evaluatorId) {
          try {
            const evaluatorId = interviewCourse.evaluatorId;
            const msg = `🎤 Nueva entrevista completada — ${interviewCourse.title ?? 'curso'}${interviewCourse.isAutoevaluated ? ' (auto-calificada)' : ''}`;
            await createNotification({
              userId: evaluatorId, notifId: createId(), type: 'GENERAL', message: msg,
              read: false, createdAt: new Date().toISOString(), actionUrl: '/evaluator/interviews',
            });
            if (vapidIv) {
              const evalSubs = await getPushSubscriptionsByUserId(evaluatorId);
              const evalPayload = JSON.stringify({ title: 'Lux Learning', body: msg, url: '/evaluator/interviews' });
              await Promise.allSettled(evalSubs.map((sub: any) => webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, evalPayload)));
            }
            const evalRes = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: evaluatorId })).catch(() => null);
            const evalEmail = evalRes?.UserAttributes?.find((a: any) => a.Name === 'email')?.Value;
            if (evalEmail) {
              await ses.send(new SendEmailCommand({
                Source: FROM_EMAIL,
                Destination: { ToAddresses: [evalEmail] },
                Message: {
                  Subject: { Data: msg, Charset: 'UTF-8' },
                  Body: { Html: { Data: `<p>${msg}</p><p><a href="${FRONTEND_URL}/evaluator/interviews">Ver entrevistas</a></p>`, Charset: 'UTF-8' } },
                },
              }));
            }
          } catch (e) {
            console.error('[vapi] evaluator interview notification failed (non-fatal):', e);
          }
        }
      } catch (e) {
        console.error('[vapi] webhook processing error', e);
      }
    })();
  }

  return ok({ received: true });
}
