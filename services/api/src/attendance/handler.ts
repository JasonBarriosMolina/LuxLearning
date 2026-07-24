import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getPrismaClient } from '../shared/db-neon';
import {
  recordAttendance, getAttendanceMatrix, getMyAttendance, updateAttendanceRecord,
  getPendingJustifications, getRiskScores, type AttendanceRecord, type AttendanceStatus,
} from '../shared/db-dynamo';
import { createNotification } from '../shared/db-dynamo';
import { ok, badRequest, forbidden, notFound, serverError, cors, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';
import { createId } from '@paralleldrive/cuid2';

const s3 = new S3Client({ region: 'us-east-1' });
const sqs = new SQSClient({ region: 'us-east-1' });
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const S3_BUCKET = process.env.S3_IMAGES_BUCKET ?? 'lux-learning-images';
const SQS_URL = process.env.SQS_REFLECTION_QUEUE_URL ?? '';
const FRONTEND_URL = process.env.FRONTEND_URL ?? '';

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

    // ── POST /attendance/record ─────────────────────────────────────────────
    // Body: { courseId, sessionId, records: [{ userId, status }] }
    if (path === '/attendance/record' && method === 'POST') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const { courseId, sessionId, records: toRecord } = body as {
        courseId: string;
        sessionId: string;
        records: Array<{ userId: string; status: 'PRESENT' | 'ABSENT' }>;
      };
      if (!courseId || !sessionId || !Array.isArray(toRecord)) {
        return badRequest('courseId, sessionId y records son requeridos');
      }
      const session = await prisma.courseSession.findUnique({ where: { id: sessionId } });
      if (!session) return notFound('Sesión no encontrada');

      const now = new Date().toISOString();
      for (const r of toRecord) {
        const sk = `${r.userId}#${sessionId}`;
        const gsiSk = `${sessionId}#${courseId}`;
        const justificationDeadline = r.status === 'ABSENT'
          ? new Date(session.sessionDate.getTime() + JUSTIFY_TTL_MS).toISOString()
          : undefined;
        await recordAttendance({
          courseId, sk, userId: r.userId, sessionId,
          sessionDate: session.sessionDate.toISOString(),
          status: r.status,
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
        notifId: `attendance-review-${Date.now()}`,
        type: 'GENERAL',
        message: `${emoji} Tu justificación de ausencia fue ${status === 'JUSTIFIED' ? 'aprobada' : 'rechazada'}.${evaluatorFeedback ? ` Comentario: ${evaluatorFeedback}` : ''}`,
        read: false,
        createdAt: new Date().toISOString(),
        actionUrl: `${FRONTEND_URL}/attendance`,
      });
      return ok({ updated: true });
    }

    // ── PUT /attendance/override ────────────────────────────────────────────
    // Admin/Eval bypass of 72h TTL — audit logged
    if (path === '/attendance/override' && method === 'PUT') {
      if (!isAdminOrEval(role)) return forbidden('Se requiere rol de evaluador o admin');
      const { courseId, sk, overrideReason } = body as {
        courseId: string; sk: string; overrideReason: string;
      };
      if (!courseId || !sk || !overrideReason) return badRequest('courseId, sk y overrideReason son requeridos');
      await updateAttendanceRecord(courseId, sk, {
        justificationDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // +7 days
        overriddenBy: userId,
        overrideReason,
      });
      return ok({ overridden: true });
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
          notifId: `justif-${Date.now()}`,
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

    return badRequest('Ruta no encontrada');
  } catch (err) {
    return serverError(err);
  }
};
