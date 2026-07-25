// Reflection review domain handler for lux-evaluator.
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { EvalCtx, bedrock, webpush, VAPID_PUBLIC_EV, VAPID_PRIVATE_EV, resolveStudentContact, resolveStudentName } from './ctx';
import {
  getAllReflections, getReflection, updateReflectionStatus, setReflectionPriority,
  createNotification, getCertificateByUserAndCourse, saveCertificate,
  autoCompleteTasks, getPushSubscriptionsByUserId, getUserLang,
} from '../shared/db-dynamo';
import { sendTemplatedEmail } from '../shared/email';
import { detectAI } from '../reflection/detect-ai';
import { ok, badRequest, notFound, serverError } from '../shared/response';
import { createId } from '@paralleldrive/cuid2';

export async function handleReflections(ctx: EvalCtx): Promise<any | null> {
  const { method, path, prisma, userId, isAdminRole } = ctx;

  // ── GET /evaluator/reflections ──────────────────────────────────────────────
  if (method === 'GET' && path === '/evaluator/reflections') {
    const all = await getAllReflections();
    const reflections = isAdminRole ? all : all.filter((r: any) => r.evaluatorId === userId);

    // Enrich with module and course titles — batch to avoid N+1
    const uniqueModuleIds = [...new Set(reflections.map((r: any) => r.moduleId))];
    const modules = await prisma.module.findMany({
      where: { id: { in: uniqueModuleIds } },
      include: { course: { select: { id: true, title: true } } },
    });
    const moduleMap = new Map(modules.map((m: any) => [m.id, m]));

    const enriched = await Promise.all(
      reflections.map(async (r: any) => {
        const mod = moduleMap.get(r.moduleId) as any;
        const studentName = await resolveStudentName(r.userId, r.studentEmail);
        return {
          ...r,
          moduleTitle: mod?.title ?? 'Unknown',
          courseId: mod?.course.id ?? null,
          courseTitle: mod?.course.title ?? 'Unknown',
          studentName,
        };
      })
    );

    return ok(enriched);
  }

  // ── POST /evaluator/reflections/review ─────────────────────────────────────
  if (method === 'POST' && path === '/evaluator/reflections/review') {
    const { userId: studentId, moduleId, action, feedback, qualityScore } = ctx.body as {
      userId: string;
      moduleId: string;
      action: 'APPROVE' | 'REJECT';
      feedback: string;
      qualityScore?: number;
    };

    if (!studentId || !moduleId || !action || !feedback) {
      return badRequest('userId, moduleId, action and feedback are required');
    }

    if (feedback.trim().length < 20) {
      return badRequest('Feedback must be at least 20 characters');
    }

    const reflection = await getReflection(studentId, moduleId);
    if (!reflection) return notFound('Reflection not found');

    if (reflection.status !== 'PENDING_EVAL') {
      return badRequest(`Cannot review reflection with status: ${reflection.status}`);
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const reviewedAt = new Date().toISOString();

    await updateReflectionStatus(studentId, moduleId, {
      status: newStatus,
      evaluatorFeedback: feedback,
      reviewedAt,
      ...(action === 'APPROVE' && qualityScore != null ? { qualityScore: Math.min(10, Math.max(1, Math.round(qualityScore))) } : {}),
    });

    // Get module info and student lang in parallel
    const [module, studentLang] = await Promise.all([
      prisma.module.findUnique({ where: { id: moduleId }, include: { course: true } }),
      getUserLang(studentId),
    ]);

    const frontendUrl = process.env.FRONTEND_URL ?? '';
    const reflActionUrl = module?.course
      ? `${frontendUrl}/courses/${module.courseId}/modules/${moduleId}/reflection`
      : `${frontendUrl}/dashboard`;

    const notifStrings = studentLang === 'en'
      ? {
          approve: `Your reflection for "${module?.title}" was approved. Next module unlocked!`,
          reject: `Your reflection for "${module?.title}" needs revision.`,
        }
      : {
          approve: `Tu reflexión de "${module?.title}" fue aprobada. ¡Módulo siguiente desbloqueado!`,
          reject: `Tu reflexión de "${module?.title}" necesita revisión.`,
        };

    // Create in-app notification
    await createNotification({
      userId: studentId,
      notifId: createId(),
      type: action === 'APPROVE' ? 'REFLECTION_APPROVED' : 'REFLECTION_REJECTED',
      message: action === 'APPROVE' ? notifStrings.approve : notifStrings.reject,
      read: false,
      createdAt: reviewedAt,
      actionUrl: reflActionUrl,
    });

    // Auto-complete matching tasks on APPROVE (non-fatal)
    if (action === 'APPROVE') {
      autoCompleteTasks(studentId, 'submit_reflection', moduleId).catch(() => {});
    }

    // ── Fire-and-forget push notification to the student ─────────────────────
    void (async () => {
      try {
        if (!VAPID_PUBLIC_EV || !VAPID_PRIVATE_EV) return;
        const studentSubs = await getPushSubscriptionsByUserId(studentId);
        if (!studentSubs.length) return;
        const pushStrings = studentLang === 'en'
          ? {
              title: action === 'APPROVE' ? '✅ Reflection approved' : '✍️ Reflection needs revision',
              body: action === 'APPROVE'
                ? `Your reflection for "${module?.title}" was approved. Next module unlocked!`
                : `Your reflection for "${module?.title}" needs to be rewritten.`,
            }
          : {
              title: action === 'APPROVE' ? '✅ Reflexión aprobada' : '✍️ Reflexión necesita revisión',
              body: action === 'APPROVE'
                ? `Tu reflexión de "${module?.title}" fue aprobada. ¡Siguiente módulo desbloqueado!`
                : `Tu reflexión de "${module?.title}" necesita ser reescrita.`,
            };
        const pushPayload = JSON.stringify({ ...pushStrings, url: '/dashboard' });
        await Promise.allSettled(
          studentSubs.map((sub: any) => webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, pushPayload))
        );
      } catch { /* non-fatal */ }
    })();

    // ── Check if all modules approved → generate certificate ─────────────────
    let certId: string | null = null;
    if (action === 'APPROVE' && module?.course) {
      try {
        const allModules: any[] = await prisma.module.findMany({
          where: { courseId: module.courseId },
          select: { id: true },
        });
        const allReflections = await Promise.all(
          allModules.map((m: any) => getReflection(studentId, m.id))
        );
        const allApproved = allReflections.every((r: any) => r?.status === 'APPROVED');

        if (allApproved) {
          // Check if cert already exists
          const existing = await getCertificateByUserAndCourse(studentId, module.courseId);
          if (!existing) {
            certId = createId();
            const { name: studentName } = await resolveStudentContact(studentId, reflection);
            await saveCertificate({
              certId,
              userId: studentId,
              courseId: module.courseId,
              studentName,
              courseTitle: module.course.title,
              issuedAt: reviewedAt,
            });
            // In-app notification for course completion
            await createNotification({
              userId: studentId,
              notifId: createId(),
              type: 'GENERAL',
              message: studentLang === 'en'
                ? `🎓 Congratulations! You completed "${module.course.title}". Your certificate is available.`
                : `🎓 ¡Felicitaciones! Completaste "${module.course.title}". Tu certificado está disponible.`,
              read: false,
              createdAt: reviewedAt,
              actionUrl: `/certificado/${certId}`,
            });
            console.log(`[Evaluator] Certificate generated: ${certId} for student ${studentId}`);
          } else {
            certId = existing.certId;
          }
        }
      } catch (certErr) {
        console.warn('[Evaluator] Certificate generation failed (non-fatal):', certErr);
      }
    }

    // ── Send SES email via shared template system ────────────────────────────
    try {
      const moduleTitle = module?.title ?? 'módulo';
      const { email: studentEmail, name: studentName } = await resolveStudentContact(studentId, reflection);
      if (studentEmail) {
        if (action === 'APPROVE') {
          await sendTemplatedEmail(studentEmail, 'REFLECTION_APPROVED', {
            studentName,
            moduleTitle,
            feedback,
            courseTitle: module?.course?.title ?? '',
            certId: certId ?? '',
            certUrl: certId ? `${process.env.FRONTEND_URL ?? ''}/certificado/${certId}` : '',
          }, studentLang);
        } else {
          await sendTemplatedEmail(studentEmail, 'REFLECTION_REJECTED', {
            studentName,
            moduleTitle,
            feedback,
          }, studentLang);
        }
      } else {
        console.warn(`[Evaluator] No email found for student ${studentId} — skipping email`);
      }
    } catch (emailErr) {
      console.warn('[Evaluator] Email send failed (non-fatal):', emailErr);
    }

    return ok({ status: newStatus, reviewedAt, certId });
  }

  // ── POST /evaluator/reflections/reconsider ──────────────────────────────────
  if (method === 'POST' && path === '/evaluator/reflections/reconsider') {
    const { userId: studentId, moduleId, reason } = ctx.body as { userId: string; moduleId: string; reason: string };
    if (!studentId || !moduleId || !reason) return badRequest('userId, moduleId, reason required');
    if (reason.length < 20) return badRequest('La razón debe tener al menos 20 caracteres');

    const reflection = await getReflection(studentId, moduleId);
    if (!reflection) return notFound('Reflexión no encontrada');
    if (reflection.status !== 'REJECTED') return badRequest('Solo se pueden reconsiderar reflexiones rechazadas');

    const reviewedAt = new Date().toISOString();
    await updateReflectionStatus(studentId, moduleId, {
      status: 'APPROVED',
      reviewedAt,
      reconsideredBy: userId,
      reconsiderationReason: reason,
    });

    const reconsiderStudentLang = await getUserLang(studentId);

    // Notify student
    await createNotification({
      userId: studentId,
      notifId: createId(),
      type: 'REFLECTION_RECONSIDERED',
      message: reconsiderStudentLang === 'en'
        ? 'Your reflection was reconsidered and approved by an evaluator.'
        : 'Tu reflexión fue reconsiderada y aprobada por un evaluador.',
      read: false,
      createdAt: reviewedAt,
      actionUrl: '/student/reflections',
    });

    // Check if all modules approved → generate certificate
    let certId: string | null = null;
    try {
      const module = await prisma.module.findUnique({ where: { id: moduleId }, include: { course: true } });
      if (module?.course) {
        const allModules = await prisma.module.findMany({ where: { courseId: module.courseId }, select: { id: true } });
        const allReflections = await Promise.all(allModules.map((m: any) => getReflection(studentId, m.id)));
        const allApproved = allReflections.every((r: any) => r?.status === 'APPROVED');
        if (allApproved) {
          const existing = await getCertificateByUserAndCourse(studentId, module.courseId);
          if (!existing) {
            certId = createId();
            const { name: studentName } = await resolveStudentContact(studentId, reflection);
            await saveCertificate({ certId, userId: studentId, courseId: module.courseId, studentName, courseTitle: module.course.title, issuedAt: reviewedAt });
            await createNotification({
              userId: studentId, notifId: createId(), type: 'GENERAL',
              message: reconsiderStudentLang === 'en'
                ? `🎓 Congratulations! You completed "${module.course.title}". Your certificate is available.`
                : `🎓 ¡Felicitaciones! Completaste "${module.course.title}". Tu certificado está disponible.`,
              read: false, createdAt: reviewedAt, actionUrl: `/certificado/${certId}`,
            });
          } else {
            certId = existing.certId;
          }
        }
        // Send email
        try {
          const { email: studentEmail, name: studentName } = await resolveStudentContact(studentId, reflection);
          if (studentEmail) {
            await sendTemplatedEmail(studentEmail, 'REFLECTION_RECONSIDERED', {
              studentName,
              moduleTitle: module.title,
              reason,
              certId: certId ?? '',
              certUrl: certId ? `${process.env.FRONTEND_URL ?? ''}/certificado/${certId}` : '',
            }, reconsiderStudentLang);
          }
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      console.warn('[Evaluator] Reconsider post-processing failed (non-fatal):', e);
    }

    return ok({ status: 'APPROVED', reviewedAt, certId });
  }

  // ── POST /evaluator/reflections/priority ────────────────────────────────────
  if (method === 'POST' && path === '/evaluator/reflections/priority') {
    const { userId: studentId, moduleId, priority } = ctx.body as { userId: string; moduleId: string; priority: boolean };
    if (!studentId || !moduleId || priority == null) return badRequest('userId, moduleId, priority required');
    await setReflectionPriority(studentId, moduleId, priority);
    return ok({ priority });
  }

  // ── POST /evaluator/ai-feedback ─────────────────────────────────────────────
  if (method === 'POST' && path === '/evaluator/ai-feedback') {
    const { text, moduleTitle } = ctx.body as { text: string; moduleTitle?: string };
    if (!text) return badRequest('text is required');

    const prompt = `Eres un evaluador experto en desarrollo personal y aprendizaje. Se te ha presentado la siguiente reflexión de un estudiante del módulo "${moduleTitle ?? 'del curso'}".

REFLEXIÓN:
"""
${text.slice(0, 3000)}
"""

Genera un feedback evaluativo completo con exactamente 3 párrafos (mínimo 150 palabras en total) que:
- Sea constructivo, específico y se refiera directamente al contenido de la reflexión
- Párrafo 1: reconoce las fortalezas y aspectos positivos observados
- Párrafo 2: señala áreas de mejora con ejemplos concretos del texto
- Párrafo 3: conclusión motivadora con próximos pasos sugeridos
- Sea profesional, cálido y listo para enviar directamente al estudiante
- Esté en español

Responde ÚNICAMENTE con un objeto JSON con esta estructura exacta:
{
  "feedback": "Párrafo 1...\n\nPárrafo 2...\n\nPárrafo 3..."
}`;

    try {
      const response = await bedrock.send(new InvokeModelCommand({
        modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        }),
      }));

      const raw = JSON.parse(new TextDecoder().decode(response.body));
      const content = raw.content?.[0]?.text ?? '';
      const clean = content.replace(/```json|```/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return serverError('AI response format error');
      const parsed = JSON.parse(jsonMatch[0]);
      return ok({ feedback: parsed.feedback ?? '' });
    } catch (aiErr) {
      console.error('[Evaluator] Bedrock AI feedback error:', aiErr);
      return serverError('AI feedback generation failed');
    }
  }

  // ── POST /evaluator/ai-check ─────────────────────────────────────────────────
  if (method === 'POST' && path === '/evaluator/ai-check') {
    const { userId: studentId, moduleId } = ctx.body as { userId?: string; moduleId?: string };
    if (!studentId || !moduleId) return badRequest('userId and moduleId are required');

    const reflection = await getReflection(studentId, moduleId);
    if (!reflection) return notFound('Reflection not found');

    try {
      const aiResult = await detectAI(reflection.text ?? '');
      // Persist result back to DynamoDB
      await updateReflectionStatus(studentId, moduleId, { aiResult, analyzedAt: new Date().toISOString() });
      return ok({ aiResult });
    } catch (aiErr) {
      console.error('[Evaluator] AI check error:', aiErr);
      return serverError('AI detection failed');
    }
  }

  return null; // not handled by this domain
}
