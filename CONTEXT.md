# Lux Learning — Context & Estado del Sistema

> **Última actualización:** 2026-04-30  
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

---

## Lambdas y Endpoints

| Lambda | Archivo | Endpoints principales |
|--------|---------|----------------------|
| `coursesFn` | `courses/handler.ts` | `GET /courses`, `GET /courses/{id}`, `GET/POST lessons` |
| `evaluatorFn` | `evaluator/handler.ts` | `GET /evaluator/reflections`, `POST /evaluator/review`, `GET /evaluator/students` |
| `adminFn` | `admin/handler.ts` | `POST /admin/users`, `GET/PUT/DELETE /admin/courses` |
| `certsFn` | `certificates/handler.ts` | `GET /certificates/{certId}` (público), `GET /my-certificates`, `POST /my-certificates/generate` |
| `reflectionsFn` | `reflections/handler.ts` | `POST /reflections`, `GET /reflections/{moduleId}` |
| `aiAnalysisFn` | `ai-analysis/handler.ts` | (SQS trigger — no HTTP) |

---

## Trabajo Pendiente

### Phase 2 — ✅ Completado 2026-04-30
- [x] **AI feedback generator**: botón "Generar con IA" → 5 sugerencias via Bedrock (Claude Haiku), clickeables para insertar en feedback
- [x] **Backend deadline**: campo `deadline` guardado al enviar reflexión (submittedAt + 48h); frontend usa backend cuando disponible
- [x] **Modal de auditoría de quiz**: botón "Ver quiz" → modal con respuestas por intento, colores correcto/incorrecto

### Phase 3 — ✅ Completado 2026-04-30 (excepto push)
- [x] Tags/categorías para cursos — campo en Prisma, UI de chips en admin, filtro en estudiante
- [x] Score de calidad (1-10) — slider + botones en aprobación, visible en progreso del estudiante con ⭐
- [x] Priority flag — botón "Urgente" en detalle, ícono 🚩 en lista de evaluaciones
- [ ] **Notificaciones push (PWA)** — pendiente: requiere VAPID keys + service worker

### Bugs resueltos
- [x] `/admin/users`: fallback email → username elimina UUIDs vacíos
- [x] Curso sin imagen: banner gradient placeholder

### Pendiente
- [ ] **Push notifications PWA** — necesita: `npx web-push generate-vapid-keys`, configurar VAPID_PUBLIC/PRIVATE en Lambda env, service worker en `public/sw.js`

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
```

---

## Deploy

### Frontend
```bash
# Auto-deploy en push a main via Vercel
git push origin main
```

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
| 2026-04-30 | Phase 3: tags/categorías, score de calidad, priority flag, bug fixes admin/users e imagen |
| 2026-04-30 | Phase 2: AI feedback generator (Bedrock), deadline backend en reflexiones, modal auditoría de quiz |
| 2026-04-30 | Phase 1 Evaluador Dashboard: nuevo dashboard, tabla de evaluaciones con tiempo restante, detalle side-by-side con comentarios frecuentes |
| 2026-04-29 | Certificados completos: generación auto, página pública, download PDF |
| 2026-04-29 | Emails: invitación, reflexión aprobada/rechazada con nombre real del estudiante |
| 2026-04-29 | `formatCourseDuration()`: duraciones con unidades en todo el sistema |
| 2026-04-29 | Nombres de estudiantes en lugar de UUIDs en evaluador |
