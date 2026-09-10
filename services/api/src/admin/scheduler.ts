// ─── scheduler.ts ─────────────────────────────────────────────────────────────
// Lux Scheduler domain handler for lux-admin (Trello *LUX SCHEDULER*, 2026-09-10).
// Teacher availability CRUD, candidate-schedule generation, and approval.
//
// Generation is synchronous (not the async self-invoke job pattern used by the
// AI wizard) — the engine is pure in-memory greedy placement with no Bedrock/
// external calls, so it completes in milliseconds even for dozens of courses;
// wiring up a job+poll cycle here would add failure modes for no real benefit.
import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getAllEnrollments } from '../shared/db-dynamo';
import { sendTemplatedEmail } from '../shared/email';
import { ok, badRequest, forbidden, notFound } from '../shared/response';
import { AdminCtx, isAuthorized, isAdmin, cognito, USER_POOL_ID } from './ctx';
import {
  generateScheduleProposals,
  type CourseInput, type TeacherInput, type CourseModality, type ClassType, type ScheduleProposal,
} from './scheduler-engine';

// Course.modality free-text values (see apps/web .../lux-planner/_components/constants.tsx
// MODALITIES) mapped to the engine's two scheduling lanes. HIBRIDA has no dedicated lane in
// the WBS spec (only "presencial" vs "virtual" are defined) — treated as VIRTUAL, the safer
// assumption since Saturday carries the hard institutional constraint. ASINCRONICA needs no
// live session at all and is filtered out before it ever reaches the engine.
function toEngineModality(courseModality: string | null): CourseModality | null {
  if (courseModality === 'PRESENCIAL') return 'PRESENCIAL';
  if (courseModality === 'ASINCRONICA') return null;
  return 'VIRTUAL'; // SINCRONICA, HIBRIDA, unset
}

async function resolveDisplayName(username: string): Promise<string> {
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    return res.UserAttributes?.find((a: any) => a.Name === 'name')?.Value ?? username;
  } catch { return username; }
}
async function resolveEmail(username: string): Promise<string | null> {
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    return res.UserAttributes?.find((a: any) => a.Name === 'email')?.Value ?? null;
  } catch { return null; }
}

export async function handleScheduler(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body } = ctx;

  // ── GET /admin/teachers/:evaluatorId/availability ───────────────────────────
  const availMatch = path.match(/^\/admin\/teachers\/([^/]+)\/availability$/);
  if (availMatch && method === 'GET') {
    if (!isAuthorized(event)) return forbidden('Se requiere autenticación');
    const evaluatorId = decodeURIComponent(availMatch[1]!);
    const [blocks, workload] = await Promise.all([
      prisma.teacherAvailability.findMany({ where: { evaluatorId }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] }),
      prisma.teacherWorkload.findUnique({ where: { evaluatorId } }),
    ]);
    return ok({ blocks, maxCoursesPerWeek: workload?.maxCoursesPerWeek ?? 5 });
  }

  // ── PUT /admin/teachers/:evaluatorId/availability — full replace ────────────
  if (availMatch && method === 'PUT') {
    if (!isAuthorized(event)) return forbidden('Se requiere autenticación');
    const evaluatorId = decodeURIComponent(availMatch[1]!);
    const callerId = event.requestContext.authorizer?.lambda?.userId;
    if (!isAdmin(event) && callerId !== evaluatorId) return forbidden('Solo podés editar tu propia disponibilidad');
    const { blocks, maxCoursesPerWeek } = body as { blocks?: { dayOfWeek: number; startTime: string; endTime: string }[]; maxCoursesPerWeek?: number };
    if (!Array.isArray(blocks)) return badRequest('blocks es requerido (array)');
    for (const b of blocks) {
      if (typeof b.dayOfWeek !== 'number' || b.dayOfWeek < 0 || b.dayOfWeek > 6) return badRequest('dayOfWeek inválido (0-6)');
      if (!/^\d{2}:\d{2}$/.test(b.startTime) || !/^\d{2}:\d{2}$/.test(b.endTime) || b.startTime >= b.endTime) {
        return badRequest('startTime/endTime inválidos');
      }
    }
    await prisma.$transaction([
      prisma.teacherAvailability.deleteMany({ where: { evaluatorId } }),
      ...(blocks.length ? [prisma.teacherAvailability.createMany({ data: blocks.map((b) => ({ evaluatorId, ...b })) })] : []),
      prisma.teacherWorkload.upsert({
        where: { evaluatorId },
        update: { maxCoursesPerWeek: maxCoursesPerWeek ?? 5 },
        create: { evaluatorId, maxCoursesPerWeek: maxCoursesPerWeek ?? 5 },
      }),
    ]);
    return ok({ updated: true });
  }

  // ── POST /admin/scheduler/generate — synchronous, returns 2-3 candidates ────
  if (path === '/admin/scheduler/generate' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { academicPeriod, courseOverrides } = body as {
      academicPeriod?: string;
      courseOverrides?: Record<string, { classType?: ClassType; modality?: CourseModality }>;
    };
    if (!academicPeriod?.trim()) return badRequest('academicPeriod es requerido');

    const courses = await prisma.course.findMany({
      where: { academicPeriod, evaluatorId: { not: null }, isArchived: false },
      select: { id: true, title: true, evaluatorId: true, modality: true },
    });
    if (!courses.length) return badRequest('No hay cursos con evaluador asignado en ese período académico');

    // One full Enrollments scan, grouped in memory — cheaper than one Scan per course
    // (same lesson as the evaluator/tasks.ts course-wide-assignment fix from today).
    const allEnrollments = await getAllEnrollments();
    const studentsByCourse = new Map<string, string[]>();
    for (const { userId, courseId } of allEnrollments) {
      studentsByCourse.set(courseId, [...(studentsByCourse.get(courseId) ?? []), userId]);
    }

    const evaluatorIds = [...new Set(courses.map((c: any) => c.evaluatorId as string))] as string[];
    const [availabilityRows, workloadRows] = await Promise.all([
      prisma.teacherAvailability.findMany({ where: { evaluatorId: { in: evaluatorIds } } }),
      prisma.teacherWorkload.findMany({ where: { evaluatorId: { in: evaluatorIds } } }),
    ]);
    const workloadByTeacher = new Map(workloadRows.map((w: any) => [w.evaluatorId, w.maxCoursesPerWeek as number]));
    const teachers: TeacherInput[] = evaluatorIds.map((evaluatorId) => ({
      evaluatorId,
      availability: availabilityRows
        .filter((a: any) => a.evaluatorId === evaluatorId)
        .map((a: any) => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
      maxCoursesPerWeek: workloadByTeacher.get(evaluatorId) ?? 5,
    }));

    const courseTitles: Record<string, string> = {};
    const engineCourses: CourseInput[] = [];
    const skippedAsync: string[] = [];
    for (const c of courses as any[]) {
      courseTitles[c.id] = c.title;
      const override = courseOverrides?.[c.id];
      const modality = override?.modality ?? toEngineModality(c.modality);
      if (!modality) { skippedAsync.push(c.id); continue; } // asincrónica — no live session
      const studentIds = studentsByCourse.get(c.id) ?? [];
      const classType: ClassType = override?.classType ?? (studentIds.length > 1 ? 'GRUPAL' : 'INDIVIDUAL');
      engineCourses.push({ courseId: c.id, evaluatorId: c.evaluatorId, modality, classType, studentIds });
    }
    if (!engineCourses.length) return badRequest('Ningún curso de este período requiere clase en vivo (todos son asincrónicos)');

    const teacherNames: Record<string, string> = {};
    await Promise.all(evaluatorIds.map(async (id) => { teacherNames[id] = await resolveDisplayName(id); }));

    const proposals = generateScheduleProposals({ courses: engineCourses, teachers });
    return ok({ proposals, courseTitles, teacherNames, academicPeriod, skippedAsyncCourseIds: skippedAsync });
  }

  // ── POST /admin/scheduler/approve — persist one proposal + notify ───────────
  if (path === '/admin/scheduler/approve' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { academicPeriod, proposal } = body as { academicPeriod?: string; proposal?: ScheduleProposal };
    if (!academicPeriod?.trim()) return badRequest('academicPeriod es requerido');
    if (!proposal?.sessions?.length) return badRequest('proposal.sessions es requerido');

    // Re-approving the same period replaces its previously published schedule —
    // idempotent, matches the "publicar el escenario ideal" one-active-schedule spec.
    await prisma.$transaction([
      prisma.scheduledClass.deleteMany({ where: { academicPeriod } }),
      prisma.scheduledClass.createMany({
        data: proposal.sessions.map((s: typeof proposal.sessions[number]) => ({
          academicPeriod, courseId: s.courseId, evaluatorId: s.evaluatorId,
          dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
          modality: s.modality, classType: s.classType,
          studentGroupId: s.studentGroupId ?? null, studentIds: s.studentIds,
        })),
      }),
    ]);

    // Fan-out email — each recipient gets ONLY their own sessions (explicit "Don't" in the
    // spec: never a full institutional dump). Non-fatal per-recipient, same convention as
    // evaluator/groups.ts enroll.
    const courseTitles = new Map((await prisma.course.findMany({
      where: { id: { in: [...new Set(proposal.sessions.map((s: typeof proposal.sessions[number]) => s.courseId))] } },
      select: { id: true, title: true },
    })).map((c: any) => [c.id, c.title]));
    const DAY_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    const byRecipient = new Map<string, typeof proposal.sessions>();
    for (const s of proposal.sessions) {
      byRecipient.set(s.evaluatorId, [...(byRecipient.get(s.evaluatorId) ?? []), s]);
      for (const sid of s.studentIds) byRecipient.set(sid, [...(byRecipient.get(sid) ?? []), s]);
    }
    await Promise.allSettled([...byRecipient.entries()].map(async ([userId, sessions]) => {
      const email = await resolveEmail(userId);
      if (!email) return;
      const name = await resolveDisplayName(userId);
      const scheduleRows = `<ul>${sessions.map((s: typeof proposal.sessions[number]) =>
        `<li><strong>${courseTitles.get(s.courseId) ?? s.courseId}</strong> — ${DAY_LABEL[s.dayOfWeek]} ${s.startTime}–${s.endTime} (${s.modality === 'PRESENCIAL' ? 'Presencial' : 'Virtual'})</li>`
      ).join('')}</ul>`;
      await sendTemplatedEmail(email, 'SCHEDULE_PUBLISHED', { recipientName: name, academicPeriod, scheduleRows }).catch(() => {});
    }));

    return ok({ published: true, sessionCount: proposal.sessions.length, recipientCount: byRecipient.size });
  }

  // ── DELETE /admin/scheduler/:academicPeriod — unpublish (rollback) ──────────
  const unpublishMatch = path.match(/^\/admin\/scheduler\/([^/]+)$/);
  if (unpublishMatch && method === 'DELETE') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const academicPeriod = decodeURIComponent(unpublishMatch[1]!);
    const { count } = await prisma.scheduledClass.deleteMany({ where: { academicPeriod } });
    if (count === 0) return notFound('No hay horario publicado para ese período');
    return ok({ deleted: count });
  }

  return null; // not handled by this domain
}
