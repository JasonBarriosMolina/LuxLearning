import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../platform/emails', () => ({
  sendTalentNotification: vi.fn().mockResolvedValue(undefined),
  sendApplicantConfirmation: vi.fn().mockResolvedValue(undefined),
}));

import { parseTeacherApplication, handleTeacherApplications } from '../../platform/teacher-applications';
import { handleTeachers } from '../../platform/teachers';
import type { PlatformCtx, Staff } from '../../platform/ctx';
import { sendTalentNotification } from '../../platform/emails';

const VALID = {
  name: 'Carlos Rojas',
  email: 'Carlos@Example.com',
  phone: '+506 8888 0000',
  country: 'Costa Rica',
  city: 'San José',
  profileUrl: 'https://www.linkedin.com/in/carlos',
  consent: true,
  areas: ['Liderazgo y gestión'],
  yearsProfessional: '6 a 10',
  yearsTeaching: '1 a 2',
  education: 'Maestría',
  liveInterest: 'Sí',
  audiences: ['Empresas'],
  hasOnlineCourses: 'No',
  courseTopic: 'Liderazgo para nuevos jefes',
  courseAudience: 'Personas recién ascendidas a un puesto de jefatura',
  courseOutcome: 'Dirigir reuniones efectivas y dar retroalimentación clara a su equipo.',
  courseModules: '5 o 6',
  roles: ['Crear cursos'],
  hoursPerWeek: '5 a 10',
  timezone: 'America/Costa_Rica',
  materials: ['Presentaciones'],
  videoComfort: 'Cómodo',
  equipment: ['Cámara', 'Micrófono'],
  motivation: 'Quiero ayudar a nuevos líderes a no cometer los errores que yo cometí.',
};

function makeCtx(over: Partial<PlatformCtx> & { sqlResults?: unknown[][] } = {}): PlatformCtx & { sqlCalls: unknown[] } {
  const results = [...(over.sqlResults ?? [])];
  const sqlCalls: unknown[] = [];
  const sql: any = vi.fn((...args: unknown[]) => {
    sqlCalls.push(args);
    return Promise.resolve(results.shift() ?? []);
  });
  return {
    event: { requestContext: { http: { method: 'POST', sourceIp: '1.2.3.4' } }, headers: {} } as any,
    method: 'POST',
    path: '/public/teacher-applications',
    body: {},
    getSql: async () => sql,
    staff: null,
    ...over,
    sqlCalls,
  };
}

const status = (res: any) => res?.statusCode;

describe('parseTeacherApplication', () => {
  it('accepts a complete application and normalizes it', () => {
    const r = parseTeacherApplication(VALID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.email).toBe('carlos@example.com');
    expect(r.value.answers.onlineCourseUrl).toBeNull();
    expect(r.value.answers.areaOther).toBeNull();
    expect(r.value.answers.liveInterest).toBe('Sí');
  });

  it('keeps the "other" area only when Otra is chosen', () => {
    const r = parseTeacherApplication({ ...VALID, areas: ['Otra'], areaOther: 'Gastronomía' });
    expect(r.ok && r.value.answers.areaOther).toBe('Gastronomía');
  });

  it.each([
    [{ consent: false }, 'autorización'],
    [{ email: 'no' }, 'correo'],
    [{ country: '' }, 'país'],
    [{ profileUrl: 'javascript:alert(1)' }, 'enlace'],
    [{ areas: [] }, 'área'],
    [{ areas: ['Astrología'] }, 'área'],
    [{ areas: ['Otra'], areaOther: '' }, 'otra área'],
    [{ liveInterest: 'Quizás' }, 'clases en vivo'],
    [{ roles: ['Dar clases en vivo'] }, 'participar'],
    [{ courseOutcome: 'corto' }, 'logrará'],
    [{ motivation: 'porque sí' }, 'por qué'],
  ])('rejects %o', (patch, fragment) => {
    const r = parseTeacherApplication({ ...VALID, ...patch });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(fragment);
  });
});

describe('handleTeacherApplications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ignores other routes', async () => {
    expect(await handleTeacherApplications(makeCtx({ path: '/public/demo-requests' }))).toBeNull();
  });

  it('pretends success for honeypot submissions without touching the DB', async () => {
    const ctx = makeCtx({ body: { ...VALID, website: 'spam' } });
    expect(status(await handleTeacherApplications(ctx))).toBe(201);
    expect(ctx.sqlCalls).toHaveLength(0);
  });

  it('rate-limits repeated applications from the same email', async () => {
    const ctx = makeCtx({ body: VALID, sqlResults: [[{ by_ip: 0, by_email: 2 }]] });
    expect(status(await handleTeacherApplications(ctx))).toBe(400);
  });

  it('stores the application and notifies talent', async () => {
    const ctx = makeCtx({ body: VALID, sqlResults: [[{ by_ip: 0, by_email: 0 }], [{ id: 'app-1' }]] });
    expect(status(await handleTeacherApplications(ctx))).toBe(201);
    expect(ctx.sqlCalls).toHaveLength(2);
    expect(sendTalentNotification).toHaveBeenCalledWith(expect.objectContaining({ id: 'app-1', email: 'carlos@example.com' }));
  });
});

describe('handleTeachers', () => {
  const dev: Staff = { sub: '2', email: 'd@x.com', groups: ['DEV'] };
  const owner: Staff = { sub: '1', email: 'o@x.com', groups: ['OWNER'] };

  it('ignores lead routes', async () => {
    expect(await handleTeachers(makeCtx({ method: 'GET', path: '/hq/leads', staff: owner }))).toBeNull();
  });

  it('forbids staff without OWNER or MARKETING', async () => {
    expect(status(await handleTeachers(makeCtx({ method: 'GET', path: '/hq/teachers', staff: dev })))).toBe(403);
  });

  it('rejects an unknown status', async () => {
    const ctx = makeCtx({
      method: 'PATCH',
      path: '/hq/teachers/7f2c1b9e-4a3d-4c5e-9f10-123456789abc',
      staff: owner,
      body: { status: 'HIRED' },
    });
    expect(status(await handleTeachers(ctx))).toBe(400);
  });

  it('records history when the status changes', async () => {
    const ctx = makeCtx({
      method: 'PATCH',
      path: '/hq/teachers/7f2c1b9e-4a3d-4c5e-9f10-123456789abc',
      staff: owner,
      body: { status: 'INTERVIEW' },
      sqlResults: [[{ status: 'REVIEWING', owner_email: null }], [{ id: 'x', status: 'INTERVIEW' }], [], []],
    });
    expect(status(await handleTeachers(ctx))).toBe(200);
    expect(ctx.sqlCalls).toHaveLength(4); // read, update, history, audit
  });
});
