// Tasks domain handler for lux-evaluator.
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { EvalCtx, webpush, resolveStudentContact } from './ctx';
import {
  TABLES, ddb, createTask, getTasksForUser, updateTask, deleteTask, getPushSubscriptionsByUserId,
} from '../shared/db-dynamo';
import { sendTemplatedEmail } from '../shared/email';
import { ok, badRequest, serverError } from '../shared/response';
import { createId } from '@paralleldrive/cuid2';

export async function handleTasks(ctx: EvalCtx): Promise<any | null> {
  const { event, method, path } = ctx;

  // ── POST /evaluator/tasks — create task(s) for individual or all students in a course ──
  if (path === '/evaluator/tasks' && method === 'POST') {
    try {
      const { title, description, type = 'custom', dueDate, courseId, moduleId, courseTitle, moduleTitle, assignTo, userId: targetUserId, targetCourseId } = ctx.body as any;
      if (!title || !dueDate) return badRequest('title y dueDate son requeridos');

      const assignerUserId = event.requestContext.authorizer?.lambda?.userId ?? 'system';
      let assignees: string[] = [];

      if (assignTo === 'course' && targetCourseId) {
        // Fetch all enrolled students in a course
        const all = await ddb.send(new QueryCommand({
          TableName: TABLES.ENROLLMENTS,
          IndexName: 'courseId-users-index',
          KeyConditionExpression: 'courseId = :cid',
          ExpressionAttributeValues: { ':cid': targetCourseId },
        })).catch(async () => {
          // Fallback: scan enrollments for this course
          const scan = await ddb.send(new ScanCommand({
            TableName: TABLES.ENROLLMENTS,
            FilterExpression: 'courseId = :cid',
            ExpressionAttributeValues: { ':cid': targetCourseId },
          }));
          return { Items: scan.Items ?? [] };
        });
        assignees = [...new Set((all.Items ?? []).map((item: any) => item.userId as string).filter(Boolean))] as string[];
      } else if (targetUserId) {
        assignees = [targetUserId];
      }

      if (!assignees.length) return badRequest('No se encontraron destinatarios para asignar la tarea');

      // Each task gets a unique taskId from cuid2 — no Scan-based dedup needed
      const tasks = await Promise.all(
        assignees.map((uid) =>
          createTask({
            userId: uid,
            taskId: createId(),
            title,
            description,
            courseId,
            moduleId,
            courseTitle,
            moduleTitle,
            type,
            dueDate,
            status: 'PENDING',
            assignedBy: assignerUserId,
            createdAt: new Date().toISOString(),
          })
        )
      );

      // Push + email notifications (non-fatal)
      Promise.allSettled(
        assignees.map(async (uid) => {
          const [subs] = await Promise.all([getPushSubscriptionsByUserId(uid)]);
          await Promise.allSettled(
            subs.map((sub: any) =>
              webpush.sendNotification(sub, JSON.stringify({
                title: '📋 Nueva tarea asignada',
                body: `${title} — Vence: ${dueDate}`,
              }))
            )
          );
          try {
            const { email: studentEmail, name: studentName } = await resolveStudentContact(uid, {});
            if (studentEmail) {
              await sendTemplatedEmail(studentEmail, 'TASK_ASSIGNED', {
                studentName,
                taskTitle: title,
                courseTitle: courseTitle ?? '',
                dueDate,
              });
            }
          } catch { /* non-fatal */ }
        })
      ).catch(() => {});

      return ok({ created: tasks.length });
    } catch (e: any) {
      console.error('[tasks/create] Error:', e?.message, e?.code, e?.name);
      return serverError(e?.message ?? 'Error al crear tarea');
    }
  }

  // ── GET /evaluator/tasks — list all tasks assigned by this evaluator ─────────
  if (path === '/evaluator/tasks' && method === 'GET') {
    const assignerUserId = event.requestContext.authorizer?.lambda?.userId!;
    // Paginate through full Scan to avoid silent data loss after 1MB
    let lastKey: Record<string, any> | undefined;
    const allItems: any[] = [];
    do {
      const page = await ddb.send(new ScanCommand({
        TableName: TABLES.TASKS,
        FilterExpression: 'assignedBy = :aid',
        ExpressionAttributeValues: { ':aid': assignerUserId },
        ExclusiveStartKey: lastKey,
      }));
      allItems.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);
    const tasks = allItems.sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate));
    return ok(tasks);
  }

  // ── PUT /evaluator/tasks/:taskId — update a task ────────────────────────────
  const taskEditMatch = path.match(/^\/evaluator\/tasks\/([^/]+)$/);
  if (taskEditMatch && method === 'PUT') {
    const taskId = taskEditMatch[1]!;
    const { userId: targetUserId, title, description, dueDate } = ctx.body as any;
    if (!targetUserId) return badRequest('userId es requerido');
    const tasks = await getTasksForUser(targetUserId);
    const task = tasks.find((t: any) => t.taskId === taskId);
    if (!task) return badRequest('Tarea no encontrada');
    // dueDate is part of the DynamoDB SK — changing it requires delete + recreate
    if (dueDate && dueDate !== task.dueDate) {
      await deleteTask(targetUserId, task.sk);
      await createTask({
        userId: targetUserId,
        taskId: task.taskId,
        title: title ?? task.title,
        description: description ?? task.description,
        type: task.type,
        dueDate,
        courseId: task.courseId,
        moduleId: task.moduleId,
        courseTitle: task.courseTitle,
        moduleTitle: task.moduleTitle,
        assignedBy: task.assignedBy,
        status: task.status,
        createdAt: task.createdAt,
      });
    } else {
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (Object.keys(updates).length) await updateTask(targetUserId, task.sk, updates);
    }
    return ok({ updated: true });
  }

  // ── DELETE /evaluator/tasks/:taskId — delete a task ─────────────────────────
  if (taskEditMatch && method === 'DELETE') {
    const taskId = taskEditMatch[1]!;
    const { userId: targetUserId } = ctx.body as any;
    if (!targetUserId) return badRequest('userId es requerido');
    const tasks = await getTasksForUser(targetUserId);
    const task = tasks.find((t: any) => t.taskId === taskId);
    if (!task) return badRequest('Tarea no encontrada');
    await deleteTask(targetUserId, task.sk);
    return ok({ deleted: true });
  }

  return null; // not handled by this domain
}
