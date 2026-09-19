# DynamoDB Tables Reference

| Table | PK | SK | Notes |
|---|---|---|---|
| Reflections | userId | moduleId | status: PENDING_AI → PENDING_EVAL → APPROVED/REJECTED |
| QuizAttempts | userId | moduleId | arrays of attempts |
| LessonProgress | userId | lessonId | completed boolean |
| LessonProgress (`_AIJOB`) | `_AIJOB` | jobId | AI generation jobs. Status: `processing` → `done`\|`error` |
| Enrollments | userId | courseId | GSI: courseId-index |
| Notifications | userId | notifId | bell icon in Topbar |
| LuxChats | `USER#userId` | chatId | membership record |
| LuxChats | `CHAT#chatId` | `META` | chat metadata + participants |
| LuxMessages | chatId | ts | `ts = ISO#randomId` |
| PushSubscriptions | userId | endpoint | VAPID push subs |
| ScheduledTasks | userId | taskId | per-student tasks |
| LuxCertTemplates | `TEMPLATE` | `GLOBAL` | Certificate template (colors, logo, watermark) |
| LuxCalendarEvents | creatorId | eventId | visibility: private\|evaluators\|students\|community |
| LuxSlides-{Env} | userId | slideId | Lux Slides feature |
| LuxGamification-{Env} | userId | itemId | Gamification (XP, badges) |
| LuxAttendance | courseId | attendanceId | Attendance records |
