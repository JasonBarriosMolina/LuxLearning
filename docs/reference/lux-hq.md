# Lux HQ — platform console backend

Lux HQ is the console for the Lux Learning owners and internal team (marketing, data, dev).
It is **fully separate** from the tenant app (institutions, evaluators, students): its own
Cognito pool, its own Lambda and IAM role, its own database. Never add HQ features as a
role in the tenant pool — tenant ADMIN/SUPER_ADMIN must never see platform data.

## Environments

| | test | staging | prod |
|---|---|---|---|
| HQ domain | `hq-test.luxlearning.academy` (not set up yet) | — | `hq.luxlearning.academy` (not set up yet) |
| Lambda | `lux-platform-test` | — | — |
| IAM role | `lux-platform-test-role` (inline policy `lux-platform-test-inline`) | — | — |
| Cognito pool | `lux-hq-staff-test` · `us-east-1_OGeDSEfbL` | — | — |
| App client | `lux-hq-web` · `6ll4rfjfk73dre9ggg30v4gh4a` (SRP, no secret) | — | — |
| API Gateway | `hxnd6tzmce` (shared with tenant test API) | — | — |
| JWT authorizer | `lux-hq-jwt-test` · `x9xhqh` | — | — |
| Integration | `da55fc3` | — | — |
| DB secret | `lux/platform-db-test` | — | — |
| Database | `lux_platform_test` on the test Neon endpoint, role `lux_platform_app_test` | — | — |

Staging/prod are not created yet. Promote only with explicit confirmation.

## Cognito pool rules

- Admin-only sign-up (`AllowAdminCreateUserOnly`), email as username.
- MFA **required**, TOTP (authenticator app) only. First login: new password → set up TOTP.
- Password: 12+ chars, upper, lower, number, symbol. Temporary passwords valid 7 days.
- Deletion protection on. Tokens: ID/access 60 min, refresh 12 h, revocation on.
- Groups: `OWNER` (everything), `MARKETING` (leads), `DEV`, `DATA`.
- Example test users (temp passwords in the git-ignored `.hq-test-credentials.local.txt`
  at the repo root): `owner.demo@luxlearning.academy` (OWNER), `marketing.demo@luxlearning.academy` (MARKETING).

The HQ frontend must send the **ID token** (it carries `email` and `cognito:groups`; the
JWT authorizer audience is the app client ID).

## Routes (`services/api/src/platform/`)

| Route | Auth | Who |
|---|---|---|
| `POST /public/demo-requests` | none | Landing form (`apps/web/components/landing/DemoForm.tsx`) |
| `GET /hq/me` | JWT | any staff |
| `GET /hq/leads?status=&q=` | JWT | OWNER, MARKETING |
| `GET /hq/leads/{id}` | JWT | OWNER, MARKETING |
| `PATCH /hq/leads/{id}` `{status?, ownerEmail?}` | JWT | OWNER, MARKETING |
| `POST /hq/leads/{id}/notes` `{body}` | JWT | OWNER, MARKETING |
| `POST /public/teacher-applications` | none | Teacher application form (`/profesores/postular`) |
| `GET /hq/teachers?status=&q=` | JWT | OWNER, MARKETING |
| `GET /hq/teachers/{id}` | JWT | OWNER, MARKETING |
| `PATCH /hq/teachers/{id}` `{status?, ownerEmail?}` | JWT | OWNER, MARKETING |
| `POST /hq/teachers/{id}/notes` `{body}` | JWT | OWNER, MARKETING |

Lead statuses: `NEW → CONTACTED → DEMO_SCHEDULED → WON | LOST`. Status changes go to
`lead_status_history`; every staff write goes to `staff_audit_log`.

Teacher application statuses (separate CRM tray): `NEW → REVIEWING → INTERVIEW →
ONBOARDING → ACTIVE | REJECTED`, with their own notes and status history. The onboarding
questionnaire is stored in `teacher_applications.answers` (JSONB, `form_version`) so the
form can evolve and an onboarding agent can read it. Options are validated against
`TEACHER_OPTIONS` (API) and must match `apps/web/components/landing/teacher-application-options.ts`.
Applications notify `TALENT_EMAIL`; the applicant gets the onboarding next steps (first
draft, kept in sync between `emails.ts` and `content.ts`). Limits: 5/hour per IP, 2/day per email.

Demo form protection: hidden honeypot field (`website`), max 5 requests/hour per IP hash,
max 3/day per email. On success: lead saved, email to `SALES_EMAIL`
(Reply-To = requester) and confirmation to the requester. Mail failures never fail the
request (the lead is already saved).

## Lambda env vars

| Var | Value (test) |
|---|---|
| `PLATFORM_DB_SECRET_ARN` | `arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/platform-db-test-Rt5Ly4` |
| `SALES_EMAIL` | `sales@luxlearning.academy` |
| `TALENT_EMAIL` | `talent@luxlearning.academy` |
| `SES_FROM_EMAIL` | `noreply@luxlearning.academy` (the IAM policy only allows this sender) |
| `HQ_URL` | `https://hq-test.luxlearning.academy` |
| `IP_HASH_SALT` | random, set at creation |

## Database

Schema: `services/api/platform-db/*.sql`, plain SQL (no Prisma). Apply with:

```bash
node scripts/platform-db-migrate.mjs test
```

The script reads `lux/platform-db-<env>` from Secrets Manager and records applied files
in `schema_migrations`.

## Deploy

`lux-platform` is in `scripts/deploy-lambda.ps1` (no Prisma). On macOS, without PowerShell:

```bash
node_modules/.bin/esbuild services/api/src/platform/handler.ts --bundle --platform=node --target=node20 '--external:@aws-sdk/*' --outfile=services/api/dist/platform/_stage/index.js --minify
(cd services/api/dist/platform/_stage && zip -qr ../lux-platform.zip index.js)
aws lambda update-function-code --function-name lux-platform-test --zip-file fileb://services/api/dist/platform/lux-platform.zip
```

New HQ routes on API Gateway need `--authorization-type JWT --authorizer-id x9xhqh
--target integrations/da55fc3` (test). Lambda invoke permissions already cover `/hq/*`
and `/public/*`.
