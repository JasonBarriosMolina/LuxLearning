import { ok, created, badRequest, forbidden, notFound } from '../shared/response';
import { hasGroup, type PlatformCtx, type Sql } from './ctx';

// Teacher applications pipeline (HQ "Profesores" tray), separate from institution leads.
export const TEACHER_STATUSES = ['NEW', 'REVIEWING', 'INTERVIEW', 'ONBOARDING', 'ACTIVE', 'REJECTED'] as const;
type TeacherStatus = (typeof TEACHER_STATUSES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_FIELDS = `id, created_at, updated_at, name, email, phone, country, city, status, owner_email,
  answers->>'courseTopic' AS course_topic, answers->'areas' AS areas, answers->>'liveInterest' AS live_interest`;

async function audit(sql: Sql, actor: string, action: string, targetId: string, details: Record<string, unknown>) {
  await sql`
    INSERT INTO staff_audit_log (actor_email, action, target_type, target_id, details)
    VALUES (${actor}, ${action}, 'teacher_application', ${targetId}, ${JSON.stringify(details)}::jsonb)
  `;
}

/** /hq/teachers* — staff with OWNER or MARKETING (JWT checked by API Gateway, groups checked here). */
export async function handleTeachers(ctx: PlatformCtx): Promise<any | null> {
  const { method, path, staff } = ctx;
  if (!path.startsWith('/hq/teachers')) return null;
  if (!hasGroup(staff, 'MARKETING')) return forbidden('Tu rol no tiene acceso a postulaciones');
  const actor = staff!.email;
  const sql = await ctx.getSql();

  // GET /hq/teachers?status=NEW&q=texto
  if (method === 'GET' && path === '/hq/teachers') {
    const qs = ctx.event.queryStringParameters ?? {};
    const status = TEACHER_STATUSES.includes(qs.status as TeacherStatus) ? qs.status! : null;
    const q = (qs.q ?? '').trim().slice(0, 100);
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await sql(
      `SELECT ${LIST_FIELDS} FROM teacher_applications
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2 = '' OR name ILIKE $3 OR email ILIKE $3 OR answers->>'courseTopic' ILIKE $3)
       ORDER BY created_at DESC LIMIT 200`,
      [status, q, like],
    );
    const counts = await sql`SELECT status, count(*)::int AS total FROM teacher_applications GROUP BY status`;
    return ok({ applications: rows, counts });
  }

  const idMatch = path.match(/^\/hq\/teachers\/([^/]+)(\/notes)?$/);
  if (!idMatch) return null;
  const id = idMatch[1]!;
  if (!UUID_RE.test(id)) return notFound('Postulación no encontrada');
  const isNotes = !!idMatch[2];

  // GET /hq/teachers/{id}
  if (method === 'GET' && !isNotes) {
    const [application] = await sql`SELECT * FROM teacher_applications WHERE id = ${id}`;
    if (!application) return notFound('Postulación no encontrada');
    delete (application as Record<string, unknown>).ip_hash;
    const notes = await sql`SELECT id, author_email, body, created_at FROM teacher_application_notes WHERE application_id = ${id} ORDER BY created_at DESC`;
    const history = await sql`SELECT from_status, to_status, changed_by, changed_at FROM teacher_application_status_history WHERE application_id = ${id} ORDER BY changed_at DESC`;
    return ok({ application, notes, history });
  }

  // PATCH /hq/teachers/{id}  { status?, ownerEmail? }
  if (method === 'PATCH' && !isNotes) {
    const status = ctx.body.status as TeacherStatus | undefined;
    const ownerEmail = ctx.body.ownerEmail as string | null | undefined;
    if (status !== undefined && !TEACHER_STATUSES.includes(status)) return badRequest('Estado no válido');
    if (ownerEmail !== undefined && ownerEmail !== null && (typeof ownerEmail !== 'string' || ownerEmail.length > 254)) {
      return badRequest('Responsable no válido');
    }
    if (status === undefined && ownerEmail === undefined) return badRequest('Nada que actualizar');

    const [current] = (await sql`SELECT status, owner_email FROM teacher_applications WHERE id = ${id}`) as { status: string; owner_email: string | null }[];
    if (!current) return notFound('Postulación no encontrada');

    const [application] = await sql(
      `UPDATE teacher_applications SET
         status = COALESCE($2::text, status),
         owner_email = CASE WHEN $3::boolean THEN $4::text ELSE owner_email END,
         updated_at = now()
       WHERE id = $1
       RETURNING ${LIST_FIELDS}`,
      [id, status ?? null, ownerEmail !== undefined, ownerEmail ?? null],
    );

    if (status && status !== current.status) {
      await sql`
        INSERT INTO teacher_application_status_history (application_id, from_status, to_status, changed_by)
        VALUES (${id}, ${current.status}, ${status}, ${actor})
      `;
    }
    await audit(sql, actor, 'teacher_application.update', id, { status, ownerEmail, before: current });
    return ok(application);
  }

  // POST /hq/teachers/{id}/notes  { body }
  if (method === 'POST' && isNotes) {
    const body = typeof ctx.body.body === 'string' ? ctx.body.body.trim() : '';
    if (!body || body.length > 5000) return badRequest('Escribe una nota de hasta 5,000 caracteres.');
    const [exists] = await sql`SELECT 1 FROM teacher_applications WHERE id = ${id}`;
    if (!exists) return notFound('Postulación no encontrada');
    const [note] = await sql`
      INSERT INTO teacher_application_notes (application_id, author_email, body) VALUES (${id}, ${actor}, ${body})
      RETURNING id, author_email, body, created_at
    `;
    await sql`UPDATE teacher_applications SET updated_at = now() WHERE id = ${id}`;
    await audit(sql, actor, 'teacher_application.note', id, { noteId: (note as { id: string }).id });
    return created(note);
  }

  return null;
}
