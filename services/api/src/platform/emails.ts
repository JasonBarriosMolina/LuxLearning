import { SendEmailCommand } from '@aws-sdk/client-ses';
import { ses, FROM_EMAIL, SALES_EMAIL, HQ_URL } from './ctx';
import type { DemoRequest } from './demo-requests';

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
