import { getIdToken } from './auth';
import type {
  GetCoursesResponse,
  GetCourseResponse,
  MarkLessonCompleteRequest,
  SubmitQuizRequest,
  SubmitReflectionRequest,
  ReviewReflectionRequest,
  GetProgressResponse,
  GetNotificationsResponse,
} from '@lux/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getIdToken();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error ?? 'API error'), {
      statusCode: res.status,
      body: err,
    });
  }

  return res.json() as Promise<T>;
}

// ─── Courses ──────────────────────────────────────────────────────────────────

export const api = {
  courses: {
    list: () => request<GetCoursesResponse>('/courses'),
    get: (courseId: string) => request<GetCourseResponse>(`/courses/${courseId}`),
  },

  lessons: {
    complete: (body: MarkLessonCompleteRequest) =>
      request('/lessons/complete', { method: 'POST', body: JSON.stringify(body) }),
    progress: (courseId: string) =>
      request(`/lessons/progress?courseId=${courseId}`),
  },

  quiz: {
    submit: (moduleId: string, body: SubmitQuizRequest) =>
      request(`/quiz/${moduleId}/submit`, { method: 'POST', body: JSON.stringify(body) }),
    attempts: (moduleId: string) =>
      request(`/quiz/${moduleId}/attempts`),
  },

  reflection: {
    submit: (body: SubmitReflectionRequest) =>
      request('/reflection', { method: 'POST', body: JSON.stringify(body) }),
    get: (moduleId: string) =>
      request(`/reflection/${moduleId}`),
  },

  evaluator: {
    reflections: () => request('/evaluator/reflections'),
    review: (body: ReviewReflectionRequest) =>
      request('/evaluator/reflections/review', { method: 'POST', body: JSON.stringify(body) }),
    students: () => request('/evaluator/students'),
  },

  notifications: {
    list: () => request<GetNotificationsResponse>('/notifications'),
    markRead: (notifId: string) =>
      request('/notifications/read', { method: 'POST', body: JSON.stringify({ notifId }) }),
  },
};
