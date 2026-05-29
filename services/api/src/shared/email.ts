import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient, { marshallOptions: { removeUndefinedValues: true } });

const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@luxlearning.com';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://luxlearning.com';
const TABLE = process.env.DYNAMO_TABLE_EMAIL_TEMPLATES ?? 'LuxEmailTemplates';

export type EmailTemplateType =
  | 'REFLECTION_APPROVED'
  | 'REFLECTION_REJECTED'
  | 'REFLECTION_RECONSIDERED'
  | 'TASK_ASSIGNED'
  | 'TASK_DUE_SOON'
  | 'MESSAGE_UNREAD'
  | 'COURSE_UPDATED'
  | 'WELCOME'
  | 'ENROLLMENT';

const EMAIL_SUBJECT_PREFIX = 'Lux Learning - Notificación';

const SIGNATURE_HTML = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
  <strong>Lux Learning Team</strong> | <a href="${FRONTEND_URL}" style="color:#6366f1;text-decoration:none;">Lux Learning</a>
</div>`;

// Default templates used when DynamoDB doesn't have a custom one yet
const DEFAULT_TEMPLATES: Record<EmailTemplateType, { subject: string; htmlBody: string }> = {
  REFLECTION_APPROVED: {
    subject: 'Tu reflexión fue aprobada',
    htmlBody: `<h2 style="color:#059669;">✅ Reflexión Aprobada</h2>
<p>Hola <strong>{{studentName}}</strong>,</p>
<p>Tu reflexión del módulo <strong>{{moduleTitle}}</strong> fue aprobada.</p>
<p><strong>Feedback del evaluador:</strong></p>
<blockquote style="border-left:4px solid #059669;padding-left:12px;color:#555;">{{feedback}}</blockquote>
<p>Da click al siguiente enlace para ver esta información: <a href="{{frontendUrl}}/student/reflections">Ver mis reflexiones</a></p>`,
  },
  REFLECTION_REJECTED: {
    subject: 'Tu reflexión necesita revisión',
    htmlBody: `<h2 style="color:#dc2626;">✍️ Reflexión Necesita Revisión</h2>
<p>Hola <strong>{{studentName}}</strong>,</p>
<p>Tu reflexión del módulo <strong>{{moduleTitle}}</strong> necesita ser revisada.</p>
<p><strong>Comentarios del evaluador:</strong></p>
<blockquote style="border-left:4px solid #dc2626;padding-left:12px;color:#555;">{{feedback}}</blockquote>
<p>Da click al siguiente enlace para reenviar tu reflexión: <a href="{{frontendUrl}}/student/reflections">Ver mis reflexiones</a></p>`,
  },
  REFLECTION_RECONSIDERED: {
    subject: 'Tu reflexión fue reconsiderada y aprobada',
    htmlBody: `<h2 style="color:#059669;">✅ Reflexión Reconsiderada y Aprobada</h2>
<p>Hola <strong>{{studentName}}</strong>,</p>
<p>Tu reflexión del módulo <strong>{{moduleTitle}}</strong> fue rechazada inicialmente por el sistema, pero un evaluador la revisó y decidió aprobarla.</p>
<p><strong>Razón de la reconsideración:</strong></p>
<blockquote style="border-left:4px solid #059669;padding-left:12px;color:#555;">{{reason}}</blockquote>
<p>Da click al siguiente enlace para ver esta información: <a href="{{frontendUrl}}/student/reflections">Ver mis reflexiones</a></p>`,
  },
  TASK_ASSIGNED: {
    subject: 'Se te asignó una nueva tarea',
    htmlBody: `<h2 style="color:#6366f1;">📋 Nueva Tarea Asignada</h2>
<p>Hola <strong>{{studentName}}</strong>,</p>
<p>Se te ha asignado una nueva tarea: <strong>{{taskTitle}}</strong></p>
<p>{{#if courseTitle}}<span>Curso: <strong>{{courseTitle}}</strong></span>{{/if}}</p>
<p>Fecha límite: <strong>{{dueDate}}</strong></p>
<p>Da click al siguiente enlace para ver esta información: <a href="{{frontendUrl}}/student/tasks">Ver mis tareas</a></p>`,
  },
  TASK_DUE_SOON: {
    subject: 'Tienes una tarea por vencer',
    htmlBody: `<h2 style="color:#d97706;">⏰ Tarea Por Vencer</h2>
<p>Hola <strong>{{studentName}}</strong>,</p>
<p>Tu tarea <strong>{{taskTitle}}</strong> vence en <strong>{{daysLeft}} día(s)</strong>.</p>
<p>Da click al siguiente enlace para ver esta información: <a href="{{frontendUrl}}/student/tasks">Ver mis tareas</a></p>`,
  },
  MESSAGE_UNREAD: {
    subject: 'Tienes un mensaje sin leer',
    htmlBody: `<h2 style="color:#6366f1;">💬 Mensaje Sin Leer</h2>
<p>Hola <strong>{{recipientName}}</strong>,</p>
<p><strong>{{senderName}}</strong> te envió un mensaje hace más de 1 hora que no has leído:</p>
<blockquote style="border-left:4px solid #6366f1;padding-left:12px;color:#555;">{{messagePreview}}</blockquote>
<p>Da click al siguiente enlace para ver esta información: <a href="{{frontendUrl}}/messages">Ir a mensajes</a></p>`,
  },
  COURSE_UPDATED: {
    subject: 'Tu curso fue actualizado',
    htmlBody: `<h2 style="color:#6366f1;">📚 Curso Actualizado</h2>
<p>Hola <strong>{{studentName}}</strong>,</p>
<p>El curso <strong>{{courseTitle}}</strong> ha sido actualizado con nuevo contenido.</p>
<p>Da click al siguiente enlace para ver esta información: <a href="{{frontendUrl}}/dashboard">Ir al dashboard</a></p>`,
  },
  WELCOME: {
    subject: 'Bienvenido a Lux Learning',
    htmlBody: `<h2 style="color:#6366f1;">👋 Bienvenido a Lux Learning</h2>
<p>Hola <strong>{{studentName}}</strong>,</p>
<p>Tu cuenta ha sido creada exitosamente en Lux Learning.</p>
<p>Da click al siguiente enlace para iniciar sesión: <a href="{{frontendUrl}}">Ir a Lux Learning</a></p>`,
  },
  ENROLLMENT: {
    subject: 'Te inscribieron en un curso',
    htmlBody: `<h2 style="color:#6366f1;">🎓 Inscripción en Curso</h2>
<p>Hola <strong>{{studentName}}</strong>,</p>
<p>Fuiste inscrito en el curso <strong>{{courseTitle}}</strong>.</p>
<p>Da click al siguiente enlace para ver esta información: <a href="{{frontendUrl}}/dashboard">Ir al dashboard</a></p>`,
  },
};

// Render a template by replacing {{varName}} placeholders
function renderTemplate(html: string, vars: Record<string, string>): string {
  const frontendVars = { frontendUrl: FRONTEND_URL, ...vars };
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => frontendVars[key] ?? '');
}

// Get template from DDB, fallback to default
async function getTemplate(type: EmailTemplateType): Promise<{ subject: string; htmlBody: string }> {
  try {
    const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'EMAIL_TEMPLATE', sk: type } }));
    if (result.Item?.subject && result.Item?.htmlBody) {
      return { subject: result.Item.subject as string, htmlBody: result.Item.htmlBody as string };
    }
  } catch { /* fallback */ }
  return DEFAULT_TEMPLATES[type];
}

// Send an email using a stored template with variable substitution
export async function sendTemplatedEmail(
  to: string,
  type: EmailTemplateType,
  vars: Record<string, string>
): Promise<void> {
  const template = await getTemplate(type);
  const subject = `${EMAIL_SUBJECT_PREFIX}: ${renderTemplate(template.subject, vars)}`;
  const body = renderTemplate(template.htmlBody, vars) + SIGNATURE_HTML;

  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">${body}</body></html>`, Charset: 'UTF-8' } },
    },
  }));
}

// Get all templates (for admin UI)
export async function getAllEmailTemplates(): Promise<Array<{ type: string; subject: string; htmlBody: string; updatedAt?: string; updatedBy?: string }>> {
  const types = Object.keys(DEFAULT_TEMPLATES) as EmailTemplateType[];
  const results = await Promise.all(types.map(async (type) => {
    try {
      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'EMAIL_TEMPLATE', sk: type } }));
      if (r.Item) return { type, subject: r.Item.subject as string, htmlBody: r.Item.htmlBody as string, updatedAt: r.Item.updatedAt as string, updatedBy: r.Item.updatedBy as string };
    } catch { /* fallback */ }
    return { type, ...DEFAULT_TEMPLATES[type] };
  }));
  return results;
}

// Save a template (for admin UI)
export async function saveEmailTemplate(type: string, subject: string, htmlBody: string, updatedBy: string): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { pk: 'EMAIL_TEMPLATE', sk: type, subject, htmlBody, updatedAt: new Date().toISOString(), updatedBy },
  }));
}
