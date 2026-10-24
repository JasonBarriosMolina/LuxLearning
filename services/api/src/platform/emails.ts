import { SendEmailCommand } from '@aws-sdk/client-ses';
import { ses, FROM_EMAIL, SALES_EMAIL, TALENT_EMAIL, HQ_URL } from './ctx';
import type { DemoRequest } from './demo-requests';
import type { TeacherApplication } from './teacher-applications';

function esc(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(inner: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1D3247;">
  <div style="padding:24px 0;border-bottom:3px solid #E2BA50;"><strong style="font-size:18px;color:#17527E;">Lux Learning</strong></div>
  <div style="padding:24px 0;font-size:15px;line-height:1.6;">${inner}</div>
  <div style="padding-top:16px;border-top:1px solid #DCE6EF;font-size:12px;color:#7A8DA0;">Lux Learning · luxlearning.academy</div>
</div>`;
}

const ROW = (label: string, value: string | null | undefined) =>
  value ? `<tr><td style="padding:6px 16px 6px 0;color:#7A8DA0;vertical-align:top;">${label}</td><td style="padding:6px 0;">${esc(value)}</td></tr>` : '';

/** Tells the sales team a new demo request arrived. Reply-To is the requester. */
export async function sendSalesNotification(lead: DemoRequest & { id: string }): Promise<void> {
  const html = layout(`
    <p style="margin:0 0 16px;font-size:17px;"><strong>Nueva solicitud de demo</strong></p>
    <table style="border-collapse:collapse;font-size:14px;">
      ${ROW('Nombre', lead.name)}
      ${ROW('Correo', lead.email)}
      ${ROW('Teléfono', lead.phone)}
      ${ROW('Institución', lead.organization)}
      ${ROW('Tipo', lead.orgType)}
      ${ROW('Tamaño', lead.size)}
      ${ROW('Mensaje', lead.message)}
    </table>
    <p style="margin:24px 0 0;"><a href="${HQ_URL}/prospectos/${lead.id}" style="color:#17527E;font-weight:bold;">Ver en Lux HQ</a></p>`);
  await ses.send(new SendEmailCommand({
    Source: `Lux Learning <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [SALES_EMAIL] },
    ReplyToAddresses: [lead.email],
    Message: {
      Subject: { Data: `Nueva solicitud de demo: ${lead.organization}`, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  }));
}

/** Confirms to the requester that the request was received. */
export async function sendRequesterConfirmation(lead: DemoRequest): Promise<void> {
  const firstName = lead.name.split(/\s+/)[0];
  const html = layout(`
    <p style="margin:0 0 16px;">Hola, ${esc(firstName)}:</p>
    <p style="margin:0 0 16px;">Recibimos tu solicitud de demo para <strong>${esc(lead.organization)}</strong>. En menos de un día hábil te escribiremos para elegir el horario que mejor te funcione.</p>
    <p style="margin:0 0 16px;">Si quieres contarnos algo más mientras tanto, solo responde a este correo.</p>
    <p style="margin:0;">El equipo de Lux Learning</p>`);
  await ses.send(new SendEmailCommand({
    Source: `Lux Learning <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [lead.email] },
    ReplyToAddresses: [SALES_EMAIL],
    Message: {
      Subject: { Data: 'Recibimos tu solicitud de demo', Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  }));
}

/** Tells the talent team a teacher applied, with the answers that matter for a first read. */
export async function sendTalentNotification(app: TeacherApplication & { id: string }): Promise<void> {
  const a = app.answers;
  const areas = [...a.areas.filter((x) => x !== 'Otra'), ...(a.areaOther ? [a.areaOther] : [])].join(', ');
  const html = layout(`
    <p style="margin:0 0 16px;font-size:17px;"><strong>Nueva postulación de profesor</strong></p>
    <table style="border-collapse:collapse;font-size:14px;">
      ${ROW('Nombre', app.name)}
      ${ROW('Correo', app.email)}
      ${ROW('Teléfono', app.phone)}
      ${ROW('Ubicación', [app.city, app.country].filter(Boolean).join(', '))}
      ${ROW('Perfil', app.profileUrl)}
      ${ROW('Áreas', areas)}
      ${ROW('Experiencia', `${a.yearsProfessional} años profesional · ${a.yearsTeaching} enseñando`)}
      ${ROW('Formación', a.education)}
      ${ROW('Clases en vivo', a.liveInterest)}
      ${ROW('Quiere', a.roles.join(', '))}
      ${ROW('Disponibilidad', `${a.hoursPerWeek} horas por semana`)}
      ${ROW('Primer curso', a.courseTopic)}
      ${ROW('Para', a.courseAudience)}
    </table>
    <p style="margin:24px 0 0;"><a href="${HQ_URL}/talento/${app.id}" style="color:#17527E;font-weight:bold;">Ver la postulación completa en Lux HQ</a></p>`);
  await ses.send(new SendEmailCommand({
    Source: `Lux Learning <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [TALENT_EMAIL] },
    ReplyToAddresses: [app.email],
    Message: {
      Subject: { Data: `Nueva postulación: ${app.name} · ${app.answers.courseTopic}`, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  }));
}

// First draft of the onboarding path; to be refined with the product owner.
const ONBOARDING_STEPS = [
  ['Revisamos tu perfil', 'Leemos tu postulación con calma. Te escribiremos en un máximo de 5 días hábiles.'],
  ['Conversamos contigo', 'Si tu perfil encaja, agendamos una entrevista corta para conocerte y hablar de tu curso.'],
  ['Onboarding', 'Te mostramos la plataforma y te acompañamos a diseñar tu primer curso paso a paso.'],
  ['Publicas tu curso', 'Cuando tu curso esté listo, lo publicamos y empiezas a acompañar a tus estudiantes.'],
];

/** Confirms the application to the applicant and explains what happens next. */
export async function sendApplicantConfirmation(app: TeacherApplication): Promise<void> {
  const firstName = app.name.split(/\s+/)[0];
  const steps = ONBOARDING_STEPS.map(([title, text], i) => `
    <tr>
      <td style="padding:8px 14px 8px 0;vertical-align:top;"><span style="display:inline-block;width:26px;height:26px;line-height:26px;border-radius:13px;background:#17527E;color:#fff;text-align:center;font-weight:bold;font-size:13px;">${i + 1}</span></td>
      <td style="padding:8px 0;"><strong>${title}</strong><br><span style="color:#4C6075;">${text}</span></td>
    </tr>`).join('');
  const html = layout(`
    <p style="margin:0 0 16px;">Hola, ${esc(firstName)}:</p>
    <p style="margin:0 0 16px;">Gracias por querer enseñar con Lux Learning. Recibimos tu postulación y la idea de tu curso <strong>${esc(app.answers.courseTopic)}</strong>.</p>
    <p style="margin:0 0 8px;"><strong>Esto es lo que sigue:</strong></p>
    <table style="border-collapse:collapse;font-size:14px;margin:0 0 16px;">${steps}</table>
    <p style="margin:0 0 16px;">Si quieres contarnos algo más o compartir material, solo responde a este correo.</p>
    <p style="margin:0;">El equipo de Lux Learning</p>`);
  await ses.send(new SendEmailCommand({
    Source: `Lux Learning <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [app.email] },
    ReplyToAddresses: [TALENT_EMAIL],
    Message: {
      Subject: { Data: 'Recibimos tu postulación para enseñar con Lux', Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  }));
}
