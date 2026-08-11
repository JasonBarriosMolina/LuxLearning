// Courses and modules domain handler for lux-admin.
// Lesson/question CRUD and AI generation are in courses-content.ts.
import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getAiJob, createNotification } from '../shared/db-dynamo';
import { batchTranslate, invalidateTranslation } from '../shared/translate';
import { sendTemplatedEmail } from '../shared/email';
import { upsertChat } from '../shared/db-messages';
import { ok, created, badRequest, forbidden, notFound } from '../shared/response';
import {
  AdminCtx, isAuthorized, isAdmin, getCallerName,
  USER_POOL_ID, cognito, generateLessonAudio,
} from './ctx';
import { handleCoursesContent } from './courses-content';

export async function handleCourses(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, prisma, body, action } = ctx;

  // ── Async audio generation workers (self-invoked via Lambda Event) ──────────
  if (action === 'bulk-audio') {
    const { lessonIds, voiceId = 'Mia' } = body as any;
    const lessons = await prisma.lesson.findMany({ where: { id: { in: lessonIds } } });
    await Promise.allSettled(lessons.map(async (lesson: any) => {
      const text = [lesson.title, lesson.content ?? '', ...(lesson.points ?? []), lesson.tip ?? ''].join('. ');
      const audioUrl = await generateLessonAudio(lesson.id, text, voiceId);
      if (audioUrl) await prisma.lesson.update({ where: { id: lesson.id }, data: { audioUrl } });
    }));
    return ok({ generated: lessonIds.length });
  }

  if (action === 'single-audio') {
    const { lessonId, voiceId = 'Mia' } = body as any;
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (lesson) {
      const text = [lesson.title, lesson.content ?? '', ...(lesson.points ?? []), lesson.tip ?? ''].join('. ');
      const audioUrl = await generateLessonAudio(lesson.id, text, voiceId);
      if (audioUrl) await prisma.lesson.update({ where: { id: lesson.id }, data: { audioUrl } });
    }
    return ok({ generated: 1 });
  }

  // ── GET /admin/courses ──────────────────────────────────────────────────────
  if (path === '/admin/courses' && method === 'GET') {
    const statusFilter = event.queryStringParameters?.status;
    const rawLang = event.queryStringParameters?.lang ?? 'es';
    const lang = ['en', 'es'].includes(rawLang) ? rawLang : 'es';
    let whereClause: Record<string, any> = {};
    if (statusFilter === 'draft') {
      whereClause = { isDraft: true, isArchived: false };
    } else if (statusFilter === 'archived') {
      whereClause = { isArchived: true };
    } else if (statusFilter === 'active') {
      whereClause = { isDraft: false, isArchived: false };
    } else {
      whereClause = { isArchived: false };
    }
    const courses = await prisma.course.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        modules: {
          orderBy: { order: 'asc' },
          select: {
            id: true, order: true, title: true, duration: true, passingScore: true,
            _count: { select: { lessons: true, questions: true } },
            lessons: { select: { type: true, content: true } },
          },
        },
      },
    });
    let coursesWithLegacy: any[] = courses.map((c: any) => {
      const isLegacy = c.modules.length > 0 &&
        c.modules.every((m: any) => (m.lessons as any[]).every((l: any) => l.type === 'video' && !l.content));
      return { ...c, isLegacy };
    });
    if (lang !== 'es' && coursesWithLegacy.length > 0) {
      const translations = await batchTranslate(
        coursesWithLegacy.map((c: any) => ({ type: 'course' as const, id: c.id, fields: { title: c.title, description: c.description } })),
        lang
      );
      coursesWithLegacy = coursesWithLegacy.map((c: any) => {
        const t = translations.get(`course#${c.id}`);
        return t ? { ...c, title: (t.title as string) ?? c.title, description: (t.description as string) ?? c.description } : c;
      });
    }
    return ok(coursesWithLegacy);
  }

  // ── POST /admin/courses ─────────────────────────────────────────────────────
  if (path === '/admin/courses' && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const { title, slug, description, imageUrl, isActive, isPilot, tags, startDate, closeDate } = body;
    if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
    const callerName = await getCallerName(event);
    const course = await prisma.course.create({
      data: {
        title, slug, description,
        imageUrl: imageUrl || null,
        isActive: isActive ?? false,
        isPilot: isPilot ?? false,
        isDraft: true,
        tags: Array.isArray(tags) ? tags : [],
        startDate: startDate ? new Date(startDate) : null,
        closeDate: closeDate ? new Date(closeDate) : null,
        createdByName: callerName,
      },
    });
    await upsertChat(`group_${course.id}`, {
      type: 'GROUP',
      name: `Curso: ${course.title}`,
      participants: [],
    }).catch(() => {});
    return created(course);
  }

  // ── GET /admin/courses/ai-job — poll async job status ──────────────────────
  if (path === '/admin/courses/ai-job' && method === 'GET') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
    const jobId = event.queryStringParameters?.jobId;
    if (!jobId) return badRequest('jobId es requerido');
    const job = await getAiJob(jobId);
    if (!job) return notFound('Job no encontrado');
    return ok(job);
  }

  // ── GET /admin/courses/:courseId/validate-videos ────────────────────────────
  const validateVideosMatch = path.match(/^\/admin\/courses\/([^/]+)\/validate-videos$/);
  if (validateVideosMatch && method === 'GET') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
    const courseId = validateVideosMatch[1]!;
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: { modules: { include: { lessons: { select: { id: true, title: true, youtubeId: true, order: true, moduleId: true } } } } },
    });
    if (!course) return notFound('Curso no encontrado');

    const allLessons = course.modules.flatMap((m: any) =>
      m.lessons.filter((l: any) => l.youtubeId && l.youtubeId.trim())
    );

    const results = await Promise.allSettled(
      allLessons.map(async (l: any) => {
        try {
          const res = await fetch(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${l.youtubeId}&format=json`,
            { signal: AbortSignal.timeout(5000) }
          );
          return { lessonId: l.id, title: l.title, youtubeId: l.youtubeId, ok: res.ok, status: res.status };
        } catch {
          return { lessonId: l.id, title: l.title, youtubeId: l.youtubeId, ok: false, status: 0 };
        }
      })
    );

    const videos = results.map((r: any) => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
    return ok({ videos, broken: videos.filter((v: any) => !v!.ok).length, total: videos.length });
  }

  // ── PUT /admin/courses/:courseId/evaluator ──────────────────────────────────
  const courseEvaluatorMatch = path.match(/^\/admin\/courses\/([^/]+)\/evaluator$/);
  if (courseEvaluatorMatch && method === 'PUT') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const courseId = courseEvaluatorMatch[1]!;
    const { evaluatorId, evaluatorName } = body as { evaluatorId?: string; evaluatorName?: string };
    if (!evaluatorId) return badRequest('evaluatorId es requerido');
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { evaluatorId, evaluatorName: evaluatorName ?? null },
    });

    // Notify evaluator of assignment (non-fatal)
    try {
      const frontendUrl = process.env.FRONTEND_URL ?? '';
      await createNotification({
        userId: evaluatorId,
        notifId: `course-assigned-${Date.now()}`,
        type: 'GENERAL',
        message: `🎓 Se te asignó el curso "${updated.title}" como evaluador`,
        read: false,
        createdAt: new Date().toISOString(),
        actionUrl: `${frontendUrl}/evaluator/my-courses`,
      });
      const cognitoUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: evaluatorId })).catch(() => null);
      const evEmail = cognitoUser?.UserAttributes?.find((a: any) => a.Name === 'email')?.Value;
      if (evEmail) {
        sendTemplatedEmail(evEmail, 'COURSE_ASSIGNED', {
          evaluatorName: evaluatorName ?? evaluatorId,
          courseTitle: updated.title,
        }).catch(() => {});
      }
    } catch { /* non-fatal */ }

    return ok(updated);
  }

  // ── PUT /admin/courses/:courseId/publish ────────────────────────────────────
  const coursePublishMatch = path.match(/^\/admin\/courses\/([^/]+)\/publish$/);
  if (coursePublishMatch && method === 'PUT') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const courseId = coursePublishMatch[1]!;
    const course = await prisma.course.update({ where: { id: courseId }, data: { isDraft: false } });
    return ok(course);
  }

  // ── PUT /admin/courses/:courseId/archive ────────────────────────────────────
  const courseArchiveMatch = path.match(/^\/admin\/courses\/([^/]+)\/archive$/);
  if (courseArchiveMatch && method === 'PUT') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const courseId = courseArchiveMatch[1]!;
    const course = await prisma.course.update({ where: { id: courseId }, data: { isArchived: true, isActive: false } });
    return ok(course);
  }

  // ── PUT /admin/courses/:courseId/restore ────────────────────────────────────
  const courseRestoreMatch = path.match(/^\/admin\/courses\/([^/]+)\/restore$/);
  if (courseRestoreMatch && method === 'PUT') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const courseId = courseRestoreMatch[1]!;
    const course = await prisma.course.update({ where: { id: courseId }, data: { isArchived: false } });
    return ok(course);
  }

  // ── /admin/courses/:courseId ────────────────────────────────────────────────
  const courseMatch = path.match(/^\/admin\/courses\/([^/]+)$/);
  if (courseMatch) {
    const courseId = courseMatch[1]!;

    if (method === 'GET') {
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: {
          modules: {
            orderBy: { order: 'asc' },
            include: {
              lessons: { orderBy: { order: 'asc' } },
              questions: { orderBy: { order: 'asc' } },
            },
          },
        },
      });
      if (!course) return notFound('Curso no encontrado');
      return ok(course);
    }

    if (method === 'PUT') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const { title, slug, description, imageUrl, isActive, isPilot, tags, startDate, closeDate, isDraft, isArchived } = body;
      if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
      const course = await prisma.course.update({
        where: { id: courseId },
        data: {
          title, slug, description,
          imageUrl: imageUrl || null,
          isActive, isPilot,
          ...(isDraft !== undefined ? { isDraft } : {}),
          ...(isArchived !== undefined ? { isArchived } : {}),
          tags: Array.isArray(tags) ? tags : [],
          startDate: startDate ? new Date(startDate) : null,
          closeDate: closeDate ? new Date(closeDate) : null,
        },
      });
      await invalidateTranslation('course', courseId);
      return ok(course);
    }

    if (method === 'DELETE') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      await prisma.course.delete({ where: { id: courseId } });
      return ok({ deleted: true });
    }
  }

  // ── POST /admin/courses/:courseId/modules ───────────────────────────────────
  const courseModulesMatch = path.match(/^\/admin\/courses\/([^/]+)\/modules$/);
  if (courseModulesMatch && method === 'POST') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const courseId = courseModulesMatch[1]!;
    const { title, description, duration, passingScore, order } = body;
    if (!title || !description || !duration || passingScore == null) {
      return badRequest('title, description, duration y passingScore son requeridos');
    }
    let moduleOrder = order;
    if (moduleOrder == null) {
      const count = await prisma.module.count({ where: { courseId } });
      moduleOrder = count + 1;
    }
    const mod = await prisma.module.create({
      data: { courseId, title, description, duration, passingScore: Number(passingScore), order: moduleOrder },
    });
    return created(mod);
  }

  // ── /admin/modules/:moduleId ────────────────────────────────────────────────
  const moduleMatch = path.match(/^\/admin\/modules\/([^/]+)$/);
  if (moduleMatch) {
    const moduleId = moduleMatch[1]!;

    if (method === 'PUT') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const { title, description, duration, passingScore, order } = body;
      if (!title || !description || !duration || passingScore == null) {
        return badRequest('title, description, duration y passingScore son requeridos');
      }
      const mod = await prisma.module.update({
        where: { id: moduleId },
        data: { title, description, duration, passingScore: Number(passingScore), order: Number(order) },
      });
      await invalidateTranslation('module', moduleId);
      return ok(mod);
    }

    if (method === 'DELETE') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      await prisma.module.delete({ where: { id: moduleId } });
      return ok({ deleted: true });
    }
  }

  // Delegate lesson, question, and AI generation routes to courses-content handler
  return handleCoursesContent(ctx);
}
