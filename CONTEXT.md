# Lux Learning — Context & Estado del Sistema

> **Última actualización:** 2026-05-06 (Tier 0 fixes)  
> **Actualizar este archivo en cada deploy a git.**

---

## Stack Técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 15.5 App Router, TypeScript, Tailwind CSS |
| Hosting Frontend | Vercel (auto-deploy desde `main`) |
| Backend | AWS Lambda (ARM64 Graviton2) + API Gateway HTTP |
| Base de datos | DynamoDB (single-table + tablas dedicadas) |
| ORM / Datos de contenido | Prisma + PostgreSQL (Railway) |
| Auth | AWS Cognito User Pool |
| Email | AWS SES (sesiones verificadas) |
| AI | AWS Bedrock (Claude 3 Haiku) — detección IA en reflexiones |
| Queue | AWS SQS (análisis asíncrono de reflexiones) |
| IaC | AWS CDK (TypeScript) |
| Monorepo | Turborepo — `apps/web`, `services/api`, `packages/types`, `infrastructure/cdk` |

---

## Arquitectura de Rutas (Frontend)

```
app/
  (auth)/           → login, register
  (student)/        → dashboard, courses, progress, profile
  (evaluator)/      → evaluator/dashboard, evaluator/reflections, evaluator/students
  (admin)/          → admin/courses, admin/users
  certificado/[certId]/  → página pública de verificación de certificados
```

---

## Roles de Usuario

| Rol | Descripción | Menú principal |
|-----|-------------|----------------|
| `STUDENT` | Estudiante que toma cursos | Dashboard, Mis Cursos, Mi Progreso, Perfil |
| `EVALUATOR` | Evaluador de reflexiones | Dashboard, Evaluaciones, Estudiantes, Gestión de Contenido, Perfil |
| `ADMIN` | Super Admin | Todo lo anterior + Usuarios |

---

## Features Implementadas

### Autenticación
- Cognito User Pool con email + contraseña temporal
- Invitación por email al crear usuario (SES) con cursos asignados
- Roles via Cognito custom attributes (`custom:role`)

### Cursos y Módulos (Estudiante)
- Lista de cursos enriquecida con progreso personal
- Módulos con bloqueo secuencial (unlock por reflexión aprobada)
- Progreso de lecciones (completar al navegar)
- Quiz por módulo (debe pasar para enviar reflexión)

### Reflexiones
- Envío de reflexión en texto libre
- Análisis automático IA (Bedrock via SQS) — detecta texto generado por IA
- Evaluador revisa con feedback obligatorio
- Al aprobar: desbloquea siguiente módulo + envía email al estudiante
- Al rechazar: estudiante puede reescribir

### Certificados
- Auto-generación cuando todos los módulos del curso tienen reflexión `APPROVED`
- ID único con `cuid` (no predecible)
- Página pública `/certificado/[certId]` — sin auth, solo muestra datos no sensibles
- Botón "Descargar certificado" (browser print → PDF, `@media print` A4 landscape)
- Retroactivo: endpoint `POST /my-certificates/generate` idempotente

### Notificaciones por Email (SES)
| Evento | Destinatario | Estado |
|--------|-------------|--------|
| Invitación / creación de cuenta | Estudiante | ✅ Implementado |
| Reflexión aprobada | Estudiante | ✅ Implementado |
| Reflexión rechazada | Estudiante | ✅ Implementado |
| Certificado generado | Estudiante (link incluido en aprobación) | ✅ Implementado |

### Dashboard Evaluador (Phase 1 — 2026-04-30)
- Toggle **Por Curso** / **Por Estudiante**
- Stats cards: Pendientes, Aprobadas, Rechazadas, Estudiantes activos
- **Alertas urgentes**: reflexiones con >36h sin revisar (banner rojo)
- **Tabla de trabajo**: Estudiante, Módulo/Curso, Enviado, Tiempo restante (48h deadline), 3-dot action menu
- **Vista por Estudiante**: progress bars por módulo, badge de pendientes
- **Gráfico de barras** de estado (CSS puro, sin librería)
- **Comentarios frecuentes**: localStorage, editable, copy-to-clipboard

### Evaluaciones (Lista)
- Tabla con columnas: Estudiante, Módulo/Curso, Enviado, Tiempo restante, Estado
- Toggle de ordenamiento: Por urgencia / Por fecha
- Filtros: Todas / Pendientes / Aprobadas / Rechazadas
- Pendientes como filtro predeterminado

### Evaluación (Detalle — side-by-side)
- Panel izquierdo: texto completo de la reflexión (sticky)
- Panel derecho: form de feedback + acción Aprobar/Rechazar
- **Comentarios frecuentes integrados**: clic inserta en el textarea del feedback
- Análisis IA (compact strip)
- Meta: estudiante, módulo, fecha, palabras

### Duración de Módulos
- `formatCourseDuration(value)` en `apps/web/lib/utils.ts`
- Convierte `"45"` → `"45 min"`, `"90"` → `"1 h 30 min"`, `"60"` → `"1 h"`
- Aplicado en: módulo detail, course page, dashboard, progress page

---

## Estructura DynamoDB

| Tabla | PK | SK | GSI(s) | Uso |
|-------|----|----|--------|-----|
| `lux-progress` | `USER#<userId>` | `LESSON#<lessonId>` | — | Progreso de lecciones |
| `lux-reflections` | `USER#<userId>` | `MODULE#<moduleId>` | `moduleId-index`, `status-index` | Reflexiones y evaluaciones |
| `lux-quiz-results` | `USER#<userId>` | `MODULE#<moduleId>` | — | Resultados de quizzes |
| `lux-enrollments` | `USER#<userId>` | `COURSE#<courseId>` | `courseId-index` | Inscripciones |
| `lux-certificates` | `CERT#<certId>` | `META` | `userId-courseId-index` | Certificados |
| `PushSubscriptions` | `userId` | `sk` (base64 endpoint[:100]) | — | Subscripciones push PWA |

---

## Lambdas y Endpoints

| Lambda | Archivo | Endpoints principales |
|--------|---------|----------------------|
| `coursesFn` | `courses/handler.ts` | `GET /courses`, `GET /courses/{id}`, `GET/POST lessons` |
| `evaluatorFn` | `evaluator/handler.ts` | `GET /evaluator/reflections`, `POST /evaluator/review`, `GET /evaluator/students` |
| `adminFn` | `admin/handler.ts` | `POST /admin/users`, `GET/PUT/DELETE /admin/courses` |
| `certsFn` | `certificates/handler.ts` | `GET /certificates/{certId}` (público), `GET /my-certificates`, `POST /my-certificates/generate` |
| `reflectionsFn` | `reflections/handler.ts` | `POST /reflections`, `GET /reflections/{moduleId}` |
| `pushFn` | `push/handler.ts` | `GET /push/vapid-key` (público), `POST /push/subscribe`, `DELETE /push/subscribe` |
| `aiAnalysisFn` | `ai-analysis/handler.ts` | (SQS trigger — no HTTP) |

---

## Trabajo Pendiente

### Phase 2 — ✅ Completado 2026-04-30
- [x] **AI feedback generator**: botón "Generar con IA" → 5 sugerencias via Bedrock (Claude Haiku), clickeables para insertar en feedback
- [x] **Backend deadline**: campo `deadline` guardado al enviar reflexión (submittedAt + 48h); frontend usa backend cuando disponible
- [x] **Modal de auditoría de quiz**: botón "Ver quiz" → modal con respuestas por intento, colores correcto/incorrecto

### Phase 3 — ✅ Completado 2026-04-30
- [x] Tags/categorías para cursos — campo en Prisma, UI de chips en admin, filtro en estudiante
- [x] Score de calidad (1-10) — slider + botones en aprobación, visible en progreso del estudiante con ⭐
- [x] Priority flag — botón "Urgente" en detalle, ícono 🚩 en lista de evaluaciones
- [x] **Notificaciones push (PWA)** — VAPID keys generadas, service worker custom (`worker/index.ts`), `PushBell` en Topbar, evaluators reciben push al enviar reflexión

### Bugs resueltos
- [x] `/admin/users`: fallback email → username elimina UUIDs vacíos
- [x] Curso sin imagen: banner gradient placeholder
- [x] `GET /evaluator/reflections` solo devolvía PENDING_EVAL → stats del dashboard siempre en 0, filtros Todas/Aprobadas/Rechazadas vacíos, detalle de reflexiones ya revisadas daba "no encontrada". Fix: usar `getAllReflections()` con batch de módulos para evitar N+1 queries

### Phase 4 — ✅ Completado 2026-05-06
- [x] **Recordatorios automáticos por email**: Lambda `reminders/handler.ts` + EventBridge cron diario 9 AM UTC → SES a estudiantes inactivos >7 días
- [x] **Dashboard de progreso mejorado**: Card de racha 🔥 (streak) en dashboard y página de progreso, calculada desde `completedAt` de lecciones
- [x] **Feedback del evaluador visible**: En Mi Progreso, botón 💬 por módulo expande el comentario del evaluador con fecha
- [x] **Reportes para Admin** (`/admin/reports`): tasa de aprobación global, estudiantes en riesgo, barras por estado, tabla por módulo ordenable, exportar CSV
- [x] **Feedback de IA antes de enviar reflexión**: Botón "Analizar con IA" → Bedrock Haiku → evaluación + 3 sugerencias con panel expandible verde/ámbar
- [x] **Push al estudiante**: PushBell para todos los roles; evaluador aprueba/rechaza → push en tiempo real al estudiante (`getPushSubscriptionsByUserId`)
- [x] **Modo oscuro**: Toggle 🌙/☀️ en Topbar, persiste en localStorage, sin flash al cargar (script inline en `<head>`)
- [x] **Onboarding tour**: 4 pasos animados para nuevos estudiantes en primer login, localStorage guard, componente `OnboardingTour`
- [x] **evaluatorFeedback** incluido en respuesta de `GET /courses` para mostrar en Mi Progreso sin N+1

### Nuevos archivos creados
- `services/api/src/reminders/handler.ts` — Lambda recordatorios
- `apps/web/app/(evaluator)/admin/reports/page.tsx` — Reportes admin
- `apps/web/components/ui/ThemeToggle.tsx` — Toggle dark/light
- `apps/web/components/ui/OnboardingTour.tsx` — Tour onboarding

### Tier 0 — ✅ Completado 2026-05-06
- [x] **Dark mode root fix**: tailwind.config.ts usa CSS variables para colores custom → `.dark { --surface: ... }` propaga automáticamente. `dark:` variants en `.card`, `.input-field`, `.btn-secondary`, `.nav-item`. `AppShell`/`Topbar`/`Sidebar` con clases `dark:` explícitas.
- [x] **Fix "Generar con IA" error**: Bedrock model ID cambiado a cross-region inference profile `us.anthropic.claude-3-haiku-20240307-v1:0` en `evaluator/handler.ts` y `reflection/handler.ts`. EvaluatorFn timeout aumentado a 60s en CDK.
- [x] **3 puntos menú visible**: Mejor contraste y hover state en el botón MoreVertical de la tabla de carga de trabajo.
- [x] **"Ocultar por 8 días"**: Banner de bienvenida en dashboard estudiantil con botón de dismiss → localStorage con timestamp de expiración a 8 días.
- [x] **"Pendientes" clickeable**: Card de Pendientes en dashboard evaluador envuelto en `<Link>` → navega a `/evaluator/reflections`.
- [x] **"Siguiente" deshabilitado**: Botón Siguiente en visor de lección es un `<button disabled>` cuando `completed === false`; se convierte en Link activo al completar.
- [x] **Carga de trabajo clickeable**: Filas de la tabla de work queue tienen `onClick` que navega al detalle de reflexión (excepto al hacer clic en el menú de 3 puntos).

### Pendiente
- (ninguno por ahora)

---

## Variables de Entorno Requeridas

### Frontend (Vercel)
```
NEXT_PUBLIC_API_URL=https://<api-gw-id>.execute-api.<region>.amazonaws.com
NEXT_PUBLIC_COGNITO_USER_POOL_ID=...
NEXT_PUBLIC_COGNITO_CLIENT_ID=...
```

### Lambdas (CDK commonEnv)
```
DYNAMO_TABLE_PROGRESS=lux-progress
DYNAMO_TABLE_REFLECTIONS=lux-reflections
DYNAMO_TABLE_QUIZ=lux-quiz-results
DYNAMO_TABLE_ENROLLMENTS=lux-enrollments
DYNAMO_TABLE_CERTIFICATES=lux-certificates
COGNITO_USER_POOL_ID=...
PRISMA_DATABASE_URL=...
SES_FROM_EMAIL=...
BEDROCK_REGION=...
SQS_QUEUE_URL=...
DYNAMO_TABLE_PUSH_SUBS=PushSubscriptions
VAPID_PUBLIC_KEY=BD-Lc9oupPptQmoDMPCjFFapaUmaEnBTpotB7zrjdLAMHWAvXlZOzGp7uhCcJQHVW1Qof9KpDb00RSkJ2AV0OFw
VAPID_PRIVATE_KEY=SrodpnU4gkq5FH_caq4vYKP1hxz_g5iisTkCI_ONqwo
VAPID_EMAIL=mailto:admin@luxlearning.com
```

---

## Deploy

### Frontend
```bash
# Deploy manual via Vercel CLI desde la RAÍZ del monorepo
cd D:/InHouse/Lux
npx vercel --prod --yes
# Reasignar alias después de cada deploy:
npx vercel alias <deployment-url> lux-learning.vercel.app
```

> **Cuenta Vercel:** `jasonrbm-1241` — https://vercel.com/jasonrbm-1241s-projects/lux-learning  
> **URL producción:** https://lux-learning.vercel.app  
> **Repositorio GitHub:** https://github.com/JasonBarriosMolina/LuxLearning  
> **Project ID:** `prj_PRyLhUv3v66Jj771mEP3cozLQjAK`  
> **Configuración Vercel (API, NO en UI):** `framework: nextjs`, `rootDirectory: apps/web`, `buildCommand/outputDirectory/installCommand: null` (overrideados por `apps/web/vercel.json`)  
> **`apps/web/vercel.json`:** `installCommand: "npm install --prefix ../.."`, `buildCommand: "../../node_modules/.bin/next build"`  
> **Nota:** Deploy es manual (CLI). `middleware.ts` fue eliminado (era no-op y causaba MIDDLEWARE_INVOCATION_FAILED en Vercel Edge).

### Backend (CDK)
```bash
cd infrastructure/cdk
npx cdk deploy --require-approval never
```

### Verificar build local
```bash
cd apps/web && npx next build
cd services/api && npx tsc --noEmit  # errores esperados por module resolution, no bloquean esbuild
```

---

## Historial de Deploys

| Fecha | Descripción |
|-------|-------------|
| 2026-05-06 | Phase 4: recordatorios email, dashboard streak, feedback evaluador visible, reportes admin, IA preview reflexión, push al estudiante, dark mode, onboarding tour. Bug fix: dark mode CSS overrides, PushBell solo evaluadores en Topbar |
| 2026-04-30 | Bug fixes (13 issues): SW compilation, SK collision, userId guard, VAPID en Secrets Manager, fire-and-forget IIFE, isModuleUnlocked por order, SQS MessageGroupId, notificationclick, IAM typo |
| 2026-04-30 | Push notifications PWA: VAPID keys, PushSubscriptions DynamoDB, pushFn Lambda, service worker, PushBell en Topbar |
| 2026-04-30 | Phase 3: tags/categorías, score de calidad, priority flag, bug fixes admin/users e imagen |
| 2026-04-30 | Phase 2: AI feedback generator (Bedrock), deadline backend en reflexiones, modal auditoría de quiz |
| 2026-04-30 | Phase 1 Evaluador Dashboard: nuevo dashboard, tabla de evaluaciones con tiempo restante, detalle side-by-side con comentarios frecuentes |
| 2026-04-29 | Certificados completos: generación auto, página pública, download PDF |
| 2026-04-29 | Emails: invitación, reflexión aprobada/rechazada con nombre real del estudiante |
| 2026-04-29 | `formatCourseDuration()`: duraciones con unidades en todo el sistema |
| 2026-04-29 | Nombres de estudiantes en lugar de UUIDs en evaluador |
