// ─── scheduler.ts ─────────────────────────────────────────────────────────────
// Lux Scheduler domain handler for lux-admin (Trello *LUX SCHEDULER*, 2026-09-10).
// Teacher availability CRUD, candidate-schedule generation, and approval.
//
// Generation is synchronous (not the async self-invoke job pattern used by the
// AI wizard) — the engine is pure in-memory greedy placement with no Bedrock/
// external calls, so it completes in milliseconds even for dozens of courses;
// wiring up a job+poll cycle here would add failure modes for no real benefit.
import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getAllEnrollments } from '../shared/db-dynamo';
import { sendTemplatedEmail } from '../shared/email';
import { ok, badRequest, forbidden, notFound, buildContentDisposition } from '../shared/response';
import { AdminCtx, isAuthorized, isAdmin, cognito, USER_POOL_ID, s3Client, S3_IMAGES_BUCKET } from './ctx';
import {
  generateScheduleProposals, findConflicts,
  type CourseInput, type TeacherInput, type CourseModality, type ClassType, type ScheduleProposal, type ScheduledSession,
} from './scheduler-engine';

const DAY_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

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
// One Cognito call for both fields — used in the approve fan-out where every
// recipient needs name+email together (avoids 2x AdminGetUserCommand per person).
async function resolveContact(username: string): Promise<{ name: string; email: string | null }> {
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    const attrs = res.UserAttributes ?? [];
    return {
      name: attrs.find((a: any) => a.Name === 'name')?.Value ?? username,
      email: attrs.find((a: any) => a.Name === 'email')?.Value ?? null,
    };
  } catch { return { name: username, email: null }; }
}

// Shared by GET /admin/scheduler/courses (Paso 3 preview, before generating) and
// POST /admin/scheduler/generate (actually runs the engine) — same source data,
// one query path so the wizard's course-catalog step can never drift from what
// generation actually uses.
async function loadCourseCatalog(prisma: any, academicPeriod: string) {
  const courses = await prisma.course.findMany({
    where: { academicPeriod, evaluatorId: { not: null }, isArchived: false },
    select: { id: true, title: true, evaluatorId: true, modality: true },
  });
  // One full Enrollments scan, grouped in memory — cheaper than one Scan per course
  // (same lesson as the evaluator/tasks.ts course-wide-assignment fix from today).
  const allEnrollments = await getAllEnrollments();
  const studentsByCourse = new Map<string, string[]>();
  for (const { userId, courseId } of allEnrollments) {
    studentsByCourse.set(courseId, [...(studentsByCourse.get(courseId) ?? []), userId]);
  }
  return { courses: courses as any[], studentsByCourse };
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

  // ── GET /admin/scheduler/courses — Paso 3 preview, before generating ────────
  if (path === '/admin/scheduler/courses' && method === 'GET') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const academicPeriod = event.queryStringParameters?.academicPeriod;
    if (!academicPeriod?.trim()) return badRequest('academicPeriod es requerido');
    const { courses, studentsByCourse } = await loadCourseCatalog(prisma, academicPeriod);
    const evaluatorIds = [...new Set(courses.map((c) => c.evaluatorId as string))] as string[];
    const teacherNames: Record<string, string> = {};
    await Promise.all(evaluatorIds.map(async (id) => { teacherNames[id] = await resolveDisplayName(id); }));
    return ok(courses.map((c) => ({
      id: c.id, title: c.title, evaluatorId: c.evaluatorId, teacherName: teacherNames[c.evaluatorId],
      modality: c.modality, engineModality: toEngineModality(c.modality),
      studentCount: (studentsByCourse.get(c.id) ?? []).length,
    })));
  }

  // ── POST /admin/scheduler/courses — Paso 3, crea un curso borrador cuando
  // todavía no existe en Lux Learning. Trello *LUX SCHEDULER*, 2026-09-10 (Mack):
  // "los cursos no necesariamente tienen que estar creados ya... si no están
  // los cursos creados, yo pueda ponerles un nombre y crear estos cursos... le
  // pondría el nombre del curso y el evaluador. El horario no debería estar
  // disponible" — un Course real con isDraft:true (mismo campo que ya usa Lux
  // Planner para cursos sin terminar), sin classDays/classSchedule todavía;
  // el propio Lux Scheduler es quien va a resolver ese horario.
  if (path === '/admin/scheduler/courses' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { academicPeriod, title, evaluatorId } = body as { academicPeriod?: string; title?: string; evaluatorId?: string };
    if (!academicPeriod?.trim()) return badRequest('academicPeriod es requerido');
    if (!title?.trim()) return badRequest('title es requerido');
    if (!evaluatorId?.trim()) return badRequest('evaluatorId es requerido');

    const slugBase = title.toLowerCase()
      .normalize('NFD').replace(/[̀-͟]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;

    const course = await prisma.course.create({
      data: {
        title: title.trim(), slug, description: '', evaluatorId, academicPeriod,
        isDraft: true, isActive: false,
      },
      select: { id: true, title: true, evaluatorId: true, modality: true },
    });
    const teacherName = await resolveDisplayName(evaluatorId);
    return ok({
      id: course.id, title: course.title, evaluatorId: course.evaluatorId, teacherName,
      modality: course.modality, engineModality: toEngineModality(course.modality), studentCount: 0,
    });
  }

  // ── POST /admin/scheduler/generate — synchronous, returns 2-3 candidates ────
  if (path === '/admin/scheduler/generate' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { academicPeriod, courseOverrides, lunchBreak, gapMinutes, individualMinutes, groupMinutes } = body as {
      academicPeriod?: string;
      courseOverrides?: Record<string, { classType?: ClassType; modality?: CourseModality }>;
      lunchBreak?: { startTime: string; endTime: string };
      gapMinutes?: number;
      individualMinutes?: number;
      groupMinutes?: number;
    };
    if (!academicPeriod?.trim()) return badRequest('academicPeriod es requerido');

    const { courses, studentsByCourse } = await loadCourseCatalog(prisma, academicPeriod);
    if (!courses.length) return badRequest('No hay cursos con evaluador asignado en ese período académico');

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

    const proposals = generateScheduleProposals({ courses: engineCourses, teachers, lunchBreak, gapMinutes, individualMinutes, groupMinutes });
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

    const byRecipient = new Map<string, typeof proposal.sessions>();
    for (const s of proposal.sessions) {
      byRecipient.set(s.evaluatorId, [...(byRecipient.get(s.evaluatorId) ?? []), s]);
      for (const sid of s.studentIds) byRecipient.set(sid, [...(byRecipient.get(sid) ?? []), s]);
    }
    await Promise.allSettled([...byRecipient.entries()].map(async ([userId, sessions]) => {
      const { email, name } = await resolveContact(userId);
      if (!email) return;
      const scheduleRows = `<ul>${sessions.map((s: typeof proposal.sessions[number]) =>
        `<li><strong>${courseTitles.get(s.courseId) ?? s.courseId}</strong> — ${DAY_LABEL[s.dayOfWeek]} ${s.startTime}–${s.endTime} (${s.modality === 'PRESENCIAL' ? 'Presencial' : 'Virtual'})</li>`
      ).join('')}</ul>`;
      await sendTemplatedEmail(email, 'SCHEDULE_PUBLISHED', { recipientName: name, academicPeriod, scheduleRows }).catch(() => {});
    }));

    return ok({ published: true, sessionCount: proposal.sessions.length, recipientCount: byRecipient.size });
  }

  // ── POST /admin/scheduler/validate — Paso 7 manual-edit conflict re-check ───
  if (path === '/admin/scheduler/validate' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { sessions, lunchBreak, checkWorkload } = body as {
      sessions?: ScheduledSession[]; lunchBreak?: { startTime: string; endTime: string }; checkWorkload?: boolean;
    };
    if (!Array.isArray(sessions)) return badRequest('sessions es requerido (array)');
    let teachers: TeacherInput[] | undefined;
    if (checkWorkload) {
      const evaluatorIds = [...new Set(sessions.map((s) => s.evaluatorId))];
      const workloadRows = await prisma.teacherWorkload.findMany({ where: { evaluatorId: { in: evaluatorIds } } });
      const capByTeacher = new Map(workloadRows.map((w: any) => [w.evaluatorId, w.maxCoursesPerWeek as number]));
      teachers = evaluatorIds.map((evaluatorId) => ({ evaluatorId, availability: [], maxCoursesPerWeek: capByTeacher.get(evaluatorId) ?? 5 }));
    }
    return ok({ conflicts: findConflicts({ sessions, lunchBreak, teachers }) });
  }

  // ── GET /admin/scheduler/export — Paso 8, CSV of the published schedule ─────
  if (path === '/admin/scheduler/export' && method === 'GET') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const academicPeriod = event.queryStringParameters?.academicPeriod;
    if (!academicPeriod?.trim()) return badRequest('academicPeriod es requerido');
    const classes = await prisma.scheduledClass.findMany({
      where: { academicPeriod },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    if (!classes.length) return notFound('No hay horario publicado para ese período');

    const courseTitles = new Map((await prisma.course.findMany({
      where: { id: { in: [...new Set(classes.map((c: any) => c.courseId))] } },
      select: { id: true, title: true },
    })).map((c: any) => [c.id, c.title]));
    const evaluatorIds = [...new Set(classes.map((c: any) => c.evaluatorId as string))] as string[];
    const teacherNames: Record<string, string> = {};
    await Promise.all(evaluatorIds.map(async (id) => { teacherNames[id] = await resolveDisplayName(id); }));

    const header = ['Curso', 'Profesor', 'Día', 'Hora Inicio', 'Hora Fin', 'Modalidad', 'Tipo', 'Estudiantes'];
    const rows = classes.map((c: any) => [
      courseTitles.get(c.courseId) ?? c.courseId,
      teacherNames[c.evaluatorId] ?? c.evaluatorId,
      DAY_LABEL[c.dayOfWeek],
      c.startTime, c.endTime,
      c.modality === 'PRESENCIAL' ? 'Presencial' : 'Virtual',
      c.classType === 'GRUPAL' ? 'Grupal' : 'Individual',
      String(c.studentIds.length),
    ]);
    const csv = '﻿' + [header, ...rows]
      .map((row) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const key = `schedules/${academicPeriod.replace(/[^\w-]/g, '_')}-${Date.now()}.csv`;
    const fileName = `Horario_${academicPeriod}.csv`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_IMAGES_BUCKET, Key: key, Body: Buffer.from(csv, 'utf-8'),
      ContentType: 'text/csv; charset=utf-8', ContentDisposition: buildContentDisposition(fileName),
    }));
    const url = await getSignedUrl(s3Client, new GetObjectCommand({
      Bucket: S3_IMAGES_BUCKET, Key: key, ResponseContentDisposition: buildContentDisposition(fileName),
    }), { expiresIn: 300 });
    return ok({ url, fileName });
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
