// Email templates and S3 file presign domain handler for lux-admin.
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getAllEmailTemplates, saveEmailTemplate } from '../shared/email';
import { batchTranslate } from '../shared/translate';
import { ok, badRequest, forbidden } from '../shared/response';
import { AdminCtx, isAdmin, isAuthorized, s3Client, S3_IMAGES_BUCKET } from './ctx';

export async function handleFiles(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, userId, body } = ctx;

  // GET /admin/email-templates — list all email templates
  if (method === 'GET' && path === '/admin/email-templates') {
    const rawLangEt = event.queryStringParameters?.lang ?? 'es';
    const langEt = ['en', 'es'].includes(rawLangEt) ? rawLangEt : 'es';
    let templates = await getAllEmailTemplates();
    if (langEt !== 'es' && templates.length > 0) {
      const translations = await batchTranslate(
        templates.map((tpl: any) => ({ type: 'emailTemplate' as const, id: tpl.type, fields: { subject: tpl.subject, htmlBody: tpl.htmlBody } })),
        langEt
      );
      templates = templates.map((tpl: any) => {
        const tr = translations.get(`emailTemplate#${tpl.type}`);
        return tr ? { ...tpl, subject: (tr.subject as string) ?? tpl.subject, htmlBody: (tr.htmlBody as string) ?? tpl.htmlBody } : tpl;
      });
    }
    return ok(templates);
  }

  // PUT /admin/email-templates/:type — update a template (admin only)
  const emailTemplateMatch = path.match(/^\/admin\/email-templates\/([A-Z_]+)$/);
  if (method === 'PUT' && emailTemplateMatch) {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const type = emailTemplateMatch[1]!;
    const { subject, htmlBody } = body as { subject: string; htmlBody: string };
    if (!subject || !htmlBody) return badRequest('subject and htmlBody required');
    if (subject.length > 500) return badRequest('subject excede 500 caracteres');
    if (htmlBody.length > 100_000) return badRequest('htmlBody excede 100,000 caracteres');
    const safeHtml = htmlBody
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<object[\s\S]*?<\/object>/gi, '')
      .replace(/<embed[^>]*>/gi, '')
      .replace(/javascript\s*:/gi, 'nojavascript:')
      .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');
    await saveEmailTemplate(type, subject, safeHtml, userId);
    return ok({ saved: true });
  }

  // POST /admin/files/presign — generate S3 presigned upload URL (tasks + resources)
  if (method === 'POST' && path === '/admin/files/presign') {
    if (!isAuthorized(event)) return forbidden('Se requiere rol de administrador o evaluador');
    const { fileName, fileType, folder = 'uploads' } = body as { fileName?: string; fileType?: string; folder?: string };
    if (!fileName || !fileType) return badRequest('fileName y fileType son requeridos');

    const ALLOWED_TYPES = new Set([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/pdf',
      'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
      'video/mp4', 'video/webm',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]);
    if (!ALLOWED_TYPES.has(fileType)) return badRequest('Tipo de archivo no permitido');

    const safeFolder = ['tasks', 'resources', 'uploads'].includes(folder) ? folder : 'uploads';
    const ext = fileName.split('.').pop()?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
    const fileKey = `${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const command = new PutObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: fileKey, ContentType: fileType });
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });
    const publicUrl = `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${fileKey}`;
    return ok({ uploadUrl, fileKey, publicUrl });
  }

  return null; // not handled by this domain
}
