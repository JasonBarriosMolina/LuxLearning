// Submissions and interviews domain handler for lux-evaluator.
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EvalCtx, s3Ev, SUBMISSIONS_BUCKET_EV, webpush, VAPID_PUBLIC_EV, VAPID_PRIVATE_EV, resolveStudentName } from './ctx';
import { listSubmissionsForModule, updateSubmissionGrade, listInterviewsForModule, updateInterviewGrade, getInterview, listClassSessionsForModule, updateClassSessionGrade, getClassSession, getPushSubscriptionsByUserId } from '../shared/db-dynamo';
import { ok, badRequest, forbidden } from '../shared/response';

export async function handleSubmissions(ctx: EvalCtx): Promise<any | null> {
  const { event, method, path, userId, prisma, isAdminRole } = ctx;

  // ── GET /evaluator/submissions/pending ──────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/submissions/pending') {
    const courses = await prisma.course.findMany({
      where: isAdminRole ? {} : { evaluatorId: userId },
      select: { id: true, title: true, modules: { select: { id: true, title: true } } },
    });
    const moduleMap = new Map<string, { courseTitle: string; moduleTitle: string }>();
    for (const c of courses) {
      for (const m of c.modules) {
        moduleMap.set(m.id, { courseTitle: c.title, moduleTitle: m.title });
      }
    }
    const allSubs = (await Promise.all(
      [...moduleMap.keys()].map((mid) => listSubmissionsForModule(mid))
    )).flat();
    const pending = allSubs.filter((s) => s.status === 'pending');
    pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const uniqueUserIds = [...new Set(pending.map((s) => s.userId))];
    const nameMap = Object.fromEntries(
      await Promise.all(uniqueUserIds.map(async (uid) => [uid, await resolveStudentName(uid)]))
    );
    const enriched = pending.map((s) => ({
      ...s,
      studentName: nameMap[s.userId] ?? s.userId,
      courseTitle: moduleMap.get(s.moduleId)?.courseTitle ?? '',
      moduleTitle: moduleMap.get(s.moduleId)?.moduleTitle ?? '',
    }));
    return ok(enriched);
  }

  // ── GET /evaluator/submissions?moduleId=X ────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/submissions') {
    const moduleId = event.queryStringParameters?.moduleId;
    if (!moduleId) return badRequest('moduleId required');
    const subs = await listSubmissionsForModule(moduleId);
    const uniqueUserIds = [...new Set(subs.map((s) => s.userId))];
    const nameMap = Object.fromEntries(
      await Promise.all(uniqueUserIds.map(async (uid) => [uid, await resolveStudentName(uid)]))
    );
    return ok(subs.map((s) => ({ ...s, studentName: nameMap[s.userId] ?? s.userId })));
  }

  // ── PUT /evaluator/submissions/:submissionId/grade ───────────────────────────
  const gradeMatch = path.match(/^\/evaluator\/submissions\/([^/]+)\/grade$/);
  if (gradeMatch && method === 'PUT') {
    const submissionId = gradeMatch[1]!;
    const body = JSON.parse(event.body ?? '{}');
    const { studentUserId, grade, feedback, courseId } = body;
    const gradeNum = Number(grade);
    if (!studentUserId || grade == null) return badRequest('studentUserId and grade required');
    if (isNaN(gradeNum) || gradeNum < 0 || gradeNum > 100) return badRequest('grade must be 0-100');
    if (!isAdminRole && courseId) {
      const course = await prisma.course.findUnique({ where: { id: courseId }, select: { evaluatorId: true } });
      if (course && course.evaluatorId !== userId) return forbidden('No autorizado para este curso');
    }
    await updateSubmissionGrade(studentUserId, submissionId, gradeNum, String(feedback ?? ''), userId!);
    return ok({ graded: true });
  }

  // ── GET /evaluator/submissions/:submissionId/download?s3Key=Y ────────────────
  const downloadMatch = path.match(/^\/evaluator\/submissions\/([^/]+)\/download$/);
  if (downloadMatch && method === 'GET') {
    const s3Key = event.queryStringParameters?.s3Key;
    if (!s3Key) return badRequest('s3Key required');
    if (!s3Key.startsWith('submissions/')) return badRequest('Invalid s3Key');
    const cmd = new GetObjectCommand({ Bucket: SUBMISSIONS_BUCKET_EV, Key: s3Key });
    const url = await getSignedUrl(s3Ev, cmd, { expiresIn: 300 });
    return ok({ url });
  }

  // ── GET /evaluator/interviews/pending ────────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/interviews/pending') {
    const courses = await prisma.course.findMany({
      where: isAdminRole ? {} : { evaluatorId: userId },
      select: { id: true, title: true, modules: { select: { id: true, title: true } } },
    });
    const moduleMap = new Map<string, { courseTitle: string; moduleTitle: string }>();
    for (const c of courses) {
      for (const m of c.modules) {
        moduleMap.set(m.id, { courseTitle: c.title, moduleTitle: m.title });
      }
    }
    const allInterviews = (await Promise.all(
      [...moduleMap.keys()].map((mid) => listInterviewsForModule(mid))
    )).flat();
    const pending = allInterviews.filter((iv) => iv.status === 'completed' && iv.grade == null);
    pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const uniqueUserIds = [...new Set(pending.map((iv) => iv.userId))];
    const nameMap = Object.fromEntries(
      await Promise.all(uniqueUserIds.map(async (uid) => [uid, await resolveStudentName(uid)]))
    );
    const enriched = pending.map((iv) => ({
      ...iv,
      studentName: nameMap[iv.userId] ?? iv.userId,
      courseTitle: moduleMap.get(iv.moduleId)?.courseTitle ?? '',
      moduleTitle: moduleMap.get(iv.moduleId)?.moduleTitle ?? '',
    }));
    return ok(enriched);
  }

  // ── GET /evaluator/interviews?moduleId=X ─────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/interviews') {
    const moduleId = event.queryStringParameters?.moduleId;
    if (!moduleId) return badRequest('moduleId required');
    const interviews = await listInterviewsForModule(moduleId);
    const uniqueUserIds = [...new Set(interviews.map((iv) => iv.userId))];
    const nameMap = Object.fromEntries(
      await Promise.all(uniqueUserIds.map(async (uid) => [uid, await resolveStudentName(uid)]))
    );
    return ok(interviews.map((iv) => ({ ...iv, studentName: nameMap[iv.userId] ?? iv.userId })));
  }

  // ── PUT /evaluator/interviews/:interviewId/grade ─────────────────────────────
  const interviewGradeMatch = path.match(/^\/evaluator\/interviews\/([^/]+)\/grade$/);
  if (interviewGradeMatch && method === 'PUT') {
    const interviewId = interviewGradeMatch[1]!;
    let body: any = {};
    try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }
    const { studentUserId, grade, feedback } = body as { studentUserId?: string; grade?: number; feedback?: string };
    if (!studentUserId || grade == null) return badRequest('studentUserId and grade required');
    const gradeNum = Number(grade);
    if (isNaN(gradeNum) || gradeNum < 0 || gradeNum > 100) return badRequest('grade must be 0-100');
    if (!isAdminRole) {
      // interviewId is a DDB session UUID — look up courseId from the interview record itself
      const interview = await getInterview(studentUserId!, interviewId);
      if (interview?.courseId) {
        const course = await prisma.course.findUnique({ where: { id: interview.courseId }, select: { evaluatorId: true } });
        if (course && course.evaluatorId !== userId) return forbidden('No autorizado para este curso');
      }
    }
    await updateInterviewGrade(studentUserId, interviewId, gradeNum, String(feedback ?? ''), userId!);

    if (VAPID_PUBLIC_EV && VAPID_PRIVATE_EV) {
      void (async () => {
        try {
          const subs = await getPushSubscriptionsByUserId(studentUserId);
          const payload = JSON.stringify({ title: 'Entrevista calificada', body: `Tu entrevista oral fue calificada: ${gradeNum}%` });
          await Promise.allSettled(subs.map((sub: any) =>
            webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
          ));
        } catch {}
      })();
    }
    return ok({ graded: true });
  }

  // ── GET /evaluator/classes?moduleId=X ───────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/classes') {
    const moduleId = event.queryStringParameters?.moduleId;
    if (!moduleId) return badRequest('moduleId required');
    const sessions = await listClassSessionsForModule(moduleId);
    return ok(sessions.filter((s) => !s.voided));
  }

  // ── PUT /evaluator/classes/:sessionId/grade ──────────────────────────────────
  const classGradeMatch = path.match(/^\/evaluator\/classes\/([^/]+)\/grade$/);
  if (classGradeMatch && method === 'PUT') {
    const sessionId = classGradeMatch[1]!;
    let body: any = {};
    try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }
    const { studentUserId, grade, feedback, courseId } = body as { studentUserId?: string; grade?: number; feedback?: string; courseId?: string };
    if (!studentUserId || grade == null) return badRequest('studentUserId and grade required');
    const gradeNum = Number(grade);
    if (isNaN(gradeNum) || gradeNum < 0 || gradeNum > 100) return badRequest('grade must be 0-100');

    // Verify evaluator owns the course (unless admin)
    if (!isAdminRole && courseId) {
      const course = await prisma.course.findUnique({ where: { id: courseId }, select: { evaluatorId: true } });
      if (course && course.evaluatorId !== userId) return forbidden('No autorizado para este curso');
    }

    // Verify session exists
    const session = await getClassSession(studentUserId, sessionId);
    if (!session) return badRequest('Sesión no encontrada');

    await updateClassSessionGrade(studentUserId, sessionId, gradeNum, String(feedback ?? ''), userId!);

    if (VAPID_PUBLIC_EV && VAPID_PRIVATE_EV) {
      void (async () => {
        try {
          const subs = await getPushSubscriptionsByUserId(studentUserId);
          const payload = JSON.stringify({ title: 'Clase calificada', body: `Tu sesión de Lux Mentor fue calificada: ${gradeNum}%` });
          await Promise.allSettled(subs.map((sub: any) =>
            webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
          ));
        } catch {}
      })();
    }
    return ok({ graded: true });
  }

  return null; // not handled by this domain
}
