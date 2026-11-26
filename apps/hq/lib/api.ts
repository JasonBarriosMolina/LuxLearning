import { getIdToken } from './auth';

const API_URL = process.env.NEXT_PUBLIC_HQ_API_URL ?? '';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new ApiError('Tu sesión terminó. Vuelve a iniciar sesión.', 401);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      res.status === 401 ? 'Tu sesión terminó. Vuelve a iniciar sesión.'
      : res.status === 403 ? (body?.error ?? 'Tu rol no tiene acceso a esta sección.')
      : (body?.error ?? 'No pudimos completar la acción. Inténtalo de nuevo.');
    throw new ApiError(message, res.status);
  }
  return (body?.data ?? body) as T;
}

export type Pipeline = 'leads' | 'teachers';
export type Note = { id: string; author_email: string; body: string; created_at: string };
export type HistoryItem = { from_status: string | null; to_status: string; changed_by: string; changed_at: string };
export type Counts = { status: string; total: number }[];

export type LeadRow = {
  id: string; created_at: string; updated_at: string; name: string; email: string; phone: string | null;
  organization: string; org_type: string; size_range: string; source: string; status: string; owner_email: string | null;
};
export type Lead = LeadRow & { message: string | null; user_agent: string | null };

export type TeacherRow = {
  id: string; created_at: string; updated_at: string; name: string; email: string; phone: string | null;
  country: string; city: string | null; status: string; owner_email: string | null;
  course_topic: string; areas: string[]; live_interest: string;
};
export type TeacherApplication = Omit<TeacherRow, 'course_topic' | 'areas' | 'live_interest'> & {
  profile_url: string | null; source: string; form_version: number; answers: Record<string, unknown>;
};

const qs = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request<{ email: string; groups: string[] }>('/hq/me'),
  leads: {
    list: (p: { status?: string; q?: string }) => request<{ leads: LeadRow[]; counts: Counts }>(`/hq/leads${qs(p)}`),
    get: (id: string) => request<{ lead: Lead; notes: Note[]; history: HistoryItem[] }>(`/hq/leads/${id}`),
    update: (id: string, body: { status?: string; ownerEmail?: string | null }) =>
      request<LeadRow>(`/hq/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    addNote: (id: string, body: string) => request<Note>(`/hq/leads/${id}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  },
  teachers: {
    list: (p: { status?: string; q?: string }) => request<{ applications: TeacherRow[]; counts: Counts }>(`/hq/teachers${qs(p)}`),
    get: (id: string) => request<{ application: TeacherApplication; notes: Note[]; history: HistoryItem[] }>(`/hq/teachers/${id}`),
    update: (id: string, body: { status?: string; ownerEmail?: string | null }) =>
      request<TeacherRow>(`/hq/teachers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    addNote: (id: string, body: string) => request<Note>(`/hq/teachers/${id}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  },
};
