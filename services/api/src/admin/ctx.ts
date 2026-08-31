// Shared context, AWS clients, utility functions, and types for lux-admin domain modules.
import { randomInt } from 'crypto';
import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { SESClient } from '@aws-sdk/client-ses';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PollyClient, SynthesizeSpeechCommand, VoiceId } from '@aws-sdk/client-polly';
import { jsonrepair } from 'jsonrepair';

// ── AWS Clients ──────────────────────────────────────────────────────────────
export const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
// Stability Image Core is only available in us-west-2
export const bedrockImageClient = new BedrockRuntimeClient({ region: 'us-west-2' });
export const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const pollyClient = new PollyClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

// ── Constants ────────────────────────────────────────────────────────────────
export const S3_IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET ?? 'lux-learning-images';
export const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.academy';
export const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://luxlearning.academy';
export const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

// ── Types ────────────────────────────────────────────────────────────────────
export type AuthContext = { userId: string; email: string; role: string };
export type Event = APIGatewayProxyEventV2WithRequestContext<
  APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }
>;

export type AdminCtx = {
  event: Event;
  method: string;
  path: string;
  prisma: any;
  body: any;
  action: string | undefined;
  userId: string | undefined;
};

// ── Auth helpers ─────────────────────────────────────────────────────────────
export function isAuthorized(event: Event): boolean {
  const role = event.requestContext.authorizer?.lambda?.role;
  return role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'EVALUATOR';
}

export function isAdmin(event: Event): boolean {
  const role = event.requestContext.authorizer?.lambda?.role;
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export async function getCallerName(event: Event): Promise<string | null> {
  const userId = event.requestContext.authorizer?.lambda?.userId;
  const email = event.requestContext.authorizer?.lambda?.email;
  if (!userId || userId === 'system') return null;
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const name = res.UserAttributes?.find((a) => a.Name === 'name')?.Value;
    return name || email || userId;
  } catch {
    return email || userId;
  }
}

// Image generation (sanitizeUserPromptForImage, buildVisualPrompt,
// generateLessonInfographic, generateLessonImage) moved to ai-image-helpers.ts to
// keep this file under the shared-helper size limit (Trello DmPpbrff item 4).

// ── Amazon Polly audio generation helper ─────────────────────────────────────
// English neural voices added (Trello DmPpbrff item 4, 2026-08-30 20:20): the map only
// had Spanish voices, so an English course could never get a matching neural voice.
const POLLY_VOICE_LANGUAGE: Record<string, string> = {
  Mia: 'es-MX', Lupe: 'es-US', Pedro: 'es-US', Lucia: 'es-ES', Sergio: 'es-ES',
  Danielle: 'en-US', Gregory: 'en-US',
};

// Default neural voice per course language — used by the Lux Planner auto-audio worker
// so every lesson gets a matching-language voice without an admin picking one manually.
export function defaultVoiceForLanguage(planLanguage: string | null | undefined): string {
  return (planLanguage ?? 'ES').toUpperCase() === 'EN' ? 'Danielle' : 'Mia';
}

// Male neural voice per language — Lux Mentor Class narration specifically asked for a
// male voice (Trello DmPpbrff, 2026-08-31 04:01: "en una voz masculina, específicamente").
export function defaultMaleVoiceForLanguage(planLanguage: string | null | undefined): string {
  return (planLanguage ?? 'ES').toUpperCase() === 'EN' ? 'Gregory' : 'Sergio';
}

export async function generateLessonAudio(lessonId: string, text: string, voiceId = 'Mia'): Promise<string | null> {
  try {
    const plain = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2900); // Polly Neural limit per request

    const resp = await pollyClient.send(new SynthesizeSpeechCommand({
      Text: plain,
      VoiceId: voiceId as VoiceId,
      Engine: 'neural',
      OutputFormat: 'mp3',
      LanguageCode: (POLLY_VOICE_LANGUAGE[voiceId] ?? 'es-MX') as any,
    }));

    if (!resp.AudioStream) return null;

    const chunks: Uint8Array[] = [];
    for await (const chunk of resp.AudioStream as any) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    const key = `audio/${lessonId}-${voiceId.toLowerCase()}.mp3`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_IMAGES_BUCKET,
      Key: key,
      Body: audioBuffer,
      ContentType: 'audio/mpeg',
    }));
    return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
  } catch (err) {
    console.error('[Polly] Error generating audio:', err);
    return null;
  }
}

/** Synthesizes narration audio for a Lux Carrousel AND its sentence-level Speech Marks
 *  (Polly can only return one OutputFormat per call, so this is 2 requests) — used to
 *  sync slide transitions to the exact millisecond narration reaches each sentence.
 *  Each entry in the returned marks array is Polly's raw {time, type:'sentence', start,
 *  end, value} JSON (one line per sentence in the input text). */
export async function generateCarouselNarration(
  lessonId: string, text: string, voiceId = 'Mia',
): Promise<{ audioUrl: string; marks: Array<{ time: number; value: string }> } | null> {
  try {
    const plain = text.replace(/\s+/g, ' ').trim().slice(0, 2900);
    const languageCode = (POLLY_VOICE_LANGUAGE[voiceId] ?? 'es-MX') as any;

    const [audioResp, marksResp] = await Promise.all([
      pollyClient.send(new SynthesizeSpeechCommand({
        Text: plain, VoiceId: voiceId as VoiceId, Engine: 'neural', OutputFormat: 'mp3', LanguageCode: languageCode,
      })),
      pollyClient.send(new SynthesizeSpeechCommand({
        Text: plain, VoiceId: voiceId as VoiceId, Engine: 'neural', OutputFormat: 'json',
        SpeechMarkTypes: ['sentence'], LanguageCode: languageCode,
      })),
    ]);
    if (!audioResp.AudioStream) return null;

    const audioChunks: Uint8Array[] = [];
    for await (const chunk of audioResp.AudioStream as any) audioChunks.push(chunk);
    const audioBuffer = Buffer.concat(audioChunks);

    let marksText = '';
    if (marksResp.AudioStream) {
      const marksChunks: Uint8Array[] = [];
      for await (const chunk of marksResp.AudioStream as any) marksChunks.push(chunk);
      marksText = Buffer.concat(marksChunks).toString('utf-8');
    }
    const marks = marksText.split('\n').filter(Boolean).map((line) => {
      try { const m = JSON.parse(line); return { time: Number(m.time ?? 0), value: String(m.value ?? '') }; }
      catch { return null; }
    }).filter((m): m is { time: number; value: string } => m !== null);

    const key = `audio/carousel-${lessonId}-${voiceId.toLowerCase()}.mp3`;
    await s3Client.send(new PutObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: key, Body: audioBuffer, ContentType: 'audio/mpeg' }));
    return { audioUrl: `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`, marks };
  } catch (err) {
    console.error('[Polly] Error generating carousel narration:', err);
    return null;
  }
}

/** Shuffle options array in-place and update correctIndex so the correct answer moves with it */
export function shuffleQuestionOptions(questions: any[]): any[] {
  return questions.map((q) => {
    if (!Array.isArray(q.options) || q.options.length < 2) return q;
    const correctAnswer = q.options[Number(q.correctIndex)];
    const opts = [...q.options];
    for (let i = opts.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    return { ...q, options: opts, correctIndex: opts.indexOf(correctAnswer) };
  });
}

export function s3KeyFromUrl(url: string): string | null {
  const match = url.match(/\.amazonaws\.com\/(.+)$/);
  return match?.[1] ?? null;
}

/** Lightweight Bedrock / Claude Haiku JSON caller — used in synchronous routes.
 *  Retries up to 3 times with exponential backoff.
 *
 *  Retries EVERY error, not just throttle-coded ones — was throttle-only before, which
 *  meant a non-throttle transient error (network blip, a Bedrock 5xx not carrying one of
 *  the exact THROTTLE_CODES names, etc.) got ZERO retries and failed on the very first
 *  attempt. Found investigating Trello DmPpbrff comment 6a926775: a course generated
 *  under the new concurrent-modules + longer-lesson-prompt combo had 5 of 8 modules come
 *  back with placeholder-only content — plausible if some modules hit a non-throttle
 *  error under the heavier concurrent load. Also always logs the final failure now: the
 *  call sites in ai-wizard-worker.ts swallow this with a bare `.catch(() => null)`, so
 *  without a log line HERE, a real failure leaves zero trace in CloudWatch — which is
 *  exactly what happened investigating that comment: the run clearly had failures but
 *  produced no diagnostic output at all. */
export async function invokeBedrockForJson(prompt: string, maxTokens = 2000): Promise<any> {
  const RETRIES = 3;
  let lastErr: any;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 5s, 15s
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
      const res = await bedrock.send(new InvokeModelCommand({
        modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      }));
      const parsed = JSON.parse(new TextDecoder().decode(res.body));
      const raw = (parsed.content?.[0]?.text ?? '{}').replace(/```json\s*|```/g, '').trim();
      const match = raw.match(/[\[{][\s\S]*/);
      const jsonStr = match?.[0] ?? '{}';
      try { return JSON.parse(jsonStr); }
      catch { try { return JSON.parse(jsonrepair(jsonStr)); } catch { return {}; } }
    } catch (err: any) {
      lastErr = err;
      if (attempt === RETRIES - 1) {
        console.error(`[invokeBedrockForJson] giving up after ${RETRIES} attempts — ${err?.name ?? 'UnknownError'}: ${err?.message ?? err}`);
        throw err;
      }
      console.warn(`[invokeBedrockForJson] attempt ${attempt + 1}/${RETRIES} failed (${err?.name ?? 'UnknownError'}: ${err?.message ?? err}), retrying in ${5 * (attempt + 1)}s`);
    }
  }
  throw lastErr;
}

// ── Email HTML builders ──────────────────────────────────────────────────────
export function invitationEmailHtml(name: string, email: string, temporaryPassword: string, courseNames: string[]): string {
  const coursesBlock = courseNames.length > 0
    ? `<p style="color:#555;line-height:1.6;">Has sido inscrito en:</p>
       <ul style="color:#555;line-height:1.8;padding-left:20px;">${courseNames.map((c) => `<li><strong>${c}</strong></li>`).join('')}</ul>`
    : '';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Claridad que transforma.</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Bienvenido a Lux Learning!</h2>
      <p style="color:#555;line-height:1.6;">Hola ${name || email.split('@')[0]},</p>
      <p style="color:#555;line-height:1.6;">Tu cuenta ha sido creada. Aquí están tus credenciales de acceso:</p>
      <div style="background:#F8F8F8;border-left:4px solid #00B4D8;padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0 0 8px;color:#555;"><strong>Correo:</strong> ${email}</p>
        <p style="margin:0;color:#555;"><strong>Contraseña temporal:</strong> <span style="font-family:monospace;font-size:16px;color:#7B2FBE;">${temporaryPassword}</span></p>
      </div>
      <p style="color:#888;font-size:13px;">Se te pedirá cambiar tu contraseña al iniciar sesión por primera vez.</p>
      ${coursesBlock}
      <a href="${FRONTEND_URL}/auth/login"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:16px;">
        Iniciar sesión
      </a>
    </div>
  </div>
</body>
</html>`;
}

export function enrollmentEmailHtml(name: string, courseName: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Claridad que transforma.</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Tienes un nuevo curso!</h2>
      <p style="color:#555;line-height:1.6;">Hola ${name},</p>
      <p style="color:#555;line-height:1.6;">Has sido inscrito en el siguiente curso:</p>
      <div style="background:#F0F7FF;border-left:4px solid #00B4D8;padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0;color:#2C2C2C;font-size:16px;font-weight:600;">📚 ${courseName}</p>
      </div>
      <p style="color:#555;line-height:1.6;">Ingresa a la plataforma para comenzar tu aprendizaje.</p>
      <a href="${FRONTEND_URL}/courses"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:16px;">
        Ver mis cursos
      </a>
    </div>
  </div>
</body>
</html>`;
}
