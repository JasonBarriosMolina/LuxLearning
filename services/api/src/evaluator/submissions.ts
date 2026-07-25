// Submissions and interviews domain handler for lux-evaluator.
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EvalCtx, s3Ev, SUBMISSIONS_BUCKET_EV, webpush, VAPID_PUBLIC_EV, VAPID_PRIVATE_EV } from './ctx';
import { listSubmissionsForModule, updateSubmissionGrade, listInterviewsForModule, updateInterviewGrade, getPushSubscriptionsByUserId } from '../shared/db-dynamo';
import { ok, badRequest } from '../shared/response';

export async function handleSubmissions(ctx: EvalCtx): Promise<any | null> {
  const { event, method, path, userId } = ctx;

  // ── GET /evaluator/submissions?moduleId=X ────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/submissions') {
    const moduleId = event.queryStringParameters?.moduleId;
    if (!moduleId) return badRequest('moduleId required');
    const subs = await listSubmissionsForModule(moduleId);
    return ok(subs);
  }

  // ── PUT /evaluator/submissions/:submissionId/grade ───────────────────────────
  const gradeMatch = path.match(/^\/evaluator\/submissions\/([^/]+)\/grade$/);
  if (gradeMatch && method === 'PUT') {
    const submissionId = gradeMatch[1]!;
    const body = JSON.parse(event.body ?? '{}');
    const { studentUserId, grade, feedback } = body;
    const gradeNum = Number(grade);
    if (!studentUserId || grade == null) return badRequest('studentUserId and grade required');
    if (isNaN(gradeNum) || gradeNum < 0 || gradeNum > 100) return badRequest('grade must be 0-100');
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

  // ── GET /evaluator/interviews?moduleId=X ─────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/interviews') {
    const moduleId = event.queryStringParameters?.moduleId;
    if (!moduleId) return badRequest('moduleId required');
    const interviews = await listInterviewsForModule(moduleId);
    return ok(interviews);
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
    await updateInterviewGrade(studentUserId, interviewId, gradeNum, String(feedback ?? ''), userId!);

    if (VAPID_PUBLIC_EV && VAPID_PRIVATE_EV) {
      void (async () => {
        try {
          const subs = await getPushSubscriptionsByUserId(studentUserId);
          const payload = JSON.stringify({ title: 'Entrevista calificada', body: `Tu entrevista oral fue calificada: ${gradeNum}%` });
          await Promise.allSettled(subs.map((sub: any) =>
            webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
          ));
        } catch {}
      })();
    }
    return ok({ graded: true });
  }

  return null; // not handled by this domain
}
