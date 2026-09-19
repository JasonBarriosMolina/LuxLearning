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
import { buildScheduleDocx } from './scheduler-docx';

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

// Trello *LUX SCHEDULER*, 2026-09-10 (Mack): "me indica que el nombre de ciertos
// evaluadores es un código en lugar del nombre" — falling straight to the raw
// Cognito username/sub when the `name` attribute is unset shows exactly that
// "código". Try email first, only fall back to the username as a last resort.
function bestDisplayName(username: string, attrs: { Name?: string; Value?: string }[]): string {
  const name = attrs.find((a) => a.Name === 'name')?.Value;
  if (name) return name;
  const email = attrs.find((a) => a.Name === 'email')?.Value;
  if (email) return email;
  return username;
}

async function resolveDisplayName(username: string): Promise<string> {
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    return bestDisplayName(username, res.UserAttributes ?? []);
  } catch { return username; }
}
// One Cognito call for both fields — used in the approve fan-out where every
// recipient needs name+email together (avoids 2x AdminGetUserCommand per person).
async function resolveContact(username: string): Promise<{ name: string; email: string | null }> {
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    const attrs = res.UserAttributes ?? [];
    return {
      name: bestDisplayName(username, attrs),
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
    select: { id: true, title: true, evaluatorId: true, modality: true, courseType: true, preferredRoomId: true },
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
  const { event, method, path, prisma, body, userId } = ctx;

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
      // Trello *LUX SCHEDULER* (Mack, 2026-09-15, revertido el mismo día):
      // "creo que vamos a eliminar la regla... de que sea a partir de las 6
      // de la tarde específicamente, como una hora exacta. Vamos a hacerlo
      // más general: vamos a hacer que la persona elija. Sin embargo, se
      // hace una mención directa en el perfil, un aviso diciendo que es la
      // hora sugerida." La regla dura de esta misma tarde se quitó — 6pm
      // ahora es solo una sugerencia visual en AvailabilityEditor.tsx, no
      // una validación de backend.
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
    // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "tampoco tengo opción de
    // eliminar estudiantes que estén en los cursos ya" — el catálogo necesita
    // exponer el roster (no solo el conteo) para poder listarlo y quitar.
    const allStudentIds = [...new Set([...studentsByCourse.values()].flat())];
    const studentNames: Record<string, string> = {};
    await Promise.all(allStudentIds.map(async (id) => { studentNames[id] = await resolveDisplayName(id); }));
    return ok({
      courses: courses.map((c) => ({
        id: c.id, title: c.title, evaluatorId: c.evaluatorId, teacherName: teacherNames[c.evaluatorId],
        modality: c.modality, engineModality: toEngineModality(c.modality), courseType: c.courseType,
        preferredRoomId: c.preferredRoomId ?? null,
        studentIds: studentsByCourse.get(c.id) ?? [],
        studentCount: (studentsByCourse.get(c.id) ?? []).length,
      })),
      studentNames,
    });
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
      select: { id: true, title: true, evaluatorId: true, modality: true, courseType: true },
    });
    const teacherName = await resolveDisplayName(evaluatorId);
    return ok({
      id: course.id, title: course.title, evaluatorId: course.evaluatorId, teacherName,
      modality: course.modality, engineModality: toEngineModality(course.modality), courseType: course.courseType, studentIds: [], studentCount: 0,
    });
  }

  // ── POST /admin/scheduler/generate — synchronous, returns 2-3 candidates ────
  if (path === '/admin/scheduler/generate' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const {
      academicPeriod, courseOverrides, lunchBreak, gapMinutes, individualMinutes, groupMinutes,
      presencialDays, virtualDays, institutionalOpen, institutionalClose,
    } = body as {
      academicPeriod?: string;
      courseOverrides?: Record<string, { classType?: ClassType; modality?: CourseModality | 'HIBRIDA'; durationOverrideMin?: number; hybridPresencialIds?: string[]; roomId?: string; preferredDay?: number }>;
      lunchBreak?: { startTime: string; endTime: string };
      gapMinutes?: number;
      individualMinutes?: number;
      groupMinutes?: number;
      // Trello *LUX SCHEDULER*, 2026-09-15 (Mack): "que se puedan elegir los
      // días de la semana que son cursos presenciales [y] virtuales... así
      // funcionaría con cualquier centro educativo."
      presencialDays?: number[];
      virtualDays?: number[];
      institutionalOpen?: string;
      institutionalClose?: string;
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
      const studentIds = studentsByCourse.get(c.id) ?? [];
      // Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "yo quisiera que se
      // respete que ese Ensamble Instrumental se dé siempre en el aula de
      // ensayos... eso bloquearía el uso de ese aula para un horario en
      // específico directamente para ese curso." override.roomId permite
      // cambiarlo solo para esta generación sin tocar el valor persistido.
      const pinnedRoomId = override?.roomId ?? c.preferredRoomId ?? undefined;

      // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "hay cursos que pueden ser
      // híbridos... hay estudiantes virtuales y hay estudiantes presenciales."
      // Un curso híbrido genera DOS sesiones para el mismo courseId — una
      // PRESENCIAL (sábado) con los alumnos marcados, otra VIRTUAL (semana)
      // con el resto — en vez de una sola sesión mixta.
      if (override?.modality === 'HIBRIDA') {
        const presencialIds = override.hybridPresencialIds ?? [];
        const virtualIds = studentIds.filter((id) => !presencialIds.includes(id));
        if (presencialIds.length > 0) {
          engineCourses.push({
            courseId: c.id, evaluatorId: c.evaluatorId, modality: 'PRESENCIAL',
            classType: presencialIds.length > 1 ? 'GRUPAL' : 'INDIVIDUAL',
            studentIds: presencialIds, durationOverrideMin: override.durationOverrideMin, pinnedRoomId,
            courseType: c.courseType ?? undefined,
            preferredDays: override.preferredDay ? [override.preferredDay] : undefined,
          });
        }
        if (virtualIds.length > 0) {
          engineCourses.push({
            courseId: c.id, evaluatorId: c.evaluatorId, modality: 'VIRTUAL',
            classType: virtualIds.length > 1 ? 'GRUPAL' : 'INDIVIDUAL',
            studentIds: virtualIds, durationOverrideMin: override.durationOverrideMin,
          });
        }
        continue;
      }

      const modality = override?.modality ?? toEngineModality(c.modality);
      if (!modality) { skippedAsync.push(c.id); continue; } // asincrónica — no live session
      const classType: ClassType = override?.classType ?? (studentIds.length > 1 ? 'GRUPAL' : 'INDIVIDUAL');
      engineCourses.push({
        courseId: c.id, evaluatorId: c.evaluatorId, modality, classType, studentIds,
        durationOverrideMin: override?.durationOverrideMin,
        pinnedRoomId: modality === 'PRESENCIAL' ? pinnedRoomId : undefined,
        courseType: c.courseType ?? undefined,
        preferredDays: override?.preferredDay ? [override.preferredDay] : undefined,
      });
    }
    if (!engineCourses.length) return badRequest('Ningún curso de este período requiere clase en vivo (todos son asincrónicos)');

    const teacherNames: Record<string, string> = {};
    await Promise.all(evaluatorIds.map(async (id) => { teacherNames[id] = await resolveDisplayName(id); }));

    // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "en un dropdown yo pueda ver
    // los estudiantes matriculados" en el calendario visual del paso 7 — nombres,
    // no IDs crudos de Cognito.
    const studentIds = [...new Set(engineCourses.flatMap((c) => c.studentIds))];
    const studentNames: Record<string, string> = {};
    await Promise.all(studentIds.map(async (id) => { studentNames[id] = await resolveDisplayName(id); }));

    const roomRows = await prisma.classRoom.findMany({ select: { id: true, name: true, preferredName: true, capacity: true, courseTypeTags: true } });
    const rooms = roomRows.map((r: any) => ({ id: r.id, capacity: r.capacity, courseTypeTags: r.courseTypeTags ?? [] }));
    // Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "si el nombre es 'Aula
    // 101', pero se le conoce internamente como 'Salón de ensayos'... que sea
    // visible para el estudiante también y para el evaluador" — el apodo manda
    // en cualquier vista que muestre el nombre del aula.
    const roomNames: Record<string, string> = Object.fromEntries(roomRows.map((r: any) => [r.id, r.preferredName || r.name]));
    const proposals = generateScheduleProposals({
      courses: engineCourses, teachers, lunchBreak, gapMinutes, individualMinutes, groupMinutes, rooms,
      presencialDays, virtualDays, institutionalOpen, institutionalClose,
    });

    // Trello *LUX SCHEDULER* (Mack, 2026-09-18): "que se indique qué profesor
    // es el que tiene problema y tiene que aumentar su disponibilidad."
    const courseToEvaluator = new Map(engineCourses.map((c) => [c.courseId, c.evaluatorId]));
    for (const p of proposals) {
      for (const courseId of p.unscheduledCourseIds) {
        const evaluatorId = courseToEvaluator.get(courseId);
        const name = evaluatorId ? teacherNames[evaluatorId] : undefined;
        if (name) p.unscheduledReasons[courseId] = `Profesor: ${name}. ${p.unscheduledReasons[courseId] ?? ''}`.trim();
      }
    }

    return ok({ proposals, courseTitles, teacherNames, studentNames, roomNames, academicPeriod, skippedAsyncCourseIds: skippedAsync });
  }

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "probar los horarios no significa
  // que deban publicarse; deben aprobarse... las opciones que tengo que tener
  // son: enviar notificación a estudiantes / a evaluadores... el botón de
  // publicar debe existir una vez se confirme, después de enviar las
  // notificaciones." Split the old one-shot approve (DB write + email to
  // everyone at once) into three steps below — approve just stores the
  // candidate (see ScheduleApproval), notify/publish are separate, explicit
  // actions the admin triggers on demand.

  // ── POST /admin/scheduler/approve — store the candidate, no side effects ────
  if (path === '/admin/scheduler/approve' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { academicPeriod, proposal, courseTitles, teacherNames, studentNames, roomNames } = body as {
      academicPeriod?: string; proposal?: ScheduleProposal;
      courseTitles?: Record<string, string>; teacherNames?: Record<string, string>; studentNames?: Record<string, string>; roomNames?: Record<string, string>;
    };
    if (!academicPeriod?.trim()) return badRequest('academicPeriod es requerido');
    if (!proposal?.sessions?.length) return badRequest('proposal.sessions es requerido');

    const proposalJson = { proposal, courseTitles: courseTitles ?? {}, teacherNames: teacherNames ?? {}, studentNames: studentNames ?? {}, roomNames: roomNames ?? {} };
    await prisma.scheduleApproval.upsert({
      where: { academicPeriod },
      update: { proposalJson, status: 'APPROVED', notifiedStudents: false, notifiedEvaluators: false, publishedAt: null },
      create: { academicPeriod, proposalJson },
    });
    return ok({ approved: true });
  }

  // ── GET /admin/scheduler/approval — re-preview an already-approved candidate ─
  if (path === '/admin/scheduler/approval' && method === 'GET') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const academicPeriod = event.queryStringParameters?.academicPeriod;
    if (!academicPeriod?.trim()) return badRequest('academicPeriod es requerido');
    const approval = await prisma.scheduleApproval.findUnique({ where: { academicPeriod } });
    if (!approval) return notFound('No hay un horario aprobado para ese período');
    return ok(approval);
  }

  // ── POST /admin/scheduler/notify — email one audience on demand ─────────────
  if (path === '/admin/scheduler/notify' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { academicPeriod, audience } = body as { academicPeriod?: string; audience?: 'students' | 'evaluators' };
    if (!academicPeriod?.trim()) return badRequest('academicPeriod es requerido');
    if (audience !== 'students' && audience !== 'evaluators') return badRequest("audience debe ser 'students' o 'evaluators'");
    const approval = await prisma.scheduleApproval.findUnique({ where: { academicPeriod } });
    if (!approval) return notFound('Aprobá un horario para este período antes de notificar');

    const { proposal, courseTitles: rawTitles, studentNames: rawStudentNames, roomNames: rawRoomNames } = approval.proposalJson as unknown as {
      proposal: ScheduleProposal; courseTitles: Record<string, string>;
      studentNames: Record<string, string>; roomNames: Record<string, string>;
    };
    const courseTitles = new Map(Object.entries(rawTitles ?? {}));
    const studentNames = new Map(Object.entries(rawStudentNames ?? {}));
    const roomNames = new Map(Object.entries(rawRoomNames ?? {}));
    const byRecipient = new Map<string, ScheduledSession[]>();
    for (const s of proposal.sessions) {
      const ids = audience === 'evaluators' ? [s.evaluatorId] : s.studentIds;
      for (const id of ids) byRecipient.set(id, [...(byRecipient.get(id) ?? []), s]);
    }
    await Promise.allSettled([...byRecipient.entries()].map(async ([userId, sessions]) => {
      const { email, name } = await resolveContact(userId);
      if (!email) return;
      let scheduleRows: string;
      if (audience === 'evaluators') {
        // Table layout: course+schedule+room left, students right
        const rows = sessions.map((s) => {
          const room = s.roomId ? roomNames.get(s.roomId) : null;
          const studentList = s.studentIds.length
            ? `<ul style="margin:0;padding-left:16px;">${s.studentIds.map((sid) => `<li style="font-size:13px;">${studentNames.get(sid) ?? sid}</li>`).join('')}</ul>`
            : '<span style="font-size:12px;color:#6b7280;">Sin estudiantes asignados</span>';
          return `<tr style="vertical-align:top;border-bottom:1px solid #e5e7eb;">
            <td style="padding:10px 16px 10px 0;width:55%;">
              <strong style="font-size:14px;">${courseTitles.get(s.courseId) ?? s.courseId}</strong><br>
              <span style="color:#374151;font-size:13px;">${DAY_LABEL[s.dayOfWeek]} ${s.startTime}–${s.endTime}</span><br>
              <span style="color:#6b7280;font-size:12px;">${s.modality === 'PRESENCIAL' ? 'Presencial' : 'Virtual'}${room ? ` · ${room}` : ''}</span>
            </td>
            <td style="padding:10px 0;">${studentList}</td>
          </tr>`;
        }).join('');
        scheduleRows = `<table style="width:100%;border-collapse:collapse;margin-top:8px;">
          <thead><tr style="border-bottom:2px solid #6366f1;">
            <th style="text-align:left;padding:8px 16px 8px 0;font-size:12px;color:#6366f1;text-transform:uppercase;letter-spacing:.05em;">Curso / Horario / Aula</th>
            <th style="text-align:left;padding:8px 0;font-size:12px;color:#6366f1;text-transform:uppercase;letter-spacing:.05em;">Estudiantes</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      } else {
        scheduleRows = `<ul>${sessions.map((s) => {
          const room = s.roomId ? roomNames.get(s.roomId) : null;
          return `<li><strong>${courseTitles.get(s.courseId) ?? s.courseId}</strong> — ${DAY_LABEL[s.dayOfWeek]} ${s.startTime}–${s.endTime} (${s.modality === 'PRESENCIAL' ? 'Presencial' : 'Virtual'}${room ? `, ${room}` : ''})</li>`;
        }).join('')}</ul>`;
      }
      await sendTemplatedEmail(email, 'SCHEDULE_PUBLISHED', { recipientName: name, academicPeriod, scheduleRows }).catch(() => {});
    }));

    await prisma.scheduleApproval.update({
      where: { academicPeriod },
      data: audience === 'evaluators' ? { notifiedEvaluators: true } : { notifiedStudents: true },
    });
    return ok({ notified: true, audience, recipientCount: byRecipient.size });
  }

  // ── POST /admin/scheduler/publish — final lock-in, writes the real rows ─────
  if (path === '/admin/scheduler/publish' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { academicPeriod } = body as { academicPeriod?: string };
    if (!academicPeriod?.trim()) return badRequest('academicPeriod es requerido');
    const approval = await prisma.scheduleApproval.findUnique({ where: { academicPeriod } });
    if (!approval) return notFound('Aprobá un horario para este período antes de publicar');
    if (!approval.notifiedStudents && !approval.notifiedEvaluators) {
      return badRequest('Enviá al menos una notificación (estudiantes o evaluadores) antes de publicar');
    }
    const { proposal } = approval.proposalJson as unknown as { proposal: ScheduleProposal };

    // Re-publishing the same period replaces its previously published schedule —
    // idempotent, matches the "publicar el escenario ideal" one-active-schedule spec.
    await prisma.$transaction([
      prisma.scheduledClass.deleteMany({ where: { academicPeriod } }),
      prisma.scheduledClass.createMany({
        data: proposal.sessions.map((s) => ({
          academicPeriod, courseId: s.courseId, evaluatorId: s.evaluatorId,
          dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
          modality: s.modality, classType: s.classType,
          studentGroupId: s.studentGroupId ?? null, studentIds: s.studentIds,
          roomId: s.roomId ?? null,
        })),
      }),
      prisma.scheduleApproval.update({ where: { academicPeriod }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    return ok({ published: true, sessionCount: proposal.sessions.length });
  }

  // ── POST /admin/scheduler/validate — Paso 7 manual-edit conflict re-check ───
  if (path === '/admin/scheduler/validate' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { sessions, lunchBreak, checkWorkload, presencialDays, institutionalOpen, institutionalClose } = body as {
      sessions?: ScheduledSession[]; lunchBreak?: { startTime: string; endTime: string }; checkWorkload?: boolean;
      presencialDays?: number[]; institutionalOpen?: string; institutionalClose?: string;
    };
    if (!Array.isArray(sessions)) return badRequest('sessions es requerido (array)');
    let teachers: TeacherInput[] | undefined;
    if (checkWorkload) {
      const evaluatorIds = [...new Set(sessions.map((s) => s.evaluatorId))];
      const workloadRows = await prisma.teacherWorkload.findMany({ where: { evaluatorId: { in: evaluatorIds } } });
      const capByTeacher = new Map(workloadRows.map((w: any) => [w.evaluatorId, w.maxCoursesPerWeek as number]));
      teachers = evaluatorIds.map((evaluatorId) => ({ evaluatorId, availability: [], maxCoursesPerWeek: capByTeacher.get(evaluatorId) ?? 5 }));
    }
    return ok({ conflicts: findConflicts({ sessions, lunchBreak, teachers, presencialDays, institutionalOpen, institutionalClose }) });
  }

  // ── GET /admin/scheduler/export — Paso 8, Word doc of the published schedule ─
  // Trello *LUX SCHEDULER* (Mack, 2026-09-10): "en lugar de exportar a un CSV
  // plano... exportes más bien un documento editable de Word, como en Lux
  // Planner" — ver admin/scheduler-docx.ts para el generador.
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
    const generatedByName = await resolveDisplayName(userId);

    const docxRows = classes.map((c: any) => ({
      dayOfWeek: c.dayOfWeek,
      startTime: c.startTime, endTime: c.endTime,
      courseTitle: courseTitles.get(c.courseId) ?? c.courseId,
      teacherName: teacherNames[c.evaluatorId] ?? c.evaluatorId,
      modality: c.modality === 'PRESENCIAL' ? 'Presencial' : 'Virtual',
      classType: c.classType === 'GRUPAL' ? 'Grupal' : 'Individual',
      studentCount: c.studentIds.length,
    }));
    const buffer = await buildScheduleDocx({ academicPeriod, generatedByName, rows: docxRows });

    const key = `schedules/${academicPeriod.replace(/[^\w-]/g, '_')}-${Date.now()}.docx`;
    const fileName = `Horario_${academicPeriod}.docx`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_IMAGES_BUCKET, Key: key, Body: buffer,
      ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ContentDisposition: buildContentDisposition(fileName),
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
    // Limpia también el candidato aprobado — "volver a editar" empieza de cero,
    // no arrastra notificaciones ya marcadas como enviadas de la versión anterior.
    await prisma.scheduleApproval.deleteMany({ where: { academicPeriod } }).catch(() => {});
    return ok({ deleted: count });
  }

  return null; // not handled by this domain
}
