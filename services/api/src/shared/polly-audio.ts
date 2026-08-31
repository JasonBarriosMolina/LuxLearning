// ─── polly-audio.ts ───────────────────────────────────────────────────────────
// Amazon Polly neural lesson-audio synthesis — extracted out of admin/ctx.ts
// (2026-08-31) so the student-facing lessons lambda can lazily generate audio
// on demand too (Trello DmPpbrff, 2026-08-31 19:54 — Mack: lessons without a
// pre-generated Polly audioUrl fell back to the browser's free voice, "no son
// voces agradables"). Own S3/Polly client instances, same pattern already used
// by shared/carousel-pdf.ts for the same cross-lambda-reuse reason.
import { PollyClient, SynthesizeSpeechCommand, VoiceId } from '@aws-sdk/client-polly';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
