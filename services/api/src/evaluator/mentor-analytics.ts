import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from '../shared/db-dynamo';
import { ok, badRequest } from '../shared/response';
import type { EvalCtx } from './ctx';

// GET /evaluator/mentor/analytics?courseId=xxx
export async function handleMentorAnalytics(ctx: EvalCtx): Promise<any | null> {
  const { method, path, prisma } = ctx;
  if (!(method === 'GET' && path.startsWith('/evaluator/mentor/analytics'))) return null;

  const courseId = ctx.event.queryStringParameters?.courseId;
  if (!courseId) return badRequest('courseId query param required');

  // Get all lessons in this course
  const lessons = await prisma.lesson.findMany({
    where: { module: { courseId } },
    select: { id: true, title: true, moduleId: true },
  });

  if (!lessons.length) return ok({ lessons: [], summary: { totalMessages: 0, uniqueStudents: 0, activeLessons: 0 } });

  // Query DDB for each lesson in parallel
  const results = await Promise.all(
    lessons.map(async (lesson: { id: string; title: string; moduleId: string }) => {
      const res = await ddb.send(new QueryCommand({
        TableName: TABLES.MENTOR_INTERACTIONS,
        KeyConditionExpression: 'lessonId = :lid',
        ExpressionAttributeValues: { ':lid': lesson.id },
        ProjectionExpression: 'userId, ts',
      })).catch(() => ({ Items: [] }));

      const items = res.Items ?? [];
      const uniqueStudents = new Set(items.map((i: any) => i.userId)).size;
      const totalMessages = items.length;

      // Hour distribution
      const byHour: Record<number, number> = {};
      for (const item of items as any[]) {
        const h = new Date(item.ts).getUTCHours();
        byHour[h] = (byHour[h] ?? 0) + 1;
      }
      const peakHour = Object.entries(byHour).sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0];

      // Per-student message counts
      const studentMsgCount: Record<string, number> = {};
      for (const item of items as any[]) {
        studentMsgCount[item.userId] = (studentMsgCount[item.userId] ?? 0) + 1;
      }
      const msgCounts = Object.values(studentMsgCount);
      const avgMsgsPerStudent = uniqueStudents > 0 ? Math.round((totalMessages / uniqueStudents) * 10) / 10 : 0;
      const singleMsgStudents = msgCounts.filter((c) => c === 1).length;
      const deepDiveStudents = msgCounts.filter((c) => c >= 3).length;

      return {
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        moduleId: lesson.moduleId,
        totalMessages,
        uniqueStudents,
        avgMsgsPerStudent,
        singleMsgStudents,
        deepDiveStudents,
        peakHour: peakHour !== undefined ? parseInt(peakHour, 10) : null,
      };
    })
  );

  // Sort by totalMessages desc (most-questioned = harder lessons)
  results.sort((a, b) => b.totalMessages - a.totalMessages);

  const allStudentIds = new Set<string>();
  let totalMessages = 0;
  for (const r of results) {
    totalMessages += r.totalMessages;
    // Can't reconstruct individual student IDs from counts — use uniqueStudents per lesson as approx
  }
  const activeLessons = results.filter((r) => r.totalMessages > 0).length;

  // Approximate unique across all lessons (not exact without per-student lists)
  const summary = {
    totalMessages,
    activeLessons,
    totalLessons: lessons.length,
    usageRate: lessons.length > 0 ? Math.round((activeLessons / lessons.length) * 100) : 0,
  };

  return ok({ lessons: results, summary });
}
