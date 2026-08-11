// Miscellaneous routes: reminder, quiz-audit, translate — for lux-evaluator.
import { SendEmailCommand } from '@aws-sdk/client-ses';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { EvalCtx, ses, FROM_EMAIL, bedrock } from './ctx';
import { getQuizAttempts } from '../shared/db-dynamo';
import { ok, badRequest, notFound, serverError } from '../shared/response';

export async function handleMisc(ctx: EvalCtx): Promise<any | null> {
  const { event, method, path, prisma } = ctx;

  // ── POST /evaluator/reminder — send inactivity reminder email to a student ──
  if (method === 'POST' && path === '/evaluator/reminder') {
    const { userId, studentEmail, studentName, hoursInactive, courseTitle } = ctx.body as {
      userId: string; studentEmail: string; studentName?: string;
      hoursInactive?: number; courseTitle?: string;
    };
    if (!userId || !studentEmail) return badRequest('userId y studentEmail son requeridos');

    const name = studentName || studentEmail.split('@')[0];
    const hours = Math.round(hoursInactive ?? 72);
    const timeLabel = hours >= 48 ? `${Math.round(hours / 24)} días` : `${hours} horas`;

    const reminderHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Roboto',Arial,sans-serif;background:#F8F8F8;padding:40px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#00B4D8,#7B2FBE);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-family:Montserrat,sans-serif;font-size:24px;">Lux Learning</h1>
      <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px;">Claridad que transforma.</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Hola, ${name}!</h2>
      <p style="color:#555;line-height:1.6;">Hemos notado que llevas <strong>${timeLabel}</strong> sin conectarte a la plataforma.</p>
      ${courseTitle ? `<p style="color:#555;line-height:1.6;">Recuerda que tienes el curso <strong>"${courseTitle}"</strong> activo con fechas límite próximas.</p>` : ''}
      <p style="color:#555;line-height:1.6;">Tu progreso importa. ¡Todavía estás a tiempo de completar tus módulos y reflexiones!</p>
      <a href="${process.env.FRONTEND_URL ?? 'https://luxlearning.academy'}/dashboard"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:16px;">
        Continuar aprendiendo
      </a>
    </div>
  </div>
</body>
</html>`;

    try {
      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [studentEmail] },
        Message: {
          Subject: { Data: '¡Te echamos de menos en Lux Learning!', Charset: 'UTF-8' },
          Body: { Html: { Data: reminderHtml, Charset: 'UTF-8' } },
        },
      }));
    } catch (sesErr: any) {
      // SES sandbox: unverified destination — log but don't fail (chat message still sent by frontend)
      console.warn('[Reminder] SES send failed (non-fatal):', sesErr?.message ?? sesErr);
      return ok({ sent: false, reason: sesErr?.message ?? 'SES error' });
    }

    return ok({ sent: true });
  }

  // ── GET /evaluator/quiz-audit?userId=X&moduleId=Y — quiz answers for a student
  if (method === 'GET' && path === '/evaluator/quiz-audit') {
    const qs = event.queryStringParameters ?? {};
    const { userId: studentId, moduleId } = qs as { userId?: string; moduleId?: string };
    if (!studentId || !moduleId) return badRequest('userId and moduleId are required');

    const [attempts, module] = await Promise.all([
      getQuizAttempts(studentId, moduleId),
      prisma.module.findUnique({
        where: { id: moduleId },
        include: { questions: { orderBy: { order: 'asc' } } },
      }),
    ]);

    if (!module) return notFound('Module not found');

    // Enrich each attempt with question details
    const enrichedAttempts = attempts.map((attempt: any) => ({
      ...attempt,
      results: module.questions.map((q: any, i: number) => ({
        questionText: q.text,
        options: q.options,
        selectedIndex: attempt.answers?.[i] ?? -1,
        correctIndex: q.correctIndex,
        isCorrect: attempt.answers?.[i] === q.correctIndex,
      })),
    }));

    return ok({
      attempts: enrichedAttempts,
      passingScore: module.passingScore,
      moduleTitle: module.title,
      totalQuestions: module.questions.length,
    });
  }

  // ── POST /evaluator/translate — translate evaluator feedback text using Bedrock ──
  if (method === 'POST' && path === '/evaluator/translate') {
    const { text, targetLang } = ctx.body as { text?: string; targetLang?: string };
    if (!text?.trim()) return badRequest('text is required');
    const validLangs: Record<string, string> = {
      es: 'español',
      en: 'English',
      pt: 'português',
      fr: 'français',
    };
    const targetLabel = validLangs[targetLang ?? ''];
    if (!targetLabel) return badRequest('targetLang must be es, en, pt, or fr');

    const translatePrompt = `Translate the following educational feedback text to ${targetLabel}.
Preserve the tone, formality, and educational context.
Return ONLY the translated text, no explanations or extra content.

Text to translate:
${text.trim()}`;

    const translateResponse = await bedrock.send(new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        messages: [{ role: 'user', content: translatePrompt }],
      }),
    }));

    const translateRaw = JSON.parse(new TextDecoder().decode(translateResponse.body));
    const translatedText = translateRaw.content?.[0]?.text?.trim() ?? '';
    if (!translatedText) return serverError('Translation returned empty result');
    return ok({ translatedText });
  }

  return null; // not handled by this domain
}
