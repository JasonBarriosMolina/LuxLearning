// ─── vapid.ts ─────────────────────────────────────────────────────────────────
// Lazy-loaded VAPID keys from Secrets Manager with in-memory cache.
// Avoids storing push notification credentials in Lambda environment variables.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({ region: 'us-east-1' });

interface VapidKeys {
  public: string;
  private: string;
  email: string;
}

let _cached: VapidKeys | null = null;

export async function getVapidKeys(): Promise<VapidKeys> {
  if (_cached) return _cached;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: 'lux/vapid' }));
  _cached = JSON.parse(res.SecretString!) as VapidKeys;
  return _cached;
}
