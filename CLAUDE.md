# Lux Learning — Project Guide for Claude

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router) · Vercel · `apps/web` |
| Backend | AWS Lambda (Node 20, arm64) + API Gateway v2 HTTP |
| DB | Prisma + PostgreSQL (Neon serverless) |
| Cache/State | DynamoDB |
| AI | Amazon Bedrock (Claude Haiku `global.anthropic.claude-haiku-4-5-20251001-v1:0`, Nova Canvas) |
| Auth | Amazon Cognito — groups: STUDENT / EVALUATOR / ADMIN / SUPER_ADMIN |
| Queue | SQS → `lux-sqsconsumer` (AI detection on reflections) |
| Storage | S3 `lux-learning-images` |
| Email | SES |
| Push | Web Push (VAPID) |

## Key identifiers

| Key | Value |
|---|---|
| API Gateway ID | `v4vabtmerb` |
| Region | `us-east-1` |
| Account | `798694628803` |
| Cognito User Pool | `us-east-1_RGVyVRJXx` |
| Cognito Client ID | `63ujfu3mt11s45p9g6m7p0n648` |
| SQS Reflection Queue | `https://sqs.us-east-1.amazonaws.com/798694628803/lux-reflection-queue` |
| DB Secret ARN | `arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-bp488g` |
| S3 Images Bucket | `lux-learning-images` |
| Frontend URL | `https://lux-learning-mentor.vercel.app` |

## Monorepo structure

```
apps/web/                  Next.js frontend
  app/(student)/           Student views
  app/(evaluator)/         Evaluator/admin views
  lib/api.ts               All API calls
  lib/auth.ts              Cognito / getIdToken
services/api/src/
  admin/handler.ts         lux-admin
  reflection/handler.ts    lux-reflection
  reflection/sqs-consumer.ts  lux-sqsconsumer
  evaluator/handler.ts     lux-evaluator
  courses/handler.ts       lux-courses
  quiz/handler.ts          lux-quiz
  certificates/handler.ts  lux-certs
  analysis/handler.ts      lux-analysis
  reminders/handler.ts     lux-reminders
  reports/handler.ts       lux-reports
  messages/handler.ts      lux-messages
  lessons/handler.ts       lux-lessons
  tasks/handler.ts         lux-tasks
  notifications/handler.ts lux-notifs
  push/handler.ts          lux-push
  authorizer/handler.ts    lux-authorizer
  shared/
    db-neon.ts             Prisma client (async, SM fallback)
    db-dynamo.ts           DynamoDB helpers
    db-messages.ts         Chat/message DynamoDB helpers
    response.ts            HTTP response builders + CORS
packages/types/            @lux/types shared types
scripts/deploy-lambda.ps1  Canonical build+deploy script
```

---

## How to deploy

```powershell
.\scripts\deploy-lambda.ps1 lux-admin lux-reflection   # one or more
.\scripts\deploy-lambda.ps1 all                         # everything
```

The script: esbuild → stage Prisma node_modules (for Prisma lambdas) → zip → deploy → sync `PRISMA_QUERY_ENGINE_LIBRARY`. Never wipes env vars.

### Prisma zip must include
- `index.js`
- `node_modules/@prisma/client/`
- `node_modules/.prisma/client/` (exclude `query_engine-windows.dll.node`)

---

## Environment variables per Lambda

All lambdas inherit DynamoDB table names from env. Prisma lambdas also need `DATABASE_URL` (auto-fetched from SM if missing).

### Shared across all lambdas
```
COGNITO_USER_POOL_ID      us-east-1_RGVyVRJXx
COGNITO_CLIENT_ID         63ujfu3mt11s45p9g6m7p0n648
DYNAMO_TABLE_PROGRESS     LessonProgress
DYNAMO_TABLE_QUIZ         QuizAttempts
DYNAMO_TABLE_REFLECTIONS  Reflections
DYNAMO_TABLE_NOTIFS       Notifications
DYNAMO_TABLE_ENROLLMENTS  Enrollments
DYNAMO_TABLE_CERTIFICATES Certificates
DYNAMO_TABLE_PUSH_SUBS    PushSubscriptions
DYNAMO_TABLE_TASKS        ScheduledTasks
DYNAMO_TABLE_REPORT_ANALYSIS  ReportAnalysis
DYNAMO_TABLE_RECOMMENDATIONS  CurriculumRecommendations
DYNAMO_TABLE_ACTIVITY     LuxActivity
DYNAMO_TABLE_CHATS        LuxChats
DYNAMO_TABLE_MESSAGES     LuxMessages
DYNAMO_TABLE_CALENDAR     LuxCalendarEvents
```

### Prisma lambdas (admin, reflection, evaluator, courses, quiz, certs, analysis, reminders, reports)
```
DATABASE_URL              postgresql://... (auto-fetched from SM if missing)
PRISMA_QUERY_ENGINE_LIBRARY  /var/task/node_modules/.prisma/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node
DB_SECRET_ARN             arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-bp488g
```

### lux-certs
```
DYNAMO_TABLE_CERT_TEMPLATES  LuxCertTemplates   (added 2026-05-29)
```
Requires `pdfkit` — already installed in `services/api`. Lazy `require('pdfkit')` inside handler to avoid cold-start cost.

### lux-admin
```
S3_IMAGES_BUCKET          lux-learning-images
SES_FROM_EMAIL            jason.rbm@gmail.com
FRONTEND_URL              https://lux-learning-mentor.vercel.app
BEDROCK_REGION            us-east-1
VAPID_PUBLIC_KEY          BD-Lc9oup...
VAPID_PRIVATE_KEY         SrodpnU4...
VAPID_EMAIL               mailto:admin@luxlearning.com
```

### lux-reflection + lux-sqsconsumer
```
SQS_REFLECTION_QUEUE_URL  https://sqs.../lux-reflection-queue
BEDROCK_REGION            us-east-1
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_EMAIL
```

### lux-evaluator + lux-reports + lux-reminders
```
SES_FROM_EMAIL            jason.rbm@gmail.com
FRONTEND_URL              https://lux-learning-mentor.vercel.app
BEDROCK_REGION            us-east-1 (evaluator only)
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_EMAIL (evaluator only)
```

---

## CRITICAL rules

### NEVER do this — wipes all env vars
```bash
aws lambda update-function-configuration --environment Variables={KEY=val}
```

### Always merge env vars (PowerShell — no backslash continuation)
```powershell
$vars = (aws lambda get-function-configuration --function-name lux-X --query "Environment.Variables" --output json) -join ""
$d = $vars | ConvertFrom-Json; $h = @{}
$d.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }
$h['NEW_VAR'] = 'value'   # add/change only what you need
$body = @{ Variables = $h } | ConvertTo-Json -Compress
$noBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText("$env:TEMP\env-patch.json", $body, $noBom)
aws lambda update-function-configuration --function-name lux-X --environment "file://$env:TEMP\env-patch.json"
```

### DATABASE_URL is self-healing
`db-neon.ts` fetches `DATABASE_URL` from Secrets Manager if env var is missing and caches it. `getPrismaClient()` is async — all handlers use `await getPrismaClient()`.

### CORS
Allowed origins are in `shared/response.ts` `ALLOWED_ORIGINS[]`. Add new Vercel URLs there.

---

## DynamoDB tables

| Table | PK | SK | Notes |
|---|---|---|---|
| Reflections | userId | moduleId | status: PENDING_AI → PENDING_EVAL → APPROVED/REJECTED |
| QuizAttempts | userId | moduleId | arrays of attempts |
| LessonProgress | userId | lessonId | completed boolean |
| Enrollments | userId | courseId | GSI: courseId-index |
| Notifications | userId | notifId | bell icon in Topbar |
| LuxChats | `USER#userId` | chatId | membership record |
| LuxChats | `CHAT#chatId` | `META` | chat metadata + participants |
| LuxMessages | chatId | ts | `ts = ISO#randomId` |
| PushSubscriptions | userId | endpoint | VAPID push subs |
| ScheduledTasks | userId | taskId | per-student tasks |
| LuxCertTemplates | `TEMPLATE` | `GLOBAL` | Certificate template (colors, logo, watermark) — env: `DYNAMO_TABLE_CERT_TEMPLATES` |
| LessonProgress (`_AIJOB`) | `_AIJOB` | jobId | AI generation jobs — reuses LessonProgress table with special userId. Status: `processing` → `done`\|`error` |
| LuxCalendarEvents | creatorId | eventId | Evaluator/Admin calendar events — env: `DYNAMO_TABLE_CALENDAR`. visibility: private\|evaluators\|students\|community |

---

## Business flows

### Reflection flow
1. Student submits `POST /reflection` → saves `PENDING_AI`, sends `{userId, moduleId}` to SQS
2. `lux-sqsconsumer` reads SQS → runs `detectAI()` via Bedrock
3. If AI score ≥ 60 → status `REJECTED`; else → `PENDING_EVAL`
4. On `PENDING_EVAL`: creates in-app notification + push to `reflection.evaluatorId`
5. Evaluator reviews → `POST /evaluator/reflections/review` → `APPROVED` or `REJECTED`
6. `reflection.evaluatorId` is stored at submission time from `module.course.evaluatorId`

### Quiz flow
1. Student answers → `POST /quiz/{moduleId}/submit`
2. Score calculated server-side; stored in `QuizAttempts` DDB
3. Passing score set per module in Prisma (`module.passingScore`, default 70)
4. Must pass quiz before reflection is unlocked (`hasPassedQuiz` check)
5. Options are shuffled in DB at creation time (`shuffleQuestionOptions` in admin/handler.ts)

### Enrollment flow
1. Admin `POST /admin/users/{username}/enrollments`
2. Prisma `Enrollment` record created
3. DynamoDB `Enrollments` record written
4. Welcome email sent via SES
5. `upsertChat(group_${courseId})` + `upsertMembership(username, group_${courseId})` — ensures group chat META + membership exist

### Group chat
- Chat ID: `group_${courseId}`
- Messages handler auto-joins users without membership (`group_*` prefix) — handles legacy students, admins, evaluators
- `upsertMembership` uses `UpdateCommand + SET if_not_exists` (safe to call multiple times)

### Certificate flow
1. All module reflections must be `APPROVED`
2. `POST /my-certificates/generate` → Bedrock generates personalized text → saved in `Certificates` DDB
3. Certificate accessible at `/certificado/{certId}` (public, no auth)

---

## Common errors & fixes

| Error | Cause | Fix |
|---|---|---|
| `Cannot find module '@prisma/client'` | zip missing `node_modules/@prisma/client/` | Use `deploy-lambda.ps1` — stages Prisma files automatically |
| `Cannot find module '.prisma/client/default'` | zip missing `node_modules/.prisma/client/` generated files | Same — full `.prisma/client/` directory needed |
| `Internal server error` on any Prisma lambda | `DATABASE_URL` env var missing | Code auto-fetches from SM; if still failing, check SM secret is accessible |
| `403 No eres participante de este chat` | User has no membership record in `LuxChats` | Auto-join now handles `group_*` chats; for DIRECT chats create via `POST /messages/chats` |
| `Runtime.ImportModuleError` on cold start | Wrong zip structure | Always use `deploy-lambda.ps1` |
| Reflection 403 "pass quiz first" | Student hasn't passed the quiz for that module | Expected behavior — not a bug |
| Push notification silent | VAPID keys not set or subscription stale | Check `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars |
| `Application error: client-side exception` on page load | React hook (e.g. `useRef`, `useCallback`) used in component but not imported | Check the import line — add all used hooks to `import { ... } from 'react'` |
| `Failed to fetch` on new API call | New backend route exists in handler but was never registered in API Gateway | See "API Gateway — adding new routes" section below |

---

## API Gateway — adding new routes

**Every new route in a Lambda handler MUST be registered in API Gateway + given a Lambda invoke permission. Forgetting either causes `Failed to fetch` on the frontend.**

### Checklist when adding a new route to any handler

1. **Create the API GW route:**
```powershell
aws apigatewayv2 create-route \
  --api-id v4vabtmerb \
  --route-key "POST /admin/example/{id}" \
  --authorization-type CUSTOM --authorizer-id zsk60q \
  --target "integrations/6aoajo2"   # lux-admin integration
```

2. **Add Lambda invoke permission:**
```powershell
aws lambda add-permission \
  --function-name lux-admin \
  --statement-id ApiGw-POST-example-id \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:798694628803:v4vabtmerb/*/POST/admin/example/*"
```

3. **Verify the route exists:**
```powershell
aws apigatewayv2 get-routes --api-id v4vabtmerb \
  --query "Items[?contains(RouteKey, 'example')].RouteKey" --output json
```

### Integration IDs per Lambda
| Lambda | Integration ID |
|---|---|
| lux-admin | `6aoajo2` |
| lux-evaluator | check with `aws apigatewayv2 get-integrations --api-id v4vabtmerb` |
| lux-courses | same |
| (others) | same |

### Authorizer
All protected routes use `--authorizer-id zsk60q` (the `lux-authorizer` JWT verifier). Public routes omit `--authorization-type` and `--authorizer-id`.

### Async job pattern (module/course AI regeneration)
Long-running AI tasks use Lambda self-invoke (`InvocationType: 'Event'`):
- Initial HTTP call saves `jobId` to DynamoDB (`LessonProgress` table, `userId='_AIJOB'`) and returns immediately
- Worker runs in background, updates status to `done` or `error`
- Frontend **must poll** `GET /admin/courses/ai-job?jobId=...` every 3 s to detect completion
- lux-admin has `lambda:InvokeFunction` on its own ARN in the execution role — self-invoke works
- Debug stuck jobs: `aws dynamodb query --table-name LessonProgress --key-condition-expression "userId = :uid" --expression-attribute-values file://expr.json` where expr.json = `{":uid":{"S":"_AIJOB"}}`

---

## React — common mistakes

### Always import every hook you use
```tsx
// Wrong — useRef used in component body but not imported → crashes with "Application error"
import { useEffect, useState } from 'react';
const myRef = useRef(null);  // ← ReferenceError at runtime

// Correct
import { useEffect, useState, useRef } from 'react';
```

Common hooks to remember: `useRef`, `useCallback`, `useMemo`, `useReducer`, `useContext`, `useId`.

---

## Backlog highlights (not implemented)

See `BACKLOG.md` for full list. Top priorities:
1. Gamification (XP + badges + leaderboard) — DDB `Gamification` table
2. Socratic chatbot upgrade — prompt change in `lessons/handler.ts`
3. AI gap detector post-quiz — reuse `heatMap` data already in reports
4. AI study planner — Bedrock call from dashboard, data already in DDB
5. Bulk CSV student import — `POST /admin/users/bulk-import`
