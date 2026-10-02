// ─── polly-audio.ts ───────────────────────────────────────────────────────────
// Amazon Polly neural lesson-audio synthesis — extracted out of admin/ctx.ts
// (2026-08-31) so the student-facing lessons lambda can lazily generate audio
// on demand too (Trello DmPpbrff, 2026-08-31 19:54 — Mack: lessons without a
// pre-generated Polly audioUrl fell back to the browser's free voice, "no son
// voces agradables"). Own S3/Polly client instances, same pattern already used
// by shared/carousel-pdf.ts for the same cross-lambda-reuse reason.
import { PollyClient, SynthesizeSpeechCommand, VoiceId } from '@aws-sdk/client-polly';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { acquireMedia, stubMediaUrl } from './media-budget';

const pollyClient = new PollyClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const S3_IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET ?? 'lux-learning-images';

// English neural voices added (Trello DmPpbrff item 4, 2026-08-30 20:20): the map only
// had Spanish voices, so an English course could never get a matching neural voice.
export const POLLY_VOICE_LANGUAGE: Record<string, string> = {
  Mia: 'es-MX', Lupe: 'es-US', Pedro: 'es-US', Lucia: 'es-ES', Sergio: 'es-ES',
  Danielle: 'en-US', Gregory: 'en-US',
};

// Default neural voice per course language — used by the Lux Planner auto-audio worker
// (and the lazy on-demand route) so every lesson gets a matching-language voice without
// an admin picking one manually.
export function defaultVoiceForLanguage(planLanguage: string | null | undefined): string {
  return (planLanguage ?? 'ES').toUpperCase() === 'EN' ? 'Danielle' : 'Mia';
}

// Male neural voice per language — Lux Mentor Class narration specifically asked for a
// male voice (Trello DmPpbrff, 2026-08-31 04:01: "en una voz masculina, específicamente").
// Spanish default changed from Sergio (es-ES, Spain) to Pedro (es-US, Latin American) —
// Trello DmPpbrff, 2026-09-05 (Mack): "El modelo de voz en español es un español de
// España; quiero que sea ... latinoamericano." The female default (Mia, es-MX) was
// already Latin American — only the male voice had this problem.
export function defaultMaleVoiceForLanguage(planLanguage: string | null | undefined): string {
  return (planLanguage ?? 'ES').toUpperCase() === 'EN' ? 'Gregory' : 'Pedro';
}

/** Short stable hash of the narrated text — lets lazy audio routes key S3 objects by
 *  content, so an edited lesson/question gets fresh audio and an unchanged one reuses it. */
export function audioContentHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 10);
}

async function s3ObjectExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: key }));
    return true;
  } catch {
    return false; // missing object (or unavailable check) → just synthesize
  }
}

/** Public URL of an already-synthesized audio object, or null — lets a caller skip costly
 *  upstream work (e.g. a Haiku translation) when the audio for this exact content exists. */
export async function existingAudioUrl(lessonId: string, voiceId: string): Promise<string | null> {
  const key = `audio/${lessonId}-${voiceId.toLowerCase()}.mp3`;
  return (await s3ObjectExists(key)) ? `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}` : null;
}

/** `reuseExisting`: for lazy student-facing routes whose lessonId already embeds a content
 *  hash — an existing S3 object for that key is the same audio, so skip Polly entirely. */
export async function generateLessonAudio(
  lessonId: string, text: string, voiceId = 'Mia', opts: { reuseExisting?: boolean } = {},
): Promise<string | null> {
  try {
    const plain = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2900); // Polly Neural limit per request

    const key = `audio/${lessonId}-${voiceId.toLowerCase()}.mp3`;
    if (opts.reuseExisting && await s3ObjectExists(key)) {
      return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
    }

    const gate = await acquireMedia('polly', plain.length);
    if (gate === 'stub') return stubMediaUrl('audio');
    if (gate === 'deny') return null;

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
