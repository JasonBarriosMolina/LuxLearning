import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

// Required for Neon serverless in Lambda
neonConfig.webSocketConstructor = ws;

let prisma: PrismaClient;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    const connectionString = process.env.DATABASE_URL!;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaNeon(pool);
    prisma = new PrismaClient({ adapter } as any);
  }
  return prisma;
}
