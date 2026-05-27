import { randomInt } from 'crypto';
import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand as LambdaInvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PollyClient, SynthesizeSpeechCommand, VoiceId } from '@aws-sdk/client-polly';
import { getPrismaClient } from '../shared/db-neon';
import { createEnrollment, getEnrollments, deleteEnrollment, getAllReflections, getAllLessonProgress, getAllEnrollments, saveAiJob, getAiJob, createTask } from '../shared/db-dynamo';
import { upsertChat, upsertMembership } from '../shared/db-messages';
import { ok, created, badRequest, forbidden, notFound, conflict, serverError, cors, setRequestOrigin } from '../shared/response';
import { jsonrepair } from 'jsonrepair';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const pollyClient = new PollyClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const S3_IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET ?? 'lux-learning-images';

// ── Nova Canvas image generation helper ─────────────────────────────────────
const STYLE_SUFFIXES: Record<string, string> = {
  realistic:    ', photorealistic style, high detail, professional photography look',
  illustration: ', flat illustration style, colorful, modern vector art',
  diagram:      ', clean technical diagram style, clear labels, professional schematic',
  comic:        ', comic book style, bold outlines, vibrant colors, graphic novel look',
  minimal:      ', minimal design, clean white space, simple geometric shapes',
  colorful:     ', vibrant multicolor palette, energetic infographic style',
  corporate:    ', professional corporate style, blue and gray tones, business presentation',
};

async function generateLessonImage(
  lessonTitle: string,
  moduleTitle: string,
  order: number,
  override?: { promptText?: string; style?: string }
): Promise<string | null> {
  const basePrompts: Record<number, string> = {
    2:  `Clean minimal educational mind map diagram about "${lessonTitle.slice(0, 60)}" in the context of "${moduleTitle.slice(0, 60)}", light blue background, professional illustration, no text labels, vector style`,
    6:  `Professional educational illustration depicting "${lessonTitle.slice(0, 60)}" about "${moduleTitle.slice(0, 60)}", modern flat design, vivid colors, no text, clean composition`,
    10: `Clean professional educational infographic layout about "${lessonTitle.slice(0, 60)}" summarizing "${moduleTitle.slice(0, 60)}", structured sections, modern design, geometric shapes`,
  };
  let prompt = override?.promptText ?? basePrompts[order]
    ?? `Educational illustration for lesson "${lessonTitle.slice(0, 60)}" about "${moduleTitle.slice(0, 60)}", modern flat design, professional, no text, clean composition`;
  if (override?.style && STYLE_SUFFIXES[override.style]) {
    prompt = prompt + STYLE_SUFFIXES[override.style];
  }
  try {
    const resp = await bedrock.send(new InvokeModelCommand({
      modelId: 'amazon.nova-canvas-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        taskType: 'TEXT_IMAGE',
        textToImageParams: { text: prompt, negativeText: 'blurry, low quality, text, watermark, letters, words, nsfw' },
        imageGenerationConfig: { numberOfImages: 1, quality: 'standard', width: 1024, height: 1024 },
      }),
    }));
    const result = JSON.parse(new TextDecoder().decode(resp.body));
    const base64 = result.images?.[0];
    if (!base64) return null;
    const imgBuffer = Buffer.from(base64, 'base64');
    const key = `lessons/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_IMAGES_BUCKET,
      Key: key,
      Body: imgBuffer,
      ContentType: 'image/png',
    }));
    return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
  } catch (err) {
    console.error('[ImageGen] Error generating lesson image:', err);
    return null;
  }
}
// ── Amazon Polly audio generation helper ────────────────────────────────────
const POLLY_VOICE_LANGUAGE: Record<string, string> = {
  Mia: 'es-MX', Lupe: 'es-US', Pedro: 'es-US', Lucia: 'es-ES', Sergio: 'es-ES',
};

async function generateLessonAudio(lessonId: string, text: string, voiceId = 'Mia'): Promise<string | null> {
  try {
    const plain = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2900); // Polly Neural limit per request

    const resp = await pollyClient.send(new SynthesizeSpeechCommand({
      Text: plain,
      VoiceId: voiceId as VoiceId,
      Engine: 'neural',
      OutputFormat: 'mp3',
      LanguageCode: (POLLY_VOICE_LANGUAGE[voiceId] ?? 'es-MX') as any,
    }));

    if (!resp.AudioStream) return null;

    const chunks: Uint8Array[] = [];
    for await (const chunk of resp.AudioStream as any) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    const key = `audio/${lessonId}-${voiceId.toLowerCase()}.mp3`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_IMAGES_BUCKET,
      Key: key,
      Body: audioBuffer,
      ContentType: 'audio/mpeg',
    }));
    return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
  } catch (err) {
    console.error('[Polly] Error generating audio:', err);
    return null;
  }
}

/** Shuffle options array in-place and update correctIndex so the correct answer moves with it */
function shuffleQuestionOptions(questions: any[]): any[] {
  return questions.map((q) => {
    if (!Array.isArray(q.options) || q.options.length < 2) return q;
    const correctAnswer = q.options[Number(q.correctIndex)];
    const opts = [...q.options];
    for (let i = opts.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    return { ...q, options: opts, correctIndex: opts.indexOf(correctAnswer) };
  });
}

function s3KeyFromUrl(url: string): string | null {
  const match = url.match(/\.amazonaws\.com\/(.+)$/);
  return match?.[1] ?? null;
}

const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.com';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://luxlearning.com';

function invitationEmailHtml(name: string, email: string, temporaryPassword: string, courseNames: string[]): string {
  const coursesBlock = courseNames.length > 0
    ? `<p style="color:#555;line-height:1.6;">Has sido inscrito en:</p>
       <ul style="color:#555;line-height:1.8;padding-left:20px;">${courseNames.map((c) => `<li><strong>${c}</strong></li>`).join('')}</ul>`
    : '';
  return `
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
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Bienvenido a Lux Learning!</h2>
      <p style="color:#555;line-height:1.6;">Hola ${name || email.split('@')[0]},</p>
      <p style="color:#555;line-height:1.6;">Tu cuenta ha sido creada. Aquí están tus credenciales de acceso:</p>
      <div style="background:#F8F8F8;border-left:4px solid #00B4D8;padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0 0 8px;color:#555;"><strong>Correo:</strong> ${email}</p>
        <p style="margin:0;color:#555;"><strong>Contraseña temporal:</strong> <span style="font-family:monospace;font-size:16px;color:#7B2FBE;">${temporaryPassword}</span></p>
      </div>
      <p style="color:#888;font-size:13px;">Se te pedirá cambiar tu contraseña al iniciar sesión por primera vez.</p>
      ${coursesBlock}
      <a href="${FRONTEND_URL}/auth/login"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:16px;">
        Iniciar sesión
      </a>
    </div>
  </div>
</body>
</html>`;
}

function enrollmentEmailHtml(name: string, courseName: string): string {
  return `
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
      <h2 style="color:#2C2C2C;font-family:Montserrat,sans-serif;margin-top:0;">¡Tienes un nuevo curso!</h2>
      <p style="color:#555;line-height:1.6;">Hola ${name},</p>
      <p style="color:#555;line-height:1.6;">Has sido inscrito en el siguiente curso:</p>
      <div style="background:#F0F7FF;border-left:4px solid #00B4D8;padding:16px 20px;border-radius:4px;margin:24px 0;">
        <p style="margin:0;color:#2C2C2C;font-size:16px;font-weight:600;">📚 ${courseName}</p>
      </div>
      <p style="color:#555;line-height:1.6;">Ingresa a la plataforma para comenzar tu aprendizaje.</p>
      <a href="${FRONTEND_URL}/courses"
         style="display:inline-block;background:linear-gradient(135deg,#00B4D8,#7B2FBE);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:600;margin-top:16px;">
        Ver mis cursos
      </a>
    </div>
  </div>
</body>
</html>`;
}

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<
  APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }
>;

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

function isAuthorized(event: Event): boolean {
  const role = event.requestContext.authorizer?.lambda?.role;
  return role === 'ADMIN' || role === 'EVALUATOR';
}

function isAdmin(event: Event): boolean {
  return event.requestContext.authorizer?.lambda?.role === 'ADMIN';
}

async function getCallerName(event: Event): Promise<string | null> {
  const userId = event.requestContext.authorizer?.lambda?.userId;
  const email = event.requestContext.authorizer?.lambda?.email;
  if (!userId || userId === 'system') return null;
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const name = res.UserAttributes?.find((a) => a.Name === 'name')?.Value;
    return name || email || userId;
  } catch {
    return email || userId;
  }
}

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();
  setRequestOrigin(event.headers?.origin ?? event.headers?.Origin);
  if (!isAuthorized(event)) return forbidden('Se requiere rol de evaluador o administrador');

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // getPrismaClient inside try-catch so DB init errors return 500 instead of crashing (502)
    const prisma = getPrismaClient();
    const body = event.body ? JSON.parse(event.body) : {};
    const action = (body as any)._action as string | undefined;

    // ── Async audio generation workers (self-invoked via Lambda Event) ──────
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

    // ── GET /admin/courses ──────────────────────────────────────────────────
    if (path === '/admin/courses' && method === 'GET') {
      const courses = await prisma.course.findMany({
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
      const coursesWithLegacy = courses.map((c) => {
        const isLegacy = c.modules.length > 0 &&
          c.modules.every((m) => (m.lessons as any[]).every((l: any) => l.type === 'video' && !l.content));
        return { ...c, isLegacy };
      });
      return ok(coursesWithLegacy);
    }

    // ── POST /admin/courses ─────────────────────────────────────────────────
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
          tags: Array.isArray(tags) ? tags : [],
          startDate: startDate ? new Date(startDate) : null,
          closeDate: closeDate ? new Date(closeDate) : null,
          createdByName: callerName,
        },
      });
      // Auto-create group chat for the new course
      await upsertChat(`group_${course.id}`, {
        type: 'GROUP',
        name: `Curso: ${course.title}`,
        participants: [],
      }).catch(() => {});
      return created(course);
    }

    // ── GET /admin/courses/ai-job — poll async job status ──────────────────────
    if (path === '/admin/courses/ai-job' && method === 'GET') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador');
      const jobId = event.queryStringParameters?.jobId;
      if (!jobId) return badRequest('jobId es requerido');
      const job = await getAiJob(jobId);
      if (!job) return notFound('Job no encontrado');
      return ok(job);
    }

    // ── GET /admin/courses/:courseId/validate-videos ────────────────────────
    const validateVideosMatch = path.match(/^\/admin\/courses\/([^/]+)\/validate-videos$/);
    if (validateVideosMatch && method === 'GET') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const courseId = validateVideosMatch[1]!;
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: { modules: { include: { lessons: { select: { id: true, title: true, youtubeId: true, order: true, moduleId: true } } } } },
      });
      if (!course) return notFound('Curso no encontrado');

      const allLessons = course.modules.flatMap(m =>
        m.lessons.filter(l => l.youtubeId && l.youtubeId.trim())
      );

      const results = await Promise.allSettled(
        allLessons.map(async (l) => {
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

      const videos = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
      return ok({ videos, broken: videos.filter(v => !v!.ok).length, total: videos.length });
    }

    // ── PUT /admin/courses/:courseId/evaluator ──────────────────────────────
    const courseEvaluatorMatch = path.match(/^\/admin\/courses\/([^/]+)\/evaluator$/);
    if (courseEvaluatorMatch && method === 'PUT') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador');
      const courseId = courseEvaluatorMatch[1]!;
      const { evaluatorId, evaluatorName } = body as { evaluatorId?: string; evaluatorName?: string };
      if (!evaluatorId) return badRequest('evaluatorId es requerido');
      const updated = await prisma.course.update({
        where: { id: courseId },
        data: { evaluatorId, evaluatorName: evaluatorName ?? null },
      });
      return ok(updated);
    }

    // ── /admin/courses/:courseId ────────────────────────────────────────────
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
        const { title, slug, description, imageUrl, isActive, isPilot, tags, startDate, closeDate } = body;
        if (!title || !slug || !description) return badRequest('title, slug y description son requeridos');
        const course = await prisma.course.update({
          where: { id: courseId },
          data: {
            title, slug, description,
            imageUrl: imageUrl || null,
            isActive, isPilot,
            tags: Array.isArray(tags) ? tags : [],
            startDate: startDate ? new Date(startDate) : null,
            closeDate: closeDate ? new Date(closeDate) : null,
          },
        });
        return ok(course);
      }

      if (method === 'DELETE') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        await prisma.course.delete({ where: { id: courseId } });
        return ok({ deleted: true });
      }
    }

    // ── POST /admin/courses/:courseId/modules ───────────────────────────────
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

    // ── /admin/modules/:moduleId ────────────────────────────────────────────
    const moduleMatch = path.match(/^\/admin\/modules\/([^/]+)$/);
    if (moduleMatch) {
      const moduleId = moduleMatch[1]!;

      if (method === 'PUT') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        const { title, description, duration, passingScore, order } = body;
        if (!title || !description || !duration || passingScore == null) {
          return badRequest('title, description, duration y passingScore son requeridos');
        }
        const mod = await prisma.module.update({
          where: { id: moduleId },
          data: { title, description, duration, passingScore: Number(passingScore), order: Number(order) },
        });
        return ok(mod);
      }

      if (method === 'DELETE') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        await prisma.module.delete({ where: { id: moduleId } });
        return ok({ deleted: true });
      }
    }

    // ── POST /admin/modules/:moduleId/lessons ───────────────────────────────
    const moduleLessonsMatch = path.match(/^\/admin\/modules\/([^/]+)\/lessons$/);
    if (moduleLessonsMatch && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const moduleId = moduleLessonsMatch[1]!;
      const { title, duration, youtubeId, imageUrl, points, tip, order, type, content } = body;
      if (!title || !duration) {
        return badRequest('title y duration son requeridos');
      }
      const lessonType = type ?? (youtubeId ? 'video' : 'text');
      let lessonOrder = order;
      if (lessonOrder == null) {
        const count = await prisma.lesson.count({ where: { moduleId } });
        lessonOrder = count + 1;
      }
      const lesson = await prisma.lesson.create({
        data: {
          moduleId, title, duration,
          youtubeId: youtubeId ?? '',
          type: lessonType,
          content: content ?? null,
          imageUrl: imageUrl || null,
          points: Array.isArray(points) ? points : [],
          tip: tip ?? '',
          order: Number(lessonOrder),
        },
      });

      // Auto-generate Polly audio asynchronously (fire-and-forget)
      lambdaClient.send(new LambdaInvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
          rawPath: '/_internal/audio',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ _action: 'single-audio', lessonId: lesson.id, voiceId: 'Mia' }),
        })),
      })).catch(() => {});

      return created(lesson);
    }

    // ── /admin/lessons/:lessonId ────────────────────────────────────────────
    const lessonMatch = path.match(/^\/admin\/lessons\/([^/]+)$/);
    if (lessonMatch) {
      const lessonId = lessonMatch[1]!;

      if (method === 'PUT') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        const { title, duration, youtubeId, imageUrl, points, tip, order } = body;
        if (!title || !duration || !youtubeId) {
          return badRequest('title, duration y youtubeId son requeridos');
        }
        const lesson = await prisma.lesson.update({
          where: { id: lessonId },
          data: {
            title, duration, youtubeId,
            imageUrl: imageUrl || null,
            points: Array.isArray(points) ? points : [],
            tip: tip ?? '',
            order: Number(order),
          },
        });
        return ok(lesson);
      }

      if (method === 'DELETE') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        // Clean up S3 files before deleting DB record
        const lessonToDelete = await prisma.lesson.findUnique({ where: { id: lessonId } });
        if (lessonToDelete?.imageUrl) {
          const key = s3KeyFromUrl(lessonToDelete.imageUrl);
          if (key) await s3Client.send(new DeleteObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: key })).catch(() => {});
        }
        if (lessonToDelete?.audioUrl) {
          const key = s3KeyFromUrl(lessonToDelete.audioUrl);
          if (key) await s3Client.send(new DeleteObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: key })).catch(() => {});
        }
        await prisma.lesson.delete({ where: { id: lessonId } });
        return ok({ deleted: true });
      }
    }

    // ── POST /admin/modules/:moduleId/questions ─────────────────────────────
    const moduleQuestionsMatch = path.match(/^\/admin\/modules\/([^/]+)\/questions$/);
    if (moduleQuestionsMatch && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const moduleId = moduleQuestionsMatch[1]!;
      const { text, options, correctIndex, order } = body;
      if (!text || !Array.isArray(options) || options.length < 2 || correctIndex == null) {
        return badRequest('text, options (mínimo 2) y correctIndex son requeridos');
      }
      let questionOrder = order;
      if (questionOrder == null) {
        const count = await prisma.question.count({ where: { moduleId } });
        questionOrder = count + 1;
      }
      const question = await prisma.question.create({
        data: { moduleId, text, options, correctIndex: Number(correctIndex), order: Number(questionOrder) },
      });
      return created(question);
    }

    // ── /admin/questions/:questionId ────────────────────────────────────────
    const questionMatch = path.match(/^\/admin\/questions\/([^/]+)$/);
    if (questionMatch) {
      const questionId = questionMatch[1]!;

      if (method === 'PUT') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        const { text, options, correctIndex, order } = body;
        if (!text || !Array.isArray(options) || options.length < 2 || correctIndex == null) {
          return badRequest('text, options (mínimo 2) y correctIndex son requeridos');
        }
        const question = await prisma.question.update({
          where: { id: questionId },
          data: { text, options, correctIndex: Number(correctIndex), order: Number(order) },
        });
        return ok(question);
      }

      if (method === 'DELETE') {
        if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
        await prisma.question.delete({ where: { id: questionId } });
        return ok({ deleted: true });
      }
    }

    // ── GET /admin/users ────────────────────────────────────────────────────
    if (path === '/admin/users' && method === 'GET') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');

      // Paginated fetch helpers
      const listAllUsers = async () => {
        const all: NonNullable<Awaited<ReturnType<typeof cognito.send>>['Users']>[number][] = [];
        let token: string | undefined;
        do {
          const res = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60, PaginationToken: token }));
          all.push(...(res.Users ?? []));
          token = res.PaginationToken;
        } while (token);
        return all;
      };
      const listAllInGroup = async (GroupName: string) => {
        const all: NonNullable<Awaited<ReturnType<typeof cognito.send>>['Users']>[number][] = [];
        let token: string | undefined;
        do {
          const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName, Limit: 60, NextToken: token }));
          all.push(...(res.Users ?? []));
          token = res.NextToken;
        } while (token);
        return all;
      };

      // Fetch all users + group memberships in parallel
      const [allUsers, evaluators, admins] = await Promise.all([
        listAllUsers(),
        listAllInGroup('EVALUATOR'),
        listAllInGroup('ADMIN'),
      ]);

      const evaluatorUsernames = new Set(evaluators.map((u) => u.Username));
      const adminUsernames = new Set(admins.map((u) => u.Username));

      const attr = (user: { Attributes?: { Name?: string; Value?: string }[] }, name: string) =>
        user.Attributes?.find((a) => a.Name === name)?.Value ?? '';

      const users = allUsers.map((u) => {
        const username = u.Username ?? '';
        const role = adminUsernames.has(username) ? 'ADMIN'
          : evaluatorUsernames.has(username) ? 'EVALUATOR'
          : 'STUDENT';
        const email = attr(u, 'email') || username; // fallback to username (which is email for admin-created users)
        return {
          username,
          sub: attr(u, 'sub'),   // Cognito UUID — matches userId stored in tasks/enrollments
          email,
          name: attr(u, 'name'),
          role,
          enabled: u.Enabled ?? true,
          status: u.UserStatus ?? 'UNKNOWN',
          createdAt: u.UserCreateDate?.toISOString() ?? null,
        };
      });

      // Sort: ADMIN first, then EVALUATOR, then STUDENT, then by email
      const roleOrder = { ADMIN: 0, EVALUATOR: 1, STUDENT: 2 };
      users.sort((a, b) =>
        (roleOrder[a.role as keyof typeof roleOrder] ?? 2) - (roleOrder[b.role as keyof typeof roleOrder] ?? 2) ||
        a.email.localeCompare(b.email)
      );

      return ok(users);
    }

    // ── POST /admin/users — invite/create user ──────────────────────────────
    if (path === '/admin/users' && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

      const { email, role = 'STUDENT', name, courseIds } = body as { email: string; role?: string; name?: string; courseIds?: string[] };
      if (!email) return badRequest('email es requerido');
      if (!['STUDENT', 'EVALUATOR', 'ADMIN'].includes(role)) return badRequest('rol inválido');

      // Generate a cryptographically secure temporary password (Cognito policy: 8+ chars,
      // uppercase, lowercase, digits). Use crypto.randomInt (Node 18+) + Fisher-Yates shuffle.
      const chars = 'abcdefghijklmnopqrstuvwxyz';
      const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const digits = '0123456789';
      const cryptoItem = (s: string) => s[randomInt(s.length)]!;
      const pwChars = [
        cryptoItem(uppers), cryptoItem(uppers),
        cryptoItem(chars), cryptoItem(chars), cryptoItem(chars), cryptoItem(chars),
        cryptoItem(digits), cryptoItem(digits),
      ];
      // Unbiased Fisher-Yates shuffle
      for (let i = pwChars.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [pwChars[i], pwChars[j]] = [pwChars[j]!, pwChars[i]!];
      }
      const temporaryPassword = pwChars.join('');

      // Create user with SUPPRESS — admin shares password through their own channel
      let createRes: any;
      try {
        createRes = await cognito.send(new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          TemporaryPassword: temporaryPassword,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            ...(name ? [{ Name: 'name', Value: name }] : []),
          ],
        }));
      } catch (cognitoErr: any) {
        const errName: string = cognitoErr?.name ?? cognitoErr?.__type ?? '';
        console.warn('[Admin] AdminCreateUser error:', errName, cognitoErr?.message);
        if (errName === 'UsernameExistsException') {
          return conflict('Este correo ya tiene una cuenta registrada en la plataforma');
        }
        if (errName === 'InvalidPasswordException') {
          return badRequest('Error al generar la contraseña temporal. Contacta soporte.');
        }
        if (errName === 'InvalidParameterException') {
          return badRequest('Email inválido o parámetros incorrectos');
        }
        throw cognitoErr;
      }

      const username = createRes.User?.Username ?? email;

      // Add to role group
      try {
        await cognito.send(new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          GroupName: role === 'EVALUATOR' || role === 'ADMIN' ? role : 'STUDENT',
        }));
      } catch (groupErr: any) {
        console.error('[Admin] AddUserToGroup failed (non-fatal for response):', groupErr);
      }

      // Enroll in courses if provided
      let courseNames: string[] = [];
      if (Array.isArray(courseIds) && courseIds.length > 0) {
        await Promise.all(courseIds.map((cid) => createEnrollment(username, cid)));
        // Fetch course names for the email
        try {
          const courses = await prisma.course.findMany({ where: { id: { in: courseIds } }, select: { title: true } });
          courseNames = courses.map((c) => c.title);
        } catch { /* non-fatal */ }
      }

      // Send welcome email via SES
      try {
        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Data: '¡Bienvenido a Lux Learning! — Tu cuenta está lista', Charset: 'UTF-8' },
            Body: { Html: { Data: invitationEmailHtml(name ?? '', email, temporaryPassword, courseNames), Charset: 'UTF-8' } },
          },
        }));
      } catch (emailErr) {
        console.warn('[Admin] Invitation email failed (non-fatal):', emailErr);
      }

      return created({ username, email, role, status: 'FORCE_CHANGE_PASSWORD', temporaryPassword, courseIds: courseIds ?? [] });
    }

    // ── PUT /admin/users/:username/role ─────────────────────────────────────
    const userRoleMatch = path.match(/^\/admin\/users\/([^/]+)\/role$/);
    if (userRoleMatch && method === 'PUT') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

      const username = decodeURIComponent(userRoleMatch[1]!);
      const { role } = body as { role: string };
      if (!['STUDENT', 'EVALUATOR', 'ADMIN'].includes(role)) return badRequest('rol inválido');

      // Remove from all groups first, then add to new one
      await Promise.allSettled([
        cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: 'STUDENT' })),
        cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: 'EVALUATOR' })),
        cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: 'ADMIN' })),
      ]);

      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: role,
      }));

      return ok({ username, role });
    }

    // ── PUT /admin/users/:username/status ───────────────────────────────────
    const userStatusMatch = path.match(/^\/admin\/users\/([^/]+)\/status$/);
    if (userStatusMatch && method === 'PUT') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

      const username = decodeURIComponent(userStatusMatch[1]!);
      const { enabled } = body as { enabled: boolean };

      if (enabled) {
        await cognito.send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
      } else {
        await cognito.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
      }

      return ok({ username, enabled });
    }

    // ── DELETE /admin/users/:username ───────────────────────────────────────
    const userDeleteMatch = path.match(/^\/admin\/users\/([^/]+)$/);
    if (userDeleteMatch && method === 'DELETE') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');

      const username = decodeURIComponent(userDeleteMatch[1]!);
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
      return ok({ deleted: true });
    }

    // ── /admin/users/:username/enrollments ──────────────────────────────────
    const userEnrollmentsMatch = path.match(/^\/admin\/users\/([^/]+)\/enrollments$/);
    if (userEnrollmentsMatch) {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const username = decodeURIComponent(userEnrollmentsMatch[1]!);

      if (method === 'GET') {
        const courseIds = await getEnrollments(username);
        return ok({ courseIds });
      }

      if (method === 'POST') {
        const { courseId } = body;
        if (!courseId) return badRequest('courseId es requerido');
        await createEnrollment(username, courseId);

        // Send enrollment notification email + add to group chat
        try {
          const [userRes, course] = await Promise.all([
            cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username })),
            prisma.course.findUnique({ where: { id: courseId }, select: { title: true } }),
          ]);
          const emailAttr = userRes.UserAttributes?.find((a) => a.Name === 'email')?.Value;
          const nameAttr = userRes.UserAttributes?.find((a) => a.Name === 'name')?.Value;
          if (emailAttr && course) {
            await ses.send(new SendEmailCommand({
              Source: FROM_EMAIL,
              Destination: { ToAddresses: [emailAttr] },
              Message: {
                Subject: { Data: `¡Nuevo curso disponible: ${course.title}!`, Charset: 'UTF-8' },
                Body: { Html: { Data: enrollmentEmailHtml(nameAttr || emailAttr.split('@')[0], course.title), Charset: 'UTF-8' } },
              },
            }));
          }
          // Add student to group chat for this course
          if (course) {
            await upsertMembership(username, `group_${courseId}`, {
              chatName: `Curso: ${course.title}`,
              chatType: 'GROUP',
            });
          }
        } catch (e) { console.warn('Enrollment email/chat failed:', e); }

        // M-7: Auto-create tasks for each module (one per module, due in 7×order days)
        try {
          const courseModules = await prisma.module.findMany({
            where: { courseId },
            orderBy: { order: 'asc' },
            select: { id: true, title: true, order: true },
          });
          const courseForTasks = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true } });
          const enrollDate = new Date();
          await Promise.all(courseModules.map((mod) => {
            const due = new Date(enrollDate);
            due.setDate(due.getDate() + 7 * mod.order);
            const dueDate = due.toISOString().slice(0, 10);
            return createTask({
              userId: username,
              taskId: `auto-${courseId}-${mod.id}`,
              title: `Completar módulo: ${mod.title}`,
              description: `Completa todas las lecciones y el quiz del módulo ${mod.order}.`,
              type: 'complete_module',
              dueDate,
              courseId,
              moduleId: mod.id,
              courseTitle: courseForTasks?.title ?? '',
              moduleTitle: mod.title,
              assignedBy: 'system',
              status: 'PENDING',
              createdAt: new Date().toISOString(),
            });
          }));
        } catch (e) { console.warn('Auto-task creation failed:', e); }

        return ok({ enrolled: true });
      }

      if (method === 'DELETE') {
        const { courseId } = body;
        if (!courseId) return badRequest('courseId es requerido');
        await deleteEnrollment(username, courseId);
        return ok({ removed: true });
      }
    }

    // ── GET /admin/reports ──────────────────────────────────────────────────
    if (path === '/admin/reports' && method === 'GET') {
      // Both EVALUATOR and ADMIN can view reports

      const [allReflections, allProgress, allEnrollments, courses] = await Promise.all([
        getAllReflections(),
        getAllLessonProgress(),
        getAllEnrollments(),
        prisma.course.findMany({
          include: {
            modules: {
              orderBy: { order: 'asc' },
              include: { lessons: { select: { id: true } } },
            },
          },
        }),
      ]);

      // ── Tasa de aprobación por módulo ──────────────────────────────────────
      const moduleMap = new Map<string, { title: string; courseTitle: string; total: number; approved: number; rejected: number; avgDaysToReview: number; totalReviewTime: number; reviewedCount: number }>();
      courses.forEach((c) =>
        c.modules.forEach((m) => moduleMap.set(m.id, { title: m.title, courseTitle: c.title, total: 0, approved: 0, rejected: 0, avgDaysToReview: 0, totalReviewTime: 0, reviewedCount: 0 }))
      );

      allReflections.forEach((r) => {
        const entry = moduleMap.get(r.moduleId);
        if (!entry) return;
        entry.total++;
        if (r.status === 'APPROVED') entry.approved++;
        if (r.status === 'REJECTED') entry.rejected++;
        if ((r.status === 'APPROVED' || r.status === 'REJECTED') && (r as any).reviewedAt && r.submittedAt) {
          const ms = new Date((r as any).reviewedAt).getTime() - new Date(r.submittedAt).getTime();
          if (ms > 0) {
            entry.totalReviewTime += ms;
            entry.reviewedCount++;
          }
        }
      });

      const moduleStats = Array.from(moduleMap.entries()).map(([moduleId, e]) => ({
        moduleId,
        title: e.title,
        courseTitle: e.courseTitle,
        total: e.total,
        approved: e.approved,
        rejected: e.rejected,
        approvalRate: e.total > 0 ? Math.round((e.approved / e.total) * 100) : null,
        avgHoursToReview: e.reviewedCount > 0 ? Math.round(e.totalReviewTime / e.reviewedCount / 3600000 * 10) / 10 : null,
      })).filter((m) => m.total > 0).sort((a, b) => (b.approvalRate ?? 0) - (a.approvalRate ?? 0));

      // ── Estudiantes en riesgo (inscrito, sin actividad en >7 días) ─────────
      const INACTIVITY_DAYS = 7;
      const now = Date.now();
      const lastActivityByStudent = new Map<string, number>();

      allProgress.forEach((p) => {
        const t = new Date(p.completedAt).getTime();
        if (!lastActivityByStudent.has(p.userId) || t > lastActivityByStudent.get(p.userId)!) {
          lastActivityByStudent.set(p.userId, t);
        }
      });
      allReflections.forEach((r) => {
        const t = new Date(r.submittedAt).getTime();
        if (!lastActivityByStudent.has(r.userId) || t > lastActivityByStudent.get(r.userId)!) {
          lastActivityByStudent.set(r.userId, t);
        }
      });

      const enrolledUserIds = [...new Set(allEnrollments.map((e) => e.userId))];
      const atRiskStudents = enrolledUserIds.filter((uid) => {
        const last = lastActivityByStudent.get(uid);
        if (!last) return true; // never active
        return (now - last) / 86400000 > INACTIVITY_DAYS;
      }).length;

      // ── Totals ─────────────────────────────────────────────────────────────
      const totalReflections = allReflections.length;
      const totalApproved = allReflections.filter((r) => r.status === 'APPROVED').length;
      const totalRejected = allReflections.filter((r) => r.status === 'REJECTED').length;
      const totalPending = allReflections.filter((r) => r.status === 'PENDING_EVAL').length;
      const overallApprovalRate = totalReflections > 0 ? Math.round((totalApproved / totalReflections) * 100) : 0;
      const totalEnrolled = enrolledUserIds.length;
      const activeStudents = enrolledUserIds.filter((uid) => {
        const last = lastActivityByStudent.get(uid);
        return last && (now - last) / 86400000 <= 7;
      }).length;

      // ── Avg quality score ──────────────────────────────────────────────────
      const scored = allReflections.filter((r) => (r as any).qualityScore != null);
      const avgQuality = scored.length > 0
        ? Math.round(scored.reduce((sum, r) => sum + ((r as any).qualityScore ?? 0), 0) / scored.length * 10) / 10
        : null;

      return ok({
        summary: { totalReflections, totalApproved, totalRejected, totalPending, overallApprovalRate, totalEnrolled, activeStudents, atRiskStudents, avgQuality },
        moduleStats,
      });
    }

    // ── POST /admin/courses/ai-generate ────────────────────────────────────────
    if (path === '/admin/courses/ai-generate' && method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const { method: genMethod, input, _jobId, _context } = body as { method?: string; input?: string; _jobId?: string; _context?: string };

      // ── ASYNC WORKER: invoked by self with _jobId ─────────────────────────
      if (_jobId && _context) {
        // This branch runs as a fire-and-forget Lambda invocation — no API GW timeout
        const context = _context;

        // ── Bedrock helper ───────────────────────────────────────────────────
        // Escape control chars ONLY inside JSON string values (not structural whitespace)
        const fixJsonControlChars = (str: string): string => {
          let out = ''; let inStr = false; let esc = false;
          for (let i = 0; i < str.length; i++) {
            const c = str[i]!; const code = str.charCodeAt(i);
            if (esc) { out += c; esc = false; continue; }
            if (c === '\\' && inStr) { out += c; esc = true; continue; }
            if (c === '"') { inStr = !inStr; out += c; continue; }
            if (inStr && code < 0x20) {
              if (code === 0x0A) out += '\\n';
              else if (code === 0x0D) out += '\\r';
              else if (code === 0x09) out += '\\t';
              else out += `\\u${code.toString(16).padStart(4, '0')}`;
            } else { out += c; }
          }
          return out;
        };

        const bedrockJSON = async (prompt: string, maxTokens = 2000): Promise<any> => {
          const res = await bedrock.send(new InvokeModelCommand({
            modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: maxTokens,
              messages: [{ role: 'user', content: prompt }],
            }),
          }));
          const parsed = JSON.parse(new TextDecoder().decode(res.body));
          const raw = (parsed.content?.[0]?.text ?? '{}').replace(/```json\s*|```/g, '').trim();
          const match = raw.match(/[\[{][\s\S]*/);
          const jsonStr = fixJsonControlChars(match?.[0] ?? '{}');
          try { return JSON.parse(jsonStr); } catch {
            // Use jsonrepair to fix unescaped quotes, trailing commas, truncation, etc.
            try { return JSON.parse(jsonrepair(jsonStr)); } catch {
              return {};
            }
          }
        };

        try {
          // FASE 1: Estructura
          const structure = await bedrockJSON(`Eres un experto en diseño instruccional. Para un curso sobre:
"""
${context.slice(0, 3000)}
"""
Determina cuántos módulos necesita este curso según la complejidad del tema (mínimo 5, máximo 10). Genera la estructura en JSON. Responde ÚNICAMENTE con JSON válido:
{"title":"Título del curso","description":"Descripción 2-3 oraciones","modules":[{"order":1,"title":"Módulo 1","description":"Descripción breve"},{"order":2,"title":"Módulo 2","description":"Descripción breve"},{"order":3,"title":"Módulo 3","description":"Descripción breve"}]}`, 1200);

          if (!structure.title || !Array.isArray(structure.modules)) throw new Error('Estructura inválida');

          // FASE 2: Módulos en paralelo — cada uno genera lecciones y preguntas simultáneamente
          const generateModule = async (mod: { order: number; title: string; description: string }) => {
            const [lessons, questions] = await Promise.all([
              bedrockJSON(`Eres experto en diseño instruccional. Genera las 10 lecciones del módulo "${mod.title}" del curso "${structure.title}".
Responde ÚNICAMENTE con array JSON válido. Cada lección incluye: title, order, type, content, duration, points (array 3 frases cortas), tip (1 consejo práctico).
[
{"title":"Introducción — ${mod.title}","order":1,"type":"video","content":"<p>Escribe 1 párrafo introductorio sobre qué aprenderá el estudiante en ${mod.title} y por qué es importante.</p>","duration":"5 min","points":["Concepto clave 1 de ${mod.title}","Concepto clave 2","Para qué sirve este módulo"],"tip":"Toma notas de los conceptos que te resulten nuevos."},
{"title":"Subtema A","order":2,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo introductorio real sobre el subtema en 2ª persona.</p><ul><li>Punto clave con ejemplo concreto</li><li>Segundo punto importante</li><li>Tercer punto práctico</li></ul><p>Párrafo de cierre con aplicación práctica.</p>","duration":"8 min","points":["Punto clave 1","Punto clave 2","Punto clave 3"],"tip":"Consejo práctico aplicable al subtema."},
{"title":"Subtema B","order":3,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><ul><li>Elemento 1</li><li>Elemento 2</li></ul><blockquote>Cita relevante de autor sobre el tema.</blockquote><p>Párrafo de cierre.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip práctico."},
{"title":"Subtema C","order":4,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><p>Párrafo 2 con ejemplos.</p><ul><li>Ejemplo A</li><li>Ejemplo B</li></ul>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema D","order":5,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><ul><li>Punto A</li><li>Punto B</li></ul><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema E","order":6,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><p>Párrafo 2.</p><blockquote>Cita de experto relevante.</blockquote>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema F","order":7,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><ul><li>Elemento 1</li><li>Elemento 2</li><li>Elemento 3</li></ul>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema G","order":8,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><p>Párrafo 2.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Subtema H","order":9,"type":"text","content":"<h3>Título de sección</h3><p>Párrafo 1.</p><ul><li>Punto 1</li><li>Punto 2</li></ul><p>Párrafo final.</p>","duration":"8 min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Tip."},
{"title":"Resumen y cierre — ${mod.title}","order":10,"type":"video","content":"<p>Escribe 1 párrafo que resuma los conceptos principales aprendidos en ${mod.title} y los próximos pasos del estudiante.</p>","duration":"5 min","points":["Resumen concepto 1","Resumen concepto 2","Próximos pasos"],"tip":"Completa el quiz para afianzar lo aprendido."}
]
REGLAS ESTRICTAS: 10 lecciones exactas. Lecciones de texto (order 2-9) DEBEN usar HTML rico: <h3> para subtítulos, <ul><li> para listas con al menos 2-3 elementos, <blockquote> para citas relevantes (al menos 2 lecciones por módulo), <p> para párrafos cortos (máx 3-4 líneas). Voz activa en 2ª persona. Sin markdown, sin comillas dentro del content. Genera contenido educativo auténtico y específico, no ejemplos genéricos.`, 6000),

              bedrockJSON(`Genera exactamente 10 preguntas de opción múltiple en español para el módulo "${mod.title}" del curso "${structure.title}".
Responde ÚNICAMENTE con array JSON válido:
[
{"text":"¿Pregunta real sobre ${mod.title}?","options":["Respuesta correcta","Distractor B","Distractor C","Distractor D"],"correctIndex":0,"order":1},
{"text":"¿Segunda pregunta sobre ${mod.title}?","options":["Op A correcta","Op B","Op C","Op D"],"correctIndex":0,"order":2},
{"text":"¿Tercera pregunta?","options":["Op A","Op B correcta","Op C","Op D"],"correctIndex":1,"order":3},
{"text":"¿Cuarta pregunta?","options":["Op A","Op B","Op C correcta","Op D"],"correctIndex":2,"order":4},
{"text":"¿Quinta pregunta?","options":["Op A","Op B","Op C","Op D correcta"],"correctIndex":3,"order":5},
{"text":"¿Sexta pregunta?","options":["Op A correcta","Op B","Op C","Op D"],"correctIndex":0,"order":6},
{"text":"¿Séptima pregunta?","options":["Op A","Op B correcta","Op C","Op D"],"correctIndex":1,"order":7},
{"text":"¿Octava pregunta?","options":["Op A","Op B","Op C correcta","Op D"],"correctIndex":2,"order":8},
{"text":"¿Novena pregunta?","options":["Op A","Op B","Op C","Op D correcta"],"correctIndex":3,"order":9},
{"text":"¿Décima pregunta?","options":["Op A correcta","Op B","Op C","Op D"],"correctIndex":0,"order":10}
]
REGLAS: exactamente 10 preguntas, opciones con texto real (no genérico), específicas al tema "${mod.title}", correctIndex entre 0-3. Sin markdown.`, 2000),
            ]);

            // Garantizar 10 lecciones completas — validar título, content y regenerar si faltan
            const validLessons = Array.isArray(lessons) ? lessons.filter((l: any) => l && typeof l === 'object') : [];

            // Si faltan lecciones (< 10), completar las faltantes
            const existingOrders = new Set(validLessons.map((l: any) => l.order));
            const missingOrders = Array.from({ length: 10 }, (_, i) => i + 1).filter((o) => !existingOrders.has(o));
            const extraLessons = await Promise.all(missingOrders.map(async (order) => {
              const isVideo = order === 1 || order === 10;
              const fallback = await bedrockJSON(
                `Genera la lección ${order} de 10 del módulo "${mod.title}" del curso "${structure.title}".
Responde ÚNICAMENTE con JSON: {"title":"Título real","order":${order},"type":"${isVideo ? 'video' : 'text'}","content":"<p>Contenido educativo real.</p><p>Segundo párrafo.</p>","duration":"${isVideo ? '5' : '8'} min","points":["Punto 1","Punto 2","Punto 3"],"tip":"Consejo práctico."}`, 600
              );
              return { type: isVideo ? 'video' : 'text', duration: isVideo ? '5 min' : '8 min', ...fallback, order };
            }));

            const allLessons = [...validLessons, ...extraLessons].sort((a: any, b: any) => a.order - b.order);

            // Validar y completar campos faltantes en cada lección
            const finalLessons = await Promise.all(allLessons.map(async (l: any) => {
              const needsContent = !l.content || l.content.trim().length < 10;
              const needsTitle = !l.title || l.title.trim().length < 2;
              if (!needsContent && !needsTitle) return l;
              const fallback = await bedrockJSON(
                `Genera datos para la lección ${l.order} "${needsTitle ? 'sin título' : l.title}" del módulo "${mod.title}".
Responde ÚNICAMENTE con JSON: {"title":"Título real específico","content":"<p>Párrafo 1 educativo.</p><p>Párrafo 2.</p>","points":["Punto 1","Punto 2","Punto 3"],"tip":"Consejo práctico."}`, 600
              );
              return {
                ...l,
                title: needsTitle ? (fallback.title ?? `Lección ${l.order} — ${mod.title}`) : l.title,
                content: needsContent ? (fallback.content ?? `<p>Contenido de lección ${l.order} sobre ${mod.title}.</p>`) : l.content,
                points: l.points?.length ? l.points : (fallback.points ?? [`Punto clave de ${mod.title}`]),
                tip: l.tip || fallback.tip || 'Repasa los puntos clave antes de continuar.',
              };
            }));

            // Garantizar 10 preguntas de quiz
            let finalQuestions = Array.isArray(questions) ? questions.filter((q: any) => q?.text && q?.options?.length === 4) : [];
            if (finalQuestions.length < 10) {
              const missing = 10 - finalQuestions.length;
              const extraQ = await bedrockJSON(
                `Genera ${missing} preguntas de opción múltiple sobre "${mod.title}". Array JSON: [{"text":"¿Pregunta?","options":["A","B","C","D"],"correctIndex":0,"order":${finalQuestions.length + 1}},...]. Sin markdown.`, 1000
              );
              if (Array.isArray(extraQ)) finalQuestions = [...finalQuestions, ...extraQ].slice(0, 10);
            }
            finalQuestions = shuffleQuestionOptions(finalQuestions).map((q: any, i: number) => ({ ...q, order: i + 1 }));

            return { order: mod.order, title: mod.title, description: mod.description,
              lessons: finalLessons,
              questions: finalQuestions };
          };

          const modulesWithContent = await Promise.all(structure.modules.map((mod: any) => generateModule(mod)));
          const result = { title: structure.title, description: structure.description,
            modules: modulesWithContent.sort((a: any, b: any) => a.order - b.order) };

          await saveAiJob(_jobId, { status: 'done', result });
        } catch (err: any) {
          await saveAiJob(_jobId, { status: 'error', error: err.message ?? 'Error desconocido' });
        }
        return ok({ ok: true }); // async invocation ignores response
      }

      // ── DISPATCH: first call — save job and fire async ────────────────────
      if (!input) return badRequest('input es requerido');
      // SSRF guard: block private IPs, metadata service, and non-HTTP schemes
      if (genMethod === 'url') {
        try {
          const parsed = new URL(input);
          if (!['http:', 'https:'].includes(parsed.protocol)) return badRequest('URL no permitida');
          const h = parsed.hostname;
          const blocked = [/^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./];
          if (blocked.some((r) => r.test(h)) || h === 'localhost' || h.endsWith('.local'))
            return badRequest('URL no permitida');
        } catch { return badRequest('URL inválida'); }
      }
      let context = input;
      if (genMethod === 'url') {
        try {
          const res = await fetch(input, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
          const html = await res.text();
          context = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 4000);
        } catch { return badRequest('No se pudo obtener contenido de la URL'); }
      }

      const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await saveAiJob(jobId, { status: 'processing' });

      // Fire-and-forget: invoke self async bypassing API GW timeout
      const asyncPayload = {
        requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
        rawPath: '/admin/courses/ai-generate',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ _jobId: jobId, _context: context }),
      };
      await lambdaClient.send(new LambdaInvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
        InvocationType: 'Event', // async — no wait for response
        Payload: Buffer.from(JSON.stringify(asyncPayload)),
      }));

      return ok({ jobId });
    }

    // ── POST /admin/courses/ai-publish ──────────────────────────────────────────
    if (path === '/admin/courses/ai-publish' && method === 'POST') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const { title, description, modules } = body as {
        title?: string;
        description?: string;
        modules?: {
          title: string;
          description: string;
          order: number;
          lessons: { title: string; order: number; type?: string; content?: string }[];
          questions?: { text: string; options: string[]; correctIndex: number; order: number }[];
        }[];
      };
      if (!title || !modules || !Array.isArray(modules)) return badRequest('title y modules son requeridos');

      const slug = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        + '-' + Math.random().toString(36).slice(2, 8);

      const publisherName = await getCallerName(event);
      const publisherRole = event.requestContext.authorizer?.lambda?.role ?? '';
      const publisherId = event.requestContext.authorizer?.lambda?.userId;

      // Suggest tags with AI (non-blocking — run before course creation)
      let suggestedTags: string[] = [];
      try {
        const tagPrompt = `Eres un experto en clasificación de cursos educativos. Sugiere entre 3 y 5 etiquetas (tags) relevantes para el siguiente curso, en español, cortas (1-3 palabras cada una).

Curso: "${title}"
Descripción: "${(description ?? '').slice(0, 300)}"

Responde ÚNICAMENTE con un array JSON de strings. Ejemplo: ["liderazgo","comunicación","gestión"]`;

        const tagRes = await bedrock.send(new InvokeModelCommand({
          modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 200,
            messages: [{ role: 'user', content: tagPrompt }],
          }),
        }));
        const tagText = JSON.parse(new TextDecoder().decode(tagRes.body)).content[0].text.trim();
        const cleaned = tagText.replace(/```json|```/g, '').trim();
        suggestedTags = JSON.parse(cleaned);
        if (!Array.isArray(suggestedTags)) suggestedTags = [];
      } catch { suggestedTags = []; }

      const course = await prisma.course.create({
        data: {
          title,
          slug,
          description: description ?? '',
          isActive: false,
          isPilot: false,
          tags: suggestedTags,
          createdByName: publisherName,
          evaluatorId: publisherRole === 'EVALUATOR' ? publisherId : null,
          evaluatorName: publisherRole === 'EVALUATOR' ? (publisherName ?? null) : null,
          modules: {
            create: modules.map((m) => ({
              title: m.title,
              description: m.description ?? '',
              order: m.order,
              duration: `${(m.lessons?.length ?? 0) * 5} min`,
              passingScore: 70,
              lessons: {
                // Use array index as order to avoid duplicate (moduleId, order) constraint
                create: (m.lessons ?? []).map((l: any, li: number) => ({
                  title: l.title,
                  order: li + 1,
                  duration: l.duration ?? (l.type === 'video' ? '5 min' : '8 min'),
                  type: l.content ? 'text' : (l.type ?? 'text'),
                  youtubeId: '',
                  content: l.content ?? null,
                  points: Array.isArray(l.points) ? l.points : [],
                  tip: l.tip ?? '',
                })),
              },
              questions: {
                // Use array index as order to avoid duplicate (moduleId, order) constraint
                create: shuffleQuestionOptions(m.questions ?? []).map((q, qi: number) => ({
                  text: q.text,
                  options: q.options,
                  correctIndex: Number(q.correctIndex),
                  order: qi + 1,
                })),
              },
            })),
          },
        },
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
      // Auto-create group chat for the new course
      await upsertChat(`group_${course.id}`, {
        type: 'GROUP',
        name: `Curso: ${course.title}`,
        participants: [],
      }).catch(() => {});

      // X-3: Generate images for lessons at orders 2, 6, 10 (non-fatal)
      try {
        await Promise.all(
          course.modules.flatMap((mod) =>
            mod.lessons
              .filter((l) => [2, 6, 10].includes(l.order))
              .map(async (lesson) => {
                const url = await generateLessonImage(lesson.title, mod.title, lesson.order);
                if (url) await prisma.lesson.update({ where: { id: lesson.id }, data: { imageUrl: url } });
              })
          )
        );
      } catch (e) { console.warn('[ImageGen] Batch image generation error:', e); }

      // X-4: Generate Polly audio for all lessons asynchronously (fire-and-forget)
      try {
        const allLessonIds = course.modules.flatMap((m: any) => m.lessons.map((l: any) => l.id));
        await lambdaClient.send(new LambdaInvokeCommand({
          FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
          InvocationType: 'Event', // async — returns immediately
          Payload: Buffer.from(JSON.stringify({
            requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
            rawPath: '/_internal/audio',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ _action: 'bulk-audio', lessonIds: allLessonIds, voiceId: 'Mia' }),
          })),
        }));
      } catch (e) { console.warn('[Polly] Failed to schedule bulk audio generation:', e); }

      return created({ ...course, suggestedTags });
    }

    // ── POST /admin/lessons/:lessonId/audio (Polly TTS) ────────────────────────
    const lessonAudioMatch = path.match(/^\/admin\/lessons\/([^/]+)\/audio$/);
    if (lessonAudioMatch && method === 'POST') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      try {
        const lessonId = lessonAudioMatch[1]!;
        const voiceId = (body as any).voiceId ?? 'Mia';
        console.log('[audio] START lessonId=%s voiceId=%s bucket=%s', lessonId, voiceId, S3_IMAGES_BUCKET);
        const allowedVoices = ['Mia', 'Lupe', 'Lucia', 'Sergio', 'Pedro'];
        if (!allowedVoices.includes(voiceId)) return badRequest('Voz no válida');

        const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
        if (!lesson) return notFound('Lección no encontrada');

        // Delete old audio from S3 if exists
        if (lesson.audioUrl) {
          const oldKey = s3KeyFromUrl(lesson.audioUrl);
          if (oldKey) await s3Client.send(new DeleteObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: oldKey })).catch(() => {});
        }

        const text = [lesson.title, lesson.content ?? '', ...(lesson.points ?? []), lesson.tip ?? ''].join('. ');
        console.log('[audio] calling Polly, text length=%d', text.length);
        const audioUrl = await generateLessonAudio(lessonId, text, voiceId);
        console.log('[audio] Polly result=%s', audioUrl ?? 'NULL');
        if (!audioUrl) return serverError('No se pudo generar el audio. Verifica permisos IAM de Polly.');

        const updated = await prisma.lesson.update({ where: { id: lessonId }, data: { audioUrl } });
        return ok(updated);
      } catch (e: any) {
        console.error('[audio] Error:', e?.message, e?.code, e?.name);
        return serverError(e?.message ?? 'Error generando audio con Polly');
      }
    }

    // ── POST /admin/lessons/:lessonId/regenerate (X-1) ─────────────────────────
    const lessonRegenMatch = path.match(/^\/admin\/lessons\/([^/]+)\/regenerate$/);
    if (lessonRegenMatch && method === 'POST') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const lessonId = lessonRegenMatch[1]!;
      const lesson = await prisma.lesson.findUnique({
        where: { id: lessonId },
        include: { module: { select: { title: true, course: { select: { title: true } } } } },
      });
      if (!lesson) return notFound('Lección no encontrada');
      const modTitle = lesson.module.title;
      const courseTitle = lesson.module.course.title;

      // Parse type/level/style/preview flags from request body
      const regenType = (body as any).type as 'text' | 'image' | 'infographic' | undefined ?? 'text';
      const regenLevel = (body as any).level as 'basic' | 'intermediate' | 'advanced' | undefined ?? 'intermediate';
      const regenStyle = (body as any).style as string | undefined;
      const previewMode = (body as any).preview as boolean ?? false;
      const combineMode = (body as any).combineMode as boolean ?? false;
      const previewData = (body as any).previewData as any;

      // ── Confirm phase: apply already-generated previewData to DB ────────────
      if (previewData && !previewMode) {
        if (regenType === 'text') {
          const updateData = combineMode ? {
            points: [...new Set([...(lesson.points ?? []), ...(Array.isArray(previewData.points) ? previewData.points : [])])],
            tip: previewData.tip ?? lesson.tip,
          } : {
            title: previewData.title ?? lesson.title,
            content: previewData.content ?? lesson.content,
            points: Array.isArray(previewData.points) ? previewData.points : lesson.points,
            tip: previewData.tip ?? lesson.tip,
          };
          const updated = await prisma.lesson.update({ where: { id: lessonId }, data: updateData });
          return ok(updated);
        }
        if ((regenType === 'image' || regenType === 'infographic') && previewData.imageUrl) {
          const updated = await prisma.lesson.update({ where: { id: lessonId }, data: { imageUrl: previewData.imageUrl } });
          return ok(updated);
        }
      }

      const bedrockJSONSimple = async (prompt: string, maxTokens = 2000): Promise<any> => {
        const res = await bedrock.send(new InvokeModelCommand({
          modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
        }));
        const raw = (JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text ?? '{}').replace(/```json\s*|```/g, '').trim();
        const match = raw.match(/[\[{][\s\S]*/);
        try { return JSON.parse(match?.[0] ?? '{}'); } catch { try { return JSON.parse(jsonrepair(match?.[0] ?? '{}')); } catch { return {}; } }
      };

      if (regenType === 'image') {
        // Regenerate the lesson image only (generate+upload to S3, then optionally save to DB)
        const imageUrl = await generateLessonImage(lesson.title, modTitle, lesson.order, { style: regenStyle });
        if (!imageUrl) return badRequest('No se pudo generar la imagen (posición de lección no soportada o error en Nova Canvas)');
        if (previewMode) return ok({ imageUrl, preview: true }); // return URL without saving
        const updated = await prisma.lesson.update({ where: { id: lessonId }, data: { imageUrl } });
        return ok(updated);
      }

      if (regenType === 'infographic') {
        // Generate infographic-style image with structured prompt
        const promptText = `Educational infographic for lesson "${lesson.title.slice(0, 60)}" from module "${modTitle.slice(0, 60)}", structured layout with sections and icons, professional design, no text labels, clean composition`;
        const imageUrl = await generateLessonImage(lesson.title, modTitle, lesson.order, { promptText, style: regenStyle });
        if (!imageUrl) return badRequest('No se pudo generar la infografía');
        if (previewMode) return ok({ imageUrl, preview: true }); // return URL without saving
        const updated = await prisma.lesson.update({ where: { id: lessonId }, data: { imageUrl } });
        return ok(updated);
      }

      // Default: type === 'text' — regenerate lesson content at specified level
      const levelInstructions: Record<string, string> = {
        basic:        'vocabulario simple y didáctico, frases cortas, ejemplos cotidianos, sin tecnicismos. Ideal para principiantes.',
        intermediate: 'lenguaje claro, ejemplos prácticos, estructura bien definida. Para estudiantes con conocimiento básico.',
        advanced:     'profundidad técnica, conceptos avanzados, terminología especializada. Para estudiantes con experiencia.',
      };
      const levelNote = levelInstructions[regenLevel] ?? levelInstructions.intermediate;

      const regen = await bedrockJSONSimple(
        `Eres experto en diseño instruccional. Regenera la lección "${lesson.title}" (orden ${lesson.order}) del módulo "${modTitle}" del curso "${courseTitle}".
Nivel de dificultad: ${regenLevel} — ${levelNote}
Responde ÚNICAMENTE con JSON: {"title":"Título específico","content":"<h3>Subtítulo</h3><p>Párrafo 1 educativo real.</p><ul><li>Punto A</li><li>Punto B</li></ul><p>Párrafo de cierre.</p>","points":["Punto clave 1","Punto clave 2","Punto clave 3"],"tip":"Consejo práctico."}
Genera contenido auténtico sobre el tema, diferente al existente. Voz activa en 2ª persona.`, 4000
      );
      const regenPayload = {
        title: regen.title ?? lesson.title,
        content: regen.content ?? lesson.content,
        points: Array.isArray(regen.points) ? regen.points : lesson.points,
        tip: regen.tip ?? lesson.tip,
      };
      if (previewMode) return ok({ ...regenPayload, preview: true }); // return without saving
      const updateData = combineMode ? {
        points: [...new Set([...(lesson.points ?? []), ...regenPayload.points])],
        tip: regenPayload.tip,
      } : regenPayload;
      const updated = await prisma.lesson.update({ where: { id: lessonId }, data: updateData });
      return ok(updated);
    }

    // ── POST /admin/modules/:moduleId/regenerate (X-1) ──────────────────────────
    const moduleRegenMatch = path.match(/^\/admin\/modules\/([^/]+)\/regenerate$/);
    if (moduleRegenMatch && method === 'POST') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const moduleId = moduleRegenMatch[1]!;
      const mod = await prisma.module.findUnique({
        where: { id: moduleId },
        include: { course: { select: { title: true } } },
      });
      if (!mod) return notFound('Módulo no encontrado');

      // Async job pattern (same as ai-generate)
      const jobId = `regen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await saveAiJob(jobId, { status: 'processing' });

      const asyncPayload = {
        requestContext: { http: { method: 'POST' }, authorizer: { lambda: { role: 'ADMIN', userId: 'system' } } },
        rawPath: '/admin/modules/_regen_worker',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ _jobId: jobId, _moduleId: moduleId, _moduleTitle: mod.title, _courseTitle: mod.course.title, _moduleOrder: mod.order }),
      };
      await lambdaClient.send(new LambdaInvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify(asyncPayload)),
      }));
      return ok({ jobId });
    }

    // ── Async worker for module regeneration ─────────────────────────────────
    if (path === '/admin/modules/_regen_worker' && method === 'POST') {
      const { _jobId, _moduleId, _moduleTitle, _courseTitle, _moduleOrder } = body as any;
      if (!_jobId || !_moduleId) return ok({ ok: true });
      try {
        const bedrockJSON2 = async (prompt: string, maxTokens = 2000): Promise<any> => {
          const res = await bedrock.send(new InvokeModelCommand({
            modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
            contentType: 'application/json', accept: 'application/json',
            body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
          }));
          const raw = (JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text ?? '{}').replace(/```json\s*|```/g, '').trim();
          const match = raw.match(/[\[{][\s\S]*/);
          try { return JSON.parse(match?.[0] ?? '{}'); } catch { try { return JSON.parse(jsonrepair(match?.[0] ?? '{}')); } catch { return {}; } }
        };

        const [newLessons, newQuestions] = await Promise.all([
          bedrockJSON2(`Eres experto en diseño instruccional. Genera las 10 lecciones del módulo "${_moduleTitle}" del curso "${_courseTitle}".
Responde ÚNICAMENTE con array JSON válido. Cada lección incluye: title, order, type, content, duration, points (array 3 frases), tip.
Lección 1 y 10: type "video". Lecciones 2-9: type "text" con HTML rico (<h3>,<ul><li>,<blockquote>,<p>). Voz activa 2ª persona.`, 6000),
          bedrockJSON2(`Genera exactamente 10 preguntas de opción múltiple sobre "${_moduleTitle}" del curso "${_courseTitle}".
Array JSON: [{"text":"¿Pregunta?","options":["A","B","C","D"],"correctIndex":0,"order":1},...]. 10 preguntas exactas.`, 2000),
        ]);

        // Replace all lessons and questions
        await prisma.$transaction([
          prisma.lesson.deleteMany({ where: { moduleId: _moduleId } }),
          prisma.question.deleteMany({ where: { moduleId: _moduleId } }),
        ]);
        const lessons = Array.isArray(newLessons) ? newLessons.slice(0, 10) : [];
        const questions = shuffleQuestionOptions(Array.isArray(newQuestions) ? newQuestions.slice(0, 10) : []);
        await prisma.lesson.createMany({
          data: lessons.map((l: any, i: number) => ({
            moduleId: _moduleId,
            title: l.title ?? `Lección ${i + 1}`,
            order: l.order ?? i + 1,
            duration: l.duration ?? '8 min',
            type: l.content ? 'text' : (l.type ?? 'text'),
            youtubeId: '',
            content: l.content ?? null,
            points: Array.isArray(l.points) ? l.points : [],
            tip: l.tip ?? '',
          })),
        });
        await prisma.question.createMany({
          data: questions.map((q: any, i: number) => ({
            moduleId: _moduleId,
            text: q.text ?? `Pregunta ${i + 1}`,
            options: Array.isArray(q.options) ? q.options : ['A', 'B', 'C', 'D'],
            correctIndex: Number(q.correctIndex ?? 0),
            order: q.order ?? i + 1,
          })),
        });
        await saveAiJob(_jobId, { status: 'done', result: { moduleId: _moduleId, lessonsCreated: lessons.length, questionsCreated: questions.length } });
      } catch (err: any) {
        await saveAiJob(_jobId, { status: 'error', error: err.message ?? 'Error' });
      }
      return ok({ ok: true });
    }

    // ── POST /admin/courses/:courseId/regenerate (X-1) ───────────────────────
    const courseRegenMatch = path.match(/^\/admin\/courses\/([^/]+)\/regenerate$/);
    if (courseRegenMatch && method === 'POST') {
      if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
      const courseId = courseRegenMatch[1]!;
      const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true, description: true } });
      if (!course) return notFound('Curso no encontrado');
      // Run FASE 1 synchronously (structure only — no publish)
      const structureRes = await bedrock.send(new InvokeModelCommand({
        modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        contentType: 'application/json', accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31', max_tokens: 1200,
          messages: [{ role: 'user', content: `Eres un experto en diseño instruccional. Para el curso "${course.title}" sobre: "${(course.description ?? '').slice(0, 500)}"
Genera una nueva estructura de módulos. Responde ÚNICAMENTE con JSON: {"modules":[{"order":1,"title":"Módulo 1","description":"Descripción breve"},...]}` }],
        }),
      }));
      const raw = (JSON.parse(new TextDecoder().decode(structureRes.body)).content?.[0]?.text ?? '{}').replace(/```json\s*|```/g, '').trim();
      const match = raw.match(/[\[{][\s\S]*/);
      let structure: any = {};
      try { structure = JSON.parse(match?.[0] ?? '{}'); } catch { try { structure = JSON.parse(jsonrepair(match?.[0] ?? '{}')); } catch { structure = {}; } }
      return ok({ courseId, title: course.title, modules: structure.modules ?? [] });
    }

    // ── GET /user/profile ───────────────────────────────────────────────────────
    if (path === '/user/profile' && method === 'GET') {
      if (!isAuthorized(event)) return forbidden('No autorizado');
      const userId = event.requestContext.authorizer?.lambda?.userId;
      if (!userId) return badRequest('userId no disponible');
      const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
      const attr = (name: string) => res.UserAttributes?.find((a) => a.Name === name)?.Value ?? '';
      return ok({
        username: userId,
        name: attr('name'),
        email: attr('email') || userId,
        phone: attr('phone_number'),
        bio: attr('custom:bio'),
        picture: attr('picture'),
      });
    }

    // ── PUT /user/profile ───────────────────────────────────────────────────────
    if (path === '/user/profile' && method === 'PUT') {
      if (!isAuthorized(event)) return forbidden('No autorizado');
      const userId = event.requestContext.authorizer?.lambda?.userId;
      if (!userId) return badRequest('userId no disponible');
      const { name, phone, bio, picture } = body as { name?: string; phone?: string; bio?: string; picture?: string };
      const attrs: { Name: string; Value: string }[] = [];
      if (name !== undefined) attrs.push({ Name: 'name', Value: name });
      if (phone !== undefined) attrs.push({ Name: 'phone_number', Value: phone });
      if (bio !== undefined) attrs.push({ Name: 'custom:bio', Value: bio });
      if (picture !== undefined) attrs.push({ Name: 'picture', Value: picture });
      if (attrs.length === 0) return badRequest('No hay campos para actualizar');
      await cognito.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
        UserAttributes: attrs,
      }));
      return ok({ updated: true });
    }

    return notFound('Ruta no encontrada');
  } catch (err) {
    return serverError(err);
  }
};
