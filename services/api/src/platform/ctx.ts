import { createHash } from 'crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SESClient } from '@aws-sdk/client-ses';

// lux-platform serves Lux HQ (the owners' console) and the public forms
// (institution demo requests, teacher applications).
// It never touches the tenant database: its data lives in the platform DB whose
// URL is in PLATFORM_DB_SECRET_ARN.

export const REGION = process.env.AWS_REGION ?? 'us-east-1';
export const SALES_EMAIL = process.env.SALES_EMAIL ?? 'sales@luxlearning.academy';
export const TALENT_EMAIL = process.env.TALENT_EMAIL ?? 'talent@luxlearning.academy';
export const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.academy';
export const HQ_URL = process.env.HQ_URL ?? 'https://hq.luxlearning.academy';

export const ses = new SESClient({ region: REGION });
const sm = new SecretsManagerClient({ region: REGION });

export type Sql = NeonQueryFunction<false, false>;

let sqlPromise: Promise<Sql> | undefined;

async function initSql(): Promise<Sql> {
  const secretArn = process.env.PLATFORM_DB_SECRET_ARN;
  if (!secretArn) throw new Error('PLATFORM_DB_SECRET_ARN is not set');
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const raw = res.SecretString ?? '';
  const url = raw.startsWith('{') ? JSON.parse(raw).DATABASE_URL : raw;
  return neon(url);
}

export function getSql(): Promise<Sql> {
  if (!sqlPromise) sqlPromise = initSql().catch((err) => { sqlPromise = undefined; throw err; });
  return sqlPromise;
}

/** Internal HQ roles, stored as groups in the lux-hq-staff Cognito pool. */
export type StaffGroup = 'OWNER' | 'MARKETING' | 'DEV' | 'DATA';

export type Staff = { sub: string; email: string; groups: StaffGroup[] };

export type PlatformEvent = APIGatewayProxyEventV2WithJWTAuthorizer;

export type PlatformCtx = {
  event: PlatformEvent;
  method: string;
  path: string;
  body: Record<string, unknown>;
  getSql: () => Promise<Sql>;
  /** Set only on /hq/* routes, which API Gateway protects with the HQ JWT authorizer. */
  staff: Staff | null;
};

/** HTTP API JWT authorizers pass array claims as a string like "[OWNER MARKETING]". */
export function parseGroups(claim: unknown): StaffGroup[] {
  const list = Array.isArray(claim) ? claim : String(claim ?? '').replace(/^\[|\]$/g, '').split(/[\s,]+/);
  return list.map((g) => String(g).trim()).filter(Boolean) as StaffGroup[];
}

export function staffFromEvent(event: PlatformEvent): Staff | null {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!claims?.sub) return null;
  return {
    sub: String(claims.sub),
    email: String(claims.email ?? claims.username ?? ''),
    groups: parseGroups(claims['cognito:groups']),
  };
}

export function hasGroup(staff: Staff | null, ...allowed: StaffGroup[]): boolean {
  return !!staff && staff.groups.some((g) => g === 'OWNER' || allowed.includes(g));
}

/** Rate limits key on a salted hash, never on the raw IP. */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'lux';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}
