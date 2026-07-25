// ─── db-core.ts ──────────────────────────────────────────────────────────────
// DynamoDB client + TABLES proxy — no circular deps, imported by all domain files.
// Other code should import from db-dynamo (which re-exports everything).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getTableName } from './env-context';

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const BASE_TABLES = {
  PROGRESS: process.env.DYNAMO_TABLE_PROGRESS ?? 'LessonProgress',
  QUIZ: process.env.DYNAMO_TABLE_QUIZ ?? 'QuizAttempts',
  REFLECTIONS: process.env.DYNAMO_TABLE_REFLECTIONS ?? 'Reflections',
  NOTIFS: process.env.DYNAMO_TABLE_NOTIFS ?? 'Notifications',
  ENROLLMENTS: process.env.DYNAMO_TABLE_ENROLLMENTS ?? 'Enrollments',
  CERTIFICATES: process.env.DYNAMO_TABLE_CERTIFICATES ?? 'Certificates',
  PUSH_SUBS: process.env.DYNAMO_TABLE_PUSH_SUBS ?? 'PushSubscriptions',
  TASKS: process.env.DYNAMO_TABLE_TASKS ?? 'ScheduledTasks',
  REPORT_ANALYSIS: process.env.DYNAMO_TABLE_REPORT_ANALYSIS ?? 'ReportAnalysis',
  RECOMMENDATIONS: process.env.DYNAMO_TABLE_RECOMMENDATIONS ?? 'CurriculumRecommendations',
  ACTIVITY: process.env.DYNAMO_TABLE_ACTIVITY ?? 'LuxActivity',
  CERT_TEMPLATES: process.env.DYNAMO_TABLE_CERT_TEMPLATES ?? 'LuxCertTemplates',
  RESOURCES: process.env.DYNAMO_TABLE_RESOURCES ?? 'LuxResources',
  TRANSLATIONS: process.env.DYNAMO_TABLE_TRANSLATIONS ?? 'LuxTranslations',
  CALENDAR: process.env.DYNAMO_TABLE_CALENDAR ?? 'LuxCalendarEvents',
  USER_PROFILES: process.env.DYNAMO_TABLE_USER_PROFILES ?? 'LuxUserProfiles',
  SUBMISSIONS: process.env.DYNAMO_TABLE_SUBMISSIONS ?? 'LuxSubmissions',
  INTERVIEWS: process.env.DYNAMO_TABLE_INTERVIEWS ?? 'LuxInterviews',
  ATTENDANCE: process.env.DYNAMO_TABLE_ATTENDANCE ?? 'LuxAttendance',
};

export const TABLES: typeof BASE_TABLES = new Proxy(BASE_TABLES, {
  get(target, key: string) {
    const base = target[key as keyof typeof target];
    return base ? getTableName(base) : base;
  },
}) as typeof BASE_TABLES;
