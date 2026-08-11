/**
 * Post-deploy smoke test.
 * Usage: npx ts-node scripts/smoke-test.ts [env]
 *   env: test (default) | staging | prod
 *
 * Requires env vars:
 *   SMOKE_TEST_ADMIN_TOKEN   — Cognito ID token for an ADMIN user
 *   SMOKE_TEST_EVAL_TOKEN    — Cognito ID token for an EVALUATOR user (optional)
 *
 * Exit 0 = all checks green. Exit 1 = at least one failure.
 */

const ENV = (process.argv[2] ?? 'test') as 'test' | 'staging' | 'prod';

const BASE_URLS: Record<string, string> = {
  test:    'https://v4vabtmerb.execute-api.us-east-1.amazonaws.com',
  staging: 'https://v4vabtmerb.execute-api.us-east-1.amazonaws.com',
  prod:    'https://v4vabtmerb.execute-api.us-east-1.amazonaws.com',
};

const BASE = BASE_URLS[ENV];

const ADMIN_TOKEN = process.env.SMOKE_TEST_ADMIN_TOKEN ?? '';
const EVAL_TOKEN  = process.env.SMOKE_TEST_EVAL_TOKEN  ?? ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  console.error('❌  SMOKE_TEST_ADMIN_TOKEN is required');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface Check {
  name: string;
  passed: boolean;
  status?: number;
  detail?: string;
}

const results: Check[] = [];

async function hit(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; expectStatus?: number | number[]; expectKeys?: string[] } = {}
): Promise<Check> {
  const { token = ADMIN_TOKEN, body, expectStatus = [200, 201], expectKeys = [] } = opts;
  const statuses = Array.isArray(expectStatus) ? expectStatus : [expectStatus];

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let json: any = {};
  try { json = await res.json(); } catch { /* ignore */ }

  const statusOk  = statuses.includes(res.status);
  const missingKeys = expectKeys.filter((k) => !(k in (json.data ?? {})));
  const passed    = statusOk && missingKeys.length === 0;
  const detail    = !statusOk
    ? `got ${res.status}, expected ${statuses.join('|')}`
    : missingKeys.length > 0
      ? `missing keys: ${missingKeys.join(', ')}`
      : undefined;

  return { name: `${method} ${path}`, passed, status: res.status, detail };
}

function record(check: Check) {
  results.push(check);
  const icon = check.passed ? '✅' : '❌';
  const suffix = check.detail ? ` — ${check.detail}` : '';
  console.log(`  ${icon}  [${check.status ?? '???'}] ${check.name}${suffix}`);
}

// ─── Checks ──────────────────────────────────────────────────────────────────

async function runChecks() {
  console.log(`\n🔥  Smoke test: ${ENV.toUpperCase()} — ${BASE}\n`);

  // ── lux-admin routes ────────────────────────────────────────────────────────
  console.log('── lux-admin ──────────────────────────────────');

  record(await hit('GET', '/admin/courses',              { expectStatus: 200 }));
  record(await hit('GET', '/admin/users',                { expectStatus: 200 }));
  record(await hit('GET', '/admin/reports',              { expectStatus: 200 }));
  record(await hit('GET', '/user/profile',               { expectStatus: 200 }));
  record(await hit('GET', '/admin/courses/ai-job?jobId=smoke-nonexistent',
    { expectStatus: [200, 404] }));

  // bulk-import: send an intentionally-bad CSV to get 400, proves route exists
  record(await hit('POST', '/admin/users/bulk-import',
    { body: {}, expectStatus: 400 }));

  // wizard copilot: missing body → 400 proves route is wired
  record(await hit('POST', '/admin/courses/wizard/copilot',
    { body: {}, expectStatus: 400 }));

  // wizard save: missing title → 400 proves route is wired
  record(await hit('POST', '/admin/courses/wizard/save',
    { body: {}, expectStatus: 400 }));

  // generate-image: missing promptText → 400
  record(await hit('POST', '/admin/generate-image',
    { body: {}, expectStatus: 400 }));

  // stock-photos: missing q → 400
  record(await hit('GET', '/admin/stock-photos',
    { expectStatus: 400 }));

  // ── lux-evaluator routes ────────────────────────────────────────────────────
  console.log('\n── lux-evaluator ──────────────────────────────');

  record(await hit('GET',  '/evaluator/my-courses',      { token: EVAL_TOKEN, expectStatus: 200 }));
  record(await hit('GET',  '/evaluator/reflections',     { token: EVAL_TOKEN, expectStatus: 200 }));
  record(await hit('GET',  '/evaluator/groups',          { token: EVAL_TOKEN, expectStatus: 200 }));
  record(await hit('GET',  '/evaluator/tasks',           { token: EVAL_TOKEN, expectStatus: 200 }));
  record(await hit('GET',  '/evaluator/resources',       { token: EVAL_TOKEN, expectStatus: 200 }));

  // quiz-audit: missing params → 400
  record(await hit('GET',  '/evaluator/quiz-audit',      { token: EVAL_TOKEN, expectStatus: 400 }));

  // translate: missing body → 400
  record(await hit('POST', '/evaluator/translate',
    { token: EVAL_TOKEN, body: {}, expectStatus: 400 }));

  // ── lux-courses ─────────────────────────────────────────────────────────────
  console.log('\n── lux-courses ────────────────────────────────');
  record(await hit('GET', '/courses', { expectStatus: 200 }));

  // ── lux-quiz ────────────────────────────────────────────────────────────────
  console.log('\n── lux-quiz ───────────────────────────────────');
  // GET on a non-existent module → 404 or 200 (any non-500 proves the lambda is alive)
  record(await hit('GET', '/quiz/smoke-test-nonexistent',
    { expectStatus: [200, 400, 404] }));

  // ── lux-reflection ──────────────────────────────────────────────────────────
  console.log('\n── lux-reflection ─────────────────────────────');
  // POST with no body → 400 proves lambda responds
  record(await hit('POST', '/reflection',
    { body: {}, expectStatus: 400 }));

  // ─── summary ──────────────────────────────────────────────────────────────
  const passed  = results.filter((r) => r.passed).length;
  const failed  = results.filter((r) => !r.passed).length;
  const total   = results.length;

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Result: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`);

  if (failed > 0) {
    console.log('\nFailed checks:');
    results.filter((r) => !r.passed).forEach((r) =>
      console.log(`  • ${r.name} — ${r.detail ?? `status ${r.status}`}`)
    );
    process.exit(1);
  }

  console.log('All checks passed. ✅');
  process.exit(0);
}

runChecks().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
