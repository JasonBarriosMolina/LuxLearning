import { created, badRequest } from '../shared/response';
import { hashIp, type PlatformCtx } from './ctx';
import { sendTalentNotification, sendApplicantConfirmation } from './emails';

// Options must match apps/web/components/landing/teacher-application-options.ts
export const TEACHER_OPTIONS = {
  areas: ['Educación y docencia', 'Liderazgo y gestión', 'Negocios y ventas', 'Tecnología', 'Salud y bienestar', 'Idiomas', 'Arte y diseño', 'Ciencias', 'Desarrollo personal', 'Otra'],
  yearsProfessional: ['Menos de 2', '2 a 5', '6 a 10', 'Más de 10'],
  yearsTeaching: ['Aún no he enseñado', '1 a 2', '3 a 5', 'Más de 5'],
  education: ['Técnico', 'Licenciatura', 'Maestría', 'Doctorado', 'Otra'],
  liveInterest: ['Sí', 'Tal vez más adelante', 'No'],
  audiences: ['Escolar', 'Universitario', 'Empresas', 'Adultos y público general'],
  hasOnlineCourses: ['Sí', 'No'],
  courseModules: ['3 o 4', '5 o 6', '7 u 8', 'Más de 8', 'Aún no lo sé'],
  roles: ['Crear cursos', 'Revisar entregas y acompañar estudiantes'],
  hoursPerWeek: ['Menos de 5', '5 a 10', '11 a 20', 'Más de 20'],
  materials: ['Presentaciones', 'Videos', 'Guías o ejercicios', 'Aún no tengo material'],
  videoComfort: ['Muy cómodo', 'Cómodo', 'Me pone un poco nervioso', 'Prefiero no grabar'],
  equipment: ['Cámara', 'Micrófono', 'Aún no tengo equipo'],
} as const;

type Opt = typeof TEACHER_OPTIONS;
const FORM_VERSION = 1;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PER_IP_PER_HOUR = 5;
const MAX_PER_EMAIL_PER_DAY = 2;

export type TeacherAnswers = {
  areas: string[];
  areaOther: string | null;
  yearsProfessional: string;
  yearsTeaching: string;
  education: string;
  certifications: string | null;
  liveInterest: string;
  audiences: string[];
  hasOnlineCourses: string;
  onlineCourseUrl: string | null;
  courseTopic: string;
  courseAudience: string;
  courseOutcome: string;
  courseModules: string;
  roles: string[];
  hoursPerWeek: string;
  timezone: string | null;
  materials: string[];
  videoComfort: string;
  equipment: string[];
  motivation: string;
};

export type TeacherApplication = {
  name: string;
  email: string;
  phone: string | null;
  country: string;
  city: string | null;
  profileUrl: string | null;
  answers: TeacherAnswers;
  source: string;
};

type Result = { ok: true; value: TeacherApplication } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const opt = (v: unknown) => str(v) || null;

function one<K extends keyof Opt>(body: Record<string, unknown>, key: K): string | null {
  const v = str(body[key]);
  return (TEACHER_OPTIONS[key] as readonly string[]).includes(v) ? v : null;
}

function many<K extends keyof Opt>(body: Record<string, unknown>, key: K): string[] | null {
  const v = body[key];
  if (!Array.isArray(v) || v.length === 0) return null;
  const allowed = TEACHER_OPTIONS[key] as readonly string[];
  const clean = [...new Set(v.map(str))];
  return clean.every((x) => allowed.includes(x)) ? clean : null;
}

function isUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Validates the public application. Returns the clean application or a user-facing error. */
export function parseTeacherApplication(body: Record<string, unknown>): Result {
  const fail = (error: string): Result => ({ ok: false, error });

  const name = str(body.name);
  const email = str(body.email).toLowerCase();
  const phone = str(body.phone);
  const country = str(body.country);
  const city = str(body.city);
  const profileUrl = str(body.profileUrl);

  if (name.length < 2 || name.length > 120) return fail('Escribe tu nombre completo.');
  if (!EMAIL_RE.test(email) || email.length > 254) return fail('Escribe un correo válido.');
  if (phone.length > 40) return fail('El teléfono es demasiado largo.');
  if (country.length < 2 || country.length > 80) return fail('Escribe tu país.');
  if (city.length > 80) return fail('El nombre de la ciudad es demasiado largo.');
  if (profileUrl && (profileUrl.length > 300 || !isUrl(profileUrl))) return fail('Escribe un enlace válido a tu LinkedIn o portafolio.');
  if (body.consent !== true) return fail('Necesitamos tu autorización para contactarte.');

  const areas = many(body, 'areas');
  const yearsProfessional = one(body, 'yearsProfessional');
  const yearsTeaching = one(body, 'yearsTeaching');
  const education = one(body, 'education');
  const liveInterest = one(body, 'liveInterest');
  const audiences = many(body, 'audiences');
  const hasOnlineCourses = one(body, 'hasOnlineCourses');
  const courseModules = one(body, 'courseModules');
  const roles = many(body, 'roles');
  const hoursPerWeek = one(body, 'hoursPerWeek');
  const materials = many(body, 'materials');
  const videoComfort = one(body, 'videoComfort');
  const equipment = many(body, 'equipment');

  if (!areas) return fail('Elige al menos un área de especialidad.');
  const areaOther = str(body.areaOther);
  if (areas.includes('Otra') && (areaOther.length < 2 || areaOther.length > 80)) return fail('Cuéntanos cuál es tu otra área.');
  if (!yearsProfessional) return fail('Elige tus años de experiencia profesional.');
  if (!yearsTeaching) return fail('Elige tus años de experiencia enseñando.');
  if (!education) return fail('Elige tu nivel de formación.');
  if (!liveInterest) return fail('Cuéntanos si te interesa dar clases en vivo.');
  if (!audiences) return fail('Elige al menos un público con el que hayas trabajado.');
  if (!hasOnlineCourses) return fail('Cuéntanos si ya has creado cursos en línea.');
  const onlineCourseUrl = str(body.onlineCourseUrl);
  if (onlineCourseUrl && (onlineCourseUrl.length > 300 || !isUrl(onlineCourseUrl))) return fail('Escribe un enlace válido a tu curso.');

  const courseTopic = str(body.courseTopic);
  const courseAudience = str(body.courseAudience);
  const courseOutcome = str(body.courseOutcome);
  if (courseTopic.length < 3 || courseTopic.length > 150) return fail('Cuéntanos el tema de tu primer curso.');
  if (courseAudience.length < 3 || courseAudience.length > 300) return fail('Cuéntanos a quién va dirigido tu curso.');
  if (courseOutcome.length < 10 || courseOutcome.length > 1000) return fail('Cuéntanos qué logrará el estudiante al terminar.');
  if (!courseModules) return fail('Elige cuántos módulos imaginas.');

  if (!roles) return fail('Elige cómo te gustaría participar.');
  if (!hoursPerWeek) return fail('Elige cuántas horas por semana tienes disponibles.');
  if (!materials) return fail('Cuéntanos qué material tienes.');
  if (!videoComfort) return fail('Cuéntanos qué tan cómodo te sientes grabando video.');
  if (!equipment) return fail('Cuéntanos con qué equipo cuentas.');

  const motivation = str(body.motivation);
  if (motivation.length < 20 || motivation.length > 1500) return fail('Cuéntanos en unas líneas por qué quieres enseñar con Lux.');
  const certifications = str(body.certifications);
  if (certifications.length > 500) return fail('Las certificaciones no pueden pasar de 500 caracteres.');
  const timezone = str(body.timezone).slice(0, 64);

  return {
    ok: true,
    value: {
      name, email, phone: phone || null, country, city: city || null, profileUrl: profileUrl || null,
      source: (str(body.source) || 'landing').slice(0, 40),
      answers: {
        areas, areaOther: areas.includes('Otra') ? areaOther : null, yearsProfessional, yearsTeaching, education,
        certifications: opt(certifications), liveInterest, audiences, hasOnlineCourses,
        onlineCourseUrl: hasOnlineCourses === 'Sí' ? opt(onlineCourseUrl) : null,
        courseTopic, courseAudience, courseOutcome, courseModules, roles, hoursPerWeek, timezone: timezone || null,
        materials, videoComfort, equipment, motivation,
      },
    },
  };
}


/** POST /public/teacher-applications — no auth. Stores the application, then notifies talent and the applicant. */
export async function handleTeacherApplications(ctx: PlatformCtx): Promise<any | null> {
  if (!(ctx.method === 'POST' && ctx.path === '/public/teacher-applications')) return null;

  // Honeypot: people never see the "website" field, bots fill it. Pretend success.
  if (str(ctx.body.website)) return created({ received: true });

  const parsed = parseTeacherApplication(ctx.body);
  if (!parsed.ok) return badRequest(parsed.error);
  const app = parsed.value;

  const sql = await ctx.getSql();
  const ipHash = hashIp(ctx.event.requestContext.http.sourceIp ?? 'unknown');

  const [{ by_ip, by_email }] = (await sql`
    SELECT
      count(*) FILTER (WHERE ip_hash = ${ipHash} AND created_at > now() - interval '1 hour')::int AS by_ip,
      count(*) FILTER (WHERE lower(email) = ${app.email} AND created_at > now() - interval '1 day')::int AS by_email
    FROM teacher_applications
    WHERE created_at > now() - interval '1 day'
  `) as { by_ip: number; by_email: number }[];
  if (by_ip >= MAX_PER_IP_PER_HOUR || by_email >= MAX_PER_EMAIL_PER_DAY) {
    return badRequest('Ya recibimos tu postulación. Te escribiremos pronto, o contáctanos en talent@luxlearning.academy.');
  }

  const userAgent = (ctx.event.headers?.['user-agent'] ?? '').slice(0, 300);
  const [row] = (await sql`
    INSERT INTO teacher_applications (name, email, phone, country, city, profile_url, answers, form_version, source, ip_hash, user_agent)
    VALUES (${app.name}, ${app.email}, ${app.phone}, ${app.country}, ${app.city}, ${app.profileUrl},
            ${JSON.stringify(app.answers)}::jsonb, ${FORM_VERSION}, ${app.source}, ${ipHash}, ${userAgent})
    RETURNING id
  `) as { id: string }[];

  // The application is already saved; a mail failure must not make the applicant resend it.
  const results = await Promise.allSettled([
    sendTalentNotification({ ...app, id: row!.id }),
    sendApplicantConfirmation(app),
  ]);
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[teacher-applications] email ${i === 0 ? 'talent' : 'applicant'} failed:`, r.reason);
  });

  return created({ received: true });
}
