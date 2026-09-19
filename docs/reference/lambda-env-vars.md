# Lambda Environment Variables Reference

> Consultar solo cuando se agreguen/quiten variables o se debuggee un Lambda específico.

## Shared across ALL lambdas
```
COGNITO_USER_POOL_ID      us-east-1_RGVyVRJXx
COGNITO_CLIENT_ID         63ujfu3mt11s45p9g6m7p0n648
DYNAMO_TABLE_ATTENDANCE   LuxAttendance
DYNAMO_TABLE_PROGRESS     LessonProgress
DYNAMO_TABLE_QUIZ         QuizAttempts
DYNAMO_TABLE_REFLECTIONS  Reflections
DYNAMO_TABLE_NOTIFS       Notifications
DYNAMO_TABLE_ENROLLMENTS  Enrollments
DYNAMO_TABLE_CERTIFICATES Certificates
DYNAMO_TABLE_PUSH_SUBS    PushSubscriptions
DYNAMO_TABLE_TASKS        ScheduledTasks
DYNAMO_TABLE_REPORT_ANALYSIS  ReportAnalysis
DYNAMO_TABLE_RECOMMENDATIONS  CurriculumRecommendations
DYNAMO_TABLE_ACTIVITY     LuxActivity
DYNAMO_TABLE_CHATS        LuxChats
DYNAMO_TABLE_MESSAGES     LuxMessages
DYNAMO_TABLE_CALENDAR     LuxCalendarEvents
```

## Prisma lambdas (admin, reflection, evaluator, courses, quiz, certs, analysis, reminders, reports)
```
DATABASE_URL              postgresql://... (auto-fetched from SM if missing)
PRISMA_QUERY_ENGINE_LIBRARY  /var/task/node_modules/.prisma/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node
DB_SECRET_ARN             arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-bp488g
```

## lux-admin
```
S3_IMAGES_BUCKET          lux-learning-images
SES_FROM_EMAIL            jason.rbm@gmail.com
FRONTEND_URL              https://lux-learning-mentor.vercel.app
BEDROCK_REGION            us-east-1
VAPID_PUBLIC_KEY          BD-Lc9oup...
VAPID_PRIVATE_KEY         SrodpnU4...
VAPID_EMAIL               mailto:admin@luxlearning.com
```

## lux-reflection + lux-sqsconsumer
```
SQS_REFLECTION_QUEUE_URL  https://sqs.../lux-reflection-queue
BEDROCK_REGION            us-east-1
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_EMAIL
```

## lux-evaluator + lux-reports + lux-reminders
```
SES_FROM_EMAIL            jason.rbm@gmail.com
FRONTEND_URL              https://lux-learning-mentor.vercel.app
BEDROCK_REGION            us-east-1          (evaluator only)
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_EMAIL  (evaluator only)
```

## lux-certs
```
DYNAMO_TABLE_CERT_TEMPLATES  LuxCertTemplates
```
Requires `pdfkit` — lazy `require('pdfkit')` inside handler.

## lux-evaluator (Slides)
```
DYNAMO_TABLE_SLIDES       LuxSlides-{Env}
DYNAMO_TABLE_GAMIFICATION LuxGamification-{Env}
PEXELS_API_KEY            (from Pexels dashboard)
```
