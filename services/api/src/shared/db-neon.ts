import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const SECRET_ARN = process.env.DB_SECRET_ARN ?? 'arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-bp488g';
const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

let prismaPromise: Promise<PrismaClient> | null = null;

async function initPrisma(): Promise<PrismaClient> {
  let url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[db-neon] DATABASE_URL not set — fetching from Secrets Manager');
    const res = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
    url = res.SecretString!;
    process.env.DATABASE_URL = url; // cache for subsequent warm calls
  }
  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({ adapter } as any);
}

export function getPrismaClient(): Promise<PrismaClient> {
  if (!prismaPromise) prismaPromise = initPrisma();
  return prismaPromise;
}
