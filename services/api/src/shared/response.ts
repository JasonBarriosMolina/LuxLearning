import type { APIGatewayProxyResultV2 } from 'aws-lambda';

const ALLOWED_ORIGINS = [
  'https://lux-learning-tau.vercel.app',
  'https://lux-learning-mentor.vercel.app',
  'https://lux-learning.vercel.app',
  'http://localhost:3000',
];

function getCorsOrigin(requestOrigin?: string): string {
  if (!requestOrigin) return ALLOWED_ORIGINS[0]!;
  return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0]!;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.FRONTEND_URL ?? getCorsOrigin(),
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Content-Type': 'application/json',
};

export function ok<T>(data: T, message?: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ data, message }),
  };
}

export function created<T>(data: T): APIGatewayProxyResultV2 {
  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify({ data }),
  };
}

export function badRequest(error: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error, statusCode: 400 }),
  };
}

export function unauthorized(error = 'Unauthorized'): APIGatewayProxyResultV2 {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error, statusCode: 401 }),
  };
}

export function forbidden(error = 'Forbidden'): APIGatewayProxyResultV2 {
  return {
    statusCode: 403,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error, statusCode: 403 }),
  };
}

export function conflict(error: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 409,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error, statusCode: 409 }),
  };
}

export function notFound(error = 'Not found'): APIGatewayProxyResultV2 {
  return {
    statusCode: 404,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error, statusCode: 404 }),
  };
}

export function serverError(error: unknown): APIGatewayProxyResultV2 {
  console.error('[Lambda Error]', error);
  return {
    statusCode: 500,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: 'Internal server error', statusCode: 500 }),
  };
}

export function cors(): APIGatewayProxyResultV2 {
  return { statusCode: 204, headers: CORS_HEADERS, body: '' };
}
