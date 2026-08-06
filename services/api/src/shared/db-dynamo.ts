// ─── db-dynamo.ts (hub — backward-compatible re-exports) ─────────────────────
// Existing handlers import from '../shared/db-dynamo' and continue to work.
// The DynamoDB client (ddb) and TABLES proxy live in db-core.ts to avoid
// circular deps (domain files import db-core; db-dynamo re-exports domain files).
export { ddb, TABLES } from './db-core.js';

// ─── Domain re-exports ────────────────────────────────────────────────────────
export * from './db-progress.js';
export * from './db-reflections.js';
export * from './db-enrollments.js';
export * from './db-notifications.js';
export * from './db-tasks.js';
export * from './db-calendar.js';
export * from './db-submissions.js';
export * from './db-classes.js';
export * from './db-attendance.js';
export * from './db-misc.js';
