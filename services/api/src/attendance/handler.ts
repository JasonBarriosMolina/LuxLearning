import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createHmac } from 'crypto';
import { getPrismaClient } from '../shared/db-neon';
import {
  recordAttendance, getAttendanceMatrix, getMyAttendance, updateAttendanceRecord,
  getPendingJustifications, getRiskScores, type AttendanceRecord, type AttendanceStatus,
} from '../shared/db-dynamo';
import { createNotification } from '../shared/db-dynamo';
import { ok, created, badRequest, forbidden, notFound, serverError, cors, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin, getCurrentEnv } from '../shared/env-context';
import { createId } from '@paralleldrive/cuid2';

const s3 = new S3Client({ region: 'us-east-1' });
const sqs = new SQSClient({ region: 'us-east-1' });
const S3_BUCKET = process.env.S3_IMAGES_BUCKET ?? 'lux-learning-images';
// FIX #19 (TODO infra): use a dedicated queue to isolate OCR from reflection AI detection
const SQS_URL = process.env.SQS_ATTENDANCE_OCR_QUEUE_URL ?? process.env.SQS_REFLECTION_QUEUE_URL ?? '';
const FRONTEND_URL = process.env.FRONTEND_URL ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? 'lux-qr-dev-secret';

// ── QR token helpers (30-second anti-fraud tokens) ────────────────────────────
function generateQrToken(userId: string, courseId: string): { token: string; expiresAt: string } {
  const exp = Date.now() + 30_000;
  const payload = Buffer.from(JSON.stringify({ userId, courseId, exp })).toString('base64url');
  const sig = createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, expiresAt: new Date(exp).toISOString() };
}

function verifyQrToken(token: string): { userId: string; courseId: string } | null {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) return null;
  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expected = createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  if (expected !== sig) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (data.exp < Date.now()) return null;
  return { userId: data.userId, courseId: data.courseId };
}

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const JUSTIFY_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

function isAdminOrEval(role: string) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'EVALUATOR';
}

function isAdmin(role: string) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

// ── Risk level from absence rate ──────────────────────────────────────────────
function absenceRateToSemaphore(absenceRate: number): 'LOW' | 'MODERATE' | 'HIGH' {
  if (absenceRate < 0.2) return 'LOW';
  if (absenceRate < 0.35) return 'MODERATE';
  return 'HIGH';
}

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const auth = event.requestContext.authorizer?.lambda;
  const userId = auth?.userId ?? '';
  const role = auth?.role ?? 'STUDENT';
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  let body: any = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* ignore */ }

  try {
    const prisma = await getPrismaClient();

    // ── GET /attendance/sessions/:courseId ─────────────────────────────────
    const sessionsMatch = path.match(/^\/attendance\/sessions\/([^/]+)$/);
    if (sessionsMatch && method === 'GET') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const courseId = sessionsMatch[1]!;
      const sessions = await prisma.courseSession.findMany({
        where: { courseId },
        orderBy: { order: 'asc' },
      });
      // Augment each session with attendance summary
      const matrix = await getAttendanceMatrix(courseId);
      const summaries = sessions.map((s) => {
        const records = matrix.filter((r) => r.sessionId === s.id);
        const present = records.filter((r) => r.status === 'PRESENT').length;
        const absent = records.filter((r) => r.status === 'ABSENT' || r.status === 'JUSTIFICATION_PENDING' || r.status === 'REJECTED').length;
        const justified = records.filter((r) => r.status === 'JUSTIFIED').length;
        return { ...s, present, absent, justified, total: records.length };
      });
      return ok(summaries);
    }

    // ── POST /attendance/sessions/:courseId ─────────────────────────────────
    // Evaluator/admin adds an extra (unplanned) session to a course
    if (sessionsMatch && method === 'POST') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const courseId = sessionsMatch[1]!;
      const { sessionDate } = body as { sessionDate?: string };
      if (!sessionDate) return badRequest('sessionDate es requerido');
      const last = await prisma.courseSession.findFirst({
        where: { courseId },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      const session = await prisma.courseSession.create({
        data: {
          courseId,
          sessionDate: new Date(sessionDate + 'T12:00:00'),
          weekIndex: null,
          order: (last?.order ?? 0) + 1,
        },
      });
      return created(session);
    }

    // ── POST /attendance/record ─────────────────────────────────────────────
    // Body: { courseId, sessionId, records: [{ userId, status }] }
    if (path === '/attendance/record' && method === 'POST') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const { courseId, sessionId, records: toRecord } = body as {
        courseId: string;
        sessionId: string;
        records: Array<{ userId: string; status: 'PRESENT' | 'ABSENT' | 'LATE' | 'LATE_JUSTIFIED' | 'JUSTIFIED'; observations?: string }>;
      };
      if (!courseId || !sessionId || !Array.isArray(toRecord)) {
        return badRequest('courseId, sessionId y records son requeridos');
      }
      const session = await prisma.courseSession.findUnique({ where: { id: sessionId } });
      if (!session) return notFound('Sesión no encontrada');

      const VALID_RECORD_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LATE_JUSTIFIED', 'JUSTIFIED'];
      const now = new Date().toISOString();
      for (const r of toRecord) {
        if (!VALID_RECORD_STATUSES.includes(r.status)) continue;
        const sk = `${r.userId}#${sessionId}`;
        const gsiSk = `${sessionId}#${courseId}`;
        // LATE arrivals get the same justification window in case evaluator wants documentation
        const justificationDeadline = (r.status === 'ABSENT' || r.status === 'LATE')
          ? new Date(session.sessionDate.getTime() + JUSTIFY_TTL_MS).toISOString()
          : undefined;
        await recordAttendance({
          courseId, sk, userId: r.userId, sessionId,
          sessionDate: session.sessionDate.toISOString(),
          status: r.status,
          observations: r.observations || undefined,
          justificationDeadline,
          createdAt: now, updatedAt: now,
        });
      }
      return ok({ recorded: toRecord.length });
    }

    // ── GET /attendance/matrix/:courseId ───────────────────────────────────
    const matrixMatch = path.match(/^\/attendance\/matrix\/([^/]+)$/);
    if (matrixMatch && method === 'GET') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const courseId = matrixMatch[1]!;
      const [sessions, records] = await Promise.all([
        prisma.courseSession.findMany({ where: { courseId }, orderBy: { order: 'asc' } }),
        getAttendanceMatrix(courseId),
      ]);
      // Build matrix: { sessions[], studentRows: { userId, records: { [sessionId]: status } }[] }
      const studentMap = new Map<string, Record<string, AttendanceRecord>>();
      for (const rec of records) {
        if (rec.sk === 'RISK_SCORES') continue;
        if (!studentMap.has(rec.userId)) studentMap.set(rec.userId, {});
        studentMap.get(rec.userId)![rec.sessionId] = rec;
      }
      const studentRows = Array.from(studentMap.entries()).map(([uid, sessionMap]) => ({
        userId: uid,
        sessions: sessionMap,
      }));
      return ok({ sessions, studentRows });
    }

    // ── GET /attendance/pending/:courseId ──────────────────────────────────
    const pendingMatch = path.match(/^\/attendance\/pending\/([^/]+)$/);
    if (pendingMatch && method === 'GET') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const courseId = pendingMatch[1]!;
      const pending = await getPendingJustifications(courseId);
      return ok(pending);
    }

    // ── PUT /attendance/review ─────────────────────────────────────────────
    // Body: { courseId, sk, status: 'JUSTIFIED'|'REJECTED', evaluatorFeedback }
    if (path === '/attendance/review' && method === 'PUT') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const { courseId, sk, status, evaluatorFeedback } = body as {
        courseId: string; sk: string; status: 'JUSTIFIED' | 'REJECTED'; evaluatorFeedback?: string;
      };
      if (!courseId || !sk || !status) return badRequest('courseId, sk y status son requeridos');
      if (status !== 'JUSTIFIED' && status !== 'REJECTED') return badRequest('status debe ser JUSTIFIED o REJECTED');

      await updateAttendanceRecord(courseId, sk, { status, evaluatorFeedback });

      // Notify student
      const studentId = sk.split('#')[0]!;
      const emoji = status === 'JUSTIFIED' ? '✅' : '❌';
      await createNotification({
        userId: studentId,
        // FIX #18: createId() avoids timestamp collisions under concurrency
        notifId: `attendance-review-${createId()}`,
        type: 'GENERAL',
        message: `${emoji} Tu justificación de ausencia fue ${status === 'JUSTIFIED' ? 'aprobada' : 'rechazada'}.${evaluatorFeedback ? ` Comentario: ${evaluatorFeedback}` : ''}`,
        read: false,
        createdAt: new Date().toISOString(),
        // FIX #3: /attendance doesn't exist — correct route is /courses/{courseId}/attendance
        actionUrl: `${FRONTEND_URL}/courses/${courseId}/attendance`,
      });
      return ok({ updated: true });
    }

    // ── PUT /attendance/override ────────────────────────────────────────────
    // Admin/Eval bypass of 72h TTL — audit logged
    // FIX #6: Accept optional extraHours (default 168 = 7 days) from override UI modal
    if (path === '/attendance/override' && method === 'PUT') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const { courseId, sk, overrideReason, extraHours } = body as {
        courseId: string; sk: string; overrideReason: string; extraHours?: number;
      };
      if (!courseId || !sk || !overrideReason) return badRequest('courseId, sk y overrideReason son requeridos');
      const hours = Math.min(Math.max(Number(extraHours) || 168, 1), 720); // clamp 1h–30 days
      await updateAttendanceRecord(courseId, sk, {
        justificationDeadline: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
        overriddenBy: userId,
        overrideReason,
      });
      return ok({ overridden: true, extraHours: hours });
    }

    // ── GET /attendance/my/:courseId ───────────────────────────────────────
    const myMatch = path.match(/^\/attendance\/my\/([^/]+)$/);
    if (myMatch && method === 'GET') {
      const courseId = myMatch[1]!;
      const [records, sessions, riskData] = await Promise.all([
        getMyAttendance(userId, courseId),
        prisma.courseSession.findMany({ where: { courseId }, orderBy: { order: 'asc' } }),
        getRiskScores(courseId),
      ]);
      const attendance = records.filter((r) => r.sk !== 'RISK_SCORES');
      const totalSessions = sessions.length;
      const presentCount = attendance.filter((r) => r.status === 'PRESENT' || r.status === 'JUSTIFIED').length;
      const absentCount = attendance.filter((r) => r.status === 'ABSENT' || r.status === 'REJECTED').length;
      const attendanceRate = totalSessions > 0 ? presentCount / totalSessions : 1;
      const semaphore = absenceRateToSemaphore(1 - attendanceRate);
      const myRisk = riskData?.scores.find((s) => s.userId === userId) ?? null;
      return ok({
        totalSessions,
        presentCount,
        absentCount,
        attendanceRate: Math.round(attendanceRate * 100),
        semaphore,
        records: attendance,
        riskLevel: myRisk?.riskLevel ?? null,
      });
    }

    // ── POST /attendance/justify ────────────────────────────────────────────
    // Returns a presigned S3 URL for the student to upload their document
    if (path === '/attendance/justify' && method === 'POST') {
      const { courseId, sk, fileName, fileType } = body as {
        courseId: string; sk: string; fileName: string; fileType: string;
      };
      if (!courseId || !sk || !fileName || !fileType) {
        return badRequest('courseId, sk, fileName y fileType son requeridos');
      }
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(fileType)) {
        return badRequest('Solo se aceptan PDF, JPG o PNG');
      }
      // Verify the record belongs to this user and is within 72h
      const matrix = await getMyAttendance(userId, courseId);
      const record = matrix.find((r) => r.sk === sk);
      if (!record) return notFound('Registro de asistencia no encontrado');
      if (record.status !== 'ABSENT') return badRequest('Solo se pueden justificar ausencias (ABSENT)');
      if (record.justificationDeadline && Date.now() > new Date(record.justificationDeadline).getTime()) {
        return forbidden('El plazo de 72 horas para justificar esta ausencia ha vencido. Contacta a tu evaluador.');
      }
      const ext = fileType === 'application/pdf' ? 'pdf' : fileType === 'image/jpeg' ? 'jpg' : 'png';
      const s3Key = `justifications/${userId}/${courseId}/${sk.replace('#', '_')}_${Date.now()}.${ext}`;
      const cmd = new PutObjectCommand({ Bucket: S3_BUCKET, Key: s3Key, ContentType: fileType });
      const presignedUrl = await getSignedUrl(s3, cmd, { expiresIn: 600 });
      return ok({ presignedUrl, s3Key });
    }

    // ── PUT /attendance/justify/submit ─────────────────────────────────────
    // Called after upload; marks JUSTIFICATION_PENDING and queues OCR
    if (path === '/attendance/justify/submit' && method === 'PUT') {
      const { courseId, sk, documentKey } = body as {
        courseId: string; sk: string; documentKey: string;
      };
      if (!courseId || !sk || !documentKey) {
        return badRequest('courseId, sk y documentKey son requeridos');
      }
      const matrix = await getMyAttendance(userId, courseId);
      const record = matrix.find((r) => r.sk === sk);
      if (!record) return notFound('Registro de asistencia no encontrado');
      if (record.status !== 'ABSENT') return badRequest('Solo se pueden justificar ausencias (ABSENT)');
      if (record.justificationDeadline && Date.now() > new Date(record.justificationDeadline).getTime()) {
        return forbidden('El plazo de 72 horas para justificar esta ausencia ha vencido. Contacta a tu evaluador.');
      }

      await updateAttendanceRecord(courseId, sk, {
        documentKey,
        status: 'JUSTIFICATION_PENDING',
      });

      // Queue OCR analysis
      if (SQS_URL) {
        const sqsBody = {
          type: 'ATTENDANCE_OCR',
          env: getCurrentEnv(),
          courseId,
          sk,
          userId,
          sessionId: record.sessionId,
          sessionDate: record.sessionDate,
          documentKey,
          studentEmail: auth?.email ?? '',
        };
        await sqs.send(new SendMessageCommand({
          QueueUrl: SQS_URL,
          MessageBody: JSON.stringify(sqsBody),
        })).catch((e) => console.error('[attendance] SQS error:', e));
      }

      // Notify evaluator
      const course = await prisma.course.findUnique({ where: { id: courseId }, select: { evaluatorId: true, title: true } });
      if (course?.evaluatorId) {
        await createNotification({
          userId: course.evaluatorId,
          notifId: `justif-${createId()}`,
          type: 'GENERAL',
          message: `📎 Nueva justificación de ausencia pendiente de revisión en "${course.title}"`,
          read: false,
          createdAt: new Date().toISOString(),
          actionUrl: `${FRONTEND_URL}/admin/attendance/${courseId}`,
        });
      }
      return ok({ status: 'JUSTIFICATION_PENDING' });
    }

    // ── GET /attendance/risk/:courseId ─────────────────────────────────────
    const riskMatch = path.match(/^\/attendance\/risk\/([^/]+)$/);
    if (riskMatch && method === 'GET') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const courseId = riskMatch[1]!;
      const data = await getRiskScores(courseId);
      return ok(data ?? { scores: [], cohortInsight: null });
    }

    // ── GET /attendance/qr-token ────────────────────────────────────────────
    // Student generates a short-lived signed token to show as QR code
    if (path === '/attendance/qr-token' && method === 'GET') {
      const courseId = event.queryStringParameters?.courseId ?? '';
      if (!courseId) return badRequest('courseId es requerido');
      return ok(generateQrToken(userId, courseId));
    }

    // ── POST /attendance/qr-record ──────────────────────────────────────────
    // Evaluator scans student QR → records PRESENT directly
    if (path === '/attendance/qr-record' && method === 'POST') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const { token, sessionId, courseId: bodyCourseId } = body as { token: string; sessionId: string; courseId: string };
      if (!token || !sessionId || !bodyCourseId) return badRequest('token, sessionId y courseId son requeridos');
      const tokenData = verifyQrToken(token);
      if (!tokenData) return badRequest('Token QR inválido o expirado');
      if (tokenData.courseId !== bodyCourseId) return badRequest('El token no corresponde a este curso');
      const session = await prisma.courseSession.findUnique({ where: { id: sessionId } });
      if (!session) return notFound('Sesión no encontrada');
      const sk = `${tokenData.userId}#${sessionId}`;
      const now = new Date().toISOString();
      await recordAttendance({
        courseId: bodyCourseId, sk, userId: tokenData.userId, sessionId,
        sessionDate: session.sessionDate.toISOString(),
        status: 'PRESENT',
        createdAt: now, updatedAt: now,
      });
      return ok({ userId: tokenData.userId, recorded: true });
    }

    // ── GET /attendance/admin/overview ──────────────────────────────────────
    // Admin-only global attendance metrics across all active courses
    if (path === '/attendance/admin/overview' && method === 'GET') {
      if (!isAdmin(role)) return forbidden('Se requiere rol de admin o super_admin');
      const courses = await prisma.course.findMany({
        where: { isActive: true, isDraft: false },
        select: { id: true, title: true },
      });
      const summaries = await Promise.all(courses.map(async (c) => {
        const riskData = await getRiskScores(c.id);
        const scores = riskData?.scores ?? [];
        const high = scores.filter((s: any) => s.riskLevel === 'HIGH').length;
        const moderate = scores.filter((s: any) => s.riskLevel === 'MODERATE').length;
        const rates = scores.map((s: any) => 100 - (s.absenceRate ?? 0));
        const avgRate = rates.length > 0 ? Math.round(rates.reduce((a: number, b: number) => a + b, 0) / rates.length) : 100;
        return { courseId: c.id, courseTitle: c.title, attendanceRate: avgRate, studentsHigh: high, studentsModerate: moderate, totalStudents: scores.length };
      }));
      const globalRate = summaries.length > 0
        ? Math.round(summaries.reduce((s, c) => s + c.attendanceRate, 0) / summaries.length)
        : 100;
      return ok({
        totalCourses: courses.length,
        globalAttendanceRate: globalRate,
        studentsAtRisk: summaries.reduce((s, c) => s + c.studentsHigh, 0),
        studentsWarning: summaries.reduce((s, c) => s + c.studentsModerate, 0),
        coursesSummary: summaries.sort((a, b) => a.attendanceRate - b.attendanceRate),
      });
    }

    // ── GET /attendance/export/:courseId ────────────────────────────────────
    // Returns full attendance matrix as CSV (JSON-wrapped for CORS compatibility)
    const exportMatch = path.match(/^\/attendance\/export\/([^/]+)$/);
    if (exportMatch && method === 'GET') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const courseId = exportMatch[1]!;
      const [sessions, records] = await Promise.all([
        prisma.courseSession.findMany({ where: { courseId }, orderBy: { order: 'asc' } }),
        getAttendanceMatrix(courseId),
      ]);
      const sessionMap = Object.fromEntries(sessions.map((s) => [s.id, s]));
      const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['Fecha', 'Sesión', 'UserId', 'Estado', 'Actualizado', 'Reemplazado por', 'Motivo override', 'Documento', 'Recomendación IA']
        .map(escape).join(',');
      const rows = records
        .filter((r) => r.sk !== 'RISK_SCORES')
        .map((r) => {
          const s = sessionMap[r.sessionId] as any;
          return [
            r.sessionDate ? new Date(r.sessionDate).toLocaleDateString('es-CR') : '',
            s?.order ?? '',
            r.userId,
            r.status,
            r.updatedAt ?? '',
            r.overriddenBy ?? '',
            r.overrideReason ?? '',
            r.documentKey ?? '',
            (r as any).aiOcrData?.aiRecommendation ?? '',
          ].map(escape).join(',');
        });
      const csvContent = [header, ...rows].join('\n');
      return ok({ csvContent, filename: `asistencia-${courseId}.csv` });
    }

    return badRequest('Ruta no encontrada');
  } catch (err) {
    return serverError(err);
  }
};
