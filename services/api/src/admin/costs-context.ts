// Static project knowledge handed to the platform assistant (costs-chat.ts). Hand-condensed from
// CLAUDE.md / docs/reference so the Lambda needs no repo files. Update when architecture or cost drivers change.
export const PROJECT_CONTEXT = `
# Lux Learning — contexto de plataforma

## Estructura del repositorio (monorepo)
- apps/web: frontend Next.js 14 (App Router). Vistas de estudiante en app/(student), de evaluador/admin en app/(evaluator). Todas las llamadas al API en lib/api.ts.
- services/api/src: código de las Lambdas. admin/ (handler.ts router + ctx.ts + módulos por dominio: courses, users, reports, ai, profile, files, groups, interviews, classes, carousel, scheduler, rooms, costs), evaluator/, shared/ (db-neon.ts Prisma, db-dynamo.ts, response.ts con CORS, env-context.ts, media-budget.ts, bedrock-usage.ts).
- packages/types: tipos compartidos (@lux/types). scripts/deploy-lambda.ps1: build + deploy canónico (-DeployEnv test|staging|prod; sin flag despliega a prod). docs/reference: variables de entorno, esquema DynamoDB, flujos de negocio, errores comunes.
- Patrón de Lambdas admin/evaluator: handler.ts solo enruta; cada módulo de dominio exporta handleX(ctx) que devuelve null si no maneja la ruta. Rutas nuevas requieren crear la ruta en API Gateway Y el permiso lambda:InvokeFunction (si no, el frontend ve "Failed to fetch").
- CORS en dos capas: API Gateway + ALLOWED_ORIGINS en shared/response.ts.
- Trabajo largo con IA = job asíncrono (self-invoke con _action, estado en DynamoDB, polling a /admin/courses/ai-job).

## Funcionalidades de la plataforma
Cursos con módulos, lecciones, quizzes y reflexiones; generación de cursos con IA (Lux Planner); Lux Carrousel (lecciones narradas con imágenes y audio); mentor socrático por lección; inscripciones, progreso, certificados; grupos base; calendario y asistencia (OCR con Bedrock, riesgo de deserción); scheduler de clases y aulas; plan de estudio semanal; entrevistas por voz (Vapi); i18n ES/EN con traducción por Bedrock; notificaciones push y email (SES); gamificación.

## Stack
- Frontend Next.js 14 en Vercel (no aparece en la factura AWS).
- Backend: AWS Lambda (Node 20, arm64) detrás de API Gateway v2 HTTP. Lambdas por dominio: lux-admin, lux-evaluator, lux-courses, lux-lessons, lux-quiz, lux-reflection, lux-reports, lux-certs, lux-notifs, lux-push, lux-attendance, lux-study-plans, lux-tasks, lux-messages, lux-sqsconsumer, lux-authorizer. Cada una existe en 3 ambientes (sufijo -test / -staging; prod sin sufijo).
- DB relacional: Prisma + PostgreSQL en Neon (serverless, branches por ambiente; se factura aparte de AWS).
- Estado/cache: DynamoDB (tablas por ambiente con sufijo -Test / -Staging; prod sin sufijo).
- IA: Amazon Bedrock. Texto: Claude Haiku 4.5 (global.anthropic.claude-haiku-4-5-20251001-v1:0). Imágenes: Stability AI Image Core (us-west-2). Audio: Amazon Polly (neural). Este chat usa Sonnet.
- Auth: Cognito (grupos STUDENT / EVALUATOR / ADMIN / SUPER_ADMIN). Cola: SQS. Storage: S3 lux-learning-images. Email: SES. Push: Web Push (VAPID).
- Voz/entrevistas: Vapi (externo, no sale en la factura AWS).

## Ambientes
- prod (luxlearning.academy, API v4vabtmerb), staging (staging.luxlearning.academy), test (test.luxlearning.academy, API hxnd6tzmce). Una sola cuenta AWS (798694628803) y un solo user pool de Cognito.
- Cost Explorer es de TODA la cuenta, y la cuenta también aloja proyectos ajenos a Lux (trading, inventario, etc.). No hay tags de costo por ambiente.

## Cómo se separan los costos por ambiente en el dashboard (estimado)
- test y staging: contadores propios en la tabla LuxMediaUsage-<Env> (tokens de Bedrock por Lambda/modelo, imágenes y caracteres de Polly), valorados a precio de lista.
- prod: factura AWS de IA/media menos lo atribuido a test y staging, SOLO desde que existen los contadores (activados el 2026-10-05). El gasto de IA/media anterior no se puede asignar a ningún ambiente y se reporta como "sin atribuir"; no asumas que es de prod.
- Lambda y API Gateway: la factura real de cada servicio se reparte por uso medido en CloudWatch (GB-segundo e invocaciones; requests por API). Hoy esa factura es ~$0 por free tier.
- Los recursos (Lambdas, tablas DynamoDB) llevan el tag lux-env (test|staging|prod). Cuando ese tag se active como tag de costo en Billing, el campo "tag" de get_costs traerá el costo real por ambiente (solo desde la activación). Mientras available=false no hay costo real por ambiente.
- EC2, Security Hub, VPC, Secrets Manager, KMS, S3, DynamoDB, CloudWatch, etc. quedan sin repartir. La cuenta incluye recursos ajenos a Lux; Neon, Vercel y Vapi no están en la factura AWS.

## Principales generadores de costo conocidos
- Generación de cursos (Lux Planner): ráfagas de ~270 imágenes/hora y un audio Polly por lección; en Sep-2026 imágenes + Polly fueron ~70% de la factura.
- Lux Carrousel: imágenes Stability por diapositiva + narración Polly.
- Haiku: generación de cursos/módulos/lecciones/quizzes, mentor socrático, traducción i18n, OCR de asistencia, consultas semánticas de imágenes y YouTube.
- Precios de lista usados: Haiku 4.5 $1/$5 por M tokens in/out; imagen Stability $0.04 c/u; Polly neural $16 por M caracteres; Sonnet (supuesto) $3/$15 por M tokens.

## Controles de costo existentes
- media-budget (services/api/src/shared/media-budget.ts): en test MEDIA_MODE='stub' (imágenes/audio fixture, costo 0); en staging modo real con caps mensuales (300 imágenes, 750k chars Polly); prod nunca se limita.
- bedrock-usage (shared/bedrock-usage.ts): middleware que cuenta tokens por Lambda/modelo, solo test y staging.
- Polly: free tier 1M chars neural/mes (primeros 12 meses, cuenta completa).

## Reglas operativas
- Todo cambio empieza en test; staging se promueve desde test; prod solo con orden explícita.
- API Gateway corta a los 29 s: todo lo que usa Bedrock va por job asíncrono con polling.
`.trim();
