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
  return role === 'ADMIN' || role === 'EVALUATOR';
}

export function isAdmin(event: Event): boolean {
  return event.requestContext.authorizer?.lambda?.role === 'ADMIN';
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

// ── Image generation ─────────────────────────────────────────────────────────
export const STYLE_SUFFIXES: Record<string, string> = {
  realistic:    ', photorealistic, high detail, professional photography',
  illustration: ', flat illustration, colorful, modern vector art style',
  diagram:      ', clean technical illustration, professional schematic, flat design',
  comic:        ', comic book style, bold outlines, vibrant colors, graphic novel',
  minimal:      ', minimal design, clean white background, simple shapes',
  colorful:     ', vibrant multicolor palette, energetic, dynamic composition',
  corporate:    ', professional corporate style, blue and gray tones, business',
};

// Haiku → visual prompt for Stability AI (pure scene description, no text in image)
export async function buildVisualPrompt(lessonTitle: string, moduleTitle: string, content: string): Promise<string> {
  const snippet = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json', accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31', max_tokens: 150,
        messages: [{ role: 'user', content:
          `Visual art director task: convert this lesson content into a diffusion model image prompt (max 80 words).\nRules: describe only visual elements (objects, people, settings, colors). NO text, labels, diagrams anywhere in the image. Flat illustration style, colorful, white background.\nLesson: "${lessonTitle}"\nContent: ${snippet}\nReturn ONLY the prompt, nothing else.`
        }],
      }),
    }));
    const text = JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text?.trim() ?? '';
    if (text.length > 20) return text;
  } catch { /* fall through */ }
  return `Flat illustration of "${lessonTitle.slice(0, 60)}", colorful educational scene with objects and people, clean white background, modern design, no text, no labels`;
}

// Haiku → SVG infographic with real readable text (for regenType 'infographic')
export async function generateLessonInfographic(lessonTitle: string, moduleTitle: string, lessonContent: string): Promise<string | null> {
  const snippet = lessonContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  const prompt = `Create a clean educational SVG infographic (1200x1200px) for this lesson.

Lesson: "${lessonTitle}"
Module: "${moduleTitle}"
Content: ${snippet}

Generate a complete, valid SVG with:
- White background (#FFFFFF)
- Title at top in dark color, large font (32-40px), in Spanish, wrapped with tspan if needed
- 3-4 content sections, each with: a colored rounded rectangle header, a simple SVG icon built from basic shapes (circle/rect/path — no external images or base64), 2-3 lines of explanatory text in Spanish
- Color palette: complementary colors (blues #3B82F6, greens #10B981, oranges #F59E0B, purples #8B5CF6)
- font-family="Arial, Helvetica, sans-serif" on all text elements
- All text content in Spanish, directly related to the lesson
- NO external images, NO base64, NO JavaScript, NO CSS classes — pure SVG attributes only
- viewBox="0 0 1200 1200" width="1200" height="1200"

Return ONLY the raw SVG markup starting with <svg and ending with </svg>. No markdown, no explanation.`;

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json', accept: 'application/json',
      body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }] }),
    }));
    let svgRaw = JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text?.trim() ?? '';
    const match = svgRaw.match(/<svg[\s\S]*<\/svg>/i);
    if (!match) { console.error('[InfographicGen] No valid SVG in response'); return null; }
    const svg = match[0];
    const key = `lessons/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.svg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_IMAGES_BUCKET, Key: key,
      Body: Buffer.from(svg, 'utf-8'),
      ContentType: 'image/svg+xml',
      CacheControl: 'public, max-age=31536000',
    }));
    return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
  } catch (err) {
    console.error('[InfographicGen] Error:', err);
    return null;
  }
}

export async function generateLessonImage(
  lessonTitle: string,
  moduleTitle: string,
  order: number,
  override?: { promptText?: string; style?: string; lessonContent?: string }
): Promise<string | null> {
  // Build prompt: custom override → Haiku visual scene from content → simple fallback
  let prompt: string;
  if (override?.promptText) {
    prompt = override.promptText;
  } else if (override?.lessonContent) {
    prompt = await buildVisualPrompt(lessonTitle, moduleTitle, override.lessonContent);
  } else {
    prompt = `Flat illustration of "${lessonTitle.slice(0, 60)}" from "${moduleTitle.slice(0, 60)}", colorful educational scene, clean white background, modern design, no text`;
  }
  if (override?.style && STYLE_SUFFIXES[override.style]) {
    prompt = prompt + STYLE_SUFFIXES[override.style];
  }
  try {
    // Stability Image Core — ACTIVE model in us-west-2, native Bedrock, no external API key
    const resp = await bedrockImageClient.send(new InvokeModelCommand({
      modelId: 'stability.stable-image-core-v1:1',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        prompt,
        negative_prompt: 'text, words, letters, labels, captions, watermark, writing, typography, signs, blurry, low quality, distorted, infographic, chart, diagram',
        mode: 'text-to-image',
        aspect_ratio: '1:1',
        output_format: 'jpeg',
      }),
    }));
    const result = JSON.parse(new TextDecoder().decode(resp.body));
    const base64 = result.images?.[0];
    if (!base64) { console.error('[ImageGen] Stability returned no image'); return null; }
    const imgBuffer = Buffer.from(base64, 'base64');
    if (imgBuffer.length === 0) return null;
    const key = `lessons/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_IMAGES_BUCKET,
      Key: key,
      Body: imgBuffer,
      ContentType: 'image/jpeg',
    }));
    return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
  } catch (err) {
    console.error('[ImageGen] Error generating lesson image:', err);
    return null;
  }
}

// ── Amazon Polly audio generation helper ─────────────────────────────────────
const POLLY_VOICE_LANGUAGE: Record<string, string> = {
  Mia: 'es-MX', Lupe: 'es-US', Pedro: 'es-US', Lucia: 'es-ES', Sergio: 'es-ES',
};

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

/** Lightweight Bedrock / Claude Haiku JSON caller — used in synchronous routes */
export async function invokeBedrockForJson(prompt: string, maxTokens = 2000): Promise<any> {
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
