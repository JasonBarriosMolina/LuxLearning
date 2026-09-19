# Business Flows Reference

## Reflection flow
1. Student submits `POST /reflection` → saves `PENDING_AI`, sends `{userId, moduleId}` to SQS
2. `lux-sqsconsumer` reads SQS → runs `detectAI()` via Bedrock
3. If AI score ≥ 60 → status `REJECTED`; else → `PENDING_EVAL`
4. On `PENDING_EVAL`: creates in-app notification + push to `reflection.evaluatorId`
5. Evaluator reviews → `POST /evaluator/reflections/review` → `APPROVED` or `REJECTED`
6. `reflection.evaluatorId` stored at submission from `module.course.evaluatorId`

## Quiz flow
1. Student answers → `POST /quiz/{moduleId}/submit`
2. Score calculated server-side; stored in `QuizAttempts` DDB
3. Passing score per module in Prisma (`module.passingScore`, default 70)
4. Must pass quiz before reflection is unlocked (`hasPassedQuiz` check)
5. Options shuffled in DB at creation (`shuffleQuestionOptions` in admin/handler.ts)

## Enrollment flow
1. Admin `POST /admin/users/{username}/enrollments`
2. Prisma `Enrollment` + DynamoDB `Enrollments` record created
3. Welcome email via SES
4. `upsertChat(group_${courseId})` + `upsertMembership(username, group_${courseId})`

## Group chat
- Chat ID: `group_${courseId}`
- Messages handler auto-joins users without membership (`group_*` prefix)
- `upsertMembership` uses `UpdateCommand + SET if_not_exists` (safe to call multiple times)

## Certificate flow
1. All module reflections must be `APPROVED`
2. `POST /my-certificates/generate` → Bedrock generates personalized text → saved in `Certificates` DDB
3. Certificate at `/certificado/{certId}` (public, no auth)

## Async AI job pattern
- Initial HTTP call saves `jobId` to DynamoDB (`LessonProgress`, `userId='_AIJOB'`) and returns immediately
- Worker runs in background, updates status to `done` or `error`
- Frontend polls `GET /admin/courses/ai-job?jobId=...` every 3s
- lux-admin has `lambda:InvokeFunction` on its own ARN — self-invoke works
