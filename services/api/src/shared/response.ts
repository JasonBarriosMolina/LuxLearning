import type { APIGatewayProxyResultV2 } from 'aws-lambda';

const ALLOWED_ORIGINS = [
  'https://luxlearning.academy',
  'https://www.luxlearning.academy',
  'https://test.luxlearning.academy',
  'https://staging.luxlearning.academy',
  'https://lux-learning-tau.vercel.app',
  'https://lux-learning-mentor.vercel.app',
  'https://lux-learning.vercel.app',
  'https://lux-learning-staging.vercel.app',
  'https://lux-learning-test.vercel.app',
  'http://localhost:3000',
];

export function getCorsOrigin(requestOrigin?: string): string {
  if (!requestOrigin) return ALLOWED_ORIGINS[0]!;
  return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0]!;
}

let _requestOrigin: string | undefined;

export function setRequestOrigin(origin: string | undefined) {
  _requestOrigin = origin;
}

function buildCorsHeaders() {
  const origin = _requestOrigin;
  _requestOrigin = undefined; // reset after each use — prevents stale origin on warm containers
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(origin),
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Content-Type': 'application/json',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

export function ok<T>(data: T, message?: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: buildCorsHeaders(),
    body: JSON.stringify({ data, message }),
  };
}

export function created<T>(data: T): APIGatewayProxyResultV2 {
  return {
    statusCode: 201,
    headers: buildCorsHeaders(),
    body: JSON.stringify({ data }),
  };
}

export function badRequest(error: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 400,
    headers: buildCorsHeaders(),
    body: JSON.stringify({ error, statusCode: 400 }),
  };
}

export function unauthorized(error = 'Unauthorized'): APIGatewayProxyResultV2 {
  return {
    statusCode: 401,
    headers: buildCorsHeaders(),
    body: JSON.stringify({ error, statusCode: 401 }),
  };
}

export function forbidden(error = 'Forbidden'): APIGatewayProxyResultV2 {
  return {
    statusCode: 403,
    headers: buildCorsHeaders(),
    body: JSON.stringify({ error, statusCode: 403 }),
  };
}

export function conflict(error: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 409,
    headers: buildCorsHeaders(),
    body: JSON.stringify({ error, statusCode: 409 }),
  };
}

export function notFound(error = 'Not found'): APIGatewayProxyResultV2 {
  return {
    statusCode: 404,
    headers: buildCorsHeaders(),
    body: JSON.stringify({ error, statusCode: 404 }),
  };
}

export function serverError(error: unknown): APIGatewayProxyResultV2 {
  // Sanitize before logging — strip DB credentials that may appear in error messages
  const raw = error instanceof Error ? error.message : String(error ?? 'Internal server error');
  const sanitized = raw
    .replace(/postgresql:\/\/[^@]+@/g, 'postgresql://***@')
    .replace(/password=[^&\s"']+/gi, 'password=***');
  console.error('[Lambda Error]', sanitized);
  return {
    statusCode: 500,
    headers: buildCorsHeaders(),
    body: JSON.stringify({ error: 'Internal server error', statusCode: 500 }),
  };
}

export function cors(): APIGatewayProxyResultV2 {
  return { statusCode: 204, headers: buildCorsHeaders(), body: '' };
}
