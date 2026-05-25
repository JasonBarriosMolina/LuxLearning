# Lux Learning — Contexto Técnico y Reglas de Negocio

> **Última actualización:** 2026-05-24 — Sprint 1-3 + Fix YouTube + Chat + Actividad + Perfil Estudiante  
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
- **Recordatorios de tareas:** escanea `ScheduledTasks` con status PENDING/SUBMITTED; si `daysLeft === 5` o `daysLeft === 3` envía email SES al estudiante. Deduplicado con flags `r5`/`r3` en el item.

### Tareas — Estados
```
PENDING → SUBMITTED (estudiante presenta) → COMPLETED (evaluador marca)
PENDING → OVERDUE (automático cuando dueDate < hoy)
SUBMITTED (dentro de plazo) → PENDING (deshacer presentación)
```
- `POST /tasks/:taskId/submit` → SUBMITTED + notificación in-app al evaluador
- `POST /tasks/:taskId/undo` → PENDING (solo si no está OVERDUE)
- Al presentar: `createNotification()` al evaluador asignado o al primero del grupo EVALUATOR

### Chat — Flujos
- `chatId` determinista: DIRECT = `direct_{[userA,userB].sort().join('_')}`, GROUP = `group_{courseId}`
- Contactos para STUDENT: compañeros inscritos en los mismos cursos + evaluadores (badge diferenciado)
- GROUP chat se auto-crea al publicar un curso (`upsertChat` en ai-publish)
- Polling frontend 5s para chats y mensajes activos
- Reacciones con emoji: toggle (agrega si no existe, quita si ya existe)

### Quiz — Comportamiento
- Opciones mezcladas con Fisher-Yates en cada intento (frontend guarda mapping `shuffledIdx → originalIdx`)
- Feedback progresivo: intentos 1-2 no muestran respuesta correcta; intento 3+ sí la muestra
- Siempre envía `originalIndex` al backend (no la posición visual)

### Perfil Estudiante
- Foto: URL manual guardada en Cognito `picture` attribute
- Restricción nombre: máximo 1 cambio sin aprobación admin; contador en `localStorage` key `lux-name-change-count`
- Si `count >= 1`: campo deshabilitado con mensaje explicativo

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
| `ScheduledTasks` (`DYNAMO_TABLE_TASKS`) | `userId` | `dueDate#taskId` | `courseId-index` (PK: courseId, SK: dueDate) | Tareas asignadas. Status: PENDING/SUBMITTED/COMPLETED/OVERDUE. Campos: `r5`, `r3` (reminder flags), `submittedAt` |
| `ReportAnalysis` (`DYNAMO_TABLE_REPORT_ANALYSIS`) | `moduleId` | `'ANALYSIS'` (fijo) | — | Análisis IA nocturno: temas clave, resumen, quiz débil |
| `CurriculumRecommendations` (`DYNAMO_TABLE_RECOMMENDATIONS`) | `moduleId` | `'RECS'` (fijo) | — | Recursos sugeridos por IA, editables |
| `LuxChats` (`DYNAMO_TABLE_CHATS`) | `pk` (USER#/CHAT#) | `sk` | — | Membresías (`USER#{userId}` / `chatId`) y metadata de chats (`CHAT#{chatId}` / `META`) |
| `LuxMessages` (`DYNAMO_TABLE_MESSAGES`) | `chatId` | `ts#msgId` | — | Mensajes de chat ordenados cronológicamente. Attrs: `senderId`, `senderName`, `text`, `reactions` |
| `LuxActivity` (`DYNAMO_TABLE_ACTIVITY`) | `userId` | `SESSION#{isoTs}` | — | Sesiones de actividad. Attrs: `startedAt`, `endedAt`, `durationSeconds`. TTL 90 días |

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
| `TasksFn` | `lux-tasks` | 15s / 256MB | HTTP | `GET /tasks`, `GET /tasks/calendar.ics` (público, token en query), `POST /tasks/{id}/complete`, `POST /tasks/{id}/submit`, `POST /tasks/{id}/undo` |
| `MessagesFn` | `lux-messages` | 30s / 256MB | HTTP | `GET /messages/contacts`, `GET/POST /messages/chats`, `GET/POST /messages/{chatId}`, `PUT /messages/{chatId}/read`, `POST /messages/{chatId}/react` |
| `ReportsFn` | `lux-reports` | 60s / 512MB | HTTP | `GET /reports?mode=master\|student\|course&studentId=&courseId=`, `POST /reports/email`, `GET/PUT /reports/recommendations/{moduleId}` |
| `SQSConsumerFn` | `lux-sqsconsumer` | 120s / 512MB | SQS batch 5 | Análisis IA de reflexiones (Bedrock) |
| `RemindersFn` | `lux-reminders` | 300s / 256MB | EventBridge 09:00 UTC | Emails recordatorio a estudiantes inactivos + recordatorios de tareas 5/3 días antes del vencimiento |
| `AnalysisFn` | `lux-analysis` | 300s / 512MB | EventBridge 02:00 UTC | Análisis nocturno de reflexiones + recomendaciones |

**Rutas públicas (sin auth):** `/push/vapid-key`, `/certificates/{certId}`, `/tasks/calendar.ics`

**Variables de entorno adicionales (Lambdas nuevas):**
```
DYNAMO_TABLE_CHATS=LuxChats
DYNAMO_TABLE_MESSAGES=LuxMessages
DYNAMO_TABLE_ACTIVITY=LuxActivity
```

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
- ✅ Lecciones tipo `video` (YouTube embed) y `text` (HTML rico: h3, ul, blockquote, p)
- ✅ **YouTube error fallback**: si el video falla (postMessage código 100/101/150), muestra texto automáticamente con aviso ⚠. Tabs Video/Texto cuando la lección tiene ambos. Requiere `enablejsapi=1` en iframe.
- ✅ Resaltado de texto en 4 colores (amarillo/verde/azul/rosa), persiste en DDB
- ✅ Favoritos de lecciones y módulos, persiste en DDB
- ✅ Transcripción de video (youtube-transcript, caché en DDB)
- ✅ **TTS (Text-to-Speech)** en lecciones de texto — Web Speech API, selector de velocidad (0.75x-2x), voz es-ES, preferencias en localStorage. Componente: `apps/web/components/shared/TextToSpeechButton.tsx`
- ✅ **Tutor IA → "Mentor"**: chatbot por lección (Bedrock), renderiza markdown, panel deslizante
- ✅ Quiz por módulo — **opciones mezcladas** (Fisher-Yates), **feedback progresivo** (sin respuesta correcta en intentos 1-2), múltiples intentos
- ✅ Reflexión con análisis IA previo al envío ("¿Listo para enviar?")
- ✅ Progreso personal con score de calidad del evaluador y feedback expandible
- ✅ Certificados descargables (PDF via print)
- ✅ **Tareas con estados**: PENDING → SUBMITTED (Presentar) → COMPLETED. Botones Presentar/Deshacer/Completar según estado. Notifica evaluador al presentar. Tab "Presentadas" en filtros.
- ✅ Recordatorios automáticos de tareas por SES: 5 y 3 días antes del vencimiento
- ✅ Calendario .ics exportable (RFC 5545)
- ✅ **Calendario visual** `/calendar` — react-big-calendar, colores por tipo de tarea (`task-colors.ts`), filtro por curso
- ✅ **Dashboard acordeón**: cursos colapsables, mensajes motivacionales por % progreso, stats cards clickeables (→ /courses, → /activity)
- ✅ **Mi Actividad** `/activity` — tareas completadas arriba, gráficas recharts, historial de sesiones colapsado por defecto
- ✅ **Mi Perfil** estudiante — foto URL, restricción de cambio de nombre (1 vez, contador localStorage)
- ✅ **Comunicaciones** `/communications` — chat DIRECT y GROUP, polling 5s, contactos filtrados por curso, reacciones emoji, badge no leídos en sidebar, tabs Directos/Grupos
- ✅ Racha de actividad (streak) en dashboard
- ✅ Dark mode (toggle persistente, sin FOUC)
- ✅ **Onboarding tour** — 6 pasos con spotlight, flag server-side en DDB, botón Omitir
- ✅ **Push notifications prompt** al primer login (AppShell, solo STUDENT, si `Notification.permission === 'default'`)
- ✅ Sesiones de actividad tracking (AppShell: start/update/end cada 2min, beforeunload)

### Evaluador
- ✅ Dashboard con workqueue por curso/estudiante, alertas urgentes (>36h)
- ✅ Detalle side-by-side con comentarios frecuentes
- ✅ Botón "Generar feedback con IA" (Bedrock, 5 sugerencias)
- ✅ "Comprobar IA" — detecta si reflexión fue generada con IA
- ✅ Priority flag por reflexión
- ✅ Score de calidad 1-10 al aprobar
- ✅ **Firma digital** — canvas en perfil evaluador, guardada como base64 en DDB (`LessonProgress` sk=`SIGNATURE`). Mostrada en aprobación de reflexiones y certificado.
- ✅ Tareas a estudiantes individuales o cursos completos (tipos: custom, complete_module, submit_reflection, pass_quiz, upload_link, watch_video, read_resource)
- ✅ **Comunicaciones** `/evaluator/communications` — misma UI compartida (`CommunicationsPanel.tsx`)
- ✅ **Reportes:** 5 pilares, filtros master/estudiante/curso, export PDF + email SES
- ✅ **Lista estudiantes** como tabla limpia (nombre+fecha+estado+cursos+acciones)
- ✅ Badge ⚠ en tareas con UUID como título
- ✅ Botón submit deshabilitado durante guardado

### Admin
- ✅ Gestión de cursos, módulos, lecciones, preguntas (solo ADMIN)
- ✅ Creación de cursos con IA — lecciones tipo `text` con HTML rico (h3, ul, blockquote, voz activa 2ª persona)
- ✅ Tags generados por IA persisten en Prisma al publicar (fix A-5)
- ✅ Auto-create GROUP chat al publicar curso
- ✅ Gestión de usuarios: invitar, cambiar rol, activar/desactivar
- ✅ Gestión de inscripciones — al inscribir estudiante se agrega como miembro del GROUP chat del curso

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

## Prisma Schema — Campos relevantes

```prisma
model Lesson {
  type      String   @default("video")  // "video" | "text"
  youtubeId String   @default("")       // vacío para lecciones text
  content   String?                      // HTML rico para lecciones text
}
model Course {
  evaluatorId   String?   // userId del evaluador asignado
  evaluatorName String?
  createdByName String?
}
```
- Al crear lección manual: `youtubeId` es **opcional** — si no se provee, `type` se infiere como `text`
- AI-publish: lecciones con `content` se guardan como `type: 'text'` automáticamente

---

## Componentes Compartidos Clave

| Componente | Ruta | Propósito |
|-----------|------|-----------|
| `AppShell` | `components/shared/AppShell.tsx` | Layout base, heartbeat, session tracking, push prompt |
| `CommunicationsPanel` | `components/shared/CommunicationsPanel.tsx` | Chat DIRECT/GROUP compartido entre estudiante y evaluador |
| `TaskCalendar` | `components/shared/TaskCalendar.tsx` | Vista calendario react-big-calendar, colores por tipo |
| `TextToSpeechButton` | `components/shared/TextToSpeechButton.tsx` | TTS Web Speech API para lecciones de texto |
| `OnboardingWizard` | `components/shared/OnboardingWizard.tsx` | Tour 6 pasos con spotlight, flag DDB |
| `Sidebar` | `components/shared/Sidebar.tsx` | Navegación + UnreadBadge chat + iconos por rol |
| `Topbar` | `components/shared/Topbar.tsx` | Bell notificaciones, dark mode toggle, menú móvil |

---

## Historial de Deploys

| Fecha | Descripción |
|-------|-------------|
| 2026-05-24 | **Fix YouTube**: postMessage error detection, tabs Video/Texto, fallback automático a texto |
| 2026-05-24 | **Sprint 3**: perfil estudiante (foto+nombre), dashboard acordeón motivacional, stats clickeables, Mi Actividad reorden, ícono TrendingUp, contactos chat filtrados por curso, push prompt login |
| 2026-05-24 | **Sprint 2**: tareas SUBMITTED/UNDO, recordatorios 5/3 días, TTS lecciones, HTML rico en prompts IA |
| 2026-05-24 | **Sprint 1**: quiz shuffle + feedback progresivo, chat names fix, Mentor rename + markdown render |
| 2026-05-15 | **Batch 10:** A-1 label invitación, A-3 Mi Perfil sidebar, A-4 tabla estudiantes limpia, A-5 tags IA persisten, A-9 badge UUID, A-10 submit guard, B-4 calendario visual + colores tipo, B-5 actividad extendida |
| 2026-05-07 | Bug fixes: error rate quiz, reports filter guard, dashboard nav router.push |
| 2026-05-07 | Reports: ReportsFn + AnalysisFn Lambdas, 2 tablas DDB, EventBridge nightly, UI 5 pilares, PDF + email SES |
| 2026-05-06 | Tier 0-4: highlights, favoritos, transcripción, chatbot IA, creación curso IA, tareas, dark mode, onboarding, push |
| 2026-04-30 | Phase 1-4: evaluador dashboard, feedback IA, score calidad, priority, push, reportes, recordatorios, streak |

---

## Pendiente (Sprint 4)

| Item | Descripción | Complejidad |
|------|-------------|-------------|
| X-1 | Regenerar curso/módulo/lección con IA | Alta |
| X-2 | Marcar cursos legacy (solo video) | Media |
| M-5 | Importar .ics externo | Media |
| M-7 | Tareas automáticas al crear curso | Media |
| X-3 | Stable Diffusion imágenes (Bedrock) | Muy alta |
| UT | Unit tests BE + integration tests mocks AWS (Vitest, ~2-3 días) | Media |
| E2E | Playwright tests flujos críticos (~1 día adicional) | Media |
