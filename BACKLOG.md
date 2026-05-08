# Lux Learning — Backlog de Features

> Investigación competitiva completada 2026-05-08.  
> Referentes: TalentLMS, 360Learning, Docebo, Absorb LMS, Canvas, Coursera for Business, LinkedIn Learning, Duolingo, Khanmigo.  
> **Ninguna feature de este archivo está implementada.**

---

## 🔴 Alta prioridad

| # | Feature | Rol | Referente | Descripción técnica |
|---|---------|-----|-----------|-------------------|
| 1 | **Gamificación: XP + Badges + Leaderboard** | Estudiante | Duolingo, TalentLMS | XP por acción (lección, quiz, reflexión, streak). Badges por hitos. Ranking entre compañeros del mismo curso. DDB tabla `Gamification`. Sin nueva infra. |
| 2 | **Chatbot Socrático (upgrade chatbot actual)** | Estudiante | Khanmigo | Cambio de prompt en `lessons/handler.ts`. Modo "ayúdame a entender" → AI guía con preguntas en lugar de respuestas. Modo "evalúame" → AI hace preguntas sobre la lección para verificar comprensión. |
| 3 | **AI Detector de Brechas post-Quiz** | Estudiante | Absorb Skills, Cornerstone | Tras cada quiz, mostrar qué conceptos tiene débil el estudiante + recursos específicos. Dato ya calculado en `heatMap` de reportes — reutilizar para vista del estudiante. |
| 4 | **AI Planner de Estudio Personalizado** | Estudiante | LinkedIn Learning AI Coach | Dado módulos pendientes + tareas + progreso → Bedrock genera plan diario/semanal. Call desde dashboard. Datos ya disponibles en DDB. |
| 5 | **AI First-Pass Feedback completo** | Evaluador | Canvas SuperSmartGrader | Upgrade al botón "Generar con IA": producir feedback completo listo para enviar (no solo 5 bullets). Evaluador edita si quiere y aprueba. Cambio de prompt en `evaluator/handler.ts`. |
| 6 | **AI Generador de Preguntas de Quiz** | Admin | TalentLMS TalentCraft, Canvas IgniteAI | Admin pega contenido de lección → Bedrock genera 5-10 preguntas multiple choice con `correctIndex`. Botón en editor de preguntas. Patrón ya existe en `admin/handler.ts` (ai-generate). |

---

## 🟡 Media prioridad

| # | Feature | Rol | Referente | Descripción técnica |
|---|---------|-----|-----------|-------------------|
| 7 | **Foro de discusión por lección** | Estudiante + Evaluador | 360Learning, Canvas | Comentarios a nivel de lección. DDB tabla `Discussions` (PK: lessonId, SK: timestamp#userId). AI resume hilo para evaluador. |
| 8 | **Resumen Semanal AI para Evaluador** | Evaluador | Khanmigo for Teachers | Extension de `RemindersFn`: lunes 09:00 UTC, un call a Bedrock con datos de la semana → email + push con resumen de patrones, pendientes y estudiantes en riesgo. |
| 9 | **Bulk Import CSV de Estudiantes** | Admin | Todos los competidores | `POST /admin/users/bulk-import`. CSV con email, nombre, cursos → crea en Cognito + inscribe. Bloqueador de ventas sin esto. |
| 10 | **Detección Predictiva de Abandono** | Evaluador / Admin | Cornerstone, Absorb | Score de riesgo más sofisticado que "7 días inactivo": combina inactividad + velocidad de progreso + quizzes fallidos + reflexiones rechazadas. Semáforo 🟢🟡🔴 con explicación AI. |
| 11 | **White-label por Institución** | Admin | TalentLMS, Docebo | `institutionId` en Prisma + `branding: { logo, primaryColor, name }`. CSS variables inyectadas según institución. Base para multi-tenancy real. |
| 12 | **Rubric Builder para Evaluadores** | Evaluador | Canvas, Khanmigo for Teachers | Criterios de evaluación estructurados por módulo. Evaluador marca qué criterios cumplió la reflexión. Más consistencia entre evaluadores. |

---

## 🟢 Largo plazo

| # | Feature | Rol | Referente | Notas |
|---|---------|-----|-----------|-------|
| 13 | **SSO (Google / Microsoft)** | Todos | Todos | Bloqueador para empresas grandes. SAML + OAuth2. |
| 14 | **Mode Role-Play / Simulación IA** | Estudiante | Coursera Role Play, Docebo Virtual Coaching | Módulo tipo `roleplay` en Prisma. AI asume personaje, estudiante practica conversación, AI evalúa performance con score + feedback. |
| 15 | **App móvil nativa / PWA offline** | Estudiante | Cornerstone, Absorb | Crítico para usuarios de campo y sin conexión estable. |
| 16 | **Auto-traducción de cursos** | Admin | 360Learning (67 idiomas) | Expansión latam/global. Bedrock o servicio de traducción dedicado. |
| 17 | **Flashcards con spaced repetition** | Estudiante | Duolingo, Khanmigo | Auto-generadas desde puntos clave de lección. Algoritmo SM-2. |
| 18 | **HRIS integration (BambooHR, Workday)** | Admin | Docebo, Cornerstone | Auto-enrolamiento basado en cargo/departamento/onboarding. |
| 19 | **Video feedback del evaluador** | Evaluador | 360Learning | Loom-style; feedback más humano que texto. S3 para almacenamiento. |
| 20 | **AI Insights de Cohort semanal** | Evaluador | Absorb Reporting Agent | "Esta semana el patrón del grupo es X" — generado por `AnalysisFn`, visible en dashboard evaluador. |
| 21 | **AI Coach de Escritura en tiempo real** | Estudiante | Khanmigo Writing Coach | Feedback inline mientras el estudiante escribe la reflexión, no solo al presionar "Analizar". WebSocket o polling cada 3s. |
| 22 | **Búsqueda semántica de contenido** | Estudiante | Canvas Smart Search | Buscar por significado en todas las lecciones del curso. Embeddings en DDB o OpenSearch. |
| 23 | **Auto-enrolamiento por reglas** | Admin | Docebo, Cornerstone | Completar Curso A → auto-inscribir en Curso B. Reglas configurables en admin. |
| 24 | **xAPI / Learning Record Store** | Admin | Docebo, Cornerstone | Tracking de aprendizaje fuera de la plataforma (eventos externos, on-the-job). |
