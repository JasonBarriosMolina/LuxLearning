import { created, badRequest } from '../shared/response';
import { hashIp, type PlatformCtx } from './ctx';
import { sendSalesNotification, sendRequesterConfirmation } from './emails';

// Options must match apps/web/components/landing/DemoForm.tsx
export const ORG_TYPES = ['Colegio o escuela', 'Universidad', 'Empresa', 'Gobierno u ONG', 'Otro'];
export const SIZES = ['Menos de 50', '50 a 200', '201 a 1,000', 'Más de 1,000'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PER_IP_PER_HOUR = 5;
const MAX_PER_EMAIL_PER_DAY = 3;

export type DemoRequest = {
  name: string;
  email: string;
  phone: string | null;
  organization: string;
  orgType: string;
  size: string;
  message: string | null;
  source: string;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Validates the public form body. Returns the clean request or a user-facing error. */
export function parseDemoRequest(body: Record<string, unknown>): { ok: true; value: DemoRequest } | { ok: false; error: string } {
  const name = str(body.name);
  const email = str(body.email).toLowerCase();
  const phone = str(body.phone);
  const organization = str(body.organization);
  const orgType = str(body.orgType);
  const size = str(body.size);
  const message = str(body.message);
  const source = str(body.source) || 'landing';

  if (name.length < 2 || name.length > 120) return { ok: false, error: 'Escribe tu nombre completo.' };
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: 'Escribe un correo válido.' };
  if (phone.length > 40) return { ok: false, error: 'El teléfono es demasiado largo.' };
  if (organization.length < 2 || organization.length > 160) return { ok: false, error: 'Escribe el nombre de tu institución o empresa.' };
  if (!ORG_TYPES.includes(orgType)) return { ok: false, error: 'Elige el tipo de institución.' };
  if (!SIZES.includes(size)) return { ok: false, error: 'Elige un número aproximado de estudiantes.' };
  if (message.length > 2000) return { ok: false, error: 'El mensaje no puede pasar de 2,000 caracteres.' };

  return {
    ok: true,
    value: { name, email, phone: phone || null, organization, orgType, size, message: message || null, source: source.slice(0, 40) },
  };
}


/** POST /public/demo-requests — no auth. Stores the lead, then notifies sales and the requester. */
export async function handleDemoRequests(ctx: PlatformCtx): Promise<any | null> {
  if (!(ctx.method === 'POST' && ctx.path === '/public/demo-requests')) return null;

  // Honeypot: people never see the "website" field, bots fill it. Pretend success.
  if (str(ctx.body.website)) return created({ received: true });

  const parsed = parseDemoRequest(ctx.body);
  if (!parsed.ok) return badRequest(parsed.error);
  const lead = parsed.value;

  const sql = await ctx.getSql();
  const ipHash = hashIp(ctx.event.requestContext.http.sourceIp ?? 'unknown');

  const [{ by_ip, by_email }] = (await sql`
    SELECT
      count(*) FILTER (WHERE ip_hash = ${ipHash} AND created_at > now() - interval '1 hour')::int AS by_ip,
      count(*) FILTER (WHERE lower(email) = ${lead.email} AND created_at > now() - interval '1 day')::int AS by_email
    FROM leads
    WHERE created_at > now() - interval '1 day'
  `) as { by_ip: number; by_email: number }[];
  if (by_ip >= MAX_PER_IP_PER_HOUR || by_email >= MAX_PER_EMAIL_PER_DAY) {
    return badRequest('Ya recibimos varias solicitudes tuyas. Te contactaremos pronto, o escríbenos a sales@luxlearning.academy.');
  }

  const userAgent = (ctx.event.headers?.['user-agent'] ?? '').slice(0, 300);
  const [row] = (await sql`
    INSERT INTO leads (name, email, phone, organization, org_type, size_range, message, source, ip_hash, user_agent)
    VALUES (${lead.name}, ${lead.email}, ${lead.phone}, ${lead.organization}, ${lead.orgType}, ${lead.size},
            ${lead.message}, ${lead.source}, ${ipHash}, ${userAgent})
    RETURNING id
  `) as { id: string }[];

  // The lead is already saved; a mail failure must not make the visitor retry and duplicate it.
  const results = await Promise.allSettled([
    sendSalesNotification({ ...lead, id: row!.id }),
    sendRequesterConfirmation(lead),
  ]);
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[demo-requests] email ${i === 0 ? 'sales' : 'requester'} failed:`, r.reason);
  });

  return created({ received: true });
}
