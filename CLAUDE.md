# Lux Learning — Project Guide for Claude

> **Reference docs** (leer solo cuando se necesiten): `docs/reference/`
> - `lambda-env-vars.md` — env vars por Lambda
> - `dynamo-tables.md` — esquema DynamoDB
> - `business-flows.md` — flujos reflection/quiz/enrollment/certificate/async-AI
> - `common-errors.md` — errores frecuentes y fixes

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router) · Vercel · `apps/web` |
| Backend | AWS Lambda (Node 20, arm64) + API Gateway v2 HTTP |
| DB | Prisma + PostgreSQL (Neon serverless) |
| Cache/State | DynamoDB |
| AI | Amazon Bedrock (Claude Haiku `global.anthropic.claude-haiku-4-5-20251001-v1:0`) |
| Auth | Amazon Cognito — groups: STUDENT / EVALUATOR / ADMIN / SUPER_ADMIN |
| Queue | SQS → `lux-sqsconsumer` |
| Storage | S3 `lux-learning-images` |
| Email | SES |
| Push | Web Push (VAPID) |

## Key identifiers

| Key | Value |
|---|---|
| API Gateway ID | `v4vabtmerb` (prod) · `hxnd6tzmce` (test) |
| Region | `us-east-1` |
| Account | `798694628803` |
| Cognito User Pool | `us-east-1_RGVyVRJXx` |
| Cognito Client ID | `63ujfu3mt11s45p9g6m7p0n648` |
| DB Secret ARN | `arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-bp488g` |
| S3 Images Bucket | `lux-learning-images` |
| Authorizer ID | `zsk60q` (prod) |
| lux-admin integration | `6aoajo2` |

## Environments

| Env | Domain | API GW | Branch |
|---|---|---|---|
| prod | luxlearning.academy | v4vabtmerb | master |
| staging | staging.luxlearning.academy | (see project_env_promotion memory) | staging |
| test | test.luxlearning.academy | hxnd6tzmce | test |

**Rule:** All new work starts in test. Staging auto-promotes. Prod needs explicit confirmation.

## Monorepo structure

```
apps/web/                  Next.js frontend
  app/(student)/           Student views
  app/(evaluator)/         Evaluator/admin views
  lib/api.ts               All API calls
services/api/src/
  admin/handler.ts + ctx.ts + {courses,users,reports,ai,profile,files}.ts
  evaluator/handler.ts + ctx.ts + {reflections,courses,tasks,resources,misc}.ts
  shared/db-neon.ts · db-dynamo.ts · response.ts
packages/types/            @lux/types shared types
scripts/deploy-lambda.ps1  Canonical build+deploy script
docs/reference/            Reference docs (env vars, dynamo, flows, errors)
```

## How to deploy

```powershell
.\scripts\deploy-lambda.ps1 lux-admin lux-evaluator   # one or more
.\scripts\deploy-lambda.ps1 all                        # everything
```

**Prisma zip must include:** `index.js` + `node_modules/@prisma/client/` + `node_modules/.prisma/client/` (exclude `query_engine-windows.dll.node`).

`DATABASE_URL` is self-healing — `db-neon.ts` fetches from Secrets Manager if missing.

## CRITICAL rules

### NEVER — wipes all env vars
```bash
aws lambda update-function-configuration --environment Variables={KEY=val}
```

### Always merge env vars (PowerShell)
```powershell
$vars = (aws lambda get-function-configuration --function-name lux-X --query "Environment.Variables" --output json) -join ""
$d = $vars | ConvertFrom-Json; $h = @{}
$d.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }
$h['NEW_VAR'] = 'value'
$body = @{ Variables = $h } | ConvertTo-Json -Compress
$noBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText("$env:TEMP\env-patch.json", $body, $noBom)
aws lambda update-function-configuration --function-name lux-X --environment "file://$env:TEMP\env-patch.json"
```

## Module architecture (lux-admin and lux-evaluator)

- `handler.ts` — entry point only: parse body, build ctx, chain domain handlers with `??`
- `ctx.ts` — shared AWS clients, constants, types
- Domain modules — each exports ONE `handleX(ctx)` that returns `Promise<any | null>`; `null` = not handled

```typescript
// AdminCtx: { event, method, path, prisma, body, action, userId }
// EvalCtx:  { event, method, path, prisma, body, userId, isAdminRole }

export async function handleX(ctx): Promise<any | null> {
  // handle routes; return ok(...) / badRequest(...)
  return null; // required — tells router to try next domain
}
```

**File size limits:**
| Type | Limit |
|---|---|
| `handler.ts` | ≤ 80 lines (router only) |
| Domain module | ≤ 600 lines |
| `ctx.ts` / helpers | ≤ 400 lines |
| `page.tsx` | ≤ 500 lines |
| Page component | ≤ 400 lines |
| Translation file | ≤ 500 lines |

When over limit: create sibling domain file (e.g. `courses-content.ts`), delegate with `return handleX(ctx)`. For FE: extract to `_components/ComponentName.tsx`.

## API Gateway — adding new routes

**Every new route needs both steps or frontend gets `Failed to fetch`:**

```powershell
# 1. Create route
aws apigatewayv2 create-route --api-id v4vabtmerb --route-key "POST /admin/example/{id}" `
  --authorization-type CUSTOM --authorizer-id zsk60q --target "integrations/6aoajo2"

# 2. Add invoke permission
aws lambda add-permission --function-name lux-admin --statement-id ApiGw-POST-example-id `
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com `
  --source-arn "arn:aws:execute-api:us-east-1:798694628803:v4vabtmerb/*/POST/admin/example/*"
```

For other Lambdas: `aws apigatewayv2 get-integrations --api-id v4vabtmerb` to find integration ID.

## React — common mistakes

Always import every hook used:
```tsx
// Wrong — crashes at runtime
import { useEffect, useState } from 'react';
const myRef = useRef(null); // ReferenceError

// Correct
import { useEffect, useState, useRef } from 'react';
```

Common forgotten: `useRef`, `useCallback`, `useMemo`, `useReducer`, `useContext`, `useId`.

## CORS

Two layers: API Gateway + `shared/response.ts` `ALLOWED_ORIGINS[]`. Add new Vercel URLs in both.

## Image generation

Use Stability AI (`stability.stable-image-core-v1:1`, us-west-2). NOT Nova Canvas.
