# Lux HQ — platform console backend

Lux HQ is the console for the Lux Learning owners and internal team (marketing, data, dev).
It is **fully separate** from the tenant app (institutions, evaluators, students): its own
Cognito pool, its own Lambda and IAM role, its own database. Never add HQ features as a
role in the tenant pool — tenant ADMIN/SUPER_ADMIN must never see platform data.

## Environments

| | test | staging | prod |
|---|---|---|---|
| HQ domain | `hq-test.luxlearning.academy` (Vercel not set up yet) | `hq-staging.luxlearning.academy` (Vercel not set up yet) | `hq.luxlearning.academy` — not created |
| Lambda | `lux-platform-test` | `lux-platform-staging` | `lux-platform` |
| IAM role | `lux-platform-test-role` | `lux-platform-staging-role` | `lux-platform-prod-role` |
| Cognito pool | `lux-hq-staff-test` · `us-east-1_OGeDSEfbL` | `lux-hq-staff-staging` · `us-east-1_ha9ec0sHi` | `lux-hq-staff-prod` |
| App client `lux-hq-web` | `6ll4rfjfk73dre9ggg30v4gh4a` | `4h24g1fce52fhr8cklrfmribsa` | — |
| API Gateway | `hxnd6tzmce` | `1ohrw48nii` | `v4vabtmerb` |
| JWT authorizer | `lux-hq-jwt-test` · `x9xhqh` | `lux-hq-jwt-staging` · `f5479o` | `lux-hq-jwt-prod` |
| Integration | `da55fc3` | `yvvgwo4` | — |
| DB secret | `lux/platform-db-test` | `lux/platform-db-staging` | `lux/platform-db-prod` |
| Database | `lux_platform_test` · role `lux_platform_app_test` | `lux_platform_staging` · role `lux_platform_app_staging` | `lux_platform_prod` |

Each database lives on that env's own Neon endpoint (the tenant DB's endpoint), but is a
separate database with its own login role. Prod is **not created**: it needs explicit
confirmation from the owner, then `HQ_CONFIRM_PROD=yes scripts/hq-provision-env.sh prod`.

## Provisioning an environment

```bash
scripts/hq-provision-env.sh test|staging|prod
```

Idempotent (safe to re-run; on an existing env it only redeploys code and merges env vars).
It creates the platform DB + secret and runs migrations, the Cognito pool (admin-only
sign-up, TOTP required, groups, web client), the IAM role, the log group (30 days), the
Lambda, and on API Gateway the integration, JWT authorizer, `/public/*` and `/hq/*` routes,
invoke permissions and the HQ origin in CORS. It does **not** create staff users.
`prod` refuses to run without `HQ_CONFIRM_PROD=yes` (same for the DB scripts).

Creating a staff user (Cognito emails the temporary password):

```bash
aws cognito-idp admin-create-user --user-pool-id <pool> --username name@luxlearning.academy --user-attributes Name=email,Value=name@luxlearning.academy Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id <pool> --username name@luxlearning.academy --group-name OWNER
```

## Frontend (`apps/hq`)

Separate Next.js app (workspace `@lux/hq`), never part of `apps/web`: own domain, own
Amplify config pointing at the HQ pool, so tenant and staff sessions can never mix.

- Routes: `/login` (password → new password on first sign-in → TOTP setup with QR →
  6-digit code on every later sign-in), `/prospectos` + `/prospectos/[id]` (institution
  demos), `/talento` + `/talento/[id]` (teacher applications). Email links from
  `emails.ts` use these paths.
- Every request sends the Cognito **ID token** to `/hq/*`.
- Local dev: `npm run dev --workspace=apps/hq` → http://localhost:3002 (CORS for
  localhost:3002 is allowed on the test API and in `shared/response.ts`).
  Env vars in `apps/hq/.env.example` (copy to `.env.local`).

### Deploy to Vercel (one-time, done by the owner)

1. New Vercel project from this repo, **Root Directory `apps/hq`**, framework Next.js.
2. Env vars (test): `NEXT_PUBLIC_HQ_COGNITO_USER_POOL_ID=us-east-1_OGeDSEfbL`,
   `NEXT_PUBLIC_HQ_COGNITO_CLIENT_ID=6ll4rfjfk73dre9ggg30v4gh4a`,
   `NEXT_PUBLIC_HQ_API_URL=https://hxnd6tzmce.execute-api.us-east-1.amazonaws.com`.
   For **staging** use pool `us-east-1_ha9ec0sHi`, client `4h24g1fce52fhr8cklrfmribsa`
   and API `https://1ohrw48nii.execute-api.us-east-1.amazonaws.com` (branch `staging`,
   domain `hq-staging.luxlearning.academy`).
3. Production branch `test`; add domain `hq-test.luxlearning.academy` and create the
   CNAME Vercel shows at the DNS provider. CORS for that origin is already allowed.
4. Sign in as `owner.demo@luxlearning.academy` (temporary password in
   `.hq-test-credentials.local.txt`) and set up the authenticator app.

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

Code only: `scripts/deploy-platform.sh test|staging|prod`. `lux-platform` is also in
`scripts/deploy-lambda.ps1` for Windows, but that script does not set the platform env vars;
`hq-provision-env.sh` owns them.

New HQ routes must be added to the route list in `scripts/hq-provision-env.sh` and the
script re-run for each env.
