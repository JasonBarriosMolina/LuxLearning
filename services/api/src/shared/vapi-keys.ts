// ─── vapi-keys.ts ─────────────────────────────────────────────────────────────
// Lazy-loaded Vapi API credentials from Secrets Manager with in-memory cache.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({ region: 'us-east-1' });

interface VapiKeys {
  apiKey: string;
  webhookSecret: string;
  phoneNumberId: string;
}

let _cached: VapiKeys | null = null;

export async function getVapiKeys(): Promise<VapiKeys> {
  if (_cached) return _cached;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: 'lux/vapi' }));
  _cached = JSON.parse(res.SecretString!) as VapiKeys;
  return _cached;
}
