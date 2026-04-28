import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { UserRole } from '@lux/types';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

const JWKS_URL = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`;

// Cached JWKS (warm between Lambda invocations)
let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!JWKS) {
    JWKS = createRemoteJWKSet(new URL(JWKS_URL));
  }
  return JWKS;
}

export interface VerifiedClaims {
  userId: string;
  email: string;
  role: UserRole;
}

export async function verifyToken(token: string): Promise<VerifiedClaims> {
  const { payload } = await jwtVerify(token, getJWKS(), {
    issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
    audience: process.env.COGNITO_CLIENT_ID,
  });

  const groups = (payload['cognito:groups'] as string[] | undefined) ?? [];
  const role: UserRole = groups.includes('EVALUATOR') ? 'EVALUATOR' : 'STUDENT';

  return {
    userId: payload['sub'] as string,
    email: payload['email'] as string,
    role,
  };
}

export function extractToken(authHeader?: string): string {
  if (!authHeader) throw new Error('Missing Authorization header');
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') throw new Error('Invalid Authorization format');
  return parts[1]!;
}
