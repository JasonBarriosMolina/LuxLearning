# Lux Learning — Contexto Técnico y Reglas de Negocio

> **Última actualización:** 2026-05-15 — Batch 10 completo (A-1, A-3, A-4, A-5, A-9, A-10, B-4, B-5)  
> **Actualizar este archivo en cada deploy significativo.**

---

## Stack Técnico

| Capa | Tecnología | Detalle |
|------|-----------|---------|
| Frontend | Next.js 15.5 App Router, TypeScript, Tailwind CSS | Monorepo en `apps/web` |
| Hosting Frontend | Vercel — auto-deploy desde `master` push | URL: https://lux-learning-tau.vercel.app |
| Backend | AWS Lambda ARM64 (Graviton2) Node 20 + API Gateway HTTP v2 | us-east-1 |
| Contenido | Prisma ORM + PostgreSQL Neon (pooled + unpooled) | Secreto en Secrets Manager: `lux/neon-db` |
| DynamoDB | 10 tablas dedicadas (no single-table) | PAY_PER_REQUEST, RETAIN |
| Auth | Cognito User Pool `us-east-1_RGVyVRJXx` | Client: `63ujfu3mt11s45p9g6m7p0n648` |
| Email | AWS SES — `noreply@luxlearning.com` | Sender verificado |
| AI | AWS Bedrock — Claude Haiku 4.5 via Global Inference Profile | Ver sección Bedrock |
| Queue | AWS SQS `lux-reflection-queue` + DLQ | Análisis asíncrono post-submit |
| Push | Web Push VAPID (PWA) | Keys en Secrets Manager: `lux/vapid` |
| IaC | AWS CDK TypeScript | `infrastructure/cdk` |
| Monorepo | Turborepo | `apps/web`, `services/api`, `packages/types`, `infrastructure/cdk` |

---

## Bedrock — Configuración Crítica

```
Model ID:  global.anthropic.claude-haiku-4-5-20251001-v1:0
```

**No usar** el foundation model ID directamente — Haiku 4.5 requiere inference profile.

IAM policy correcta para global inference profiles:
```
arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0
arn:aws:bedrock:us-east-1:{account}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0
```
La región del foundation-model ARN debe ser `*` (wildcard) — los global profiles validan contra ARN sin región.

---

## Sistema de Roles

| Rol | Cognito Group | Acceso |
|-----|--------------|--------|
| `STUDENT` | `STUDENT` (precedence 10) | Cursos, progreso, tareas, perfil |
| `EVALUATOR` | `EVALUATOR` (precedence 5) | Dashboard evaluador, reflexiones, estudiantes, reportes |
| `ADMIN` | `ADMIN` (precedence 1, creado manualmente) | Todo lo anterior + gestión de contenido + gestión de usuarios |

**Implementación:** El `authorizer.ts` lee el primer grupo Cognito por precedencia → `role` en el contexto JWT.  
**Enforce en backend:** `auth?.role !== 'EVALUATOR' && auth?.role !== 'ADMIN'` para rutas de evaluación. `auth?.role !== 'ADMIN'` para mutaciones de contenido/usuarios.  
**Sidebar en frontend:** `EVALUATOR` ve Reportes (no Gestión de Contenido). `ADMIN` ve todo.

---

## Reglas de Negocio

### Flujo del Estudiante
1. Enrolado a un curso → accede a **Módulo 1** sin restricción
2. Módulo N se desbloquea cuando el Módulo N-1 tiene reflexión con `status = APPROVED`
3. Dentro de un módulo: completa lecciones → pasa quiz → envía reflexión
4. Quiz: debe obtener `score >= passingScore` (configurado en Prisma por módulo) para poder enviar reflexión
5. Reflexión enviada → status `PENDING_EVAL` → SQS → IA analiza (async) → `aiResult` guardado en DDB

### Flujo de Evaluación
1. Evaluador ve reflexiones `PENDING_EVAL` en su dashboard
2. Revisa texto + resultado IA → ingresa feedback (obligatorio) → Aprobar o Rechazar
3. **Al aprobar:**
   - Status → `APPROVED`, `reviewedAt` guardado
   - Si todos los módulos del curso aprobados → genera certificado automáticamente
   - Email al estudiante (SES) con feedback + link al certificado si aplica
   - Push notification al estudiante
4. **Al rechazar:**
   - Status → `REJECTED`, estudiante puede reescribir desde cero
   - Email al estudiante con comentario del evaluador

### Desbloqueo de Módulos
```typescript
// isModuleUnlocked() en db-dynamo.ts
if (moduleOrder === 1) return true;
const prevModule = allModules.find((m) => m.order === moduleOrder - 1);
const reflection = await getReflection(userId, prevModule.id);
return reflection?.status === 'APPROVED';
```

### Certificados
- Auto-generado en `POST /evaluator/reflections/review` cuando todos los módulos del curso están APPROVED
- `certId` generado con `cuid2` (no predecible)
- Página pública `/certificado/[certId]` — sin auth, solo muestra nombre, curso, fecha
- Endpoint `POST /my-certificates/generate` es idempotente (idempotency check en DB)

### Score de Calidad
- Evaluador puede asignar score 1-10 al aprobar una reflexión
- Guardado como `qualityScore` en DDB Reflections
- Visible en Mi Progreso del estudiante con ⭐

### Reportes — Score Integral
```
integratedScore = reflectionApprovalRate * 0.6 + avgQuizScore * 0.4
```
- `reflectionApprovalRate` = aprobadas / total × 100
- `avgQuizScore` = promedio de scores de intentos aprobados (no fallidos)
- Estudiante "activo" = actividad en últimos 7 días
- Estudiante "en riesgo" = sin actividad en últimos 7 días

### Análisis Nocturno (AnalysisFn — 02:00 UTC)
- Mínimo 3 reflexiones APPROVED por módulo para correr análisis IA
- Temas débiles de quiz: `errorRate > 30%` (solo si total de intentos > 0)
- Error rate correcto: `a.answers.length > i && a.answers[i] !== q.correctIndex`
- Guarda en `ReportAnalysis` (temas + resumen) y `CurriculumRecommendations` (recursos)
- 300ms delay entre módulos para evitar rate limiting de Bedrock

### Recordatorios (RemindersFn — 09:00 UTC)
- Envía email a estudiantes inactivos >7 días
- Solo envía si el estudiante tiene email en Cognito

---

## DynamoDB — Tablas y Estructura de Keys

| Tabla (env var) | PK | SK | GSI | Contenido |
|-----------------|----|----|-----|-----------|
| `LessonProgress` (`DYNAMO_TABLE_PROGRESS`) | `userId` | `courseId#moduleId#lessonId` | — | Progreso de lecciones, highlights (`HL#lessonId`), favoritos (`FAV#type#id`), transcripciones (`_transcript` / lessonId) |
| `QuizAttempts` (`DYNAMO_TABLE_QUIZ`) | `userId` | `moduleId#0001` (padded) | `moduleId-index` (PK: moduleId, SK: submittedAt) | Intentos de quiz con `answers[]`, `score`, `passed` |
| `Reflections` (`DYNAMO_TABLE_REFLECTIONS`) | `userId` | `moduleId` | `status-index` (PK: status, SK: submittedAt) | Reflexiones con `text`, `status`, `aiResult`, `evaluatorFeedback`, `qualityScore`, `priority` |
| `Notifications` (`DYNAMO_TABLE_NOTIFS`) | `userId` | `notifId` | — | Notificaciones in-app, TTL automático |
| `Enrollments` (`DYNAMO_TABLE_ENROLLMENTS`) | `userId` | `COURSE#courseId` | — | Inscripciones a cursos |
| `Certificates` (`DYNAMO_TABLE_CERTIFICATES`) | `certId` | — | `userId-courseId-index` | Certificados generados |
| `PushSubscriptions` (`DYNAMO_TABLE_PUSH_SUBS`) | `userId` | `sha256(endpoint)` | — | Suscripciones Web Push por dispositivo |
| `ScheduledTasks` (`DYNAMO_TABLE_TASKS`) | `userId` | `dueDate#taskId` | `courseId-index` (PK: courseId, SK: dueDate) | Tareas asignadas por evaluador |
| `ReportAnalysis` (`DYNAMO_TABLE_REPORT_ANALYSIS`) | `moduleId` | `'ANALYSIS'` (fijo) | — | Análisis IA nocturno: temas clave, resumen, quiz débil |
| `CurriculumRecommendations` (`DYNAMO_TABLE_RECOMMENDATIONS`) | `moduleId` | `'RECS'` (fijo) | — | Recursos sugeridos por IA, editables |

---

## Lambdas — Inventario Completo

| Función AWS | Lambda name | Timeout / Mem | Trigger | Endpoints |
|-------------|------------|--------------|---------|-----------|
| `AuthorizerFn` | `lux-authorizer` | 5s / 128MB | API GW Authorizer | — (valida JWT Cognito) |
| `CoursesFn` | `lux-courses` | 30s / 512MB | HTTP | `GET /courses`, `GET /courses/{courseId}` |
| `LessonsFn` | `lux-lessons` | 60s / 256MB | HTTP | `GET/POST /lessons/progress`, `/lessons/complete`, `/lessons/highlights`, `/lessons/favorites`, `/lessons/favorites/toggle`, `/lessons/transcript`, `/lessons/chat` |
| `QuizFn` | `lux-quiz` | 30s / 512MB | HTTP | `POST /quiz/{moduleId}/submit`, `GET /quiz/{moduleId}/attempts` |
| `ReflectionFn` | `lux-reflection` | 30s / 512MB | HTTP | `POST /reflection`, `GET /reflection/{moduleId}`, `POST /reflection/ai-preview` |
| `EvaluatorFn` | `lux-evaluator` | 60s / 512MB | HTTP | `GET /evaluator/reflections`, `POST /evaluator/reflections/review`, `GET /evaluator/students`, `POST /evaluator/ai-feedback`, `GET /evaluator/quiz-audit`, `POST /evaluator/reflections/priority`, `POST /evaluator/ai-check`, `GET/POST/PUT/DELETE /evaluator/tasks` |
| `AdminFn` | `lux-admin` | 30s / 512MB | HTTP | `GET/POST/PUT/DELETE /admin/courses`, `/admin/modules`, `/admin/lessons`, `/admin/questions`, `/admin/users`, `/admin/users/{u}/enrollments`, `/admin/users/{u}/role`, `/admin/users/{u}/status` |
| `NotifsFn` | `lux-notifs` | 30s / 256MB | HTTP | `GET /notifications`, `POST /notifications/read` |
| `CertsFn` | `lux-certs` | 30s / 256MB | HTTP | `GET /certificates/{certId}` (público), `GET /my-certificates`, `POST /my-certificates/generate` |
| `PushFn` | `lux-push` | 30s / 256MB | HTTP | `GET /push/vapid-key` (público), `POST /push/subscribe`, `DELETE /push/subscribe` |
| `TasksFn` | `lux-tasks` | 15s / 256MB | HTTP | `GET /tasks`, `GET /tasks/calendar.ics` (público, token en query), `POST /tasks/{id}/complete` |
| `ReportsFn` | `lux-reports` | 60s / 512MB | HTTP | `GET /reports?mode=master\|student\|course&studentId=&courseId=`, `POST /reports/email`, `GET/PUT /reports/recommendations/{moduleId}` |
| `SQSConsumerFn` | `lux-sqsconsumer` | 120s / 512MB | SQS batch 5 | Análisis IA de reflexiones (Bedrock) |
| `RemindersFn` | `lux-reminders` | 300s / 256MB | EventBridge 09:00 UTC | Emails recordatorio a estudiantes inactivos |
| `AnalysisFn` | `lux-analysis` | 300s / 512MB | EventBridge 02:00 UTC | Análisis nocturno de reflexiones + recomendaciones |

**Rutas públicas (sin auth):** `/push/vapid-key`, `/certificates/{certId}`, `/tasks/calendar.ics`

---

## Autenticación — Flujo Técnico

1. Frontend obtiene `idToken` de Cognito via `getIdToken()` en `lib/auth.ts`
2. Cada request incluye `Authorization: Bearer {idToken}`
3. API Gateway invoca `AuthorizerFn` → `jose.jwtVerify()` contra JWKS Cognito
4. Authorizer extrae `cognito:groups`, determina `role` (mayor precedencia gana: ADMIN > EVALUATOR > STUDENT), retorna `{ userId, email, role }` como contexto
5. Handler accede via `event.requestContext.authorizer?.lambda`

---

## Shape de Respuestas API

Todos los `ok()` retornan:
```json
{ "data": <payload>, "message": null }
```

Patrón en frontend para acceder datos:
```typescript
const d = res?.data ?? res;
```

Errores: `{ "error": "mensaje", "statusCode": 400|403|404|500 }`

---

## Features Implementadas — Estado Actual

### Core (Estudiante)
- ✅ Cursos con módulos secuenciales bloqueados
- ✅ Lecciones con video YouTube embed, puntos clave
- ✅ Resaltado de texto en 4 colores (amarillo/verde/azul/rosa), persiste en DDB
- ✅ Favoritos de lecciones y módulos, persiste en DDB
- ✅ Transcripción de video (youtube-transcript, caché en DDB)
- ✅ Chatbot IA por lección (Bedrock, historial de conversación, contexto de la lección)
- ✅ Quiz por módulo con intentos múltiples y auditoría
- ✅ Reflexión con análisis IA previo al envío ("¿Listo para enviar?")
- ✅ Progreso personal con score de calidad del evaluador y feedback expandible
- ✅ Certificados descargables (PDF via print)
- ✅ Sistema de tareas asignadas con calendario .ics exportable
- ✅ Racha de actividad (streak) en dashboard
- ✅ Dark mode (toggle persistente, sin FOUC)
- ✅ Onboarding tour (4 pasos, localStorage guard)
- ✅ Push notifications (Web Push PWA)
- ✅ **Calendario visual** `/calendar` — react-big-calendar, colores por tipo de tarea, filtro por curso
- ✅ **Mi Actividad** `/activity` — sesiones, quiz scores (ScatterChart), tareas completadas (recharts)
- ✅ **Mi Perfil** en sidebar del estudiante

### Evaluador
- ✅ Dashboard con workqueue por curso/estudiante, alertas urgentes (>36h)
- ✅ Detalle side-by-side con comentarios frecuentes
- ✅ Botón "Generar feedback con IA" (Bedrock, 5 sugerencias)
- ✅ "Comprobar IA" — detecta si reflexión fue generada con IA
- ✅ Priority flag por reflexión
- ✅ Score de calidad 1-10 al aprobar
- ✅ Tareas a estudiantes individuales o cursos completos
- ✅ **Reportes:** 5 pilares (KPIs, progreso integral, análisis cualitativo IA, mapa de calor quiz, recomendaciones editables), filtros master/estudiante/curso, export PDF + email SES
- ✅ **Lista estudiantes** como tabla limpia (nombre+fecha registro+estado+cursos+acciones, sin PresenceBadge)
- ✅ Badge ⚠ en tareas con UUID como título
- ✅ Botón submit deshabilitado durante guardado (previene doble envío)

### Admin
- ✅ Gestión de cursos, módulos, lecciones, preguntas (solo ADMIN)
- ✅ Creación de cursos con IA (topic o URL → estructura 7-10 módulos → preview → publicar)
- ✅ **Tags generados por IA persisten en Prisma** al publicar curso (fix A-5)
- ✅ Label correcto en invitación: "obligatorio para Estudiantes — sin cursos asignados no verá contenido"
- ✅ Gestión de usuarios: invitar, cambiar rol, activar/desactivar
- ✅ Gestión de inscripciones por usuario

---

## Prisma Schema (PostgreSQL Neon)

Modelos principales: `Course`, `Module` (con `order`, `passingScore`), `Lesson` (con `youtubeId`, `points[]`, `duration`), `Question` (con `options[]`, `correctIndex`).

Conexión: pooled URL para Lambdas con conexiones concurrentes.  
Engine binary: `libquery_engine-linux-arm64-openssl-3.0.x.so.node` copiado por CDK `afterBundling` hook.

---

## Variables de Entorno

### Frontend (`.env.local` / Vercel)
```
NEXT_PUBLIC_API_URL=https://v4vabtmerb.execute-api.us-east-1.amazonaws.com
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_RGVyVRJXx
NEXT_PUBLIC_COGNITO_CLIENT_ID=63ujfu3mt11s45p9g6m7p0n648
```

### Lambdas (CDK `commonEnv` → todos los Fns)
```
COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID
DYNAMO_TABLE_PROGRESS=LessonProgress
DYNAMO_TABLE_QUIZ=QuizAttempts
DYNAMO_TABLE_REFLECTIONS=Reflections
DYNAMO_TABLE_NOTIFS=Notifications
DYNAMO_TABLE_ENROLLMENTS=Enrollments
DYNAMO_TABLE_CERTIFICATES=Certificates
DYNAMO_TABLE_PUSH_SUBS=PushSubscriptions
DYNAMO_TABLE_TASKS=ScheduledTasks
DYNAMO_TABLE_REPORT_ANALYSIS=ReportAnalysis
DYNAMO_TABLE_RECOMMENDATIONS=CurriculumRecommendations
SES_FROM_EMAIL=noreply@luxlearning.com
BEDROCK_REGION=us-east-1
FRONTEND_URL=https://lux-learning.vercel.app
SQS_REFLECTION_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/798694628803/lux-reflection-queue
DATABASE_URL={{resolve:secretsmanager:lux/neon-db:SecretString:DATABASE_URL}}
VAPID_PUBLIC_KEY={{resolve:secretsmanager:lux/vapid:SecretString:VAPID_PUBLIC_KEY}}
VAPID_PRIVATE_KEY={{resolve:secretsmanager:lux/vapid:SecretString:VAPID_PRIVATE_KEY}}
VAPID_EMAIL=mailto:admin@luxlearning.com
```

---

## Colores de Tipos de Tarea (`apps/web/lib/constants/task-colors.ts`)

```typescript
custom: '#6366F1'          // Tarea libre
complete_module: '#3B82F6' // Completar módulo
submit_reflection: '#8B5CF6' // Enviar reflexión
pass_quiz: '#F59E0B'       // Aprobar quiz
upload_link: '#10B981'     // Subir enlace
watch_video: '#EC4899'     // Ver video
read_resource: '#14B8A6'   // Leer recurso
```

Usado en `TaskCalendar.tsx` y `activity/page.tsx`.

---

## Deploy

### Backend (CDK)
```bash
cd infrastructure/cdk
npx cdk deploy LuxLearningStack --require-approval never
```

### Frontend (Vercel — auto desde git push)
```
URL producción: https://lux-learning-tau.vercel.app
Repositorio: https://github.com/JasonBarriosMolina/LuxLearning
Branch: master
Root directory: apps/web
```

### Build local
```bash
cd apps/web && npx next build
```

---

## Historial de Deploys

| Fecha | Descripción |
|-------|-------------|
| 2026-05-15 | **Batch 10:** A-1 label invitación, A-3 Mi Perfil sidebar, A-4 tabla estudiantes limpia, A-5 tags IA persisten, A-9 badge UUID, A-10 submit guard, B-4 calendario visual + colores tipo, B-5 actividad extendida (quiz scores + sesiones + tareas) |
| 2026-05-07 | Bug fixes: error rate quiz, reports filter guard, dashboard nav router.push |
| 2026-05-07 | Reports feature: ReportsFn + AnalysisFn Lambdas, 2 nuevas tablas DDB, EventBridge nightly, UI 5 pilares, filtros, PDF + email SES |
| 2026-05-07 | Mejora prompt ai-preview reflexión (evaluador pedagógico especializado), model ID → global.* en todos los handlers, IAM bedrock fix (`arn:aws:bedrock:*::`) |
| 2026-05-07 | Role enforcement: EVALUATOR pierde gestión de contenido, gana /reports; Sidebar actualizado |
| 2026-05-06 | Tier 0-4: highlights, favoritos, transcripción, chatbot IA lección, creación curso con IA, tareas + calendario .ics, dark mode, onboarding tour, push al estudiante |
| 2026-04-30 | Phase 1-4: evaluador dashboard, feedback IA, score calidad, priority flag, notificaciones push, reportes básicos admin, recordatorios email, streak |
