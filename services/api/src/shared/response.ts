import type { APIGatewayProxyResultV2 } from 'aws-lambda';

// Trello DmPpbrff, 2026-09-05 (Mack): "No puedo descargar el documento editable" — root
// cause found in CloudWatch: TypeError [ERR_INVALID_CHAR]: Invalid character in header
// content ["content-disposition"]. A Content-Disposition/ResponseContentDisposition
// header value is sent as a raw HTTP header, which Node rejects outright for any
// non-ASCII byte (accents, ñ, emoji, etc) — course titles and teacher names routinely
// have those. buildPlanFileName() only stripped filesystem-invalid characters
// (\ / : * ? " < > |), never non-ASCII ones, so any accented course title (the common
// case in Spanish) crashed doc generation entirely — the download button then simply
// never appeared, since generateWizardPlanDocument treats this as non-fatal and
// swallows it. Fixed with the standard RFC 6266 / RFC 5987 dual form: an ASCII-safe
// `filename=` for old clients, plus the real name UTF-8-percent-encoded in `filename*=`
// for everything that actually renders it (every current browser).
const COMBINING_DIACRITICS = new RegExp('[̀-ͯ]', 'g'); // é→e, ñ→n, etc, after NFD decomposition

function asciiSafeFileName(fileName: string): string {
  // Strip the base name and extension separately — the extension (.docx, .pdf, ...) is
  // always plain ASCII letters and would otherwise make the "any letters survived?"
  // check below pass even when the actual title was 100% non-Latin (e.g. "日本語.docx").
  const ext = fileName.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '';
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  const strippedBase = base
    .normalize('NFD').replace(COMBINING_DIACRITICS, '')
    .replace(/[^\x20-\x7E]/g, '') // drop anything still non-ASCII (emoji, CJK, etc)
    .replace(/"/g, '')            // quotes would break the header's own quoting
    .trim();
  const safeBase = /[A-Za-z0-9]/.test(strippedBase) ? strippedBase : 'documento';
  return `${safeBase}${ext}`;
}

/** Builds a Content-Disposition/ResponseContentDisposition header value that's safe to
 *  hand directly to Node's http client, even when fileName has accents or other
 *  non-ASCII characters — see the comment above for the bug this fixes. */
export function buildContentDisposition(fileName: string, type: 'attachment' | 'inline' = 'attachment'): string {
  return `${type}; filename="${asciiSafeFileName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

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
