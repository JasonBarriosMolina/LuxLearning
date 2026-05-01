# Lux Learning — Documento de Referencia del Sistema

> **Propósito:** Este documento describe de forma completa la arquitectura, funcionalidades y flujos implementados en la plataforma Lux Learning. Sirve como punto de entrada para cualquier desarrollador o agente de IA que deba entender, mantener o extender el sistema.

---

## 1. ¿Qué es Lux Learning?

Lux Learning es una plataforma de aprendizaje en línea (LMS) orientada a formación estructurada con evaluación humana. Su lema es **"Claridad que transforma."**

La plataforma permite a los estudiantes avanzar por cursos divididos en módulos, donde cada módulo requiere completar lecciones en video, pasar un cuestionario y escribir una reflexión personal que es revisada por un evaluador humano. Al completar todos los módulos de un curso, el sistema genera automáticamente un certificado digital verificable.

La plataforma incluye un sistema de detección de escritura generada por IA (vía AWS Bedrock / Claude) para garantizar la autenticidad de las reflexiones.

---

## 2. Roles de Usuario

El sistema maneja tres roles, gestionados a través de grupos de AWS Cognito:

| Rol | Descripción |
|---|---|
| `STUDENT` | Estudiante que consume el contenido y avanza por los módulos. |
| `EVALUATOR` | Revisor que aprueba o rechaza las reflexiones de los estudiantes y tiene acceso de lectura al panel de progreso. |
| `ADMIN` | Administrador con control total: gestión de usuarios, cursos, módulos, lecciones, preguntas e inscripciones. |

> **Nota:** El grupo `ADMIN` fue creado manualmente en Cognito y no está gestionado por CDK. Los grupos `STUDENT` y `EVALUATOR` sí se crean vía CDK.

---

## 3. Flujo Completo del Estudiante

### 3.1 Registro e inicio de sesión

- El registro se realiza mediante email y contraseña en la página `/register`.
- El inicio de sesión utiliza `/login`.
- La autenticación es manejada por **AWS Cognito** con flujos `USER_PASSWORD_AUTH` y `USER_SRP_AUTH`.
- Los tokens de acceso e ID tienen validez de **1 hora**; el refresh token dura **30 días**.
- Al recibir una invitación del administrador, el estudiante recibe una contraseña temporal por email y se le solicita cambiarla en el primer acceso (`FORCE_CHANGE_PASSWORD`).

### 3.2 Dashboard del estudiante

- Muestra los cursos en los que el estudiante está inscrito, con su porcentaje de progreso general.
- Indica el estado de cada módulo: bloqueado, en progreso, quiz aprobado, reflexión pendiente, reflexión aprobada.

### 3.3 Visualización de lecciones

- Cada módulo contiene lecciones ordenadas, cada una con:
  - Video de YouTube (embedido por `youtubeId`).
  - Lista de puntos clave.
  - Un consejo ("tip").
  - Duración estimada.
- El estudiante marca cada lección como completada mediante `POST /lessons/complete`.

### 3.4 Quiz del módulo

- Una vez completadas **todas las lecciones** del módulo, el estudiante puede acceder al quiz.
- El quiz está compuesto por preguntas de opción múltiple con un índice de respuesta correcta.
- Cada módulo tiene un `passingScore` configurable (puntaje mínimo para aprobar, en porcentaje).
- El sistema admite **múltiples intentos**; cada intento se registra en DynamoDB con el puntaje, las respuestas seleccionadas y si pasó o no.
- La respuesta incluye el detalle de cada pregunta: respuesta seleccionada, respuesta correcta y si fue correcta.

### 3.5 Reflexión escrita

- Después de pasar el quiz, el estudiante debe escribir una reflexión personal sobre el módulo.
- **Requisito mínimo:** 80 palabras (validado tanto en frontend como en backend).
- La reflexión se guarda con estado `PENDING_AI` y se envía a una cola **SQS FIFO** para procesamiento asíncrono.
- El estudiante puede consultar el estado actual de su reflexión en cualquier momento vía `GET /reflection/:moduleId`.

### 3.6 Ciclo de revisión de la reflexión

1. El worker SQS ejecuta la detección de IA (ver sección 11).
2. Si la IA la marca como generada por IA con confianza ≥ 60%, la reflexión pasa automáticamente a `REJECTED`.
3. Si pasa la detección, su estado cambia a `PENDING_EVAL` para revisión humana.
4. El evaluador aprueba (`APPROVED`) o rechaza (`REJECTED`) con retroalimentación escrita (mínimo 20 caracteres).
5. El estudiante recibe una notificación in-app y un correo electrónico con el resultado.

### 3.7 Desbloqueo de módulos

- El primer módulo siempre está desbloqueado.
- Los módulos siguientes se desbloquean automáticamente cuando la reflexión del módulo anterior tiene estado `APPROVED`.
- Este desbloqueo es calculado dinámicamente (no hay un campo "desbloqueado" almacenado), evaluando la cadena de reflexiones aprobadas.

### 3.8 Certificado

- Cuando el evaluador aprueba la reflexión del **último módulo** del curso, el sistema genera automáticamente un certificado.
- El estudiante también puede generar su certificado manualmente desde el dashboard si todos sus módulos están aprobados (`POST /my-certificates/generate`).
- El certificado es único por par `userId + courseId` (idempotente).
- Contiene: `certId` único (cuid), nombre del estudiante, título del curso y fecha de emisión.
- La URL de verificación pública es `/certificado/:certId` y es accesible sin autenticación.

---

## 4. Flujo del Evaluador

El evaluador accede a una sección protegida del dashboard con las siguientes funcionalidades:

### 4.1 Cola de reflexiones pendientes

- `GET /evaluator/reflections` — lista todas las reflexiones con estado `PENDING_EVAL`.
- Cada reflexión es enriquecida con el título del módulo, título del curso y nombre del estudiante (resuelto desde Cognito).

### 4.2 Revisión de una reflexión

- `POST /evaluator/reflections/review` — aprueba o rechaza una reflexión.
- Campos requeridos: `userId`, `moduleId`, `action` (`APPROVE` | `REJECT`), `feedback` (mínimo 20 caracteres).
- Al aprobar:
  - El estado cambia a `APPROVED`.
  - Se crea una notificación in-app para el estudiante.
  - Se verifica si todos los módulos del curso están aprobados; si es así, se genera un certificado automáticamente.
  - Se envía un correo SES al estudiante (con o sin certificado, según corresponda).
- Al rechazar:
  - El estado cambia a `REJECTED`.
  - Se crea una notificación in-app.
  - Se envía un correo SES con el motivo y retroalimentación.

### 4.3 Panel de progreso de estudiantes

- `GET /evaluator/students` — devuelve el progreso completo de todos los estudiantes inscritos.
- Por estudiante: nombre, cursos inscritos, lecciones completadas, porcentaje de avance, módulos con quiz aprobado y estado de las reflexiones.
- Los estudiantes se ordenan por mayor progreso primero.

---

## 5. Flujo del Administrador

El rol ADMIN tiene acceso exclusivo a todas las rutas `/admin/*` para la gestión completa de la plataforma.

### 5.1 Gestión de contenido (ADMIN y EVALUATOR)

| Acción | Endpoint |
|---|---|
| Listar / crear cursos | `GET/POST /admin/courses` |
| Ver / editar / eliminar curso | `GET/PUT/DELETE /admin/courses/:courseId` |
| Crear módulo en un curso | `POST /admin/courses/:courseId/modules` |
| Editar / eliminar módulo | `PUT/DELETE /admin/modules/:moduleId` |
| Crear lección en un módulo | `POST /admin/modules/:moduleId/lessons` |
| Editar / eliminar lección | `PUT/DELETE /admin/lessons/:lessonId` |
| Crear pregunta en un módulo | `POST /admin/modules/:moduleId/questions` |
| Editar / eliminar pregunta | `PUT/DELETE /admin/questions/:questionId` |

> Los evaluadores tienen acceso de lectura/escritura al contenido, pero las acciones de gestión de usuarios están restringidas únicamente al rol ADMIN.

### 5.2 Gestión de usuarios (solo ADMIN)

| Acción | Endpoint |
|---|---|
| Listar todos los usuarios | `GET /admin/users` |
| Invitar / crear usuario | `POST /admin/users` |
| Cambiar rol | `PUT /admin/users/:username/role` |
| Activar / desactivar cuenta | `PUT /admin/users/:username/status` |
| Eliminar usuario | `DELETE /admin/users/:username` |

- Al crear un usuario, se genera una contraseña temporal segura y se envía por correo electrónico vía SES.
- El usuario es agregado automáticamente al grupo de Cognito correspondiente al rol asignado.
- Se pueden asignar cursos al momento de la invitación (`courseIds[]`), inscribiendo al usuario directamente.

### 5.3 Gestión de inscripciones (solo ADMIN)

| Acción | Endpoint |
|---|---|
| Ver inscripciones de un usuario | `GET /admin/users/:username/enrollments` |
| Inscribir en un curso | `POST /admin/users/:username/enrollments` |
| Desinscribir de un curso | `DELETE /admin/users/:username/enrollments` |

---

## 6. Funcionalidades Implementadas (Resumen)

| Funcionalidad | Descripción |
|---|---|
| **Autenticación JWT** | Login/register con AWS Cognito. Tokens Bearer validados por un Lambda Authorizer personalizado. |
| **Control de acceso por rol** | STUDENT, EVALUATOR, ADMIN. Validado en cada Lambda handler. |
| **Catálogo de cursos** | Cursos con módulos, lecciones y preguntas almacenados en Neon (PostgreSQL). |
| **Progreso de lecciones** | Marcado de lección como completada; almacenado en DynamoDB. |
| **Quiz por módulo** | Cuestionario de opción múltiple con puntaje mínimo configurable; múltiples intentos. |
| **Reflexiones escritas** | Texto libre con mínimo 80 palabras, validación frontend y backend. |
| **Detección de IA** | Análisis asíncrono vía AWS Bedrock (Claude 3 Haiku). Rechazo automático con confianza ≥ 60%. |
| **Revisión humana** | Evaluadores aprueban o rechazan reflexiones con retroalimentación escrita. |
| **Desbloqueo secuencial de módulos** | Los módulos se desbloquean en cadena según aprobación de reflexiones. |
| **Notificaciones in-app** | Notificaciones con TTL almacenadas en DynamoDB. Marcado de leído. |
| **Notificaciones por email** | Correos HTML branded vía AWS SES para aprobación, rechazo y certificado. |
| **Certificados digitales** | Generación automática al completar un curso. Verificación pública sin autenticación. |
| **Panel del evaluador** | Cola de reflexiones pendientes y vista de progreso por estudiante. |
| **Panel de administración** | CRUD completo de contenido y gestión de usuarios/inscripciones. |
| **Inscripción por curso** | Los estudiantes ven solo los cursos en los que están inscritos. |
| **Invitación de usuarios** | Admin crea cuentas con contraseña temporal y correo de bienvenida automático. |

---

## 7. Stack Tecnológico

### Frontend

| Tecnología | Uso |
|---|---|
| **Next.js** (App Router) | Framework React, rutas por carpeta con layouts por rol. |
| **TypeScript** | Tipado estático en todo el proyecto. |
| **Tailwind CSS** | Estilos utilitarios. |
| **Vercel** | Hosting del frontend (`https://lux-learning.vercel.app`). |

### Backend

| Tecnología | Uso |
|---|---|
| **AWS Lambda** (Node.js 20, ARM64/Graviton2) | Funciones serverless por dominio. |
| **AWS API Gateway HTTP API v2** | Enrutamiento REST con CORS y autorización. |
| **Prisma ORM** | Acceso a la base de datos relacional. Binario compilado para ARM64 Linux. |
| **Neon PostgreSQL** | Base de datos relacional serverless (cursos, módulos, lecciones, preguntas). |
| **AWS DynamoDB** | Base de datos NoSQL para datos operacionales (progreso, quizzes, reflexiones, notificaciones, inscripciones, certificados). |
| **AWS SQS (FIFO)** | Cola de mensajes para procesamiento asíncrono de reflexiones. |
| **AWS Bedrock (Claude 3 Haiku)** | Modelo de IA para detección de escritura generada por IA. |
| **AWS SES** | Envío de correos electrónicos transaccionales. |
| **AWS Cognito** | Autenticación, gestión de usuarios y grupos de roles. |
| **AWS Secrets Manager** | Almacenamiento seguro de credenciales de base de datos. |
| **AWS CDK (TypeScript)** | Infraestructura como código (IaC). |
| **esbuild / NodejsFunction** | Bundling y minificación de Lambdas. |

### Monorepo

```
/
├── apps/web/          # Next.js frontend
├── packages/types/    # Tipos TypeScript compartidos (@lux/types)
├── services/api/      # Lambda handlers (backend)
└── infrastructure/cdk/ # AWS CDK stack
```

---

## 8. Infraestructura AWS (Detalle)

### DynamoDB — Tablas

| Tabla | PK | SK | Descripción |
|---|---|---|---|
| `LessonProgress` | `userId` | `sk` (courseId#moduleId#lessonId) | Progreso de lecciones por estudiante. |
| `QuizAttempts` | `userId` | `sk` | Intentos de quiz. GSI: `moduleId-index`. |
| `Reflections` | `userId` | `sk` (moduleId) | Reflexiones con estado y resultado de IA. GSI: `status-index`. |
| `Notifications` | `userId` | `sk` | Notificaciones in-app con TTL. |
| `Enrollments` | `userId` | `sk` (courseId) | Inscripciones de estudiantes a cursos. |
| `Certificates` | `certId` | — | Certificados emitidos. GSI: `userId-courseId-index`. |

- Todas las tablas usan **billing bajo demanda** (`PAY_PER_REQUEST`).
- Todas tienen política de retención `RETAIN` (no se eliminan al destruir el stack).
- `Notifications` tiene atributo TTL configurado.

### Lambda Functions

| Función | Descripción | Memoria |
|---|---|---|
| `lux-authorizer` | Valida JWT de Cognito e inyecta contexto (userId, email, role). | 128 MB |
| `lux-courses` | CRUD de cursos enriquecidos con progreso del estudiante. | 512 MB |
| `lux-lessons` | Marcar lección completa y consultar progreso. | 256 MB |
| `lux-quiz` | Submit y consulta de intentos de quiz. | 512 MB |
| `lux-reflection` | Submit de reflexiones y envío a SQS. | 512 MB |
| `lux-evaluator` | Revisión de reflexiones, panel de estudiantes, envío de emails SES. | 512 MB |
| `lux-admin` | Gestión de contenido, usuarios e inscripciones. | 512 MB |
| `lux-notifs` | Consulta y marcado de notificaciones. | 256 MB |
| `lux-certs` | Consulta, generación y verificación pública de certificados. | 256 MB |
| `lux-sqsconsumer` | Worker SQS: detección de IA con Bedrock. | 512 MB, timeout 120s |

- Runtime: **Node.js 20.x**, arquitectura **ARM64** (Graviton2).
- Timeout estándar: **30 segundos** (excepto SQS consumer: 120s).
- Lambda Authorizer cachea resultados por **5 minutos**.

### SQS

- `lux-reflection-queue` — Cola estándar (no FIFO en producción, aunque el código usa `MessageGroupId`) con visibilidad de 300s.
- `lux-reflection-dlq` — Dead Letter Queue con retención de 14 días. Las reflexiones fallan hasta 3 veces antes de ir al DLQ.
- El SQS Consumer procesa lotes de hasta **5 mensajes** con ventana de batching de 10 segundos.

### API Gateway

- HTTP API v2 con CORS configurado para `*` (todos los orígenes).
- Todas las rutas requieren autorización JWT excepto `GET /certificates/:certId` (verificación pública).
- El preflight OPTIONS es manejado a nivel de handler.

---

## 9. Notificaciones por Email (SES)

Todos los correos se envían desde `noreply@luxlearning.com` con diseño HTML branded (gradiente `#00B4D8` → `#7B2FBE`).

| Trigger | Tipo | Contenido |
|---|---|---|
| Admin invita a un usuario | Bienvenida | Credenciales de acceso (email + contraseña temporal), lista de cursos inscritos, enlace al login. |
| Evaluador aprueba una reflexión (módulo no final) | Aprobación | Nombre del módulo, retroalimentación del evaluador, CTA "Continuar aprendiendo". |
| Evaluador rechaza una reflexión | Rechazo | Nombre del módulo, motivo, retroalimentación, CTA "Reescribir reflexión". |
| Evaluador aprueba la reflexión del último módulo | Curso completado + Certificado | Felicitación, nombre del curso, retroalimentación, enlace directo al certificado. |

---

## 10. Sistema de Certificados

### Generación automática

Cuando el evaluador aprueba una reflexión:
1. El sistema consulta todos los módulos del curso.
2. Verifica que **todas** las reflexiones del estudiante para ese curso tengan estado `APPROVED`.
3. Si se cumple la condición y no existe un certificado previo, se genera uno nuevo con `cuid` único.
4. Se almacena en DynamoDB con: `certId`, `userId`, `courseId`, `studentName`, `courseTitle`, `issuedAt`.
5. Se notifica al estudiante por email con el enlace al certificado.

### Generación manual (idempotente)

El estudiante puede solicitar la generación desde su dashboard vía `POST /my-certificates/generate`. Si el certificado ya existe, devuelve el existente sin crear duplicados.

### Verificación pública

- `GET /certificates/:certId` es un endpoint **público** (sin autenticación).
- Permite que terceros verifiquen la autenticidad de un certificado ingresando el ID único.
- La URL de verificación tiene el formato: `https://lux-learning.vercel.app/certificado/:certId`.

---

## 11. Sistema de Detección de IA

### Flujo de procesamiento

1. El estudiante envía una reflexión → se guarda con estado `PENDING_AI` → se publica un mensaje en SQS con `{ userId, moduleId }`.
2. El Lambda consumer (`lux-sqsconsumer`) procesa el mensaje de forma asíncrona.
3. Llama a la función `detectAI(text)` que invoca **AWS Bedrock** con el modelo **Claude 3 Haiku** (`anthropic.claude-3-haiku-20240307-v1:0`), usando inference profiles (`us.anthropic.claude-3-haiku-20240307-v1:0`).
4. El modelo devuelve un objeto `AIDetectionResult`:
   ```typescript
   {
     isAI: boolean;
     confidence: number;      // 0–100
     signals: string[];       // indicios detectados
     verdict: 'HUMANO' | 'IA_DETECTADA';
   }
   ```
5. **Umbral de rechazo automático:** `isAI === true` Y `confidence >= 60`.
   - Si supera el umbral → estado `REJECTED`.
   - Si no supera → estado `PENDING_EVAL` (pasa a revisión humana).
6. **Failsafe:** Si Bedrock falla, la reflexión avanza directamente a `PENDING_EVAL` sin bloquear al estudiante.

### Permisos IAM

El Lambda consumer tiene permisos para invocar:
- `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`
- `arn:aws:bedrock:us-east-1:{account}:inference-profile/us.anthropic.claude-3-haiku-20240307-v1:0`

---

## 12. Modelo de Datos — Referencia Rápida

### PostgreSQL (Neon via Prisma)

- **Course** — `id`, `title`, `slug`, `description`, `imageUrl`, `isActive`, `isPilot`, `createdAt`
- **Module** — `id`, `courseId`, `order`, `title`, `description`, `duration`, `passingScore`
- **Lesson** — `id`, `moduleId`, `order`, `title`, `duration`, `youtubeId`, `imageUrl`, `points[]`, `tip`
- **Question** — `id`, `moduleId`, `order`, `text`, `options[]`, `correctIndex`

### DynamoDB

- **LessonProgress** — `userId`, `courseId`, `moduleId`, `lessonId`, `completedAt`, `durationMs?`
- **QuizAttempt** — `userId`, `moduleId`, `attemptNumber`, `score`, `passed`, `answers[]`, `submittedAt`
- **Reflection** — `userId`, `moduleId`, `text`, `wordCount`, `aiResult?`, `status`, `evaluatorFeedback?`, `submittedAt`, `analyzedAt?`, `reviewedAt?`, `studentEmail?`
- **Notification** — `userId`, `notifId`, `type`, `message`, `read`, `createdAt`
- **Certificate** — `certId`, `userId`, `courseId`, `studentName`, `courseTitle`, `issuedAt`
- **Enrollment** — `userId`, `courseId`

### Estados de una Reflexión

```
PENDING_AI → (Bedrock) → REJECTED (IA detectada)
                       → PENDING_EVAL → (Evaluador) → APPROVED
                                                    → REJECTED
```

---

## 13. Variables de Entorno Relevantes

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | URL de conexión pooled a Neon PostgreSQL (desde Secrets Manager). |
| `COGNITO_USER_POOL_ID` | ID del User Pool de Cognito. |
| `COGNITO_CLIENT_ID` | ID del cliente web de Cognito. |
| `DYNAMO_TABLE_PROGRESS` | Nombre de la tabla LessonProgress. |
| `DYNAMO_TABLE_QUIZ` | Nombre de la tabla QuizAttempts. |
| `DYNAMO_TABLE_REFLECTIONS` | Nombre de la tabla Reflections. |
| `DYNAMO_TABLE_NOTIFS` | Nombre de la tabla Notifications. |
| `DYNAMO_TABLE_ENROLLMENTS` | Nombre de la tabla Enrollments. |
| `DYNAMO_TABLE_CERTIFICATES` | Nombre de la tabla Certificates. |
| `SQS_REFLECTION_QUEUE_URL` | URL de la cola SQS de reflexiones. |
| `SES_FROM_EMAIL` | Email remitente (`noreply@luxlearning.com`). |
| `BEDROCK_REGION` | Región de Bedrock (`us-east-1`). |
| `FRONTEND_URL` | URL del frontend (`https://lux-learning.vercel.app`). |
| `NEXT_PUBLIC_API_URL` | URL base del API Gateway (usada por el frontend). |

---

*Documento generado el 30 de abril de 2026 a partir del análisis del código fuente del repositorio.*
