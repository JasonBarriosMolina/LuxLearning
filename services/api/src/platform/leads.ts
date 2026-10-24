import { ok, created, badRequest, forbidden, notFound } from '../shared/response';
import { hasGroup, type PlatformCtx, type Sql } from './ctx';

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'WON', 'LOST'] as const;
type LeadStatus = (typeof LEAD_STATUSES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_FIELDS = 'id, created_at, updated_at, name, email, phone, organization, org_type, size_range, source, status, owner_email';

async function audit(sql: Sql, actor: string, action: string, targetId: string, details: Record<string, unknown>) {
  await sql`
    INSERT INTO staff_audit_log (actor_email, action, target_type, target_id, details)
    VALUES (${actor}, ${action}, 'lead', ${targetId}, ${JSON.stringify(details)}::jsonb)
  `;
}

/** /hq/me and /hq/leads* — staff only (JWT checked by API Gateway, groups checked here). */
export async function handleLeads(ctx: PlatformCtx): Promise<any | null> {
  const { method, path, staff } = ctx;
  if (!path.startsWith('/hq/')) return null;

  if (method === 'GET' && path === '/hq/me') {
    if (!staff) return forbidden('No autorizado');
    return ok(staff);
  }

  if (!path.startsWith('/hq/leads')) return null;
  if (!hasGroup(staff, 'MARKETING')) return forbidden('Tu rol no tiene acceso a prospectos');
  const actor = staff!.email;
  const sql = await ctx.getSql();

  // GET /hq/leads?status=NEW&q=texto
  if (method === 'GET' && path === '/hq/leads') {
    const qs = ctx.event.queryStringParameters ?? {};
    const status = LEAD_STATUSES.includes(qs.status as LeadStatus) ? qs.status! : null;
    const q = (qs.q ?? '').trim().slice(0, 100);
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await sql(
      `SELECT ${LIST_FIELDS} FROM leads
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2 = '' OR name ILIKE $3 OR email ILIKE $3 OR organization ILIKE $3)
       ORDER BY created_at DESC LIMIT 200`,
      [status, q, like],
    );
    const counts = await sql`SELECT status, count(*)::int AS total FROM leads GROUP BY status`;
    return ok({ leads: rows, counts });
  }

  const idMatch = path.match(/^\/hq\/leads\/([^/]+)(\/notes)?$/);
  if (!idMatch) return null;
  const id = idMatch[1]!;
  if (!UUID_RE.test(id)) return notFound('Prospecto no encontrado');
  const isNotes = !!idMatch[2];

  // GET /hq/leads/{id}
  if (method === 'GET' && !isNotes) {
    const [lead] = await sql`SELECT * FROM leads WHERE id = ${id}`;
    if (!lead) return notFound('Prospecto no encontrado');
    delete (lead as Record<string, unknown>).ip_hash;
    const notes = await sql`SELECT id, author_email, body, created_at FROM lead_notes WHERE lead_id = ${id} ORDER BY created_at DESC`;
    const history = await sql`SELECT from_status, to_status, changed_by, changed_at FROM lead_status_history WHERE lead_id = ${id} ORDER BY changed_at DESC`;
    return ok({ lead, notes, history });
  }

  // PATCH /hq/leads/{id}  { status?, ownerEmail? }
  if (method === 'PATCH' && !isNotes) {
    const status = ctx.body.status as LeadStatus | undefined;
    const ownerEmail = ctx.body.ownerEmail as string | null | undefined;
    if (status !== undefined && !LEAD_STATUSES.includes(status)) return badRequest('Estado no válido');
    if (ownerEmail !== undefined && ownerEmail !== null && (typeof ownerEmail !== 'string' || ownerEmail.length > 254)) {
      return badRequest('Responsable no válido');
    }
    if (status === undefined && ownerEmail === undefined) return badRequest('Nada que actualizar');

    const [current] = (await sql`SELECT status, owner_email FROM leads WHERE id = ${id}`) as { status: string; owner_email: string | null }[];
    if (!current) return notFound('Prospecto no encontrado');

    const [lead] = await sql(
      `UPDATE leads SET
         status = COALESCE($2::text, status),
         owner_email = CASE WHEN $3::boolean THEN $4::text ELSE owner_email END,
         updated_at = now()
       WHERE id = $1
       RETURNING ${LIST_FIELDS}`,
      [id, status ?? null, ownerEmail !== undefined, ownerEmail ?? null],
    );

    if (status && status !== current.status) {
      await sql`
        INSERT INTO lead_status_history (lead_id, from_status, to_status, changed_by)
        VALUES (${id}, ${current.status}, ${status}, ${actor})
      `;
    }
    await audit(sql, actor, 'lead.update', id, { status, ownerEmail, before: current });
    return ok(lead);
  }

  // POST /hq/leads/{id}/notes  { body }
  if (method === 'POST' && isNotes) {
    const body = typeof ctx.body.body === 'string' ? ctx.body.body.trim() : '';
    if (!body || body.length > 5000) return badRequest('Escribe una nota de hasta 5,000 caracteres.');
    const [exists] = await sql`SELECT 1 FROM leads WHERE id = ${id}`;
    if (!exists) return notFound('Prospecto no encontrado');
    const [note] = await sql`
      INSERT INTO lead_notes (lead_id, author_email, body) VALUES (${id}, ${actor}, ${body})
      RETURNING id, author_email, body, created_at
    `;
    await sql`UPDATE leads SET updated_at = now() WHERE id = ${id}`;
    await audit(sql, actor, 'lead.note', id, { noteId: (note as { id: string }).id });
    return created(note);
  }

  return null;
}
