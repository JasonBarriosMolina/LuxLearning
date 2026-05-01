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
    aiFeedback: (text: string, moduleTitle?: string) =>
      request<any>('/evaluator/ai-feedback', { method: 'POST', body: JSON.stringify({ text, moduleTitle }) }),
    quizAudit: (userId: string, moduleId: string) =>
      request<any>(`/evaluator/quiz-audit?userId=${encodeURIComponent(userId)}&moduleId=${encodeURIComponent(moduleId)}`),
    setPriority: (userId: string, moduleId: string, priority: boolean) =>
      request<any>('/evaluator/reflections/priority', { method: 'POST', body: JSON.stringify({ userId, moduleId, priority }) }),
  },

  notifications: {
    list: () => request<GetNotificationsResponse>('/notifications'),
    markRead: (notifId: string) =>
      request('/notifications/read', { method: 'POST', body: JSON.stringify({ notifId }) }),
  },

  certificates: {
    get: (certId: string) => fetch(`${API_URL}/certificates/${certId}`).then((r) => r.json()),
    mine: () => request<any>('/my-certificates'),
    generate: (courseId: string) =>
      request<any>('/my-certificates/generate', { method: 'POST', body: JSON.stringify({ courseId }) }),
  },

  admin: {
    // Courses
    courses: {
      list: () => request<any>('/admin/courses'),
      get: (courseId: string) => request<any>(`/admin/courses/${courseId}`),
      create: (body: any) => request<any>('/admin/courses', { method: 'POST', body: JSON.stringify(body) }),
      update: (courseId: string, body: any) => request<any>(`/admin/courses/${courseId}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (courseId: string) => request<any>(`/admin/courses/${courseId}`, { method: 'DELETE' }),
    },
    // Modules
    modules: {
      create: (courseId: string, body: any) => request<any>(`/admin/courses/${courseId}/modules`, { method: 'POST', body: JSON.stringify(body) }),
      update: (moduleId: string, body: any) => request<any>(`/admin/modules/${moduleId}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (moduleId: string) => request<any>(`/admin/modules/${moduleId}`, { method: 'DELETE' }),
    },
    // Lessons
    lessons: {
      create: (moduleId: string, body: any) => request<any>(`/admin/modules/${moduleId}/lessons`, { method: 'POST', body: JSON.stringify(body) }),
      update: (lessonId: string, body: any) => request<any>(`/admin/lessons/${lessonId}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (lessonId: string) => request<any>(`/admin/lessons/${lessonId}`, { method: 'DELETE' }),
    },
    // Questions
    questions: {
      create: (moduleId: string, body: any) => request<any>(`/admin/modules/${moduleId}/questions`, { method: 'POST', body: JSON.stringify(body) }),
      update: (questionId: string, body: any) => request<any>(`/admin/questions/${questionId}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (questionId: string) => request<any>(`/admin/questions/${questionId}`, { method: 'DELETE' }),
    },
    // Users
    users: {
      list: () => request<any>('/admin/users'),
      invite: (body: { email: string; role: string; name?: string; courseIds?: string[] }) =>
        request<any>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
      changeRole: (username: string, role: string) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
      setStatus: (username: string, enabled: boolean) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}/status`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
      delete: (username: string) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
      getEnrollments: (username: string) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}/enrollments`),
      addEnrollment: (username: string, courseId: string) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}/enrollments`, { method: 'POST', body: JSON.stringify({ courseId }) }),
      removeEnrollment: (username: string, courseId: string) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}/enrollments`, { method: 'DELETE', body: JSON.stringify({ courseId }) }),
    },
  },
};
