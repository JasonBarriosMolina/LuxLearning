# Common Errors & Fixes Reference

| Error | Cause | Fix |
|---|---|---|
| `Cannot find module '@prisma/client'` | zip missing `node_modules/@prisma/client/` | Use `deploy-lambda.ps1` |
| `Cannot find module '.prisma/client/default'` | zip missing generated files | Use `deploy-lambda.ps1` |
| `Internal server error` on Prisma lambda | `DATABASE_URL` missing | Code auto-fetches from SM; check SM secret access |
| `403 No eres participante de este chat` | No membership record in `LuxChats` | Auto-join handles `group_*`; for DIRECT chats use `POST /messages/chats` |
| `Runtime.ImportModuleError` on cold start | Wrong zip structure | Use `deploy-lambda.ps1` |
| Reflection 403 "pass quiz first" | Student hasn't passed quiz | Expected behavior |
| Push notification silent | VAPID keys not set | Check `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars |
| `Application error: client-side exception` | React hook used but not imported | Add missing hook to `import { ... } from 'react'` |
| `Failed to fetch` on new API call | Route not registered in API Gateway | Add route + Lambda invoke permission |
| `Requested resource not found` in Lambda | DynamoDB table name mismatch or missing env var | Check DYNAMO_TABLE_* env vars match actual table names |
| Prisma Schema Validation Error | Schema out of sync with handler | Check field names against Prisma schema |
