// platform-db-provision.mjs — one-time setup of the Lux HQ platform database for an env.
// Usage (from the repo root): node scripts/platform-db-provision.mjs test|staging|prod
//
// Creates, on that env's Neon endpoint, a dedicated login role and database
// (lux_platform_app_<env> / lux_platform_<env>) and stores the app connection URL in
// Secrets Manager as lux/platform-db-<env>. Idempotent: exits if the secret exists.
// Prints no secrets. Run scripts/platform-db-migrate.mjs afterwards.

import { randomBytes } from 'node:crypto';
import { Pool, neonConfig } from '@neondatabase/serverless';
import {
  SecretsManagerClient, GetSecretValueCommand, CreateSecretCommand, DescribeSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import ws from 'ws';

const OWNER_SECRETS = { test: 'lux/neon-db-test', staging: 'lux/neon-db-staging', prod: 'lux/neon-db' };

const env = process.argv[2];
if (!OWNER_SECRETS[env]) {
  console.error('Usage: node scripts/platform-db-provision.mjs test|staging|prod');
  process.exit(1);
}
if (env === 'prod' && process.env.HQ_CONFIRM_PROD !== 'yes') {
  console.error('Refusing to touch prod without HQ_CONFIRM_PROD=yes');
  process.exit(1);
}

neonConfig.webSocketConstructor = ws;
const DB = `lux_platform_${env}`;
const ROLE = `lux_platform_app_${env}`;
const SECRET = `lux/platform-db-${env}`;
const sm = new SecretsManagerClient({ region: 'us-east-1' });

const exists = await sm.send(new DescribeSecretCommand({ SecretId: SECRET })).then(() => true, () => false);
if (exists) {
  console.log(`Secret ${SECRET} already exists; nothing to do.`);
  process.exit(0);
}

const ownerRaw = (await sm.send(new GetSecretValueCommand({ SecretId: OWNER_SECRETS[env] }))).SecretString ?? '';
const ownerUrl = new URL(ownerRaw.startsWith('{') ? JSON.parse(ownerRaw).DATABASE_URL : ownerRaw);
const password = randomBytes(24).toString('hex');

const admin = new Pool({ connectionString: ownerUrl.toString() });
try {
  const { rows: roleRows } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
  if (roleRows.length) await admin.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}'`);
  else await admin.query(`CREATE ROLE ${ROLE} WITH LOGIN PASSWORD '${password}'`);
  // PG16: the creating role must be able to SET ROLE to the new database owner.
  await admin.query(`GRANT ${ROLE} TO ${decodeURIComponent(ownerUrl.username)} WITH SET TRUE`);
  const { rows: dbRows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB]);
  if (!dbRows.length) await admin.query(`CREATE DATABASE ${DB} OWNER ${ROLE}`);
  console.log(`Role ${ROLE} and database ${DB} ready.`);
} finally {
  await admin.end();
}

const appUrl = new URL(ownerUrl.toString());
appUrl.username = ROLE;
appUrl.password = password;
appUrl.pathname = `/${DB}`;

await sm.send(new CreateSecretCommand({
  Name: SECRET,
  Description: `Lux HQ platform DB (${env}) — leads, teacher applications, staff audit. Separate from the tenant DB.`,
  SecretString: JSON.stringify({ DATABASE_URL: appUrl.toString() }),
  Tags: [{ Key: 'Project', Value: 'LuxLearning' }, { Key: 'Env', Value: env }, { Key: 'App', Value: 'lux-hq' }],
}));
console.log(`Stored connection URL in ${SECRET}.`);
