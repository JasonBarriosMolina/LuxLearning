import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getPrismaClient } from '../shared/db-neon';
import {
  getAllReflections, getAllLessonProgress, getAllQuizAttempts, getAllEnrollments,
  getReportAnalysis, getRecommendations, saveRecommendations,
} from '../shared/db-dynamo';
import { ok, badRequest, forbidden, serverError, cors, setRequestOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';
import { createId } from '@paralleldrive/cuid2';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.academy';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://luxlearning.academy';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const nameCache = new Map<string, string>();
async function resolveName(userId: string): Promise<string> {
  if (nameCache.has(userId)) return nameCache.get(userId)!;
  if (userId.includes('@')) { nameCache.set(userId, userId.split('@')[0]); return nameCache.get(userId)!; }
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const name = res.UserAttributes?.find((a) => a.Name === 'name')?.Value
      ?? res.UserAttributes?.find((a) => a.Name === 'email')?.Value
      ?? userId;
    nameCache.set(userId, name);
    return name;
  } catch { return userId; }
}

async function resolveEmail(userId: string): Promise<string> {
  if (userId.includes('@')) return userId;
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    return res.UserAttributes?.find((a) => a.Name === 'email')?.Value ?? '';
  } catch { return ''; }
}

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const auth = event.requestContext.authorizer?.lambda;
  if (auth?.role !== 'EVALUATOR' && auth?.role !== 'ADMIN') return forbidden('Se requiere rol de evaluador o administrador');

  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const prisma = await getPrismaClient();

  try {
    // ── GET /reports — filtered report data ─────────────────────────────────
    if (method === 'GET' && path === '/reports') {
      const qs = event.queryStringParameters ?? {};
      const mode = (qs.mode ?? 'master') as 'master' | 'student' | 'course';
      const filterStudentId = qs.studentId;
      const filterCourseId = qs.courseId;

      const [allReflections, allProgress, allAttempts, allEnrollments, courses] = await Promise.all([
        getAllReflections(),
        getAllLessonProgress(),
        getAllQuizAttempts(),
        getAllEnrollments(),
        prisma.course.findMany({
          include: {
            modules: {
              orderBy: { order: 'asc' },
              include: { lessons: { select: { id: true } }, questions: { orderBy: { order: 'asc' }, select: { id: true, text: true, options: true, correctIndex: true } } },
            },
          },
        }),
      ]);

      // Determine which studentIds and courseIds are in scope
      let scopedStudentIds: Set<string> | null = null;
      let scopedCourseIds: Set<string> | null = null;

      if (mode === 'student' && filterStudentId) {
        scopedStudentIds = new Set([filterStudentId]);
        if (filterCourseId) {
          // Sub-filtro: solo ese curso específico
          scopedCourseIds = new Set([filterCourseId]);
        } else {
          // Todos los cursos del estudiante
          const enrolled = allEnrollments.filter((e) => e.userId === filterStudentId).map((e) => e.courseId);
          scopedCourseIds = new Set(enrolled);
        }
      } else if (mode === 'course' && filterCourseId) {
        scopedCourseIds = new Set([filterCourseId]);
        const enrolled = allEnrollments.filter((e) => e.courseId === filterCourseId).map((e) => e.userId);
        scopedStudentIds = new Set(enrolled);
      }

      const filterR = (r: { userId: string; moduleId?: string }) => {
        if (scopedStudentIds && !scopedStudentIds.has(r.userId)) return false;
        return true;
      };

      const scopedReflections = allReflections.filter(filterR);
      const scopedProgress = allProgress.filter(filterR);
      const scopedAttempts = allAttempts.filter(filterR);
      const scopedEnrollments = scopedStudentIds
        ? allEnrollments.filter((e) => scopedStudentIds!.has(e.userId))
        : allEnrollments;

      const visibleCourses = scopedCourseIds
        ? courses.filter((c) => scopedCourseIds!.has(c.id))
        : courses;

      // ── Summary ──────────────────────────────────────────────────────────
      const totalReflections = scopedReflections.length;
      const totalApproved = scopedReflections.filter((r) => r.status === 'APPROVED').length;
      const totalRejected = scopedReflections.filter((r) => r.status === 'REJECTED').length;
      const totalPending = scopedReflections.filter((r) => r.status === 'PENDING_EVAL').length;
      const overallApprovalRate = totalReflections > 0 ? Math.round((totalApproved / totalReflections) * 100) : 0;

      const enrolledUserIds = [...new Set(scopedEnrollments.map((e) => e.userId))];
      const totalEnrolled = enrolledUserIds.length;

      const now = Date.now();
      const lastActivityByStudent = new Map<string, number>();
      scopedProgress.forEach((p) => {
        const t = new Date(p.completedAt).getTime();
        if (!lastActivityByStudent.has(p.userId) || t > lastActivityByStudent.get(p.userId)!) lastActivityByStudent.set(p.userId, t);
      });
      scopedReflections.forEach((r) => {
        const t = new Date(r.submittedAt).getTime();
        if (!lastActivityByStudent.has(r.userId) || t > lastActivityByStudent.get(r.userId)!) lastActivityByStudent.set(r.userId, t);
      });

      const activeStudents = enrolledUserIds.filter((uid) => {
        const last = lastActivityByStudent.get(uid);
        return last && (now - last) / 86400000 <= 7;
      }).length;
      // "At risk" = had activity before BUT inactive >7 days (excludes students who never started)
      const atRiskStudents = enrolledUserIds.filter((uid) => {
        const last = lastActivityByStudent.get(uid);
        return last != null && (now - last) / 86400000 > 7;
      }).length;
      // Students who have never had any activity (never started)
      const neverStarted = enrolledUserIds.filter((uid) => !lastActivityByStudent.has(uid)).length;

      const scored = scopedReflections.filter((r) => (r as any).qualityScore != null);
      const avgQuality = scored.length > 0
        ? Math.round(scored.reduce((s, r) => s + ((r as any).qualityScore ?? 0), 0) / scored.length * 10) / 10
        : null;

      // ── Module stats ─────────────────────────────────────────────────────
      const moduleMap = new Map<string, { title: string; courseTitle: string; total: number; approved: number; rejected: number; totalReviewTime: number; reviewedCount: number }>();
      visibleCourses.forEach((c) => c.modules.forEach((m) =>
        moduleMap.set(m.id, { title: m.title, courseTitle: c.title, total: 0, approved: 0, rejected: 0, totalReviewTime: 0, reviewedCount: 0 })
      ));
      scopedReflections.forEach((r) => {
        const e = moduleMap.get(r.moduleId);
        if (!e) return;
        e.total++;
        if (r.status === 'APPROVED') e.approved++;
        if (r.status === 'REJECTED') e.rejected++;
        if ((r.status === 'APPROVED' || r.status === 'REJECTED') && (r as any).reviewedAt && r.submittedAt) {
          const ms = new Date((r as any).reviewedAt).getTime() - new Date(r.submittedAt).getTime();
          if (ms > 0) { e.totalReviewTime += ms; e.reviewedCount++; }
        }
      });
      const moduleStats = Array.from(moduleMap.entries()).map(([moduleId, e]) => ({
        moduleId, title: e.title, courseTitle: e.courseTitle, total: e.total,
        approved: e.approved, rejected: e.rejected,
        approvalRate: e.total > 0 ? Math.round((e.approved / e.total) * 100) : null,
        avgHoursToReview: e.reviewedCount > 0 ? Math.round(e.totalReviewTime / e.reviewedCount / 3600000 * 10) / 10 : null,
      })).filter((m) => m.total > 0);

      // ── Heat map — quiz error rates per question per module ───────────────
      const heatMap = visibleCourses.flatMap((c) => c.modules.map((mod) => {
        const attempts = scopedAttempts.filter((a) => a.moduleId === mod.id);
        if (!attempts.length || !mod.questions.length) return null;
        const questions = mod.questions.map((q, i) => {
          const total = attempts.filter((a) => Array.isArray(a.answers) && a.answers.length > i).length;
          const errors = attempts.filter((a) => Array.isArray(a.answers) && a.answers.length > i && a.answers[i] !== q.correctIndex).length;
          return {
            index: i,
            text: q.text.slice(0, 80),
            errorRate: total > 0 ? Math.round((errors / total) * 100) : 0,
            totalAttempts: total,
          };
        });
        return { moduleId: mod.id, moduleTitle: mod.title, courseTitle: c.title, questions };
      })).filter(Boolean);

      // ── Student progress integral ─────────────────────────────────────────
      const quizScoreByStudent = new Map<string, number[]>();
      scopedAttempts.filter((a) => a.passed).forEach((a) => {
        if (!quizScoreByStudent.has(a.userId)) quizScoreByStudent.set(a.userId, []);
        quizScoreByStudent.get(a.userId)!.push(a.score ?? 0);
      });

      const reflectionsByStudent = new Map<string, { approved: number; total: number }>();
      scopedReflections.forEach((r) => {
        if (!reflectionsByStudent.has(r.userId)) reflectionsByStudent.set(r.userId, { approved: 0, total: 0 });
        const entry = reflectionsByStudent.get(r.userId)!;
        entry.total++;
        if (r.status === 'APPROVED') entry.approved++;
      });

      const studentProgress = await Promise.all(
        enrolledUserIds.map(async (uid) => {
          const reflData = reflectionsByStudent.get(uid) ?? { approved: 0, total: 0 };
          const scores = quizScoreByStudent.get(uid) ?? [];
          const avgQuizScore = scores.length > 0 ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;
          const reflScore = reflData.total > 0 ? Math.round((reflData.approved / reflData.total) * 100) : 0;
          const integratedScore = Math.round(reflScore * 0.6 + avgQuizScore * 0.4);
          const last = lastActivityByStudent.get(uid);
          return {
            userId: uid,
            studentName: await resolveName(uid),
            reflectionsApproved: reflData.approved,
            reflectionsTotal: reflData.total,
            avgQuizScore,
            integratedScore,
            lastActivity: last ? new Date(last).toISOString() : null,
          };
        })
      );
      studentProgress.sort((a, b) => b.integratedScore - a.integratedScore);
      // Only include students with actual activity (exclude never-started)
      const activeStudentProgress = studentProgress.filter(
        (s) => s.reflectionsTotal > 0 || s.avgQuizScore > 0 || s.lastActivity !== null
      );

      // ── AI Analysis (from nightly job cache) ─────────────────────────────
      const allModuleIds = visibleCourses.flatMap((c) => c.modules.map((m) => m.id));
      const analysisResults = await Promise.allSettled(allModuleIds.map((id) => getReportAnalysis(id)));
      const analysis = analysisResults
        .map((r, i) => r.status === 'fulfilled' && r.value ? {
          moduleId: allModuleIds[i],
          moduleTitle: visibleCourses.flatMap((c) => c.modules).find((m) => m.id === allModuleIds[i])?.title ?? '',
          ...r.value,
        } : null)
        .filter(Boolean);

      // ── Recommendations ───────────────────────────────────────────────────
      const recsResults = await Promise.allSettled(allModuleIds.map((id) => getRecommendations(id)));
      const recommendations = recsResults
        .map((r, i) => ({
          moduleId: allModuleIds[i],
          moduleTitle: visibleCourses.flatMap((c) => c.modules).find((m) => m.id === allModuleIds[i])?.title ?? '',
          items: r.status === 'fulfilled' ? r.value : [],
        }))
        .filter((rec) => rec.items.length > 0);

      return ok({
        mode, filterStudentId, filterCourseId,
        summary: { totalReflections, totalApproved, totalRejected, totalPending, overallApprovalRate, totalEnrolled, activeStudents, atRiskStudents, neverStarted, avgQuality },
        moduleStats,
        heatMap,
        studentProgress: activeStudentProgress,
        analysis,
        recommendations,
      });
    }

    // ── POST /reports/email — send report via SES ─────────────────────────
    if (method === 'POST' && path === '/reports/email') {
      const body = JSON.parse(event.body ?? '{}');
      const { to, subject, htmlBody } = body as { to?: string; subject?: string; htmlBody?: string };
      if (!to || !subject || !htmlBody) return badRequest('to, subject y htmlBody son requeridos');

      const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:800px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Reporte de análisis pedagógico</p>
    </div>
    <div style="padding:40px;">
      ${htmlBody}
      <hr style="border:none;border-top:1px solid #eee;margin:32px 0;">
      <p style="color:#aaa;font-size:12px;">
        Ver reporte completo en <a href="${FRONTEND_URL}/admin/reports" style="color:#00B4D8;">${FRONTEND_URL}/admin/reports</a>
      </p>
    </div>
  </div>
</body>
</html>`;

      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: emailHtml, Charset: 'UTF-8' } },
        },
      }));
      return ok({ sent: true });
    }

    // ── GET /reports/recommendations/:moduleId ────────────────────────────
    const recGetMatch = path.match(/^\/reports\/recommendations\/([^/]+)$/);
    if (recGetMatch && method === 'GET') {
      const moduleId = recGetMatch[1]!;
      const items = await getRecommendations(moduleId);
      return ok(items);
    }

    // ── PUT /reports/recommendations/:moduleId ─ evaluator edits ──────────
    const recPutMatch = path.match(/^\/reports\/recommendations\/([^/]+)$/);
    if (recPutMatch && method === 'PUT') {
      const moduleId = recPutMatch[1]!;
      const body = JSON.parse(event.body ?? '{}');
      const { items } = body as { items?: any[] };
      if (!Array.isArray(items)) return badRequest('items array es requerido');
      const sanitized = items.map((item: any) => ({
        id: item.id ?? createId(),
        weakTopic: String(item.weakTopic ?? '').slice(0, 100),
        title: String(item.title ?? '').slice(0, 200),
        type: ['article', 'book', 'video', 'link'].includes(item.type) ? item.type : 'link',
        url: String(item.url ?? '').slice(0, 500),
        description: String(item.description ?? '').slice(0, 500),
        aiGenerated: item.aiGenerated ?? false,
      }));
      await saveRecommendations(moduleId, sanitized);
      return ok({ saved: true });
    }

    return badRequest('Unknown route');
  } catch (err) {
    return serverError(err);
  }
};
