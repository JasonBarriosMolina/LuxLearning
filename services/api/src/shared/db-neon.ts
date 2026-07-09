import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import ws from 'ws';
import { getCurrentEnv, getDbSecretArn, type AppEnv } from './env-context';

neonConfig.webSocketConstructor = ws;

const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

// Per-env cache so prod/staging/test never share a connection pool
const prismaPromises: Partial<Record<AppEnv, Promise<PrismaClient>>> = {};
// Cache fetched DATABASE_URLs per env to avoid repeated SM calls on warm containers
const cachedUrls: Partial<Record<AppEnv, string>> = {};

async function initPrisma(env: AppEnv): Promise<PrismaClient> {
  let url = cachedUrls[env];

  if (!url) {
    // For prod, also check the process.env.DATABASE_URL set by previous warm invocations
    if (env === 'prod' && process.env.DATABASE_URL) {
      url = process.env.DATABASE_URL;
    } else {
      const secretArn = getDbSecretArn();
      console.warn(`[db-neon] DATABASE_URL not cached for env="${env}" — fetching from Secrets Manager (${secretArn})`);
      const res = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
      const raw = res.SecretString!;
      url = raw.startsWith('{') ? JSON.parse(raw).DATABASE_URL : raw;
      // Keep backward-compat: cache prod URL in process.env too
      if (env === 'prod') process.env.DATABASE_URL = url;
    }
    cachedUrls[env] = url;
  }

  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({ adapter } as any);
}

export function getPrismaClient(): Promise<PrismaClient> {
  const env = getCurrentEnv();
  if (!prismaPromises[env]) prismaPromises[env] = initPrisma(env);
  return prismaPromises[env]!;
}
