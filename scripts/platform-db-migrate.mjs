// platform-db-migrate.mjs — applies services/api/platform-db/*.sql to the Lux HQ platform DB.
// Usage (from the repo root): node scripts/platform-db-migrate.mjs test|staging|prod
// The DB URL is read from Secrets Manager (lux/platform-db-<env>) and never printed.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import ws from 'ws';

const env = process.argv[2];
if (!['test', 'staging', 'prod'].includes(env)) {
  console.error('Usage: node scripts/platform-db-migrate.mjs test|staging|prod');
  process.exit(1);
}

neonConfig.webSocketConstructor = ws;
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'services', 'api', 'platform-db');

const sm = new SecretsManagerClient({ region: 'us-east-1' });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: `lux/platform-db-${env}` }));
const raw = secret.SecretString ?? '';
const url = raw.startsWith('{') ? JSON.parse(raw).DATABASE_URL : raw;

const pool = new Pool({ connectionString: url });
try {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) {
      console.log(`  skip  ${version}`);
      continue;
    }
    await pool.query('BEGIN');
    try {
      await pool.query(readFileSync(join(dir, file), 'utf8'));
      await pool.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
      await pool.query('COMMIT');
      console.log(`  apply ${version}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  }
  console.log(`Platform DB (${env}) is up to date.`);
} finally {
  await pool.end();
}
