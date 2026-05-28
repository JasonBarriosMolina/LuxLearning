# Lux Learning — Project Guide for Claude

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router) on Vercel — `apps/web` |
| Backend | AWS Lambda (Node 20, arm64) + API Gateway v2 HTTP |
| DB | Prisma + PostgreSQL (Neon serverless) |
| Cache/State | DynamoDB (progress, reflections, quiz, notifications, chats, tasks) |
| AI | Amazon Bedrock (Claude Haiku, Nova Canvas) |
| Auth | Amazon Cognito (user pools, groups: STUDENT / EVALUATOR / ADMIN / SUPER_ADMIN) |
| Queue | SQS → lux-sqsconsumer (AI detection on reflections) |
| Storage | S3 (`lux-learning-images`) |
| Email | SES |
| Push | Web Push (VAPID) |

## Key identifiers

- API Gateway ID: `v4vabtmerb`
- Region: `us-east-1`
- Account: `798694628803`
- Cognito User Pool: `us-east-1_RGVyVRJXx`
- SQS Reflection Queue: `https://sqs.us-east-1.amazonaws.com/798694628803/lux-reflection-queue`
- DB Secret ARN: `arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-bp488g`
- Frontend URL: `https://lux-learning-mentor.vercel.app`

## Lambda functions

| Function | Entry point | Uses Prisma |
|---|---|---|
| lux-admin | `src/admin/handler.ts` | ✅ |
| lux-reflection | `src/reflection/handler.ts` | ✅ |
| lux-evaluator | `src/evaluator/handler.ts` | ✅ |
| lux-courses | `src/courses/handler.ts` | ✅ |
| lux-quiz | `src/quiz/handler.ts` | ✅ |
| lux-certs | `src/certificates/handler.ts` | ✅ |
| lux-analysis | `src/analysis/handler.ts` | ✅ |
| lux-reminders | `src/reminders/handler.ts` | ✅ |
| lux-reports | `src/reports/handler.ts` | ✅ |
| lux-messages | `src/messages/handler.ts` | ❌ |
| lux-sqsconsumer | `src/reflection/sqs-consumer.ts` | ❌ |
| lux-lessons | `src/lessons/handler.ts` | ❌ |
| lux-tasks | `src/tasks/handler.ts` | ❌ |
| lux-notifs | `src/notifications/handler.ts` | ❌ |
| lux-push | `src/push/handler.ts` | ❌ |
| lux-authorizer | `src/authorizer/handler.ts` | ❌ |

## How to deploy

```powershell
# One or more lambdas
.\scripts\deploy-lambda.ps1 lux-admin lux-reflection

# All lambdas
.\scripts\deploy-lambda.ps1 all
```

The script: builds with esbuild, stages `node_modules/@prisma/client` + `.prisma/client` for Prisma lambdas, zips, deploys, and syncs `PRISMA_QUERY_ENGINE_LIBRARY` env var. Never wipes existing env vars.

## Critical rules

### NEVER do this
```bash
aws lambda update-function-configuration --environment Variables={KEY=val,...}
```
This **REPLACES the entire environment**, wiping DATABASE_URL and all other vars.

### Always merge env vars
```powershell
# Get current → merge → update
aws lambda get-function-configuration --function-name lux-X --query "Environment.Variables" --output json > tmp.json
# edit tmp.json to add/change only what you need
aws lambda update-function-configuration --function-name lux-X --environment file://tmp.json
```

### DATABASE_URL is resilient
`db-neon.ts` fetches DATABASE_URL from Secrets Manager if the env var is missing (cached in module scope). Even if env vars get wiped, DB connections still work.

## Prisma in Lambda

Prisma lambdas need these files in the zip:
- `index.js` (esbuild bundle with `--external:@prisma/client`)
- `node_modules/@prisma/client/` (JS package)
- `node_modules/.prisma/client/` (generated client + ARM64 engine binary)
  - Exclude `query_engine-windows.dll.node`

`PRISMA_QUERY_ENGINE_LIBRARY` must point to:
`/var/task/node_modules/.prisma/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node`

The deploy script handles all of this automatically.

## DynamoDB tables

| Table | Key |
|---|---|
| Reflections | `pk=userId, sk=moduleId` |
| QuizAttempts | `pk=userId, sk=moduleId` |
| LessonProgress | `pk=userId, sk=lessonId` |
| Enrollments | `pk=userId, sk=courseId` |
| Notifications | `pk=userId, sk=notifId` |
| LuxChats | `pk=USER#userId sk=chatId` (membership) / `pk=CHAT#chatId sk=META` |
| LuxMessages | `pk=chatId, sk=ts` |
| PushSubscriptions | `pk=userId, sk=endpoint` |
| ScheduledTasks | per-student tasks |

## Reflection flow

1. Student submits → `POST /reflection` → saves as `PENDING_AI` → sends to SQS
2. `lux-sqsconsumer` runs AI detection → sets `PENDING_EVAL` or `REJECTED`
3. On `PENDING_EVAL`: in-app notification + push sent to `reflection.evaluatorId`
4. Evaluator reviews → `POST /evaluator/reflections/review` → `APPROVED` or `REJECTED`

## Group chat

- Chat ID: `group_${courseId}`
- `upsertChat` creates CHAT META; `upsertMembership` creates USER membership record
- Messages handler auto-joins users accessing a `group_*` chat without a membership record (handles legacy students, admins, evaluators)

## Frontend

- `apps/web/lib/api.ts` — all API calls
- `apps/web/lib/auth.ts` — Cognito auth / getIdToken
- `apps/web/app/(student)/` — student views
- `apps/web/app/(evaluator)/` — evaluator/admin views

## Monorepo structure

```
apps/web/          Next.js frontend
services/api/src/  Lambda handlers (one per function)
  shared/          Shared utilities (db-neon, db-dynamo, db-messages, response)
packages/          Shared types (@lux/types)
scripts/           deploy-lambda.ps1
infrastructure/    CDK (not actively used for deploys)
```
