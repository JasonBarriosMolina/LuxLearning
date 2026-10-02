// ─── media-budget.ts ─────────────────────────────────────────────────────────
// Cost guard for paid generative media (Stability images, Polly audio) in the TEST and
// STAGING environments only. Both generated ~70% of the AWS bill in Sep-2026 (course
// generation bursts: ~270 images/hour, one Polly audio per lesson) while nobody was
// consuming the output. The prod environment is never gated: `acquireMedia` returns
// 'allow' without touching DynamoDB.
//
//   test    → default MEDIA_MODE='stub': fixtures instead of real Stability/Polly calls.
//             Set the Lambda env var MEDIA_MODE=real to test the real media pipeline.
//   staging → default MEDIA_MODE='real' (Mack judges voice/image quality there) but with a
//             monthly cap per kind; at the cap the call is denied (null → callers' existing
//             non-fatal path) instead of billing more.
//
// Fails OPEN on any DynamoDB error (missing table, throttle): a broken guard must never
// block the feature itself.
import { getCurrentEnv } from './env-context';

// DynamoDB is imported lazily: this module is pulled into every Lambda that owns a Bedrock
// client (via bedrock-usage), and prod/stub paths never need it.
async function dynamo() {
  const [{ UpdateCommand }, { ddb, TABLES }] = await Promise.all([
    import('@aws-sdk/lib-dynamodb'), import('./db-core'),
  ]);
  return { UpdateCommand, ddb, TABLES };
}

export type MediaKind = 'image' | 'polly';
export type MediaGate = 'allow' | 'stub' | 'deny';

// Polly free tier = 1M neural chars/month account-wide for the first 12 months, so
// test + staging caps are sized to stay together under it. Images are $0.04 each.
const DEFAULT_CAPS = {
  test: { image: 100, polly: 150_000 },
  staging: { image: 300, polly: 750_000 },
} as const;

const DAILY_TTL_SECONDS = 120 * 24 * 3600;

export function mediaMode(): 'real' | 'stub' {
  const env = getCurrentEnv();
  if (env === 'prod') return 'real';
  const override = process.env.MEDIA_MODE;
  if (override === 'real' || override === 'stub') return override;
  return env === 'test' ? 'stub' : 'real';
}

function capFor(kind: MediaKind): number {
  const env = getCurrentEnv();
  const fromEnv = Number.parseInt(
    (kind === 'image' ? process.env.MEDIA_CAP_IMAGE : process.env.MEDIA_CAP_POLLY_CHARS) ?? '', 10,
  );
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  return DEFAULT_CAPS[env === 'staging' ? 'staging' : 'test'][kind];
}

const today = () => new Date().toISOString().slice(0, 10);

/** Adds counters to today's usage item (pk `use#YYYY-MM-DD`, sk = label). Never throws. */
export async function addUsage(sk: string, counters: Record<string, number>): Promise<void> {
  if (getCurrentEnv() === 'prod') return;
  try {
    const { UpdateCommand, ddb, TABLES } = await dynamo();
    const names: Record<string, string> = {};
    const values: Record<string, any> = { ':ttl': Math.floor(Date.now() / 1000) + DAILY_TTL_SECONDS };
    const adds = Object.entries(counters).map(([k, v], i) => {
      names[`#c${i}`] = k;
      values[`:v${i}`] = v;
      return `#c${i} :v${i}`;
    });
    await ddb.send(new UpdateCommand({
      TableName: TABLES.MEDIA_USAGE,
      Key: { pk: `use#${today()}`, sk },
      UpdateExpression: `ADD ${adds.join(', ')} SET #ttl = :ttl`,
      ExpressionAttributeNames: { ...names, '#ttl': 'ttl' },
      ExpressionAttributeValues: values,
    }));
  } catch (err: any) {
    console.warn('[media-budget] addUsage failed (ignored):', err?.name ?? err);
  }
}

/**
 * Decides whether a paid media call may proceed.
 *  - 'allow': go ahead (usage already counted).
 *  - 'stub' : return a fixture instead of calling the paid API (test default).
 *  - 'deny' : monthly cap reached — caller must treat it like a failed generation.
 * `amount` is images (1 each) or Polly characters billed.
 */
export async function acquireMedia(kind: MediaKind, amount: number): Promise<MediaGate> {
  if (getCurrentEnv() === 'prod') return 'allow';
  if (mediaMode() === 'stub') return 'stub';

  const cap = capFor(kind);
  if (amount > cap) return 'deny';
  try {
    const { UpdateCommand, ddb, TABLES } = await dynamo();
    await ddb.send(new UpdateCommand({
      TableName: TABLES.MEDIA_USAGE,
      Key: { pk: `cap#${new Date().toISOString().slice(0, 7)}`, sk: kind },
      UpdateExpression: 'ADD used :n, calls :one',
      ConditionExpression: 'attribute_not_exists(used) OR used <= :max',
      ExpressionAttributeValues: { ':n': amount, ':one': 1, ':max': cap - amount },
    }));
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      console.warn(`[media-budget] ${getCurrentEnv()} monthly ${kind} cap (${cap}) reached — denying`);
      return 'deny';
    }
    console.error('[media-budget] cap check failed, allowing:', err?.name ?? err);
    return 'allow';
  }
  await addUsage(kind, { calls: 1, units: amount });
  return 'allow';
}

/** Fixture media served instead of a paid generation in stub mode. */
export function stubMediaUrl(kind: 'image' | 'audio'): string {
  const bucket = process.env.S3_IMAGES_BUCKET ?? 'lux-learning-images';
  return `https://${bucket}.s3.amazonaws.com/fixtures/stub.${kind === 'image' ? 'jpg' : 'mp3'}`;
}

/** Sentence-level speech marks with a ~60 ms/char timeline — stands in for Polly's
 *  speech-marks response in stub mode so carousel/class slide timing keeps working. */
export function syntheticSpeechMarks(text: string): Array<{ time: number; value: string }> {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  let time = 0;
  return sentences.map((value) => {
    const mark = { time, value };
    time += Math.max(1500, value.length * 60);
    return mark;
  });
}
